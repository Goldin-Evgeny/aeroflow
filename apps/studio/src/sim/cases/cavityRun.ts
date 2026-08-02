import {
  CellType,
  D2Q9,
  cavityScene2D,
  cavityCenterlines,
  compareToGhia,
  steadyStateResidual,
  SteadyStateDetector,
  STEADY_STATE_INTERVAL,
  STEADY_STATE_CRITERION,
  type CavityCenterlines,
  type CavityGhiaComparison,
  type CavityRe,
  type ResidualSample,
  type SteadyStateStop,
} from '@aeroflow/core';
import { Lbm2D } from '../lbm2d';

/**
 * M3 headline cavity runs on the GPU (M3 acceptance 1–3).
 *
 * Runs the shared `cavityScene2D` to steady state under the documented residual criterion,
 * extracts both centrelines, and scores them against Ghia 1982. The collision operator is
 * TRT (Λ=3/16), the project default — validating with BGK "temporarily" shifts the numbers
 * (M3.md pitfall "Collision operator mismatch").
 *
 * Convergence is decided ONLY by the residual — never by the picture, and never by a step
 * count that "looks like enough". A run that stops on its step/time budget is reported
 * `converged: false` and its numbers are not a result.
 *
 * Stopping uses `SteadyStateDetector`: the documented `R ≤ 1e-7` threshold first, and a
 * plateau rule for when the arithmetic cannot reach it. On this FP32 kernel the residual
 * floors around 3e-6 and the solution then *degrades* with further stepping, so stopping
 * at the floor is what makes the measurement correct — see the measured table in
 * `stats/steadyState.ts`. `stoppedOn` records which rule fired; a plateau stop must never
 * be reported as having met the 1e-7 threshold.
 */

export interface CavityRunOptions {
  /** Fluid interior side length in cells. 256 for Re=100, 512 for Re=1000. */
  H: number;
  Re: CavityRe;
  uLid?: number;
  /**
   * Floor on run length: no stopping rule may fire below this. The residual is a global
   * average and can go quiet while the *extrema* are still moving — measured at Re=1000,
   * where u_min was still shifting ~1 % between 150 k and 218 k steps. M3.md itself
   * expects "several ×10⁵ up to ~10⁶ steps" there, so a floor is the spec's own guidance.
   */
  minSteps?: number;
  /** Hard stop. Reaching it means NOT converged, never "close enough". */
  maxSteps?: number;
  /** Wall-clock budget in ms; same semantics as `maxSteps`. */
  maxMs?: number;
  /** H10 projected collision; off by default so recorded M3 runs remain unchanged. */
  regularize?: boolean;
  /** H13 finite-precision zeroth-moment correction; off by default. */
  conserveMass?: boolean;
  /** Optional fixed checkpoints for the long-run FP32 drift diagnostic. */
  diagnosticSteps?: readonly number[];
  onProgress?: (p: { steps: number; residual: number; elapsedMs: number }) => void;
}

export interface CavityRunDiagnostic {
  steps: number;
  residual: number;
  /** Total density over non-solid cells. */
  mass: number;
  /** Signed relative change from the initial mass. */
  massDriftRel: number;
  /** Simulated u_min at the Ghia extremum coordinate. */
  uMin: number;
  /** Predicted next-step mass change from independently rounded moving-wall additions. */
  movingWallRoundoffDelta: number;
}

export interface CavityRunResult {
  H: number;
  Re: CavityRe;
  uLid: number;
  nu: number;
  tau: number;
  regularize: boolean;
  conserveMass: boolean;
  totalSteps: number;
  converged: boolean;
  /** Which stopping rule fired. `budget` means the numbers are not a result. */
  stoppedOn: SteadyStateStop;
  /** Last residual sample. */
  residual: number;
  residualHistory: ResidualSample[];
  centerlines: CavityCenterlines;
  comparison: CavityGhiaComparison;
  diverged: boolean;
  elapsedMs: number;
  initialMass: number;
  finalMass: number;
  /** Signed relative change from initial mass. */
  massDriftRel: number;
  diagnostics: CavityRunDiagnostic[];
  /** The convergence criterion, verbatim — M3 acceptance 3 is that this is documented. */
  criterion: string;
}

