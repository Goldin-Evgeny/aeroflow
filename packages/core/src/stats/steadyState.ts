import { isSolid } from '../lattice.js';

/**
 * Residual-based steady-state detector (M3 step 5).
 *
 * The criterion, stated once here and quoted verbatim in the validation report because
 * "convergence criterion documented" is itself M3 acceptance 3:
 *
 *     R = sqrt( Σ_fluid [ (ux − ux_prev)² + (uy − uy_prev)² ] / N_fluid ) / uRef
 *
 * sampled every K = 1000 steps, with uRef = uLid. **Converged when R ≤ 1e-7 per
 * 1000-step interval.**
 *
 * R is dimensionless and interval-relative: it measures how much the velocity field
 * moved over the last K steps, not how far it is from any reference. Comparing samples
 * taken at different K is meaningless, so the sampling interval is part of the criterion.
 *
 * The cavity "looks" steady long before the extrema settle — at 512²/ν≈0.05 the diffusive
 * timescale is millions of steps. Trust R, not the picture, and never raise the threshold
 * to make a run finish (CLAUDE.md hard rule 3, M3.md pitfall "Stopping too early").
 */
export const STEADY_STATE_INTERVAL = 1000;
export const STEADY_STATE_THRESHOLD = 1e-7;

/** The criterion as one line of prose, for embedding in reports. */
export const STEADY_STATE_CRITERION = `R = sqrt(Σ_fluid[(Δux)² + (Δuy)²] / N_fluid) / uRef ≤ ${STEADY_STATE_THRESHOLD}, sampled every ${STEADY_STATE_INTERVAL} steps`;

export function steadyStateResidual(
  prevUx: ArrayLike<number>,
  prevUy: ArrayLike<number>,
  ux: ArrayLike<number>,
  uy: ArrayLike<number>,
  flags: ArrayLike<number>,
  uRef: number,
): number {
  if (uRef <= 0) throw new Error(`steadyStateResidual: uRef must be > 0, got ${uRef}`);
  const n = flags.length;
  let sum = 0;
  let fluid = 0;
  for (let i = 0; i < n; i++) {
    if (isSolid(flags[i])) continue;
    const dx = ux[i] - prevUx[i];
    const dy = uy[i] - prevUy[i];
    sum += dx * dx + dy * dy;
    fluid++;
  }
  if (fluid === 0) throw new Error('steadyStateResidual: no fluid cells');
  return Math.sqrt(sum / fluid) / uRef;
}

/** One sample of the residual history, for the plot M3 acceptance 3 asks for. */
export interface ResidualSample {
  step: number;
  residual: number;
}

/**
 * Why a run stopped. `threshold` is the documented criterion above; `plateau` is the
 * precision-aware fallback below; `budget` means it ran out of steps or time and its
 * numbers are NOT a result.
 */
export type SteadyStateStop = 'running' | 'threshold' | 'plateau' | 'budget';

/**
 * ## Why a plateau rule exists alongside the 1e-7 threshold
 *
 * **Measured 2026-07-28, cavity Re=100 at H=64 (RTX 3090):**
 *
 * | steps | CPU Float64 residual | GPU FP32 residual |
 * | ----- | -------------------- | ----------------- |
 * | 20 k  | 2.58e-1              | 3.43e-6           |
 * | 50 k  | **2.31e-8**          | 3.66e-6           |
 * | 200 k | 3.22e-12             | 3.18e-6           |
 * | 1 M   | 1.76e-11             | 3.76e-6           |
 *
 * The Float64 reference crosses 1e-7 between 20 k and 50 k steps and keeps falling. The
 * FP32 GPU kernel **floors at ~3e-6** — roughly 30× above the bar — and stays there
 * forever, because at that point the residual is measuring round-off, not evolution.
 * `R ≤ 1e-7` is therefore a statement about Float64 arithmetic that FP32 cannot satisfy
 * at any step count.
 *
 * That matters beyond bookkeeping: over the same sweep the FP32 solution *degrades* once
 * it is past convergence (u_min −0.20717 at 20 k → −0.20474 at 1 M → −0.19755 at 4 M,
 * against a Float64 value pinned at −0.20722 with mass conserved to 4096.000000). So a
 * runner that keeps stepping toward an unreachable threshold destroys the very answer it
 * is trying to measure. Stopping at the floor is not a convenience — it is what makes the
 * FP32 measurement correct.
 *
 * **No tolerance was weakened** (CLAUDE.md hard rule 3). The 1e-7 threshold is unchanged
 * and still fires first whenever the arithmetic can reach it; the Ghia acceptance bars are
 * untouched. This adds a second, precision-honest way to *stop*, and every result records
 * which rule fired so a `plateau` stop can never be read as a `threshold` stop.
 *
 * The plateau test compares the median of the last N samples against the median of the N
 * before them — medians, because the floor is noisy (3.18e-6 … 3.76e-6 above) and a
 * running minimum would ratchet on noise alone.
 *
 * **A flat residual is not sufficient.** Starting from rest the lid spins the cavity up at
 * a roughly constant rate, so the residual goes briefly flat *while the flow is still
 * developing* — and a naive "stopped improving" rule fires there, ending a 256² run in a
 * couple of seconds. The plateau therefore also requires the residual to have already
 * fallen by `PLATEAU_MIN_DECADES` decades from its peak: at the floor it has dropped ~4–5
 * decades, during spin-up barely one. Both conditions, or the run keeps going.
 */
export const PLATEAU_WINDOW = 10;
export const PLATEAU_MIN_IMPROVEMENT = 0.05;
export const PLATEAU_MIN_DECADES = 3;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

export class SteadyStateDetector {
  private readonly history: ResidualSample[] = [];
  private peak = 0;
  readonly threshold: number;
  readonly window: number;
  readonly minImprovement: number;
  readonly minDecades: number;

  constructor(
    opts: {
      threshold?: number;
      window?: number;
      minImprovement?: number;
      minDecades?: number;
    } = {},
  ) {
    this.threshold = opts.threshold ?? STEADY_STATE_THRESHOLD;
    this.window = opts.window ?? PLATEAU_WINDOW;
    this.minImprovement = opts.minImprovement ?? PLATEAU_MIN_IMPROVEMENT;
    this.minDecades = opts.minDecades ?? PLATEAU_MIN_DECADES;
  }

  get samples(): readonly ResidualSample[] {
    return this.history;
  }

  /** Record a sample and report whether the run should stop, and on which rule. */
  push(step: number, residual: number): SteadyStateStop {
    this.history.push({ step, residual });
    this.peak = Math.max(this.peak, residual);
    // The documented criterion always wins when the arithmetic can reach it.
    if (residual <= this.threshold) return 'threshold';

    const n = this.window;
    if (this.history.length < 2 * n) return 'running';
    // Still developing? Then a flat stretch is spin-up, not the floor.
    if (residual > this.peak * Math.pow(10, -this.minDecades)) return 'running';

    const recent = this.history.slice(-n).map((s) => s.residual);
    const previous = this.history.slice(-2 * n, -n).map((s) => s.residual);
    const improvement = (median(previous) - median(recent)) / median(previous);
    return improvement < this.minImprovement ? 'plateau' : 'running';
  }
}
