import {
  SPHERE_CASES,
  sphereScene,
  stlSphereScene,
  sphereDragCoefficient,
  sphereDragStats,
  validateFreeSlip,
  SPHERE_FREESLIP_FACES,
  type SphereCaseName,
  type Sphere3DScene,
  type StlSphereScene,
  type SphereDragStats,
  type LateralBC,
} from '@aeroflow/core';
import { Lbm3D, type Collision3D } from '../lbm3d';
import type { Precision } from '../../gpu/ddfLayout';

/**
 * M7 sphere-drag cases (steps 7–9): drive the D3Q19 kernel on an analytic sphere, collect
 * the momentum-exchange drag over time, and reduce it to a time-averaged Cd with the
 * running-mean convergence metric the acceptance gate needs. Also the FP16-vs-FP32 A/B
 * harness (step 9). Scene geometry + statistics live in @aeroflow/core (tested); this file
 * is the GPU glue (browser-only — WebGPU does not run in the node test harness).
 *
 * Cd normalization is dimensionless lattice units: Cd = Fx / (½·ρ0·u²·πR²) — no dx/dt
 * (M7 pitfall). Both precisions reset at REST (u=0) so their initial conditions are
 * bit-identical (fp16 storage only supports rest init, H5; and the A/B demands identical
 * seeds) — the flow then develops from the inlet.
 */

/** Literature pass bands (M7 acceptance criteria 1–3). */
export const SPHERE_TARGETS: Record<
  SphereCaseName,
  { target: number; band: [number, number]; note: string }
> = {
  Re100: { target: 1.09, band: [1.014, 1.166], note: 'Schiller–Naumann 1.092, ±7%' },
  Re1000: { target: 0.47, band: [0.423, 0.517], note: 'literature 0.46–0.47, ±10%' },
  Re10000: {
    target: 0.44,
    band: [0.38, 0.5],
    note: 'Newton-regime envelope; drift < 3% over final 20 T_c',
  },
};

export interface SphereRunOptions {
  precision?: Precision;
  /** Device grant for the fp16 native path (required when precision==='fp16'). */
  hasF16?: boolean;
  hasTimestamp?: boolean;
  /** Negotiated maxStorageBufferBindingSize — enables the multi-DDF split on big grids. */
  maxBindingBytes?: number;
  /** Negotiated `maxStorageBuffersPerShaderStage`; checked against the kernel's binding count. */
  maxStorageBuffersPerStage?: number;
  collision?: Collision3D;
  /**
   * Latt–Chopard velocity-stable regularization (H10). Default: ON for every near-floor τ
   * case (τ₀ < 0.51) — i.e. Re=1000 AND Re=10⁴. Plain TRT is Mach-unstable there, and LES
   * alone does NOT cure it (the M5 finding: Smagorinsky-TRT still blows up under-resolved at
   * high Re — regularization is the velocity-stable collision that does, and it stacks WITH
   * LES: regularize f^neq, then relax with the LES-augmented viscosity). Re=100 (τ₀=0.536)
   * stays plain TRT so its validated Cd is untouched. Pass explicitly to override.
   */
  regularize?: boolean;
  lateralBC?: LateralBC;
  /**
   * Pre-built scene override (M8 acceptance 2: the STL-sphere variant). Must carry the
   * same lattice parameters as the named case — only the flag field differs.
   */
  scene?: Sphere3DScene;
  /** Total run length in convective times T_c. Default 40 (laminar) / 120 (LES case). */
  totalConvectiveTimes?: number;
  /** Force-sample cadence in steps; forced EVEN (aliases the staggered mode, H2 §4a). */
  sampleIntervalSteps?: number;
  /** Called after each force sample for live plotting. `meanCd` is the post-transient mean. */
  onSample?: (s: { step: number; cd: number; meanCd: number; fy: number; fz: number }) => void;
  /** Cooperative cancel — return true to stop early (dev page teardown). */
  shouldStop?: () => boolean;
}