/** Macroscopic velocity from a raw D2Q9 distribution array (no forcing on this scene). */
function macroVelocity(
  f: ArrayLike<number>,
  n: number,
  flags: Uint8Array,
  ux: Float64Array,
  uy: Float64Array,
): { finite: boolean; mass: number } {
  const ex = [0, 1, 0, -1, 0, 1, -1, -1, 1];
  const ey = [0, 0, 1, 0, -1, 1, 1, -1, -1];
  let finite = true;
  let mass = 0;
  for (let idx = 0; idx < n; idx++) {
    if (flags[idx] === CellType.Solid) {
      ux[idx] = 0;
      uy[idx] = 0;
      continue;
    }
    let rho = 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 9; i++) {
      const fi = f[i * n + idx];
      rho += fi;
      mx += ex[i] * fi;
      my += ey[i] * fi;
    }
    mass += rho;
    ux[idx] = mx / rho;
    uy[idx] = my / rho;
    if (!Number.isFinite(rho) || !Number.isFinite(mx) || !Number.isFinite(my)) finite = false;
  }
  return { finite, mass };
}

/**
 * Replay only the moving-wall additions in the GPU's f32 storage arithmetic. In exact
 * arithmetic the two tangential diagonal corrections cancel; storing each corrected
 * population separately can leave a non-zero sum. This predicts that boundary-only
 * roundoff without emulating collision.
 */
function movingWallRoundoffDelta(
  f: Float32Array,
  nx: number,
  ny: number,
  flags: Uint8Array,
  wallVelocity: Float64Array,
): number {
  const n = nx * ny;
  let delta = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const idx = y * nx + x;
      if (flags[idx] === CellType.Solid) continue;
      for (let i = 0; i < D2Q9.q; i++) {
        const sx = x - D2Q9.ex[i];
        const sy = y - D2Q9.ey[i];
        if (sx < 0 || sx >= nx || sy < 0 || sy >= ny) continue;
        const solidIdx = sy * nx + sx;
        if (flags[solidIdx] !== CellType.Solid) continue;
        const wallUx = Math.fround(wallVelocity[2 * solidIdx]);
        const wallUy = Math.fround(wallVelocity[2 * solidIdx + 1]);
        if (wallUx === 0 && wallUy === 0) continue;

        const dot = Math.fround(D2Q9.ex[i] * wallUx + D2Q9.ey[i] * wallUy);
        const correction = Math.fround(Math.fround(6 * Math.fround(D2Q9.w[i])) * dot);
        const base = f[D2Q9.opp[i] * n + idx];
        delta += Math.fround(base + correction) - base;
      }
    }
  }
  return delta;
}

