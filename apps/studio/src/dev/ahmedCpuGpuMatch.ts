import {
  AHMED,
  AHMED_FREESLIP_FACES,
  ahmedScene,
  CellType,
  D3Q19,
  EsotericPull3D,
  fieldStats,
  lateralFlux,
  sectionStats,
  upstreamStations,
  validateFreeSlip,
  wakeProbe,
  type AhmedInletBC,
  type AhmedLateralBC,
  type AhmedScene,
  type FieldStats,
  type LateralFlux,
  type Outlet3D,
  type WakeProbe,
} from '@aeroflow/core';
import { Lbm3D } from '../sim/lbm3d';
import { hooks } from './testHooks';

/**
 * M9 Phase 1 — matched-configuration CPU↔GPU reconciliation for the Ahmed body.
 *
 * ## The question
 *
 * After the single-parity force defect was fixed (H2 §4a), the corrected Ahmed Cd read
 * ~1.32–1.42 on the CPU reference and ~1.03–1.19 on the GPU. Before spending the
 * resolution ladder, one thing has to be settled: is that a genuine CPU/GPU discrepancy,
 * or is it entirely the two runs being different runs?
 *
 * They were never the same run. The known differences, all four of them:
 *
 *   - init:      CPU test `reset(1, uLattice, 0, 0)` (uniform flow) vs worker `reset(1,0,0,0)` (rest)
 *   - grid:      30k/60k cells (body ~20 cells long) vs 2M/8M (body ~124)
 *   - averaging: fixed 8·T…12·T window vs a block-agreement convergence stop
 *   - precision: Float64 vs fp16 storage at the acceptance tier
 *
 * ## Why this is two measurements and not one
 *
 * A separated bluff-body wake is chaotic. fp32 and Float64 seed different roundoff, and
 * that difference grows. So "do CPU and GPU agree?" has two different answers depending on
 * the horizon, and conflating them is how a roundoff artefact gets read as a solver bug (or
 * a solver bug gets excused as chaos):
 *
 *   **A. Trajectory parity (the discriminator).** Identical scene, identical config,
 *   identical rest init, compared at SHORT horizons. A structural CPU/GPU difference is
 *   O(1) immediately and visible at the first checkpoint. Roundoff is ~1e-6 and grows
 *   smoothly. Measuring at several horizons separates the two by the SHAPE of the growth,
 *   which a single number cannot do.
 *
 *   **B. Windowed Cd (the reconciliation).** The same averaging protocol on both sides,
 *   which is what actually reconciles a Cd against a Cd. Agreement here is statistical, not
 *   pointwise — two chaotic trajectories with the same statistics give the same mean Cd to
 *   within the sampling error of the window, and NOT to the parity bar. Reported with that
 *   caveat attached rather than gated against a tolerance it cannot be held to.
 *
 * ## The pair-averaging path is made identical, not merely similar
 *
 * `forceAveraged(k)` advances k steps and averages the last two, so repeated calls sample
 * pairs at steps (m·k−1, m·k). The CPU test's loop instead read f₁ at a multiple of k and
 * then took an EXTRA step for f₂ — pairs at (m·k, m·k+1), and one more step consumed per
 * sample, which shifts its entire trajectory relative to the GPU's. This harness drives the
 * CPU as `step(k−1)` → read f₁ → `step(1)` → read f₂, which reproduces `forceAveraged(k)`'s
 * grid exactly: same pair, same steps consumed.
 *
 * ## Phase 3 reuse: the cheap arm of the lateral-BC A/B
 *
 * Phase 1's answer was that the CPU and GPU agree, which makes this harness the cheapest place
 * to put a body in a free-slip tunnel and look at it: ~27 s per arm at 30k cells, both solvers,
 * on one page load. `runAhmedLateralAB` runs it twice — `lateralBC: 'freestream'` against
 * `'freeslip'` — with everything else held.
 *
 * Two things it can do that the GPU ladder structurally cannot:
 *
 *   - **Ground force.** The kernel weighs `BodySolid` links only; there is no GPU equivalent of
 *     the CPU's per-cell `forceMask`. `EsotericPull3D` carries both accumulators, so
 *     `force − maskedForce` is the floor's contribution — and "did the free-slip lid shift load
 *     onto the ground?" is one of the more plausible ways this A/B could mislead.
 *   - **Approach flow on the real geometry, early.** The core velocity decides whether the two
 *     arms are even the same flow (see below).
 *
 * ### What this harness must NOT be read as
 *
 * **The Cd here is WINDOWED SCREENING, never converged.** It is a fixed 20-sample window whose
 * standard error was measured at ±0.016 — a block-convergence stop is what produces a converged
 * Cd, and that lives in the ladder. Every Cd this file emits is labelled `Cd_windowed`
 * accordingly. Reading a screening delta as a result is the same error that put M7's struck
 * Cd 0.509 on record.
 *
 * ### The stop condition this harness exists to check
 *
 * Free-slip removes the hard-Dirichlet lateral cells that currently clamp the flow to u_in. If
 * the core velocity moves, the EFFECTIVE Reynolds number moved with it — ν and τ₀ are fixed by
 * the scene, so Re_eff ∝ u_core — and the two arms are no longer the same flow. That is a stop
 * for the phase, not a result to re-normalize away: `cdCore` recovers a coefficient but not a
 * Reynolds number, so no choice of denominator repairs it. `coreRatio` below is the number that
 * says whether it happened.
 */

/** Both sides run this; every field is reported so the match is auditable, not asserted. */
export interface AhmedMatchConfig {
  maxCells: number;
  Re: number;
  /** Steps before sampling starts. */
  warmupSteps: number;
  /** `k` — steps per sample, and the argument to `forceAveraged`. */
  sampleInterval: number;
  /** Pair-averaged samples collected after warmup. */
  samples: number;
  /** Short horizons for the trajectory comparison (phase A). */
  horizons: number[];
  /** Far field under test (phase 3). Default `'freestream'` — the historical configuration. */
  lateralBC: AhmedLateralBC;
  /** Inlet formulation under test (phase 3b). Default `'equilibrium'` — historical. */
  inletBC: AhmedInletBC;
  /** Outlet formulation under test (M9/V11). Default `'zero-gradient'` (H4) — historical;
   *  `'pressure'` opts into H14, validated so far only on the empty tunnel. */
  outlet: Outlet3D;
}