export interface SphereRunResult {
  scene: Sphere3DScene;
  precision: Precision;
  fxSeries: number[];
  cdSeries: number[];
  /** Mean |Fy|,|Fz| over the post-transient window — a symmetry sanity check (≈ 0). */
  meanAbsFy: number;
  meanAbsFz: number;
  stats: SphereDragStats;
  totalSteps: number;
  sampleIntervalSteps: number;
  /** True if Cd went non-finite (solver diverged) — the run was aborted early. */
  diverged: boolean;
  /** Step at which divergence was detected, or the last completed step. */
  lastStep: number;
}

function evenClamp(n: number): number {
  const e = Math.max(2, Math.round(n));
  return e % 2 === 0 ? e : e + 1;
}

/** Run one sphere case to `totalConvectiveTimes` T_c, sampling drag on an even cadence. */
export async function runSphereCase(
  device: GPUDevice,
  caseName: SphereCaseName,
  opts: SphereRunOptions = {},
): Promise<SphereRunResult> {
  const precision: Precision = opts.precision ?? 'fp32';
  const scene = opts.scene ?? sphereScene(SPHERE_CASES[caseName], { lateralBC: opts.lateralBC });
  const tc = scene.convectiveTimeSteps;
  const totalTc = opts.totalConvectiveTimes ?? (scene.les ? 120 : 40);
  const totalSteps = totalTc * tc;
  // ~10 samples per convective time by default (plenty for a running mean); always even.
  const sampleInterval = evenClamp(opts.sampleIntervalSteps ?? tc / 10);

  // H11 free-slip far field (Re=10⁴ confinement lever): all four lateral faces reflect
  // specularly; the scene keeps the outlet interior so validateFreeSlip's H11 §3.2
  // constraint holds. Enabled only for the 'freeslip' scene, so freestream/wall are byte-
  // identical to before.
  const freeSlip = scene.lateralBC === 'freeslip' ? SPHERE_FREESLIP_FACES : undefined;
  const sim = new Lbm3D(device, {
    nx: scene.nx,
    ny: scene.ny,
    nz: scene.nz,
    omega: scene.omega,
    inletVel: scene.uLattice,
    collision: opts.collision ?? 'trt',
    regularize: opts.regularize ?? scene.tau < 0.51,
    les: scene.les ? { cs: 0.1 } : undefined,
    precision,
    hasF16: opts.hasF16,
    hasTimestamp: opts.hasTimestamp,
    maxBindingBytes: opts.maxBindingBytes,
    maxStorageBuffersPerStage: opts.maxStorageBuffersPerStage,
    forces: true,
    freeSlip,
  });
  try {
    sim.flags.set(scene.flags);
    if (freeSlip) validateFreeSlip(scene.flags, scene.nx, scene.ny, scene.nz, freeSlip);
    sim.uploadFlags();
    sim.reset(1, 0, 0, 0); // rest init (identical across precisions; fp16 requires it)

    const fxSeries: number[] = [];
    const cdSeries: number[] = [];
    const fySeries: number[] = [];
    const fzSeries: number[] = [];
    const nSamples = Math.floor(totalSteps / sampleInterval);
    let runningSum = 0;
    let runningCount = 0;
    const transientSteps = 20 * tc;
    let diverged = false;
    let lastStep = 0;

    for (let i = 0; i < nSamples; i++) {
      if (opts.shouldStop?.()) break;
      const f = await sim.sampleForce(sampleInterval);
      const cd = sphereDragCoefficient(f.fx, scene.uLattice, scene.radius);
      lastStep = (i + 1) * sampleInterval;
      // Non-finite Cd ⇒ the solver blew up (near-floor τ Mach instability). Abort now rather
      // than grind through the whole run emitting NaN (which silently blanks the plot).
      if (!Number.isFinite(cd)) {
        diverged = true;
        break;
      }
      fxSeries.push(f.fx);
      cdSeries.push(cd);
      fySeries.push(f.fy);
      fzSeries.push(f.fz);
      if (lastStep >= transientSteps) {
        runningSum += cd;
        runningCount++;
      }
      opts.onSample?.({
        step: lastStep,
        cd,
        meanCd: runningCount > 0 ? runningSum / runningCount : cd,
        fy: f.fy,
        fz: f.fz,
      });
    }

    const stats = sphereDragStats(fxSeries, {
      sampleInterval,
      convectiveTimeSteps: tc,
      radius: scene.radius,
      u: scene.uLattice,
    });
    const firstIdx = Math.max(0, Math.ceil(transientSteps / sampleInterval) - 1);
    const post = <T>(a: T[]) => a.slice(firstIdx);
    const mean = (a: number[]) =>
      a.length ? a.reduce((s, v) => s + Math.abs(v), 0) / a.length : NaN;

    return {
      scene,
      precision,
      fxSeries,
      cdSeries,
      meanAbsFy: mean(post(fySeries)),
      meanAbsFz: mean(post(fzSeries)),
      stats,
      totalSteps,
      sampleIntervalSteps: sampleInterval,
      diverged,
      lastStep,
    };
  } finally {
    sim.destroy();
  }
}

