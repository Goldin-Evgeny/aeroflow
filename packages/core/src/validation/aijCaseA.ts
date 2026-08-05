import { hitRate, pearson } from './score.js';
import { validateAijAttribution, type AijAttribution } from './aijAttribution.js';
import type { ResolvedVelocityStatistic } from '../stats/velocityTimeAverage.js';

/**
 * AIJ Case A fixture schema + scoring utilities (M10 steps 5–6).
 *
 * The data file (apps/studio/src/sim/cases/data/aij-case-a.json) holds the Meng & Hibi
 * wind-tunnel measurements distributed by AIJ (https://www.aij.or.jp/jpn/publish/
 * cfdguide/index_e.htm). Coordinates are MODEL-SCALE METERS in the DATA convention:
 * origin at the building center on the ground, x streamwise (+x downstream), y lateral,
 * z vertical (up). Velocities are mean speeds normalized by the dataset's reference
 * velocity — the fixture states the convention (`uRef`) and every consumer must use it
 * unchanged (normalizing by anything else silently destroys the hit rate — M10 pitfall).
 *
 * The repo's lattice is y-up; `pointToLattice` maps data (x, y, z) → lattice (x, z, y)
 * in continuous cell coordinates (halfway bounce-back: ground plane half a cell below
 * the first fluid node).
 */

export interface AijInflowPoint {
  /** Height above ground, model-scale meters. */
  z: number;
  /** Mean streamwise velocity, normalized by the dataset reference. */
  u: number;
}

export interface AijMeasurementPoint {
  /** Data-convention coordinates, model-scale meters (origin: building center, ground). */
  x: number;
  y: number;
  z: number;
  /** Measured mean speed, normalized by the dataset reference. */
  u: number;
}

export interface AijCaseAData {
  /** Citation: where the numbers came from (URL + retrieval note). */
  source: string;
  /**
   * Citations, processing and AIJ's disclaimer — required of every real AIJ-derived
   * fixture (see aijAttribution.ts), absent only on a synthetic placeholder, which is
   * not AIJ data and must never be scored anyway.
   */
  attribution?: AijAttribution;
  /**
   * TRUE for the schema-development placeholder. A synthetic fixture exercises the
   * pipeline but MUST NEVER be scored as a validation result (Hard rule 5) — runners
   * refuse to print a pass/fail verdict when set.
   */
  synthetic?: boolean;
  /** Normalization convention for every `u` in this view (free prose, stated once). */
  uRef: string;
  /** The reference speed itself, m/s — the divisor applied to the raw measurements. */
  uRefMps: number;
  /** Statistic reconstructible from the workbook's tabulated mean U/V/W components. */
  measurementStatistic: ResolvedVelocityStatistic;
  /** Prism width b, model-scale meters (the raw fixture's length unit). */
  bMeters: number;
  /** Measured approach-flow profile (the mandatory scoring inlet). */
  inflow: AijInflowPoint[];
  /** Measurement points with mean velocities, over the SCORED planes only. */
  points: AijMeasurementPoint[];
}

/**
 * On-disk fixture shape: the AIJ workbook transcribed VERBATIM — lengths in multiples
 * of b, velocities in raw m/s. Keeping the file raw makes it an immutable record of the
 * wind-tunnel measurement; the normalization below is the only place a reference
 * velocity is applied, so it stays visible and testable instead of baked into the data.
 * Produced by scripts/convert-aij-case-a.py.
 */
export interface AijCaseARawPoint {
  xOverB: number;
  yOverB: number;
  zOverB: number;
  U: number;
  V: number;
  W: number;
}

export interface AijCaseARawPlane {
  name: string;
  points: AijCaseARawPoint[];
}

export interface AijCaseARaw {
  source: string;
  attribution?: AijAttribution;
  synthetic?: boolean;
  uRef: string;
  uRefMps: number;
  bMeters: number;
  inflow: { zOverB: number; U: number }[];
  planes: AijCaseARawPlane[];
}

/**
 * Planes that M10's q/r gate scores: the vertical centerplane and the horizontal plane
 * at 0.125·b (2.5 m full scale — pedestrian level). The 1.25·b plane ships in the raw
 * file for completeness but is deliberately NOT part of the gate (spec step 5).
 */
export const AIJ_SCORED_PLANES = ['vertical-centerplane', 'horizontal-0.125b'] as const;

