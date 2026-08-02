export type ResolvedVelocityStatistic =
  'time-mean-of-instantaneous-scalar-speed' | 'magnitude-of-time-mean-vector';

export interface ConvergingVelocityStats {
  /** Per-point scalar means under the selected statistic. */
  means: Float64Array;
  /** Max relative checkpoint-to-checkpoint change, normalized per point. */
  drift: number;
  /** Point index that set `drift`. */
  driftIndex: number;
  /** Max absolute change normalized by the largest current mean. */
  driftScaled: number;
  /** Number of complete convergence checkpoints. */
  windows: number;
}

export interface ConvergingVelocityAveragerState {
  version: 1;
  nPoints: number;
  statistic: ResolvedVelocityStatistic;
  transientSteps: number;
  checkpointSteps: number;
  sumX: number[];
  sumY: number[];
  sumZ: number[];
  sumSpeed: number[];
  samples: number;
  previousMeans: number[] | null;
  lastMeans: number[] | null;
  lastCheckpointStep: number;
  checkpoints: number;
}

/**
 * Cumulative time average of sampled velocity vectors with explicit statistic order.
 *
 * Wind-tunnel datasets do not all report the same quantity:
 * - scalar instruments report `<|u(t)|>`;
 * - component tables support only `|<u(t)>|`.
 *
 * These differ in separated/turbulent flow and must never be selected implicitly. This
 * class accumulates the quantity named by `statistic`, discards a startup transient, and
 * compares cumulative means at fixed step checkpoints for convergence.
 */
export class ConvergingVelocityAverager {
  private readonly nPoints: number;
  private readonly statistic: ResolvedVelocityStatistic;
  private readonly transientSteps: number;
  private readonly checkpointSteps: number;
  private readonly sumX: Float64Array;
  private readonly sumY: Float64Array;
  private readonly sumZ: Float64Array;
  private readonly sumSpeed: Float64Array;
  private n = 0;
  private prev: Float64Array | null = null;
  private last: Float64Array | null = null;
  private lastCheckpointStep: number;
  private nCheckpoints = 0;

  constructor(
    nPoints: number,
    statistic: ResolvedVelocityStatistic,
    transientSteps: number,
    checkpointSteps: number,
  ) {
    if (nPoints <= 0 || transientSteps < 0 || checkpointSteps <= 0) {
      throw new Error(
        'ConvergingVelocityAverager: nPoints/checkpointSteps must be positive and transient non-negative',
      );
    }
    if (
      statistic !== 'time-mean-of-instantaneous-scalar-speed' &&
      statistic !== 'magnitude-of-time-mean-vector'
    ) {
      throw new Error('ConvergingVelocityAverager: unsupported velocity statistic');
    }
    this.nPoints = nPoints;
    this.statistic = statistic;
    this.transientSteps = transientSteps;
    this.checkpointSteps = checkpointSteps;
    this.sumX = new Float64Array(nPoints);
    this.sumY = new Float64Array(nPoints);
    this.sumZ = new Float64Array(nPoints);
    this.sumSpeed = new Float64Array(nPoints);
    this.lastCheckpointStep = transientSteps;
  }

  /** Add one vector sample per point at solver step `atStep`. */
  add(ux: ArrayLike<number>, uy: ArrayLike<number>, uz: ArrayLike<number>, atStep: number): void {
    if (ux.length !== this.nPoints || uy.length !== this.nPoints || uz.length !== this.nPoints) {
      throw new Error('ConvergingVelocityAverager: component length mismatch');
    }
    if (!Number.isFinite(atStep) || atStep < 0) {
      throw new Error('ConvergingVelocityAverager: atStep must be finite and non-negative');
    }
    if (atStep <= this.transientSteps) return;
    for (let i = 0; i < this.nPoints; i++) {
      const x = ux[i];
      const y = uy[i];
      const z = uz[i];
      if (![x, y, z].every(Number.isFinite)) {
        throw new Error(`ConvergingVelocityAverager: non-finite component at point ${i}`);
      }
      if (this.statistic === 'time-mean-of-instantaneous-scalar-speed') {
        this.sumSpeed[i] += Math.hypot(x, y, z);
      } else {
        this.sumX[i] += x;
        this.sumY[i] += y;
        this.sumZ[i] += z;
      }
    }
    this.n++;
    if (atStep - this.lastCheckpointStep >= this.checkpointSteps) {
      this.prev = this.last;
      this.last = new Float64Array(this.nPoints);
      for (let i = 0; i < this.nPoints; i++) {
        this.last[i] =
          this.statistic === 'time-mean-of-instantaneous-scalar-speed'
            ? this.sumSpeed[i] / this.n
            : Math.hypot(this.sumX[i] / this.n, this.sumY[i] / this.n, this.sumZ[i] / this.n);
      }
      this.lastCheckpointStep = atStep;
      this.nCheckpoints++;
    }
  }

