/**
 * Live force-history statistics for long 3D runs (M9 step 3) — the convergence machinery
 * the Ahmed gate and the M12 comfort-map workflow sample against. Pure TypeScript, no
 * solver dependencies; the studio force readout owns one instance and pushes every
 * `sampleForce` result.
 *
 * Conventions match `analysis/sphereDrag.ts` (M7): the convergence metric is the spread of
 * the CUMULATIVE running-mean trace over a trailing window of convective times, relative
 * to the current mean — `isConverged(20, 0.03)` is the M9 acceptance-1 trigger ("running
 * mean over the last 20 T_conv varies by < 3%"). The ring buffer bounds memory on
 * multi-hour runs; the cumulative mean/count survive ring eviction (they are O(1)
 * accumulators over ALL pushed samples), and the whole state serializes for the M9
 * checkpoint (step 4: force-history state is part of the saved run).
 */

export interface ForceHistoryOptions {
  /** Timesteps between consecutive pushed samples. */
  sampleIntervalSteps: number;
  /** One convective time T_conv in steps (= bodyLengthCells / uLattice). */
  convectiveTimeSteps: number;
  /** Ring capacity in samples. Default 16384 (~a day at 5 s/sample). */
  capacity?: number;
}

export interface WindowStats {
  /** Plain mean of the samples inside the window. */
  mean: number;
  /** Sample standard deviation inside the window (0 for a single sample). */
  std: number;
  samples: number;
}

export interface ForceHistoryState {
  sampleIntervalSteps: number;
  convectiveTimeSteps: number;
  capacity: number;
  totalPushed: number;
  cumulativeSum: [number, number, number];
  /** Ring contents oldest-first: [fx, fy, fz, runningMeanFx] per sample. */
  samples: number[];
}

const STRIDE = 4; // fx, fy, fz, cumulative running-mean of fx at push time

export class ForceHistory {
  readonly sampleIntervalSteps: number;
  readonly convectiveTimeSteps: number;
  readonly capacity: number;
  private ring: Float64Array;
  private head = 0; // next write slot
  private filled = 0;
  private totalPushed = 0;
  private cumSum: [number, number, number] = [0, 0, 0];

  constructor(opts: ForceHistoryOptions) {
    if (opts.sampleIntervalSteps <= 0 || opts.convectiveTimeSteps <= 0) {
      throw new Error('ForceHistory: intervals must be positive');
    }
    this.sampleIntervalSteps = opts.sampleIntervalSteps;
    this.convectiveTimeSteps = opts.convectiveTimeSteps;
    this.capacity = opts.capacity ?? 16384;
    this.ring = new Float64Array(this.capacity * STRIDE);
  }

  get count(): number {
    return this.filled;
  }

  /** Samples ever pushed (≥ count once the ring wraps). */
  get pushed(): number {
    return this.totalPushed;
  }

  /** Cumulative mean drag over ALL pushed samples (survives ring eviction). */
  get cumulativeMeanFx(): number {
    return this.totalPushed > 0 ? this.cumSum[0] / this.totalPushed : NaN;
  }

  push(fx: number, fy: number, fz: number): void {
    this.totalPushed++;
    this.cumSum[0] += fx;
    this.cumSum[1] += fy;
    this.cumSum[2] += fz;
    const base = this.head * STRIDE;
    this.ring[base] = fx;
    this.ring[base + 1] = fy;
    this.ring[base + 2] = fz;
    this.ring[base + 3] = this.cumSum[0] / this.totalPushed;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  /** Ring slot of the k-th most recent sample (k = 0 is the latest). */
  private slot(k: number): number {
    return ((this.head - 1 - k + this.capacity * 2) % this.capacity) * STRIDE;
  }

  private windowSamples(windowConvectiveTimes: number | undefined): number {
    if (windowConvectiveTimes === undefined) return this.filled;
    const w = Math.round(
      (windowConvectiveTimes * this.convectiveTimeSteps) / this.sampleIntervalSteps,
    );
    return Math.min(this.filled, Math.max(1, w));
  }

  /**
   * Mean ± std of one force component over the trailing window (whole ring when
   * `windowConvectiveTimes` is omitted) — the live "mean Cd ± σ" HUD numbers.
   */
  stats(component: 0 | 1 | 2, windowConvectiveTimes?: number): WindowStats {
    const n = this.windowSamples(windowConvectiveTimes);
    if (n === 0) return { mean: NaN, std: NaN, samples: 0 };
    let sum = 0;
    for (let k = 0; k < n; k++) sum += this.ring[this.slot(k) + component];
    const mean = sum / n;
    let sq = 0;
    for (let k = 0; k < n; k++) {
      const d = this.ring[this.slot(k) + component] - mean;
      sq += d * d;
    }
    return { mean, std: n > 1 ? Math.sqrt(sq / (n - 1)) : 0, samples: n };
  }

  /**
   * Fractional drift of the cumulative running-mean (fx) trace over the trailing window —
   * the M7/M9 convergence metric. NaN until at least two samples sit in the window.
   */
  runningMeanDrift(windowConvectiveTimes = 20): number {
    const n = this.windowSamples(windowConvectiveTimes);
    if (n < 2) return NaN;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < n; k++) {
      const rm = this.ring[this.slot(k) + 3];
      if (rm < lo) lo = rm;
      if (rm > hi) hi = rm;
    }
    const current = this.ring[this.slot(0) + 3];
    return current !== 0 ? (hi - lo) / Math.abs(current) : NaN;
  }

  /**
   * True once the run has BOTH covered the full window and kept the running mean inside
   * `tolerance` over it (M9 step 3: defaults 20 T_conv, 3%). Never true before the window
   * is fully populated — a 2-sample flat stretch must not fire the acceptance trigger.
   */
  isConverged(windowConvectiveTimes = 20, tolerance = 0.03): boolean {
    const needed = Math.round(
      (windowConvectiveTimes * this.convectiveTimeSteps) / this.sampleIntervalSteps,
    );
    if (this.filled < Math.max(2, needed)) return false;
    const drift = this.runningMeanDrift(windowConvectiveTimes);
    return Number.isFinite(drift) && drift < tolerance;
  }

  /** Snapshot for the M9 checkpoint (raw ring oldest-first + the O(1) accumulators). */
  serialize(): ForceHistoryState {
    const samples: number[] = [];
    for (let k = this.filled - 1; k >= 0; k--) {
      const base = this.slot(k);
      samples.push(this.ring[base], this.ring[base + 1], this.ring[base + 2], this.ring[base + 3]);
    }
    return {
      sampleIntervalSteps: this.sampleIntervalSteps,
      convectiveTimeSteps: this.convectiveTimeSteps,
      capacity: this.capacity,
      totalPushed: this.totalPushed,
      cumulativeSum: [...this.cumSum],
      samples,
    };
  }

  static restore(state: ForceHistoryState): ForceHistory {
    const h = new ForceHistory(state);
    const n = state.samples.length / STRIDE;
    if (n > h.capacity) throw new Error('ForceHistory.restore: more samples than capacity');
    // Oldest-first straight into slots 0..n−1; the accumulators are restored exactly (they
    // include samples the ring may already have evicted before the save).
    h.ring.set(state.samples.slice(0, n * STRIDE), 0);
    h.filled = n;
    h.head = n % h.capacity;
    h.totalPushed = state.totalPushed;
    h.cumSum = [...state.cumulativeSum];
    return h;
  }
}