export interface TrajectoryPoint {
  steps: number;
  /** max relative error on ρ over fluid cells. */
  maxRelRho: number;
  /** max |Δu| / u_inlet over fluid cells. */
  maxRelU: number;
  /** Pair-averaged body force at this horizon, both sides. */
  cpuPairFx: number;
  gpuPairFx: number;
  /** The two raw consecutive forces behind each pair mean. */
  cpuRaw: [number, number];
  gpuRaw: [number, number];
  relPairFx: number;
  cpuCd: number;
  gpuCd: number;
}

/**
 * The windowed Cd. **Screening, not converged** — see the module docstring. The field names
 * carry the `Windowed` suffix so a number lifted out of this report cannot lose that label on
 * the way into a table.
 */
export interface WindowedCd {
  samples: number;
  cpuCdWindowed: number;
  gpuCdWindowed: number;
  cpuStd: number;
  gpuStd: number;
  relCd: number;
  /** Standard error of each mean — the scale agreement can be expected at. */
  cpuSem: number;
  gpuSem: number;
  /**
   * Mean |f₁ − f₂| / |½(f₁+f₂)| over the window's CPU pairs — the raw consecutive-step force
   * spread that phase 0 was about. At τ₀ → ½ the staggered momentum mode is weakly damped and
   * this runs to tens of percent (63% was measured on this scene at step 50), which is exactly
   * why a single-parity sample was corrupting the mean. Reported so a change in the far field
   * that also changed the staggering would be visible rather than hidden inside the average.
   */
  cpuRawPairSpread: number;
  /**
   * Body-only streamwise force (the Cd numerator) and the GROUND's contribution, both from the
   * CPU accumulators: `maskedForce.x` and `force.x − maskedForce.x`. The GPU has no equivalent
   * of the per-cell mask, so this split is CPU-only by construction.
   */
  cpuBodyFx: number;
  cpuGroundFx: number;
}

/**
 * One post-window readback of the settled field. All of it comes from a SINGLE `readMacro()`,
 * so it describes one instant and costs one round trip.
 */
export interface MatchDiagnostics {
  /** Commanded lattice velocity — the acceptance Cd's denominator, unconditionally. */
  uCommanded: number;
  /** Boundary-layer-excluded core velocity at the station nearest the nose. */
  coreUx: number;
  /** Mass-flux-weighted bulk velocity at the same station. */
  bulkUx: number;
  /**
   * coreUx / uCommanded. **The gate-2 number.** If this moves between arms, the effective
   * Reynolds number moved with it and the arms are not the same flow.
   */
  coreRatio: number;
  /** Re × coreRatio — the Reynolds number the flow is actually running at. */
  reEffective: number;
  /** Cd on the measured core velocity. A DIAGNOSTIC. Never the acceptance number. */
  cdCoreWindowed: number;
  field: FieldStats;
  lateral: LateralFlux;
  /** lateral.net / |inlet-station mass flux|. */
  lateralNetOverInflow: number;
  inFlux: number;
  outFlux: number;
  fluxMismatch: number;
  wake: WakeProbe;
}

export interface AhmedMatchReport {
  config: AhmedMatchConfig;
  scene: {
    nx: number;
    ny: number;
    nz: number;
    cells: number;
    lengthCells: number;
    bodyVoxels: number;
    frontalCells: number;
    blockage: number;
    noseX: number;
    dx: number;
    Re: number;
    uLattice: number;
    mach: number;
    tau0: number;
    omega: number;
    nu: number;
    convectiveTimeSteps: number;
  };
  lateralBC: AhmedLateralBC;
  inletBC: AhmedInletBC;
  outlet: Outlet3D;
  /** Every solver knob, both sides, so "matched" is checkable rather than claimed. */
  solver: Record<string, string>;
  trajectory: TrajectoryPoint[];
  windowed: WindowedCd;
  diagnostics: MatchDiagnostics;
  /** Phase A verdict: no structural discrepancy at the shortest horizon. */
  trajectoryPass: boolean;
  gpuErrors: string[];
  lines: string[];
  ms: number;
}

/**
 * Phase A bar. This is the `parity3d` bar (5e-5, the measured fp32 floor for D3Q19 over 100
 * steps) applied at the SHORTEST horizon only. Later horizons are reported, never gated:
 * they are expected to grow, and gating them would be gating chaos.
 */
const TRAJECTORY_BAR = 5e-5;

const CS2_INV_SQRT = Math.sqrt(3); // 1/c_s

/** ρ, ux, uy, uz per fluid cell from the CPU canonical distributions (mirrors parity3d). */
function cpuMacro(cpu: EsotericPull3D): Float64Array {
  const snap = cpu.snapshotCanonical();
  const n = cpu.n;
  const out = new Float64Array(4 * n);
  for (let idx = 0; idx < n; idx++) {
    if (cpu.flags[idx] !== CellType.Fluid) continue;
    let rho = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let i = 0; i < D3Q19.q; i++) {
      const fi = snap[i * n + idx];
      rho += fi;
      mx += D3Q19.ex[i] * fi;
      my += D3Q19.ey[i] * fi;
      mz += D3Q19.ez[i] * fi;
    }
    out[4 * idx] = rho;
    out[4 * idx + 1] = mx / rho;
    out[4 * idx + 2] = my / rho;
    out[4 * idx + 3] = mz / rho;
  }
  return out;
}

/**
 * One pair-averaged sample on the CPU, on `forceAveraged(k)`'s exact grid: k−1 steps, read
 * f₁, one step, read f₂. Consumes exactly k steps, like the GPU call.
 *
 * Also returns the GROUND's share of the same pair. `force` is every Solid link in the domain
 * and `maskedForce` is the BodySolid subset, so the difference is the floor — measured at 74.6%
 * of the total in `groundForceContamination.test.ts`, which is why the Cd numerator is the
 * masked one. Read on the same two steps as the body force so the two are directly comparable.
 */