  stats(): ConvergingVelocityStats | null {
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
        const delta = Math.abs(this.last[i] - this.prev[i]);
        const relative = delta / Math.max(Math.abs(this.prev[i]), 1e-12);
        if (relative > drift) {
          drift = relative;
          driftIndex = i;
        }
        scale = Math.max(scale, Math.abs(this.last[i]));
        maxAbsDelta = Math.max(maxAbsDelta, delta);
      }
      driftScaled = maxAbsDelta / scale;
    }
    return {
      means: this.last,
      drift,
      driftIndex,
      driftScaled,
      windows: this.nCheckpoints,
    };
  }

  get samples(): number {
    return this.n;
  }

  serialize(): ConvergingVelocityAveragerState {
    return {
      version: 1,
      nPoints: this.nPoints,
      statistic: this.statistic,
      transientSteps: this.transientSteps,
      checkpointSteps: this.checkpointSteps,
      sumX: Array.from(this.sumX),
      sumY: Array.from(this.sumY),
      sumZ: Array.from(this.sumZ),
      sumSpeed: Array.from(this.sumSpeed),
      samples: this.n,
      previousMeans: this.prev ? Array.from(this.prev) : null,
      lastMeans: this.last ? Array.from(this.last) : null,
      lastCheckpointStep: this.lastCheckpointStep,
      checkpoints: this.nCheckpoints,
    };
  }

  static fromState(value: unknown): ConvergingVelocityAverager {
    const state = value as ConvergingVelocityAveragerState;
    if (
      typeof state !== 'object' ||
      state === null ||
      state.version !== 1 ||
      !Number.isInteger(state.nPoints) ||
      state.nPoints <= 0 ||
      (state.statistic !== 'time-mean-of-instantaneous-scalar-speed' &&
        state.statistic !== 'magnitude-of-time-mean-vector') ||
      !Number.isInteger(state.transientSteps) ||
      state.transientSteps < 0 ||
      !Number.isInteger(state.checkpointSteps) ||
      state.checkpointSteps <= 0 ||
      !Number.isInteger(state.samples) ||
      state.samples < 0 ||
      !Number.isInteger(state.lastCheckpointStep) ||
      state.lastCheckpointStep < state.transientSteps ||
      !Number.isInteger(state.checkpoints) ||
      state.checkpoints < 0
    ) {
      throw new Error('ConvergingVelocityAverager: invalid serialized state metadata');
    }
    const vector = (candidate: unknown, label: string, nullable = false): Float64Array | null => {
      if (nullable && candidate === null) return null;
      if (
        !Array.isArray(candidate) ||
        candidate.length !== state.nPoints ||
        !candidate.every(Number.isFinite)
      ) {
        throw new Error(`ConvergingVelocityAverager: invalid serialized ${label}`);
      }
      return Float64Array.from(candidate);
    };
    const previousMeans = vector(state.previousMeans, 'previousMeans', true);
    const lastMeans = vector(state.lastMeans, 'lastMeans', true);
    if (
      (state.checkpoints === 0 && (previousMeans !== null || lastMeans !== null)) ||
      (state.checkpoints === 1 && (previousMeans !== null || lastMeans === null)) ||
      (state.checkpoints >= 2 && (previousMeans === null || lastMeans === null))
    ) {
      throw new Error('ConvergingVelocityAverager: serialized checkpoints disagree with means');
    }

    const averager = new ConvergingVelocityAverager(
      state.nPoints,
      state.statistic,
      state.transientSteps,
      state.checkpointSteps,
    );
    averager.sumX.set(vector(state.sumX, 'sumX')!);
    averager.sumY.set(vector(state.sumY, 'sumY')!);
    averager.sumZ.set(vector(state.sumZ, 'sumZ')!);
    averager.sumSpeed.set(vector(state.sumSpeed, 'sumSpeed')!);
    averager.n = state.samples;
    averager.prev = previousMeans;
    averager.last = lastMeans;
    averager.lastCheckpointStep = state.lastCheckpointStep;
    averager.nCheckpoints = state.checkpoints;
    return averager;
  }
}
