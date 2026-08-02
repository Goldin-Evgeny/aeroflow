import {
  AIJ_CASE_A,
  ConvergingAverager,
  ConvergingVelocityAverager,
  caseAScene,
  interpolateInflowToLattice,
  powerLawProfile,
  logLawProfile,
  sampleTrilinear,
  scoreCaseA,
  validateAijCaseAData,
  type AblSpec,
  type AijCaseAData,
  type CaseAScene,
  type CaseAScore,
} from '@aeroflow/core';
import { Lbm3D } from '../lbm3d';
import rawFixture from './data/aij-case-a.json';

/**
 * AIJ Case A GPU runner (M10 steps 5–7b): wires the core scene builder to the Lbm3D
 * driver and owns sampling, time-averaging, steadiness, and scoring. Three modes:
 *  - 'score': the benchmark run — MEASURED inflow (fixture), building at 0°, scores
 *    q/r against the fixture points. A synthetic fixture is scored for pipeline
 *    smoke-testing but the result is labeled SYNTHETIC and never a verdict (Hard rule 5).
 *  - 'fetch': same domain + inlet, building removed — the acceptance-3 empty-domain
 *    check (time-averaged profile at the building station vs the inlet profile, 5% gate
 *    from the second fluid node up to the reference height H).
 *  - 'demo': idealized ABL editor profile (power/log, full-scale SI heights) + the
 *    wind-direction dial (rotates the GEOMETRY — never the inflow; M10 pitfall).
 */

export const AIJ_FIXTURE: AijCaseAData = validateAijCaseAData(rawFixture);

/** Gates (M10 acceptance 3–4). */
export const CASE_A_GATES = { q: 0.66, r: 0.7, fetch: 0.05 } as const;

/** Spec minimum resolution (M10 step 5): ≥16 cells across b, else no verdict. */
export const MIN_CELLS_PER_B = 16;

export interface CaseARunOptions {
  mode: 'score' | 'fetch' | 'demo';
  cellsPerB: number;
  windDeg?: number;
  /** Demo-mode profile spec (full-scale SI: z in meters at scale×model height). */
  demoSpec?: AblSpec;
  precision?: 'fp16' | 'fp32';
  hasF16?: boolean;
  maxBindingBytes?: number;
  /** Negotiated `maxStorageBuffersPerShaderStage`; checked against the kernel's binding count. */
  maxStorageBuffersPerStage?: number;
}

/**
 * One entry per COMPLETED averaging window: the convergence trace (M10, 2026-07-20).
 * Acceptance 3's first real-GPU attempt timed out with the steadiness predicate still
 * false, so the gate was never evaluated and the run taught us nothing about how long
 * it actually needs — the convergence budget had been estimated on a 40×24×8 duct and
 * never measured on the real grid. Recording drift against step count makes the next
 * timeout a measurement instead of a dead end. Set the poll budget from this curve; do
 * NOT relax the physics gate (Hard rule 3).
 */
export interface ConvergenceSample {
  steps: number;
  windows: number;
  /** Max relative change of any point's windowed mean vs the previous window. */
  drift: number;
  /** Which sampled point set `drift` (fetch mode: index i ⇒ lattice row y = i + 1). */
  driftIndex: number;
  /** Max absolute change normalized by the largest windowed mean (well-conditioned). */
  driftScaled: number;
  /** Fetch mode: worst profile deviation at this window (the gated quantity). */
  fetchMaxRel?: number;
  /** Score mode: hit rate at this window. */
  q?: number;
}

export interface CaseASampleResult {
  totalSteps: number;
  windows: number;
  /** Max per-point relative drift of windowed means — reported for diagnostics only. */
  drift: number;
  /** True once `driftScaled` (peak-normalized) is below STEADY_DRIFT — see that const. */
  steady: boolean;
  score?: CaseAScore;
  /** Fetch mode: worst relative deviation over the gated heights + per-node rows. */
  fetch?: { maxRel: number; pass: boolean; rows: { y: number; sim: number; ref: number }[] };
  /** Convergence trace so far (one entry per completed window). */
  trace?: ConvergenceSample[];
  macro: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array };
}

/**
 * Steadiness criterion (spec step 6): the field is steady when no sampled point's
 * windowed mean moves by more than 1% of the field's PEAK magnitude between windows.
 *
 * Gated on `driftScaled`, not `drift` (M10, 2026-07-20). `drift` normalizes each point's
 * change by its OWN magnitude, so a near-ground node whose mean is ~0 pins the max at
 * >100% forever under LES turbulence — acceptance 3's first real-GPU run timed out with
 * the gate never evaluated (M10.md Status). `driftScaled` normalizes by the peak instead;
 * `packages/core/test/fetch-steadiness.test.ts` shows it is well-conditioned (≤ drift
 * always) and reachable on the converged fetch duct, and `aijCaseA.test.ts` isolates the
 * conditioning defect. This re-conditions the SAME 1% criterion — it does not relax the
 * separate 5% physics gate (Hard rule 3). Caveat carried by the recorded trace: a slow
 * compliant-BC sag has small per-window change, so a real-grid run whose sag crossed 5%
 * would show it in the convergence trace, not hide behind an early "steady".
 */