function cpuPairSample(
  cpu: EsotericPull3D,
  k: number,
): { pair: number; raw: [number, number]; ground: number } {
  const groundOf = (): number => cpu.force.x - cpu.maskedForce.x;
  if (k > 1) cpu.step(k - 1);
  const f1 = cpu.maskedForce.x;
  const g1 = groundOf();
  cpu.step(1);
  const f2 = cpu.maskedForce.x;
  const g2 = groundOf();
  return { pair: 0.5 * (f1 + f2), raw: [f1, f2], ground: 0.5 * (g1 + g2) };
}

/**
 * The free-slip face set for a scene, read off the SCENE rather than off a caller's argument,
 * so the flag array and the solver config can never describe different boundaries.
 */
const facesFor = (scene: AhmedScene) =>
  scene.lateralBC === 'freeslip' ? AHMED_FREESLIP_FACES : undefined;

function buildCpu(scene: AhmedScene): EsotericPull3D {
  const cpu = new EsotericPull3D({
    nx: scene.nx,
    ny: scene.ny,
    nz: scene.nz,
    omega: scene.omega,
    flags: scene.flags.slice(), // the GPU gets its own copy too; neither may mutate the other's
    inletVelocity: scene.uLattice,
    collision: 'trt',
    les: { cs: AHMED_CS },
    regularize: true,
    conserveMass: true,
    freeSlip: facesFor(scene), // the constructor runs validateFreeSlip on these
    // No `forceMask`: `isMeasured` already selects CellType.BodySolid, which is exactly the
    // mask the kernel applies. Passing one would be a second, redundant definition.
    // No `velocityInlet` opt-in needed: the CPU solver keys off CellType.VelocityInlet in the
    // flags directly (ahmed3d.ts:170-172).
    outlet: scene.outlet,
  });
  cpu.reset(1, 0, 0, 0); // rest, matching the worker — NOT the uniform-flow init the old test used
  return cpu;
}

function buildGpu(device: GPUDevice, scene: AhmedScene): Lbm3D {
  const freeSlip = facesFor(scene);
  const gpu = new Lbm3D(device, {
    nx: scene.nx,
    ny: scene.ny,
    nz: scene.nz,
    omega: scene.omega,
    inletVel: scene.uLattice,
    collision: 'trt',
    les: { cs: AHMED_CS },
    regularize: true,
    conserveMass: true,
    forces: true,
    freeSlip,
    velocityInlet: scene.inletBC === 'velocity',
    outlet: scene.outlet,
    // fp32, NOT the acceptance tier's fp16: this run is asking whether the two
    // implementations agree, and fp16 storage noise would answer a different question.
    precision: 'fp32',
  });
  gpu.flags.set(scene.flags);
  if (freeSlip) validateFreeSlip(scene.flags, scene.nx, scene.ny, scene.nz, freeSlip);
  gpu.uploadFlags();
  gpu.reset(1, 0, 0, 0);
  return gpu;
}

/** The Ahmed run's Smagorinsky constant (sim/ahmedRun.ts AHMED_LES_CS), inlined to keep
 *  this dev harness free of a worker-module import. */
const AHMED_CS = 0.1;