export interface SphereAbResult {
  fp32: SphereRunResult;
  fp16: SphereRunResult;
  /** |Cd_fp16 − Cd_fp32| / Cd_fp32 — must be ≤ 0.02 (M7 acceptance 4). */
  relDiff: number;
  pass: boolean;
}

/**
 * FP16-vs-FP32 A/B for one case (step 9): identical scene, seed, and cadence, differing
 * only in DDF storage. Requires the device to grant shader-f16. If the A/B exceeds 2%,
 * first confirm the −w_i shifted store is active in the fp16 path before suspecting physics
 * (M7 pitfall) — it is, via Lbm3D's STORAGE_FP16 variant.
 */
export async function runSphereFp16Ab(
  device: GPUDevice,
  caseName: SphereCaseName,
  opts: SphereRunOptions = {},
): Promise<SphereAbResult> {
  if (!opts.hasF16) throw new Error('runSphereFp16Ab: device did not grant shader-f16');
  const fp32 = await runSphereCase(device, caseName, { ...opts, precision: 'fp32' });
  const fp16 = await runSphereCase(device, caseName, { ...opts, precision: 'fp16' });
  const relDiff = Math.abs(fp16.stats.meanCd - fp32.stats.meanCd) / Math.abs(fp32.stats.meanCd);
  return { fp32, fp16, relDiff, pass: relDiff <= 0.02 };
}

export interface StlSphereAbResult {
  analytic: SphereRunResult;
  stl: SphereRunResult;
  stlScene: StlSphereScene;
  /** |Cd_stl − Cd_analytic| / Cd_analytic — must be ≤ 0.02 (M8 acceptance 2). */
  relDiff: number;
  pass: boolean;
}

/**
 * M8 acceptance 2: the Re=1000 case run twice — analytic sphere mask (the M7 result) vs
 * a 20,480-triangle icosphere through the voxelizer — identical grid, τ, inflow, cadence,
 * and run length. The mesh radius is calibrated so both solid sets have the same voxel
 * count (the halfway-bounce-back like-with-like convention; see core/scenes/stlSphere3d.ts
 * for why comparing at the nominal radius would bias frontal area ~+6%). Gate: mean Cd
 * within 2%.
 */
export async function runStlVsAnalytic(
  device: GPUDevice,
  opts: SphereRunOptions = {},
): Promise<StlSphereAbResult> {
  const stlScene = stlSphereScene(SPHERE_CASES.Re1000, { lateralBC: opts.lateralBC });
  const analytic = await runSphereCase(device, 'Re1000', { ...opts, scene: undefined });
  const stl = await runSphereCase(device, 'Re1000', { ...opts, scene: stlScene });
  const relDiff =
    Math.abs(stl.stats.meanCd - analytic.stats.meanCd) / Math.abs(analytic.stats.meanCd);
  return { analytic, stl, stlScene, relDiff, pass: relDiff <= 0.02 };
}
