import { CellType, EsotericPull3D } from '@aeroflow/core';
import { hooks, lesCsOverride } from '../dev/testHooks';
import { Lbm3D } from './lbm3d';
import { computeTauField } from './tauOracle';

/**
 * Small-scene validation for the τ_eff oracle (M9 step 6).
 *
 * The oracle rebuilds the kernel's per-cell relaxation time from the raw DDF image, which
 * means it can be wrong in three silent ways — the −w_i FP16 storage shift, the Esoteric Pull
 * step parity, and the plane→split-buffer routing. Each of those produces a field that looks
 * like a plausible turbulence pattern rather than an obvious error, so the oracle is not
 * trusted until it passes here.
 *
 * **Check A — moment identity against the kernel itself (the decisive one).** Collision
 * conserves ρ and ρu. So the moments of the populations the oracle gathers at step k are
 * exactly the moments the kernel's own `write_macro` pass reports at step k+1. Both sides
 * read the same FP16 bytes, so they differ only by float summation order — parts in 1e7. A
 * wrong shift, a flipped parity or a mis-routed plane all corrupt this by O(1). This check
 * needs no CPU trajectory and is therefore immune to the chaos that makes long CPU/GPU
 * comparisons meaningless.
 *
 * **Check B — τ_eff against the CPU reference solver.** `EsotericPull3D` runs the same scene
 * in Float64 and exposes the same `collideCell` path, so a short run compares the actual
 * physics quantity rather than a proxy. FP16 storage against Float64 diverges as the flow
 * develops, so this runs for few steps and asserts a distribution-level agreement, not
 * cell-by-cell equality. Check A is the tight one; B is what catches a shared-formula error
 * that A cannot see, because A never touches the LES formula at all.
 */

const N = 32;
const STEPS = 60;
/** Moment identity is exact up to float summation order; 1e-4 relative is ~1000× slack. */
const MOMENT_TOL = 1e-4;
/** Mean |Δτ_eff|/(τ₀−½) between FP16 GPU and Float64 CPU after STEPS steps. */
const TAU_MEAN_TOL = 0.05;

export interface TauOracleCheckResult {
  grid: number;
  steps: number;
  parity: 0 | 1;
  fluidCells: number;
  freeSlipAdjacentSkipped: number;
  nonFinite: number;
  tau0: number;
  lesK: number;

  /** Check A. */
  momentCells: number;
  maxRhoRelError: number;
  maxUxAbsError: number;
  worstMomentCell: string;
  momentPass: boolean;

  /** Check B. */
  cpuTauMean: number;
  gpuTauMean: number;
  cpuTauMax: number;
  gpuTauMax: number;
  meanTauDeviation: number;
  tauPass: boolean;

  pass: boolean;
  summary: string;
}

/**
 * A duct with an asymmetric obstacle: enough shear to make τ_eff genuinely non-uniform, so a
 * broken reconstruction cannot pass by returning τ₀ everywhere. Deliberately NO FreeSlip
 * faces — the oracle skips free-slip-adjacent cells by design, and this check exists to
 * exercise the cells it does evaluate.
 */
function ductFlags(): Uint8Array {
  const flags = new Uint8Array(N * N * N).fill(CellType.Fluid);
  const at = (x: number, y: number, z: number): number => x + N * (y + N * z);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (y === 0 || y === N - 1 || z === 0 || z === N - 1) flags[at(x, y, z)] = CellType.Solid;
        else if (x === 0) flags[at(x, y, z)] = CellType.Inlet;
        else if (x === N - 1) flags[at(x, y, z)] = CellType.Outlet;
      }
    }
  }
  // Off-centre block — a symmetric one could hide an index-transposition error.
  for (let z = 12; z <= 19; z++) {
    for (let y = 9; y <= 17; y++) {
      for (let x = 8; x <= 13; x++) flags[at(x, y, z)] = CellType.BodySolid;
    }
  }
  return flags;
}

const TAU = 0.51;
const INLET_U = 0.05;
/** Cs the validation runs at unless one is supplied — the acceptance configuration's value. */
const DEFAULT_LES_CS = 0.1;