export async function runAhmedMatch(
  device: GPUDevice,
  cfg: Partial<AhmedMatchConfig> = {},
): Promise<AhmedMatchReport> {
  const t0 = performance.now();
  const maxCells = cfg.maxCells ?? 30_000;
  const Re = cfg.Re ?? 4.29e6;
  const lateralBC = cfg.lateralBC ?? 'freestream';
  const inletBC = cfg.inletBC ?? 'equilibrium';
  const outlet = cfg.outlet ?? 'zero-gradient';
  const scene = ahmedScene({ maxCells, Re, lateralBC, inletBC, outlet });
  const T = scene.convectiveTimeSteps;

  const config: AhmedMatchConfig = {
    maxCells,
    Re,
    lateralBC,
    inletBC,
    outlet,
    warmupSteps: cfg.warmupSteps ?? 8 * T,
    sampleInterval: cfg.sampleInterval ?? Math.max(2, 2 * Math.round(T / 20)),
    samples: cfg.samples ?? 20,
    horizons: cfg.horizons ?? [25, 50, 100, 200, 400],
  };

  const gpuErrors: string[] = [];
  const onErr = (e: Event) => gpuErrors.push(String((e as GPUUncapturedErrorEvent).error.message));
  device.addEventListener('uncapturederror', onErr);

  const norm = 0.5 * scene.uLattice * scene.uLattice * scene.frontalCells;
  const trajectory: TrajectoryPoint[] = [];
  let windowed: WindowedCd;
  let diagnostics: MatchDiagnostics;

  try {
    // ---- Phase A: trajectory parity at increasing short horizons ----------------------
    // Each horizon is an INDEPENDENT pair of runs from the same rest state, so a horizon's
    // number is the divergence after exactly that many steps and not a running total
    // contaminated by the readbacks of the previous one.
    for (const h of config.horizons) {
      const cpu = buildCpu(scene);
      const gpu = buildGpu(device, scene);
      try {
        // Advance both to h−2, then take the pair over steps h−1 and h on each side.
        if (h > 2) {
          cpu.step(h - 2);
          gpu.submitSteps(h - 2);
        }
        const cpuS = cpuPairSample(cpu, 2);
        const gf = await gpu.forceAveraged(2);
        const gpuRaw = await (async () => {
          // forceAveraged returns only the mean; recover the two raw readings by replaying
          // the same two steps on a second GPU instance. Same kernel, same order — the
          // semantics gate measured this replay as bitwise-identical.
          const g2 = buildGpu(device, scene);
          try {
            if (h > 2) g2.submitSteps(h - 2);
            const a = await g2.sampleForce(1);
            const b = await g2.sampleForce(1);
            return [a.fx, b.fx] as [number, number];
          } finally {
            g2.destroy();
          }
        })();

        const macCpu = cpuMacro(cpu);
        const macGpu = await gpu.readMacro();
        let maxRelRho = 0;
        let maxRelU = 0;
        for (let idx = 0; idx < scene.nx * scene.ny * scene.nz; idx++) {
          if (scene.flags[idx] !== CellType.Fluid) continue;
          const rc = macCpu[4 * idx];
          const r = Math.abs(macGpu[4 * idx] - rc) / Math.max(Math.abs(rc), 1e-9);
          if (r > maxRelRho) maxRelRho = r;
          for (let c = 1; c <= 3; c++) {
            const e = Math.abs(macGpu[4 * idx + c] - macCpu[4 * idx + c]) / scene.uLattice;
            if (e > maxRelU) maxRelU = e;
          }
        }
        const relPairFx =
          Math.abs(gf.fx - cpuS.pair) / Math.max(Math.abs(cpuS.pair), 1e-30);
        trajectory.push({
          steps: h,
          maxRelRho,
          maxRelU,
          cpuPairFx: cpuS.pair,
          gpuPairFx: gf.fx,
          cpuRaw: cpuS.raw,
          gpuRaw,
          relPairFx,
          cpuCd: cpuS.pair / norm,
          gpuCd: gf.fx / norm,
        });
      } finally {
        gpu.destroy();
      }
    }

    // ---- Phase B: windowed Cd under an identical averaging protocol -------------------
    const cpu = buildCpu(scene);
    const gpu = buildGpu(device, scene);
    try {
      cpu.step(config.warmupSteps);
      gpu.submitSteps(config.warmupSteps);
      const cpuCds: number[] = [];
      const gpuCds: number[] = [];
      const rawSpreads: number[] = [];
      const bodyFx: number[] = [];
      const groundFx: number[] = [];
      for (let s = 0; s < config.samples; s++) {
        const c = cpuPairSample(cpu, config.sampleInterval);
        cpuCds.push(c.pair / norm);
        bodyFx.push(c.pair);
        groundFx.push(c.ground);
        rawSpreads.push(Math.abs(c.raw[0] - c.raw[1]) / Math.max(Math.abs(c.pair), 1e-30));
        const g = await gpu.forceAveraged(config.sampleInterval);
        gpuCds.push(g.fx / norm);
      }
      const stat = (v: number[]): { mean: number; std: number } => {
        const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
        const std = Math.sqrt(
          v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, v.length),
        );
        return { mean, std };
      };
      const c = stat(cpuCds);
      const g = stat(gpuCds);
      windowed = {
        samples: config.samples,
        cpuCdWindowed: c.mean,
        gpuCdWindowed: g.mean,
        cpuStd: c.std,
        gpuStd: g.std,
        cpuSem: c.std / Math.sqrt(Math.max(1, config.samples)),
        gpuSem: g.std / Math.sqrt(Math.max(1, config.samples)),
        relCd: Math.abs(g.mean - c.mean) / Math.max(Math.abs(c.mean), 1e-30),
        cpuRawPairSpread: stat(rawSpreads).mean,
        cpuBodyFx: stat(bodyFx).mean,
        cpuGroundFx: stat(groundFx).mean,
      };

      // ---- Settled-field diagnostics, from ONE readback -------------------------------
      // Taken after the window so it describes the flow the Cd above was measured in. The
      // core velocity here is the gate-2 number: it decides whether the two arms are the
      // same flow at all, which no amount of re-normalizing can repair after the fact.
      const macro = await gpu.readMacro();
      const { nx, ny, nz } = scene;
      const stations = upstreamStations(scene.noseX).map((x) =>
        sectionStats(macro, gpu.flags, nx, ny, nz, x),
      );
      const ref = stations[stations.length - 1];
      const inSec = sectionStats(macro, gpu.flags, nx, ny, nz, 1);
      const outSec = sectionStats(macro, gpu.flags, nx, ny, nz, nx - 2);
      const lateral = lateralFlux(macro, gpu.flags, nx, ny, nz);
      const inScale = Math.max(Math.abs(inSec.massFlux), 1e-30);
      const mmPerCell = scene.dx * 1e3;
      const slantDx = AHMED.slantChord * Math.cos((25 * Math.PI) / 180);
      diagnostics = {
        uCommanded: scene.uLattice,
        coreUx: ref.coreMeanUx,
        bulkUx: ref.bulkUx,
        coreRatio: ref.coreMeanUx / scene.uLattice,
        reEffective: (scene.Re * ref.coreMeanUx) / scene.uLattice,
        cdCoreWindowed:
          ref.coreMeanUx > 0
            ? windowed.cpuBodyFx / (0.5 * ref.coreMeanUx * ref.coreMeanUx * scene.frontalCells)
            : Number.NaN,
        field: fieldStats(macro, gpu.flags, nx, ny, nz),
        lateral,
        lateralNetOverInflow: lateral.net / inScale,
        inFlux: inSec.massFlux,
        outFlux: outSec.massFlux,
        fluxMismatch: Math.abs(outSec.massFlux - inSec.massFlux) / inScale,
        wake: wakeProbe(macro, gpu.flags, {
          nx,
          ny,
          nz,
          noseX: scene.noseX,
          bodyLength: Math.round(scene.lengthCells),
          bodyHeight: Math.round((AHMED.groundClearance + AHMED.height) / mmPerCell),
          slantStartX: Math.round(scene.noseX + (AHMED.length - slantDx) / mmPerCell),
        }),
      };
    } finally {
      gpu.destroy();
    }
  } finally {
    device.removeEventListener('uncapturederror', onErr);
  }

  const first = trajectory[0];
  const trajectoryPass =
    first !== undefined &&
    first.maxRelRho <= TRAJECTORY_BAR &&
    first.maxRelU <= TRAJECTORY_BAR &&
    gpuErrors.length === 0;

  const solver: Record<string, string> = {
    'grid (nx×ny×nz)': `${scene.nx}×${scene.ny}×${scene.nz} = ${scene.nx * scene.ny * scene.nz} cells`,
    'body': `${scene.bodyVoxels} voxels, ${scene.lengthCells.toFixed(1)} cells long, frontal ${scene.frontalCells} cells²`,
    'blockage': `${(scene.blockage * 100).toFixed(2)} %`,
    'dx': `${(scene.dx * 1e3).toFixed(2)} mm`,
    'Re (on body length)': scene.Re.toExponential(3),
    'u_lattice / Mach': `${scene.uLattice} / ${(scene.uLattice * CS2_INV_SQRT).toFixed(4)}`,
    'τ₀ / ω': `${(1 / scene.omega).toFixed(9)} / ${scene.omega.toFixed(6)}`,
    'ν_lattice': scene.nu.toExponential(4),
    'LES Cs': `${AHMED_CS} (both)`,
    'collision': 'TRT (both), default Λ',
    'regularize / conserveMass': 'true / true (both)',
    'precision': 'CPU Float64 / GPU fp32 storage',
    'BCs':
      scene.lateralBC === 'freeslip'
        ? 'Inlet x=0, H11 FREE-SLIP top/sides, Outlet x=nx−1 (strictly interior, H11 §3.2), ' +
          'Solid ground y=0 — identical flags array both sides'
        : 'Inlet x=0 + top/sides (hard Dirichlet), Outlet x=nx−1, Solid ground y=0 — identical flags array',
    'lateralBC': scene.lateralBC,
    'inletBC': scene.inletBC,
    'outlet': scene.outlet,
    'force mask': 'CellType.BodySolid both sides (CPU isMeasured, GPU cellForce mask)',
    'init': 'reset(1, 0, 0, 0) — rest, both sides',
    'T_conv': `${T} steps`,
    'warmup / interval / samples': `${config.warmupSteps} / ${config.sampleInterval} / ${config.samples}`,
    'pair path': 'GPU forceAveraged(k); CPU step(k−1)→f₁→step(1)→f₂ — same grid, same steps consumed',
  };

  const lines = [
    `${trajectoryPass ? 'PASS' : 'FAIL'} ahmed-match trajectory @${first?.steps ?? 0} steps: ` +
      `rho=${(first?.maxRelRho ?? NaN).toExponential(2)} u=${(first?.maxRelU ?? NaN).toExponential(2)} ` +
      `(bar ${TRAJECTORY_BAR.toExponential(0)})`,
    ...trajectory.map(
      (t) =>
        `  @${String(t.steps).padStart(4)}: rho=${t.maxRelRho.toExponential(2)} ` +
        `u=${t.maxRelU.toExponential(2)} pairFx rel=${t.relPairFx.toExponential(2)} ` +
        `Cd cpu=${t.cpuCd.toFixed(4)} gpu=${t.gpuCd.toFixed(4)}`,
    ),
    `  Cd_windowed [SCREENING, NOT CONVERGED] (${windowed!.samples} samples, ${scene.lateralBC}): ` +
      `cpu=${windowed!.cpuCdWindowed.toFixed(4)}±${windowed!.cpuSem.toFixed(4)} ` +
      `gpu=${windowed!.gpuCdWindowed.toFixed(4)}±${windowed!.gpuSem.toFixed(4)} ` +
      `rel=${(windowed!.relCd * 100).toFixed(1)}%`,
    `  forces (CPU): body Fx=${windowed!.cpuBodyFx.toExponential(4)}  ` +
      `ground Fx=${windowed!.cpuGroundFx.toExponential(4)}  ` +
      `ground/body=${(windowed!.cpuGroundFx / windowed!.cpuBodyFx).toFixed(3)}  |  ` +
      `raw consecutive-pair spread=${(windowed!.cpuRawPairSpread * 100).toFixed(1)}%`,
    `  approach: u_cmd=${diagnostics!.uCommanded} core=${diagnostics!.coreUx.toFixed(5)} ` +
      `(coreU/u_cmd=${diagnostics!.coreRatio.toFixed(4)})  Re_eff=${diagnostics!.reEffective.toExponential(3)}` +
      `  [GATE 2 — if this moves between arms they are not the same flow]`,
    `  Cd_core=${diagnostics!.cdCoreWindowed.toFixed(4)} (DIAGNOSTIC ONLY — never the acceptance number)`,
    `  flux: in=${diagnostics!.inFlux.toExponential(3)} out=${diagnostics!.outFlux.toExponential(3)} ` +
      `mismatch=${diagnostics!.fluxMismatch.toExponential(2)}  |  lateral net=${diagnostics!.lateral.net.toExponential(3)} ` +
      `(top=${diagnostics!.lateral.top.toExponential(2)} zMin=${diagnostics!.lateral.zMin.toExponential(2)} ` +
      `zMax=${diagnostics!.lateral.zMax.toExponential(2)}; ground layer u_y term ` +
      `${diagnostics!.lateral.groundLayerUy.toExponential(2)} excluded) ` +
      `net/in=${diagnostics!.lateralNetOverInflow.toExponential(2)}`,
    `  field: massDrift=${diagnostics!.field.massDriftRel.toExponential(2)} ` +
      `rho[${diagnostics!.field.rhoMin.toFixed(6)}, ${diagnostics!.field.rhoMax.toFixed(6)}] ` +
      `Ma=${diagnostics!.field.machMax.toFixed(4)} nonFinite=${diagnostics!.field.nonFiniteCells}`,
    `  wake: baseReverse=${diagnostics!.wake.baseReverseFraction.toFixed(3)} ` +
      `slantReverse=${diagnostics!.wake.slantReverseFraction.toFixed(3)} ` +
      `recirc=${diagnostics!.wake.recircLengthCells} cells (${diagnostics!.wake.recircLengthBodyLengths.toFixed(3)} L) ` +
      `| omega_x: GammaL=${diagnostics!.wake.gammaLeft.toExponential(3)} ` +
      `GammaR=${diagnostics!.wake.gammaRight.toExponential(3)} ` +
      `asym=${diagnostics!.wake.cPillarAsymmetry.toFixed(3)} ` +
      `peak=${diagnostics!.wake.peakAbsOmegaX.toExponential(2)}`,
  ];

  return {
    config,
    lateralBC: scene.lateralBC,
    inletBC: scene.inletBC,
    outlet: scene.outlet,
    diagnostics: diagnostics!,
    scene: {
      nx: scene.nx,
      ny: scene.ny,
      nz: scene.nz,
      cells: scene.nx * scene.ny * scene.nz,
      lengthCells: scene.lengthCells,
      bodyVoxels: scene.bodyVoxels,
      frontalCells: scene.frontalCells,
      blockage: scene.blockage,
      noseX: scene.noseX,
      dx: scene.dx,
      Re: scene.Re,
      uLattice: scene.uLattice,
      mach: scene.uLattice * CS2_INV_SQRT,
      tau0: 1 / scene.omega,
      omega: scene.omega,
      nu: scene.nu,
      convectiveTimeSteps: T,
    },
    solver,
    trajectory,
    windowed: windowed!,
    trajectoryPass,
    gpuErrors,
    lines,
    ms: performance.now() - t0,
  };
}