export const STEADY_DRIFT = 0.01;

export function demoInflow(spec: AblSpec, ny: number, dx: number): Float64Array {
  const out = new Float64Array(ny);
  for (let k = 0; k < ny; k++) {
    const zFull = (k + 0.5) * dx * AIJ_CASE_A.scale;
    out[k] =
      spec.kind === 'power'
        ? powerLawProfile(zFull, spec.zRef, spec.uRef, spec.alpha ?? 0.25)
        : logLawProfile(zFull, spec.z0 ?? 0.5, spec.uStar ?? 0.6);
  }
  return out;
}

export class CaseARun {
  readonly scene: CaseAScene;
  readonly mode: CaseARunOptions['mode'];
  readonly synthetic: boolean;
  /**
   * TRUE when the grid is below the spec's minimum resolution (M10 step 5: "resolve the
   * building with at least 16 cells across b"). Tier A e2e deliberately runs ?b=4 to
   * exercise the pipeline cheaply — such a run must never print a pass/fail verdict, for
   * the same reason a synthetic fixture must not (Hard rule 5). Before the real fixture
   * landed, `synthetic` alone happened to suppress every verdict; it no longer does.
   */
  readonly underResolved: boolean;
  private readonly gpu: Lbm3D;
  private readonly scalarAverager: ConvergingAverager | null;
  private readonly velocityAverager: ConvergingVelocityAverager | null;
  private readonly points: { x: number; y: number; z: number }[];
  private totalSteps = 0;
  private readonly trace: ConvergenceSample[] = [];
  private lastTracedWindow = 0;

  /** Legacy label kept for the HUD/e2e ("windows"); a "window" is now a convergence
   *  checkpoint of the cumulative mean (see ConvergingAverager). */
  static readonly WINDOW_SAMPLES = 20;

  constructor(device: GPUDevice, o: CaseARunOptions) {
    this.mode = o.mode;
    this.synthetic = AIJ_FIXTURE.synthetic === true;
    this.underResolved = o.cellsPerB < MIN_CELLS_PER_B;
    const spec = o.demoSpec ?? { kind: 'power', uRef: 6, zRef: 10, alpha: 0.25 };
    this.scene = caseAScene({
      cellsPerB: o.cellsPerB,
      windDeg: o.mode === 'demo' ? (o.windDeg ?? 0) : 0,
      emptyDomain: o.mode === 'fetch',
      inflowNormalized: (ny, dx) =>
        o.mode === 'demo'
          ? demoInflow(spec, ny, dx)
          : interpolateInflowToLattice(AIJ_FIXTURE.inflow, ny, dx),
    });
    const s = this.scene;
    this.gpu = new Lbm3D(device, {
      nx: s.nx,
      ny: s.ny,
      nz: s.nz,
      omega: s.omega,
      collision: 'trt',
      regularize: true,
      les: { cs: 0.1 },
      inletProfile: { axis: 'y', ux: Float32Array.from(s.profile) },
      velocityInlet: true,
      freeSlip: { yMax: true, zMin: true, zMax: true },
      precision: o.precision ?? 'fp32',
      hasF16: o.hasF16,
      maxBindingBytes: o.maxBindingBytes,
      maxStorageBuffersPerStage: o.maxStorageBuffersPerStage,
    });
    this.gpu.flags.set(s.flags);
    this.gpu.uploadFlags();
    this.gpu.reset(1, 0, 0, 0);

    if (o.mode === 'fetch') {
      // Probe the inlet-profile heights at the (empty) building station, mid-span.
      this.points = [];
      for (let y = 1; y < s.ny - 1; y++) {
        this.points.push({ x: s.centerX - 0.5, y, z: s.centerZ - 0.5 });
      }
    } else {
      this.points = AIJ_FIXTURE.points.map((p) => s.pointToLattice(p));
    }
    // AIJ scoring is a TIME MEAN over ≥10 domain flow-throughs (M10 pitfall). Discard a
    // startup transient, then accumulate one cumulative mean and detect convergence from
    // its checkpoint-to-checkpoint change. Thresholds scale with the streamwise
    // flow-through (nx / uLattice). Under-resolved runs (Tier A ?b=N smoke) never print a
    // verdict, so they skip the transient and checkpoint fast — otherwise SwiftShader
    // could not reach two checkpoints inside the e2e budget.
    const flowThrough = Math.max(1, Math.round(s.nx / s.uLattice));
    const transientSteps = this.underResolved ? 0 : 3 * flowThrough;
    const checkpointSteps = this.underResolved
      ? Math.max(1, Math.round(s.convectiveTimeSteps / 2))
      : flowThrough;
    this.scalarAverager =
      o.mode === 'fetch'
        ? new ConvergingAverager(this.points.length, transientSteps, checkpointSteps)
        : null;
    this.velocityAverager =
      o.mode === 'fetch'
        ? null
        : new ConvergingVelocityAverager(
            this.points.length,
            AIJ_FIXTURE.measurementStatistic,
            transientSteps,
            checkpointSteps,
          );
  }