/**
 * Validate the raw fixture and derive the scoring view: coordinates converted from
 * multiples of b to model-scale meters, speeds normalized by `uRefMps`.
 *
 * Point speed is the MAGNITUDE OF THE MEAN VELOCITY VECTOR, |(U,V,W)| — the workbook
 * tabulates mean components, so this is the only speed reconstructible from it. It is
 * not the mean of the instantaneous speed (which would need the raw time series and is
 * strictly larger); the simulation side must form its comparison the same way.
 */
export function validateAijCaseAData(d: unknown): AijCaseAData {
  const o = d as AijCaseARaw;
  if (
    typeof o !== 'object' ||
    o === null ||
    typeof o.source !== 'string' ||
    typeof o.uRef !== 'string' ||
    !Number.isFinite(o.uRefMps) ||
    o.uRefMps <= 0 ||
    !Number.isFinite(o.bMeters) ||
    o.bMeters <= 0 ||
    !Array.isArray(o.inflow) ||
    !Array.isArray(o.planes) ||
    o.inflow.length < 2 ||
    o.planes.length === 0
  ) {
    throw new Error('aij-case-a fixture: missing source/uRef/uRefMps/bMeters/inflow/planes');
  }
  // Real AIJ measurements carry AIJ's citations and disclaimer or they do not load at all
  // (redistribution condition). A synthetic placeholder is not AIJ data and is exempt.
  if (o.synthetic !== true) {
    validateAijAttribution(o.attribution, 'aij-case-a fixture');
  }

  const b = o.bMeters;
  const uRefMps = o.uRefMps;

  const inflow: AijInflowPoint[] = o.inflow.map((p) => {
    if (!Number.isFinite(p.zOverB) || !Number.isFinite(p.U)) {
      throw new Error('aij-case-a fixture: non-finite inflow entry');
    }
    return { z: p.zOverB * b, u: p.U / uRefMps };
  });

  const points: AijMeasurementPoint[] = [];
  for (const name of AIJ_SCORED_PLANES) {
    const plane = o.planes.find((pl) => pl.name === name);
    if (!plane || !Array.isArray(plane.points) || plane.points.length === 0) {
      throw new Error(`aij-case-a fixture: missing scored plane ${name}`);
    }
    for (const p of plane.points) {
      if (![p.xOverB, p.yOverB, p.zOverB, p.U, p.V, p.W].every(Number.isFinite)) {
        throw new Error(`aij-case-a fixture: non-finite measurement point in ${name}`);
      }
      points.push({
        x: p.xOverB * b,
        y: p.yOverB * b,
        z: p.zOverB * b,
        u: Math.hypot(p.U, p.V, p.W) / uRefMps,
      });
    }
  }

  return {
    source: o.source,
    attribution: o.attribution,
    synthetic: o.synthetic,
    uRef: o.uRef,
    uRefMps,
    measurementStatistic: 'magnitude-of-time-mean-vector',
    bMeters: b,
    inflow,
    points,
  };
}

/**
 * Interpolate a measured inflow profile onto the lattice node heights (k+0.5)·dx.
 * Linear between samples; linear to u = 0 at the ground below the lowest sample (the
 * wall is no-slip); held constant above the highest sample. Points are sorted by z.
 */
export function interpolateInflowToLattice(
  inflow: AijInflowPoint[],
  nCells: number,
  dx: number,
): Float64Array {
  if (inflow.length < 2) throw new Error('interpolateInflowToLattice: need ≥ 2 samples');
  const pts = [...inflow].sort((a, b) => a.z - b.z);
  const out = new Float64Array(nCells);
  for (let k = 0; k < nCells; k++) {
    const z = (k + 0.5) * dx;
    if (z <= pts[0].z) {
      out[k] = pts[0].z > 0 ? (pts[0].u * z) / pts[0].z : pts[0].u;
    } else if (z >= pts[pts.length - 1].z) {
      out[k] = pts[pts.length - 1].u;
    } else {
      let i = 1;
      while (pts[i].z < z) i++;
      const t = (z - pts[i - 1].z) / (pts[i].z - pts[i - 1].z);
      out[k] = pts[i - 1].u + t * (pts[i].u - pts[i - 1].u);
    }
  }
  return out;
}

/**
 * Trilinear sample of a scalar lattice field at continuous cell coordinates (cell
 * centers at integer indices). Clamped to the grid; used to place measurement points
 * that fall between nodes (the 0.125·b plane does at every practical resolution).
 */