/** Both arms of the phase-3 far-field A/B, plus the comparison that is the actual deliverable. */
export interface AhmedLateralAbReport {
  freestream: AhmedMatchReport;
  freeslip: AhmedMatchReport;
  lines: string[];
  /**
   * Did the effective Reynolds number move? **Gate 2.** True means the free-slip arm is not
   * running the same flow as the freestream arm, the A/B has stopped isolating the boundary
   * condition, and the phase stops here rather than proceeding to a converged ladder.
   */
  reConfound: boolean;
  ms: number;
}

/**
 * Threshold for "the effective Reynolds number materially moved".
 *
 * 2% on coreU/u_cmd, chosen against what phase 2 already measured rather than picked round:
 * the hard-Dirichlet empty tunnel sits 2.2–3.8% ABOVE commanded, so the arms already differ
 * from unity by that much and the question is whether they differ from EACH OTHER by more.
 * This is not an acceptance tolerance — nothing in docs/VALIDATION.md is being restated — it
 * is the trip wire on a stop condition, and it is deliberately tight: proceeding to an
 * expensive converged ladder on two flows at different Reynolds numbers is the expensive
 * mistake, and stopping to look is the cheap one.
 */
const RE_CONFOUND_GATE = 0.02;

export async function runAhmedLateralAB(
  device: GPUDevice,
  cfg: Partial<AhmedMatchConfig> = {},
): Promise<AhmedLateralAbReport> {
  const t0 = performance.now();
  const freestream = await runAhmedMatch(device, { ...cfg, lateralBC: 'freestream' });
  const freeslip = await runAhmedMatch(device, { ...cfg, lateralBC: 'freeslip' });

  const a = freestream.diagnostics;
  const b = freeslip.diagnostics;
  const coreShift = Math.abs(b.coreRatio - a.coreRatio) / Math.max(Math.abs(a.coreRatio), 1e-30);
  const reConfound = coreShift > RE_CONFOUND_GATE;

  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const row = (label: string, x: number, y: number, digits = 4): string =>
    `    ${label.padEnd(24)} freestream ${x.toFixed(digits).padStart(12)}   ` +
    `freeslip ${y.toFixed(digits).padStart(12)}   ` +
    `${(Math.abs(x) > 0 ? `${(y / x).toFixed(3)}x` : '—').padStart(9)}`;

  const lines = [
    '## Phase 3 Stage B1 — Ahmed body, hard-Dirichlet vs free-slip far field',
    '',
    `grid ${freestream.scene.nx}x${freestream.scene.ny}x${freestream.scene.nz} = ` +
      `${freestream.scene.cells} cells   body ${freestream.scene.bodyVoxels} voxels / ` +
      `frontal ${freestream.scene.frontalCells} cells^2   blockage ` +
      `${(freestream.scene.blockage * 100).toFixed(2)}%   tau0 ${freestream.scene.tau0.toFixed(9)}`,
    '',
    'EVERY Cd BELOW IS Cd_windowed — a fixed-window screening number, NOT converged. A',
    'converged Cd comes from the ladder\'s block-agreement stop and from nowhere else. Do not',
    'quote these as results; they exist to decide whether the ladder is worth running.',
    '',
    row('Cd_windowed (CPU)', freestream.windowed.cpuCdWindowed, freeslip.windowed.cpuCdWindowed),
    row('Cd_windowed (GPU)', freestream.windowed.gpuCdWindowed, freeslip.windowed.gpuCdWindowed),
    row('  +/- sem (CPU)', freestream.windowed.cpuSem, freeslip.windowed.cpuSem),
    row('body Fx (CPU)', freestream.windowed.cpuBodyFx, freeslip.windowed.cpuBodyFx, 8),
    row('ground Fx (CPU)', freestream.windowed.cpuGroundFx, freeslip.windowed.cpuGroundFx, 8),
    row('raw pair spread', freestream.windowed.cpuRawPairSpread, freeslip.windowed.cpuRawPairSpread),
    '',
    row('coreU / u_cmd', a.coreRatio, b.coreRatio),
    `    ${'Re_effective'.padEnd(24)} freestream ${a.reEffective.toExponential(3).padStart(12)}   ` +
      `freeslip ${b.reEffective.toExponential(3).padStart(12)}`,
    row('Cd_core (diagnostic)', a.cdCoreWindowed, b.cdCoreWindowed),
    '',
    row('flux mismatch', a.fluxMismatch, b.fluxMismatch, 6),
    row('lateral net / inFlux', a.lateralNetOverInflow, b.lateralNetOverInflow, 6),
    row('mass drift', a.field.massDriftRel, b.field.massDriftRel, 8),
    row('Ma max', a.field.machMax, b.field.machMax),
    `    ${'non-finite'.padEnd(24)} freestream ${String(a.field.nonFiniteCells).padStart(12)}   ` +
      `freeslip ${String(b.field.nonFiniteCells).padStart(12)}`,
    '',
    row('wake baseReverse', a.wake.baseReverseFraction, b.wake.baseReverseFraction),
    row('wake slantReverse', a.wake.slantReverseFraction, b.wake.slantReverseFraction),
    row('recirc length (L)', a.wake.recircLengthBodyLengths, b.wake.recircLengthBodyLengths),
    row('omega_x Gamma_L', a.wake.gammaLeft, b.wake.gammaLeft, 6),
    row('omega_x Gamma_R', a.wake.gammaRight, b.wake.gammaRight, 6),
    row('C-pillar asymmetry', a.wake.cPillarAsymmetry, b.wake.cPillarAsymmetry),
    row('peak |omega_x|', a.wake.peakAbsOmegaX, b.wake.peakAbsOmegaX, 6),
    '',
    reConfound
      ? `*** GATE 2 TRIPPED: coreU/u_cmd moved ${pct(coreShift)} (> ${pct(RE_CONFOUND_GATE)}). ` +
        `The free-slip arm is running at Re_eff ${b.reEffective.toExponential(3)} against the ` +
        `freestream arm's ${a.reEffective.toExponential(3)} — these are NOT the same flow, so ` +
        `the Cd delta above is not attributable to the boundary condition. STOP: do not run ` +
        `the converged ladder. Cd_core does NOT repair this (it recovers a coefficient, not a ` +
        `Reynolds number); the remedy is the H12 VelocityInlet, as a separate variable. ***`
      : `GATE 2 CLEAR: coreU/u_cmd moved ${pct(coreShift)} (<= ${pct(RE_CONFOUND_GATE)}), so both ` +
        `arms are running at effectively the same Reynolds number and the Cd delta is ` +
        `attributable to the far field.`,
  ];

  return { freestream, freeslip, lines, reConfound, ms: performance.now() - t0 };
}