/**
 * `lesCs` exists for the M9 step-7 sweep. The oracle itself is Cs-agnostic — `computeTauField`
 * reads `sim.lesK` off the live solver rather than re-deriving it — so validating at 0.1 does
 * in principle cover every Cs. But every conclusion in that sweep is read THROUGH this oracle,
 * and "in principle" is not the standard the handoff doctrine sets for a measurement device.
 * Re-running the validation at each swept Cs costs seconds and removes the assumption.
 */
export async function runTauOracleCheck(
  device: GPUDevice,
  lesCs: number = DEFAULT_LES_CS,
): Promise<TauOracleCheckResult> {
  const LES_CS = lesCs;
  if (!device.features.has('shader-f16')) {
    throw new Error('τ_eff oracle check requires shader-f16 (the M9 acceptance storage path)');
  }
  // Cs = 0 gives lesK = 0, and `computeTauField` refuses to reconstruct a τ field with the LES
  // off (τ_eff would be the uniform τ₀, so there is nothing to validate). Say that, rather
  // than surfacing the oracle's internal error from three frames down.
  if (!(lesCs > 0)) {
    throw new Error(
      `τ_eff oracle check needs Cs > 0 (got ${lesCs}): with LES off τ_eff ≡ τ₀ and the ` +
        `reconstruction is vacuous`,
    );
  }
  const flags = ductFlags();
  let sim: Lbm3D | undefined;
  try {
    sim = new Lbm3D(device, {
      nx: N,
      ny: N,
      nz: N,
      omega: 1 / TAU,
      inletVel: INLET_U,
      collision: 'trt',
      les: { cs: LES_CS },
      conserveMass: true,
      precision: 'fp16',
      hasF16: true,
      maxBindingBytes: Math.min(
        device.limits.maxStorageBufferBindingSize,
        device.limits.maxBufferSize,
      ),
    });
    sim.flags.set(flags);
    sim.uploadFlags();
    sim.reset(1, 0, 0, 0);
    sim.submitSteps(STEPS);

    // --- Check A: moment identity -------------------------------------------------------
    const field = await computeTauField(sim);
    sim.submitSteps(1);
    const macro = await sim.readMacro();

    let maxRhoRel = 0;
    let maxUxAbs = 0;
    let worst = 'none';
    let momentCells = 0;
    for (let idx = 0; idx < flags.length; idx++) {
      if (field.evaluated[idx] !== 1) continue;
      momentCells++;
      const gpuRho = macro[4 * idx];
      const gpuUx = macro[4 * idx + 1];
      const rhoRel = Math.abs(field.rho[idx] - gpuRho) / Math.max(1e-12, Math.abs(gpuRho));
      const uxAbs = Math.abs(field.ux[idx] - gpuUx);
      if (rhoRel > maxRhoRel) {
        maxRhoRel = rhoRel;
        worst = `cell ${idx}: oracle ρ ${field.rho[idx].toPrecision(9)} vs kernel ${gpuRho.toPrecision(9)}`;
      }
      if (uxAbs > maxUxAbs) maxUxAbs = uxAbs;
    }
    // u is O(INLET_U); compare it on the same relative footing as ρ (which is O(1)).
    const momentPass = maxRhoRel <= MOMENT_TOL && maxUxAbs <= MOMENT_TOL * INLET_U * 10;

    // --- Check B: τ_eff against the Float64 CPU reference --------------------------------
    const cpu = new EsotericPull3D({
      nx: N,
      ny: N,
      nz: N,
      omega: 1 / TAU,
      flags,
      inletVelocity: INLET_U,
      collision: 'trt',
      les: { cs: LES_CS },
      conserveMass: true,
    });
    // The reference records the τ_eff it actually collided with, so this compares the
    // solver's own quantity — not a second derivation that could agree for the wrong reason.
    //
    // Alignment matters and is easy to get wrong by one: the oracle gathered the state AFTER
    // `STEPS` steps, i.e. the τ_eff the *next* step would use. So the reference runs STEPS
    // steps un-recorded, then records exactly one more. Recording from the start would
    // instead compare against step STEPS-1 and produce a plausible-but-shifted disagreement.
    for (let s = 0; s < STEPS; s++) cpu.step();
    cpu.tauEffRecord = new Float64Array(flags.length);
    cpu.step();
    const cpuTau = cpu.tauEffRecord;

    let cpuSum = 0;
    let gpuSum = 0;
    let devSum = 0;
    let cpuMax = 0;
    let gpuMax = 0;
    let cells = 0;
    const nuScale = TAU - 0.5;
    for (let idx = 0; idx < flags.length; idx++) {
      if (field.evaluated[idx] !== 1) continue;
      cells++;
      cpuSum += cpuTau[idx];
      gpuSum += field.tauEff[idx];
      devSum += Math.abs(field.tauEff[idx] - cpuTau[idx]) / nuScale;
      if (cpuTau[idx] > cpuMax) cpuMax = cpuTau[idx];
      if (field.tauEff[idx] > gpuMax) gpuMax = field.tauEff[idx];
    }
    const meanTauDeviation = cells ? devSum / cells : Number.NaN;
    const tauPass = meanTauDeviation <= TAU_MEAN_TOL;

    // A field that is τ₀ everywhere would pass both checks trivially. It must not.
    const nonUniform = gpuMax > sim.tau0 * 1.001;
    const pass =
      momentPass && tauPass && nonUniform && field.nonFinite === 0 && field.fluidCells > 0;

    const summary =
      `M9 τ_eff oracle ${N}³ fp16 LES: steps=${STEPS} parity=${field.parity} ` +
      `fluid=${field.fluidCells} skipped(freeSlip)=${field.freeSlipAdjacentSkipped} ` +
      `momentRhoRel=${maxRhoRel.toExponential(3)} momentUxAbs=${maxUxAbs.toExponential(3)} ` +
      `τmean cpu=${(cpuSum / cells).toFixed(6)} gpu=${(gpuSum / cells).toFixed(6)} ` +
      `meanDev=${(meanTauDeviation * 100).toFixed(2)}% ` +
      `τmax cpu=${cpuMax.toFixed(6)} gpu=${gpuMax.toFixed(6)} ` +
      `nonUniform=${nonUniform} ${pass ? 'PASS' : 'FAIL'}`;

    return {
      grid: N,
      steps: STEPS,
      parity: field.parity,
      fluidCells: field.fluidCells,
      freeSlipAdjacentSkipped: field.freeSlipAdjacentSkipped,
      nonFinite: field.nonFinite,
      tau0: field.tau0,
      lesK: field.lesK,
      momentCells,
      maxRhoRelError: maxRhoRel,
      maxUxAbsError: maxUxAbs,
      worstMomentCell: worst,
      momentPass,
      cpuTauMean: cpuSum / cells,
      gpuTauMean: gpuSum / cells,
      cpuTauMax: cpuMax,
      gpuTauMax: gpuMax,
      meanTauDeviation,
      tauPass,
      pass,
      summary,
    };
  } finally {
    sim?.destroy();
  }
}

export async function mountTauOracleCheck(device: GPUDevice, root: HTMLElement): Promise<void> {
  const lesCs = lesCsOverride() ?? undefined;
  root.innerHTML = `<p>Running M9 τ_eff oracle validation${lesCs === undefined ? '' : ` at Cs ${lesCs}`}...</p>`;
  try {
    const result = await runTauOracleCheck(device, lesCs);
    hooks().tauOracleCheck = result;
    root.innerHTML = `
      <h2>M9 τ_eff oracle validation${lesCs === undefined ? '' : ` — Cs ${lesCs}`}</h2>
      <p style="font-size:1.4em;font-weight:bold;color:${result.pass ? '#2a2' : '#c22'}">
        ${result.pass ? 'PASS' : 'FAIL'}
      </p>
      <pre>${result.summary}</pre>
      <p>Check A (moment identity vs kernel): ${result.momentPass ? 'PASS' : 'FAIL'}</p>
      <p>Check B (τ_eff vs CPU reference): ${result.tauPass ? 'PASS' : 'FAIL'}</p>
      <p>${result.worstMomentCell}</p>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hooks().tauOracleCheckError = message;
    root.innerHTML = `<pre style="color:#c22">τ_eff oracle check error:\n${message}</pre>`;
  }
}