export function sampleTrilinear(
  field: Float32Array | Float64Array,
  nx: number,
  ny: number,
  nz: number,
  x: number,
  y: number,
  z: number,
): number {
  const cx = Math.min(Math.max(x, 0), nx - 1);
  const cy = Math.min(Math.max(y, 0), ny - 1);
  const cz = Math.min(Math.max(z, 0), nz - 1);
  const x0 = Math.min(Math.floor(cx), nx - 2 < 0 ? 0 : nx - 2);
  const y0 = Math.min(Math.floor(cy), ny - 2 < 0 ? 0 : ny - 2);
  const z0 = Math.min(Math.floor(cz), nz - 2 < 0 ? 0 : nz - 2);
  const fx = cx - x0;
  const fy = cy - y0;
  const fz = cz - z0;
  const at = (i: number, j: number, k: number): number => field[i + nx * (j + ny * k)] as number;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), fx);
  const c10 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), fx);
  const c01 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), fx);
  const c11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), fx);
  return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
}

export interface WindowedMeans {
  /** Per-point mean over the last full window. */
  means: Float64Array;
  /** Max relative drift of per-point means between the last two full windows. */
  drift: number;
  /** Number of complete windows accumulated. */
  windows: number;
  /**
   * Index of the point that set `drift`. DIAGNOSTIC (M10, 2026-07-20): the first real
   * fetch run showed drift = 165% after 304 windows while the gated profile itself was
   * visibly settled (nodes 5–28 within 0.24–6%). `drift` divides by each point's OWN
   * magnitude, so a near-wall node whose mean is ~0 can pin the max high forever and the
   * steadiness predicate never becomes true. Recorded to confirm that before touching
   * the predicate — a steadiness criterion is what stands between a run and a premature
   * verdict, so it does not get relaxed on a hunch (Hard rule 3).
   */
  driftIndex: number;
  /**
   * Same max absolute change, normalized by the LARGEST windowed mean instead of each
   * point's own. Well-conditioned where `drift` is not; reported alongside, not yet
   * gated on.
   */
  driftScaled: number;
}

/**
 * Per-point trailing time-averager with a steadiness criterion (M10 step 6): Case A
 * data are TIME MEANS — an instantaneous LES snapshot will not pass (spec pitfall).
 * Samples accumulate into fixed-size windows; steadiness = max relative change of any
 * point's windowed mean between the two most recent complete windows.
 */
export class PointTimeAverager {
  private readonly nPoints: number;
  private readonly windowSize: number;
  private readonly sums: Float64Array;
  private count = 0;
  private prev: Float64Array | null = null;
  private last: Float64Array | null = null;
  private nWindows = 0;

  constructor(nPoints: number, windowSize: number) {
    if (nPoints <= 0 || windowSize <= 0) {
      throw new Error('PointTimeAverager: nPoints and windowSize must be positive');
    }
    this.nPoints = nPoints;
    this.windowSize = windowSize;
    this.sums = new Float64Array(nPoints);
  }

  /** Add one sample vector (length nPoints). */
  add(sample: ArrayLike<number>): void {
    if (sample.length !== this.nPoints) {
      throw new Error(`PointTimeAverager: sample length ${sample.length} ≠ ${this.nPoints}`);
    }
    for (let i = 0; i < this.nPoints; i++) this.sums[i] += sample[i];
    if (++this.count === this.windowSize) {
      this.prev = this.last;
      this.last = Float64Array.from(this.sums, (s) => s / this.windowSize);
      this.sums.fill(0);
      this.count = 0;
      this.nWindows++;
    }
  }

  /** Latest complete-window means + drift vs the window before (Infinity until 2). */
  stats(): WindowedMeans | null {
    if (!this.last) return null;
    let drift = Infinity;
    let driftIndex = -1;
    let driftScaled = Infinity;
    if (this.prev) {
      drift = 0;
      driftScaled = 0;
      let scale = 1e-12;
      let maxAbsDelta = 0;
      for (let i = 0; i < this.nPoints; i++) {
        const ref = Math.max(Math.abs(this.prev[i]), 1e-12);
        const d = Math.abs(this.last[i] - this.prev[i]) / ref;
        if (d > drift) {
          drift = d;
          driftIndex = i;
        }
        scale = Math.max(scale, Math.abs(this.last[i]));
        maxAbsDelta = Math.max(maxAbsDelta, Math.abs(this.last[i] - this.prev[i]));
      }
      driftScaled = maxAbsDelta / scale;
    }
    return { means: this.last, drift, windows: this.nWindows, driftIndex, driftScaled };
  }
}