/**
 * Both arms of the M9/V11 BC-baseline A/B (H11+H12+H14 vs the historical configuration),
 * plus the comparison.
 *
 * **Diagnostic only — this A/B does not decide which configuration V11 uses.** H11+H12+H14
 * is the physically validated boundary configuration independent of what this A/B shows; the
 * historical arm exists only as the control every prior withdrawn Cd was measured against, and
 * because it's a cheap way to catch a construction mistake (crash, non-finite, an H4 §10.9
 * violation) before spending the expensive GPU tier — never as a way to pick a "winning" BC by
 * which one reads closer to 0.285 (`ahmedRun.ts:372-388` documents exactly this trap on the
 * sphere case: a lateral-BC switch alone moved Cd 0.55→0.263, 2.1x, on normalization alone).
 */
export interface AhmedBaselineAbReport {
  historical: AhmedMatchReport;
  validated: AhmedMatchReport;
  lines: string[];
  /** Same gate-2 meaning as `AhmedLateralAbReport.reConfound` — did the effective Reynolds
   *  number move between arms, which would mean they are not comparable flows. */
  reConfound: boolean;
  ms: number;
}

export async function runAhmedBaselineAB(
  device: GPUDevice,
  cfg: Partial<Pick<AhmedMatchConfig, 'maxCells' | 'Re' | 'warmupSteps' | 'sampleInterval' | 'samples' | 'horizons'>> = {},
): Promise<AhmedBaselineAbReport> {
  const t0 = performance.now();
  const historical = await runAhmedMatch(device, {
    ...cfg,
    lateralBC: 'freestream',
    inletBC: 'equilibrium',
    outlet: 'zero-gradient',
  });
  const validated = await runAhmedMatch(device, {
    ...cfg,
    lateralBC: 'freeslip',
    inletBC: 'velocity',
    outlet: 'pressure',
  });

  const a = historical.diagnostics;
  const b = validated.diagnostics;
  const coreShift = Math.abs(b.coreRatio - a.coreRatio) / Math.max(Math.abs(a.coreRatio), 1e-30);
  const reConfound = coreShift > RE_CONFOUND_GATE;

  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const row = (label: string, x: number, y: number, digits = 4): string =>
    `    ${label.padEnd(24)} historical ${x.toFixed(digits).padStart(12)}   ` +
    `H11+H12+H14 ${y.toFixed(digits).padStart(12)}   ` +
    `${(Math.abs(x) > 0 ? `${(y / x).toFixed(3)}x` : '—').padStart(9)}`;

  const lines = [
    '## M9/V11 baseline A/B — historical (freestream/equilibrium/H4) vs validated (H11+H12+H14)',
    '',
    'Diagnostic smoke test only (30-60k cells). Does NOT decide which configuration V11 uses —',
    'H11+H12+H14 is the physically validated baseline regardless of what Cd this shows.',
    '',
    `grid ${historical.scene.nx}x${historical.scene.ny}x${historical.scene.nz} = ` +
      `${historical.scene.cells} cells   body ${historical.scene.bodyVoxels} voxels / ` +
      `frontal ${historical.scene.frontalCells} cells^2   blockage ` +
      `${(historical.scene.blockage * 100).toFixed(2)}%   tau0 ${historical.scene.tau0.toFixed(9)}`,
    '',
    'EVERY Cd BELOW IS Cd_windowed — a fixed-window screening number, NOT converged. Not a',
    'result; exists only to catch a construction mistake before the expensive GPU tier.',
    '',
    row('Cd_windowed (CPU)', historical.windowed.cpuCdWindowed, validated.windowed.cpuCdWindowed),
    row('Cd_windowed (GPU)', historical.windowed.gpuCdWindowed, validated.windowed.gpuCdWindowed),
    row('body Fx (CPU)', historical.windowed.cpuBodyFx, validated.windowed.cpuBodyFx, 8),
    row('ground Fx (CPU)', historical.windowed.cpuGroundFx, validated.windowed.cpuGroundFx, 8),
    '',
    row('coreU / u_cmd', a.coreRatio, b.coreRatio),
    `    ${'Re_effective'.padEnd(24)} historical ${a.reEffective.toExponential(3).padStart(12)}   ` +
      `H11+H12+H14 ${b.reEffective.toExponential(3).padStart(12)}`,
    row('flux mismatch', a.fluxMismatch, b.fluxMismatch, 6),
    row('mass drift', a.field.massDriftRel, b.field.massDriftRel, 8),
    row('Ma max', a.field.machMax, b.field.machMax),
    `    ${'non-finite'.padEnd(24)} historical ${String(a.field.nonFiniteCells).padStart(12)}   ` +
      `H11+H12+H14 ${String(b.field.nonFiniteCells).padStart(12)}`,
    '',
    reConfound
      ? `*** GATE 2 TRIPPED: coreU/u_cmd moved ${pct(coreShift)} (> ${pct(RE_CONFOUND_GATE)}). ` +
        `The two arms are running at different effective Reynolds numbers — expected, since ` +
        `this A/B changes three BCs at once; it is a smoke test, not an isolating experiment. ***`
      : `GATE 2 CLEAR: coreU/u_cmd moved ${pct(coreShift)} (<= ${pct(RE_CONFOUND_GATE)}).`,
    '',
    `historical: ${historical.gpuErrors.length === 0 ? 'no GPU errors' : historical.gpuErrors.join('; ')}`,
    `H11+H12+H14: ${validated.gpuErrors.length === 0 ? 'no GPU errors' : validated.gpuErrors.join('; ')}`,
  ];

  return { historical, validated, lines, reConfound, ms: performance.now() - t0 };
}