export async function runCavity(
  device: GPUDevice,
  opts: CavityRunOptions,
): Promise<CavityRunResult> {
  const scene = cavityScene2D({ H: opts.H, Re: opts.Re, uLid: opts.uLid });
  const { nx, ny, H, flags, wallVelocity, uLid, nu, tau, omega } = scene;
  const n = nx * ny;
  const minSteps = opts.minSteps ?? 0;
  const maxSteps = opts.maxSteps ?? 4_000_000;
  const maxMs = opts.maxMs ?? 20 * 60_000;
  const regularize = opts.regularize ?? false;
  const conserveMass = opts.conserveMass ?? false;
  const diagnosticSteps = new Set(opts.diagnosticSteps ?? []);

  const gpu = new Lbm2D(device, nx, ny, {
    omega,
    uin: 0, // cavity starts at rest; there are no inlet cells
    collision: 'trt',
    lambda: 3 / 16,
    lesCs: 0,
    regularize,
    conserveMass,
  });

  const started = performance.now();
  const detector = new SteadyStateDetector();
  const residualHistory: ResidualSample[] = [];
  let totalSteps = 0;
  let stoppedOn: SteadyStateStop = 'running';
  let diverged = false;
  let residual = Number.POSITIVE_INFINITY;
  const diagnostics: CavityRunDiagnostic[] = [];

  let prevUx = new Float64Array(n);
  let prevUy = new Float64Array(n);
  let curUx = new Float64Array(n);
  let curUy = new Float64Array(n);

  try {
    gpu.flags.set(Uint32Array.from(flags));
    gpu.uploadFlags();
    gpu.setWallVelocity(Float32Array.from(wallVelocity));
    gpu.resetFlow();

    // Sample 0: the initial field (at rest), so the history starts where the run starts.
    const initial = macroVelocity(await gpu.readDistributions(), n, flags, prevUx, prevUy);
    const initialMass = initial.mass;
    let finalMass = initialMass;

    while (totalSteps < maxSteps) {
      gpu.submitSteps(STEADY_STATE_INTERVAL);
      totalSteps += STEADY_STATE_INTERVAL;

      const distributions = await gpu.readDistributions();
      const macro = macroVelocity(distributions, n, flags, curUx, curUy);
      finalMass = macro.mass;
      if (!macro.finite) {
        diverged = true;
        break;
      }

      residual = steadyStateResidual(prevUx, prevUy, curUx, curUy, flags, uLid);
      residualHistory.push({ step: totalSteps, residual });
      const verdict = detector.push(totalSteps, residual);
      const elapsedMs = performance.now() - started;
      opts.onProgress?.({ steps: totalSteps, residual, elapsedMs });

      if (diagnosticSteps.has(totalSteps)) {
        const lines = cavityCenterlines(curUx, curUy, H, uLid);
        const checkpointComparison = compareToGhia(lines, opts.Re);
        const uMin = checkpointComparison.extrema.find((entry) => entry.name === 'u_min');
        if (!uMin) throw new Error('cavity diagnostic: u_min comparison is missing');
        diagnostics.push({
          steps: totalSteps,
          residual,
          mass: finalMass,
          massDriftRel: (finalMass - initialMass) / initialMass,
          uMin: uMin.simulated,
          movingWallRoundoffDelta: movingWallRoundoffDelta(
            distributions,
            nx,
            ny,
            flags,
            wallVelocity,
          ),
        });
      }

      // Swap, so the next interval compares against this one (never against step 0).
      const tx = prevUx;
      const ty = prevUy;
      prevUx = curUx;
      prevUy = curUy;
      curUx = tx;
      curUy = ty;

      if (verdict !== 'running' && totalSteps >= minSteps) {
        stoppedOn = verdict;
        break;
      }
      if (elapsedMs > maxMs) {
        stoppedOn = 'budget';
        break;
      }
    }
    if (stoppedOn === 'running') stoppedOn = 'budget'; // fell out on maxSteps

    // prevUx/prevUy hold the most recent field after the swap above.
    const centerlines = cavityCenterlines(prevUx, prevUy, H, uLid);
    const comparison = compareToGhia(centerlines, opts.Re);

    return {
      H,
      Re: opts.Re,
      uLid,
      nu,
      tau,
      regularize,
      conserveMass,
      totalSteps,
      converged: stoppedOn === 'threshold' || stoppedOn === 'plateau',
      stoppedOn,
      residual,
      residualHistory,
      centerlines,
      comparison,
      diverged,
      elapsedMs: performance.now() - started,
      initialMass,
      finalMass,
      massDriftRel: (finalMass - initialMass) / initialMass,
      diagnostics,
      criterion: STEADY_STATE_CRITERION,
    };
  } finally {
    gpu.destroy();
  }
}

/** Report block for the page, the e2e artifact, and the milestone Status section. */
export function formatCavityRun(r: CavityRunResult): string {
  const tail = r.residualHistory.slice(-5).map((s) => `${s.step}:${s.residual.toExponential(2)}`);
  return [
    `Cavity Re=${r.Re} on ${r.H}² (domain ${r.H + 2}²) — TRT Λ=3/16, ` +
      `H10=${r.regularize ? 'on' : 'off'}, H13=${r.conserveMass ? 'on' : 'off'}, ` +
      `uLid=${r.uLid}`,
    `  ν=${r.nu} τ=${r.tau}`,
    `  steps ${r.totalSteps.toLocaleString()}  ${(r.elapsedMs / 1000).toFixed(1)} s  ` +
      `converged ${r.converged} (stopped on: ${r.stoppedOn})  diverged ${r.diverged}`,
    `  criterion: ${r.criterion}`,
    `  final residual ${r.residual.toExponential(2)}  (tail ${tail.join(' ')})`,
    `  mass ${r.finalMass.toFixed(8)}  signed drift ${r.massDriftRel.toExponential(3)}`,
    r.stoppedOn === 'plateau'
      ? `  NOTE: stopped at the FP32 residual floor, NOT at the 1e-7 threshold — the` +
        ` threshold is a Float64 statement this arithmetic cannot reach (see steadyState.ts).`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