  get convectiveTimeSteps(): number {
    return this.scene.convectiveTimeSteps;
  }

  /** Run `steps` more steps, take one sample, return the current state of the run. */
  async advance(steps: number): Promise<CaseASampleResult> {
    this.gpu.submitSteps(steps);
    this.totalSteps += steps;
    const raw = await this.gpu.readMacro();
    const s = this.scene;
    const n = s.nx * s.ny * s.nz;
    const rho = new Float32Array(n);
    const ux = new Float32Array(n);
    const uy = new Float32Array(n);
    const uz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      rho[i] = raw[4 * i];
      ux[i] = raw[4 * i + 1];
      uy[i] = raw[4 * i + 2];
      uz[i] = raw[4 * i + 3];
    }
    let stats;
    if (this.mode === 'fetch') {
      const sample = new Float64Array(this.points.length);
      for (let i = 0; i < this.points.length; i++) {
        const p = this.points[i];
        // Fetch gate compares the STREAMWISE component against the prescribed profile.
        sample[i] = sampleTrilinear(ux, s.nx, s.ny, s.nz, p.x, p.y, p.z);
      }
      this.scalarAverager!.add(sample, this.totalSteps);
      stats = this.scalarAverager!.stats();
    } else {
      const sampleUx = new Float64Array(this.points.length);
      const sampleUy = new Float64Array(this.points.length);
      const sampleUz = new Float64Array(this.points.length);
      for (let i = 0; i < this.points.length; i++) {
        const p = this.points[i];
        sampleUx[i] = sampleTrilinear(ux, s.nx, s.ny, s.nz, p.x, p.y, p.z);
        sampleUy[i] = sampleTrilinear(uy, s.nx, s.ny, s.nz, p.x, p.y, p.z);
        sampleUz[i] = sampleTrilinear(uz, s.nx, s.ny, s.nz, p.x, p.y, p.z);
      }
      this.velocityAverager!.add(sampleUx, sampleUy, sampleUz, this.totalSteps);
      stats = this.velocityAverager!.stats();
    }
    const result: CaseASampleResult = {
      totalSteps: this.totalSteps,
      windows: stats?.windows ?? 0,
      drift: stats?.drift ?? Infinity,
      steady: stats !== null && stats.driftScaled < STEADY_DRIFT,
      macro: { rho, ux, uy, uz },
    };
    if (stats) {
      if (this.mode === 'fetch') {
        // Gate: second fluid node (y = 2) up to the reference height H (spec accept. 3).
        const yTop = Math.min(s.ny - 2, Math.round(s.heightToY(AIJ_CASE_A.H)));
        const rows: { y: number; sim: number; ref: number }[] = [];
        let maxRel = 0;
        for (let y = 2; y <= yTop; y++) {
          const sim = stats.means[y - 1]; // points[] starts at y = 1
          const ref = s.profile[y];
          rows.push({ y, sim, ref });
          maxRel = Math.max(maxRel, Math.abs(sim - ref) / ref);
        }
        result.fetch = { maxRel, pass: maxRel <= CASE_A_GATES.fetch, rows };
      } else if (this.mode === 'score') {
        const norm = Array.from(stats.means, (m) => m / s.latticePerNormalized);
        result.score = scoreCaseA(AIJ_FIXTURE.points, norm);
      }
      // One trace entry per completed window (windows only ever increases).
      if (stats.windows > this.lastTracedWindow) {
        this.lastTracedWindow = stats.windows;
        this.trace.push({
          steps: this.totalSteps,
          windows: stats.windows,
          drift: stats.drift,
          driftIndex: stats.driftIndex,
          driftScaled: stats.driftScaled,
          fetchMaxRel: result.fetch?.maxRel,
          q: result.score?.q,
        });
      }
    }
    result.trace = this.trace;
    return result;
  }

  destroy(): void {
    this.gpu.destroy();
  }
}