export async function mountAhmedBaselineAB(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running the Ahmed BC-baseline A/B (M9/V11, smoke test)…</p>';
  try {
    const r = await runAhmedBaselineAB(device);
    hooks().ahmedBaselineAB = r;
    root.innerHTML = `
      <h2>Ahmed BC-baseline A/B <small>(M9/V11 — diagnostic smoke test)</small></h2>
      <p style="font-size:1.2em;font-weight:bold;color:${r.reConfound ? '#c22' : '#2a2'}">
        ${r.reConfound ? 'GATE 2 TRIPPED — effective Re moved between arms' : 'gate 2 clear'}
        — ${(r.ms / 1000).toFixed(1)} s
      </p>
      <pre style="white-space:pre-wrap">${r.lines.join('\n')}</pre>
      <h3>historical arm</h3>
      <pre style="white-space:pre-wrap">${r.historical.lines.join('\n')}</pre>
      <h3>H11+H12+H14 arm</h3>
      <pre style="white-space:pre-wrap">${r.validated.lines.join('\n')}</pre>`;
  } catch (e) {
    hooks().ahmedBaselineAbError = String(e);
    root.innerHTML = `<pre style="color:#c22">ahmed-baseline error:\n${String(e)}</pre>`;
  }
}

export async function mountAhmedLateralAB(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running the Ahmed lateral-BC A/B (M9 phase 3, stage B1)…</p>';
  try {
    const r = await runAhmedLateralAB(device);
    hooks().ahmedLateralAB = r;
    root.innerHTML = `
      <h2>Ahmed lateral-BC A/B <small>(M9 phase 3, stage B1 — screening)</small></h2>
      <p style="font-size:1.2em;font-weight:bold;color:${r.reConfound ? '#c22' : '#2a2'}">
        ${r.reConfound ? 'GATE 2 TRIPPED — effective Re moved; stop here' : 'gate 2 clear'}
        — ${(r.ms / 1000).toFixed(1)} s
      </p>
      <pre style="white-space:pre-wrap">${r.lines.join('\n')}</pre>
      <h3>freestream arm</h3>
      <pre style="white-space:pre-wrap">${r.freestream.lines.join('\n')}</pre>
      <h3>free-slip arm</h3>
      <pre style="white-space:pre-wrap">${r.freeslip.lines.join('\n')}</pre>`;
  } catch (e) {
    hooks().ahmedLateralAbError = String(e);
    root.innerHTML = `<pre style="color:#c22">ahmed-lateral error:\n${String(e)}</pre>`;
  }
}