/**
 * Cumulative time-averager with transient discard and convergence detection (M10, added
 * 2026-07-21 after the first real Case-A GPU run never reached steadiness).
 *
 * WHY the windowed averager above is wrong for a building wake: it compares two SHORT
 * consecutive windows (~2 convective times each in practice). AIJ scoring requires the
 * mean over ≥10 domain flow-throughs (~100k steps); consecutive 2-Tconv windows differ by
 * the wake's own unsteadiness, so `driftScaled` never settles (measured: 30% and rising at
 * 275k steps, r=0.76/q=0.56 unstable) and the q/r are read off a noisy short average.
 *
 * This instead (a) discards a startup transient, then (b) accumulates ONE cumulative mean
 * over all later samples — a proper long-time average that stabilizes as 1/N — and (c)
 * detects convergence by comparing the cumulative mean at successive checkpoints (its
 * checkpoint-to-checkpoint change shrinks monotonically as N grows, unlike windowed
 * means). `means` is the cumulative average, so q/r/fetch are scored on the real average.
 * All thresholds are in STEPS (passed by the caller) so they scale with the flow-through.
 */
export class ConvergingAverager {
  private readonly nPoints: number;
  private readonly transientSteps: number;
  private readonly checkpointSteps: number;
  private readonly sum: Float64Array;
  private n = 0;
  private prev: Float64Array | null = null;
  private last: Float64Array | null = null;
  private lastCheckpointStep: number;
  private nCheckpoints = 0;

  constructor(nPoints: number, transientSteps: number, checkpointSteps: number) {
    if (nPoints <= 0 || checkpointSteps <= 0) {
      throw new Error('ConvergingAverager: nPoints and checkpointSteps must be positive');
    }
    this.nPoints = nPoints;
    this.transientSteps = transientSteps;
    this.checkpointSteps = checkpointSteps;
    this.sum = new Float64Array(nPoints);
    // First checkpoint fires one full interval AFTER the transient ends (not on the first
    // post-transient sample), so it already averages a checkpoint's worth of data.
    this.lastCheckpointStep = transientSteps;
  }

  /** Add one sample taken at `atStep`. Samples on/before `transientSteps` are discarded. */
  add(sample: ArrayLike<number>, atStep: number): void {
    if (sample.length !== this.nPoints) {
      throw new Error(`ConvergingAverager: sample length ${sample.length} ≠ ${this.nPoints}`);
    }
    if (atStep <= this.transientSteps) return;
    for (let i = 0; i < this.nPoints; i++) this.sum[i] += sample[i];
    this.n++;
    if (atStep - this.lastCheckpointStep >= this.checkpointSteps) {
      this.prev = this.last;
      this.last = Float64Array.from(this.sum, (s) => s / this.n);
      this.lastCheckpointStep = atStep;
      this.nCheckpoints++;
    }
  }

  /** Cumulative means + convergence drift between the last two checkpoints (null until 2). */
  stats(): WindowedMeans | null {
    if (!this.last) return null;
    let drift = Infinity;
    let driftIndex = -1;
    let driftScaled = Infinity;
    if (this.prev) {
      drift = 0;
      driftScaled = 0;
      let scale = 1e-12;
      let maxAbsDelta = 0;
      for (let i = 0; i < this.nPoints; i++) {
        const ref = Math.max(Math.abs(this.prev[i]), 1e-12);
        const d = Math.abs(this.last[i] - this.prev[i]) / ref;
        if (d > drift) {
          drift = d;
          driftIndex = i;
        }
        scale = Math.max(scale, Math.abs(this.last[i]));
        maxAbsDelta = Math.max(maxAbsDelta, Math.abs(this.last[i] - this.prev[i]));
      }
      driftScaled = maxAbsDelta / scale;
    }
    return { means: this.last, drift, windows: this.nCheckpoints, driftIndex, driftScaled };
  }

  /** Post-transient samples accumulated so far (diagnostic). */
  get samples(): number {
    return this.n;
  }
}

export interface CaseAScoreRow {
  point: AijMeasurementPoint;
  sim: number;
  hit: boolean;
}

export interface CaseAScore {
  q: number;
  r: number;
  rows: CaseAScoreRow[];
}

/** VDI 3783/9 scoring of simulated vs measured normalized mean speeds. */
export function scoreCaseA(
  points: AijMeasurementPoint[],
  sim: ArrayLike<number>,
  allowed = 0.25,
): CaseAScore {
  if (sim.length !== points.length) {
    throw new Error(`scoreCaseA: sim length ${sim.length} ≠ points ${points.length}`);
  }
  const exp = points.map((p) => p.u);
  const simArr = Array.from({ length: sim.length }, (_, i) => sim[i]);
  const rows = points.map((point, i) => ({
    point,
    sim: simArr[i],
    hit: Math.abs(simArr[i] - point.u) <= allowed,
  }));
  return { q: hitRate(simArr, exp, allowed, 1), r: pearson(simArr, exp), rows };
}