export async function mountAhmedMatch(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running matched-config Ahmed CPU↔GPU reconciliation (M9 Phase 1)…</p>';
  try {
    const r = await runAhmedMatch(device);
    hooks().ahmedMatch = r;
    const rows = (o: Record<string, string>): string =>
      Object.entries(o)
        .map(([k, v]) => `<tr><td style="padding-right:1em"><b>${k}</b></td><td>${v}</td></tr>`)
        .join('');
    root.innerHTML = `
      <h2>Ahmed CPU↔GPU matched-config reconciliation <small>(M9 Phase 1)</small></h2>
      <p style="font-size:1.3em;font-weight:bold;color:${r.trajectoryPass ? '#2a2' : '#c22'}">
        trajectory parity ${r.trajectoryPass ? 'PASS' : 'FAIL'} — ${(r.ms / 1000).toFixed(1)} s
      </p>
      <h3>Configuration (identical unless stated)</h3>
      <table style="border-collapse:collapse">${rows(r.solver)}</table>
      <h3>A — trajectory parity</h3>
      <pre style="white-space:pre-wrap">${r.lines.join('\n')}</pre>
      <h3>B — raw consecutive forces per horizon</h3>
      <table style="border-collapse:collapse">
        <tr><th>steps</th><th>CPU f₁, f₂</th><th>CPU pair</th><th>GPU f₁, f₂</th><th>GPU pair</th><th>rel</th></tr>
        ${r.trajectory
          .map(
            (t) =>
              `<tr><td>${t.steps}</td>
                 <td>${t.cpuRaw[0].toExponential(4)}, ${t.cpuRaw[1].toExponential(4)}</td>
                 <td>${t.cpuPairFx.toExponential(4)}</td>
                 <td>${t.gpuRaw[0].toExponential(4)}, ${t.gpuRaw[1].toExponential(4)}</td>
                 <td>${t.gpuPairFx.toExponential(4)}</td>
                 <td>${t.relPairFx.toExponential(2)}</td></tr>`,
          )
          .join('')}
      </table>
      ${r.gpuErrors.length ? `<pre style="color:#c22">GPU errors:\n- ${r.gpuErrors.join('\n- ')}</pre>` : ''}`;
  } catch (e) {
    hooks().ahmedMatchError = String(e);
    root.innerHTML = `<pre style="color:#c22">ahmed-match error:\n${String(e)}</pre>`;
  }
}
