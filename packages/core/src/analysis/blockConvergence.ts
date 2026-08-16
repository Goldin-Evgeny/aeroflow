/**
 * The convergence test the M9 Ahmed ladder stops on (step 7 — the Cs sensitivity sweep):
 * how long a block needs to be to resolve the spread gate (`requiredBlockLength`), how to cut
 * a sample series into blocks (`blockMeans`), and whether consecutive blocks agree
 * (`blocksAgree`/`relSpread`).
 *
 * Lives here, beside the other reductions, rather than inside an e2e harness because it is
 * pure statistics over a series of independent block means — and because a harness stopping
 * on the wrong statistic, or three harnesses each carrying their own copy that quietly drift
 * apart, is the single most expensive mistake this project has made twice: M7's Cd 0.509 was
 * read off a running mean still climbing and later struck, and the first full 8M ladder
 * (2026-08-06) stopped all three surviving rungs on a clock while every one of them reported
 * block spreads above the gate (3.04%, 5.57%, 7.12%). Code that decides "this run is
 * converged" belongs somewhere it can be tested directly, and in exactly one place.
 */

/** Range of a series relative to its own mean. NaN for fewer than two values. */
export function relSpread(vals: number[]): number {
  return vals.length > 1
    ? (Math.max(...vals) - Math.min(...vals)) /
        Math.abs(vals.reduce((a, b) => a + b, 0) / vals.length)
    : Number.NaN;
}

export interface BlockAgreementOptions {
  /** Blocks in one agreement window. */
  minBlocks: number;
  /** Maximum relative spread that counts as agreement (the convergence criterion). */
  gate: number;
}

/**
 * Have these independent block means settled?
 *
 * Three conditions, all required, over the trailing `minBlocks + 1` blocks:
 *
 *  1. **The current window** (`blocks[-minBlocks..]`) is within the gate.
 *  2. **The previous window** (`blocks[-(minBlocks+1)..-2]`) is within the gate — so agreement
 *     had to survive one further completed block. A single window passing is a coin that came
 *     up heads once: against a wandering mean, some window eventually passes by luck, and
 *     stopping on it reproduces exactly the premature-convergence error above.
 *  3. **The whole confirmation window** (all `minBlocks + 1` blocks) is within the gate.
 *
 * Condition 3 is not implied by 1 and 2. Under slow monotonic drift both four-block windows can
 * sit inside the gate while the five-block range does not: for a linear ramp of step d the
 * 4-block range is 3d and the 5-block range is 4d, so any d with 3d ≤ gate < 4d passes both
 * windows and is still drifting — a mean walking steadily in one direction, which is the
 * failure mode this test exists to catch. Checking the union closes that gap.
 *
 * The window is ROLLING on purpose. Spread over the entire post-trigger series is dominated by
 * its oldest blocks forever, so a rung that genuinely settles late could never satisfy it and
 * would burn its whole budget regardless of what the flow did.
 */
export function blocksAgree(blockVals: number[], opts: BlockAgreementOptions): boolean {
  const { minBlocks, gate } = opts;
  const need = minBlocks + 1;
  if (blockVals.length < need) return false;
  const confirm = blockVals.slice(-need);
  const current = confirm.slice(1);
  const previous = confirm.slice(0, -1);
  return relSpread(previous) <= gate && relSpread(current) <= gate && relSpread(confirm) <= gate;
}

/**
 * One scalar sample at a point in convective (or otherwise monotonic) time. Field names are
 * deliberately generic — `t`/`value` — rather than `convectiveTimes`/`cd`, so this module can
 * back any long-run force/velocity convergence gate (Ahmed, sphere, AIJ), not only the Ahmed
 * ladder it was extracted from.
 */
export interface TimeSample {
  t: number;
  value: number;
}

export interface Block {
  t0: number;
  t1: number;
  mean: number;
  n: number;
}

export interface BlockMeansResult {
  /** Complete, non-overlapping blocks, in time order. */
  blocks: Block[];
  /** Samples in the trailing partial block, dropped rather than compared as if it were full. */
  droppedSamples: number;
}

/**
 * Independent (non-overlapping) block means of a scalar series.
 *
 * The trailing remainder — whatever is left after the last complete `blockLength`-wide span —
 * is NOT a block: it spans less than `blockLength`, so its mean carries a different (larger)
 * sampling error, and comparing it against full blocks manufactures spread. Measured on the
 * Ahmed ladder: a 2-T_conv / n=13 tail turned a genuine 2.43% into a reported 14.52%, i.e. it
 * inverted the verdict. Dropped here, with its size reported so the drop is visible rather than
 * silent (the failure mode of the version that didn't report it).
 */
export function blockMeans(samples: readonly TimeSample[], blockLength: number): BlockMeansResult {
  if (samples.length === 0) return { blocks: [], droppedSamples: 0 };
  const blocks: Block[] = [];
  let start = samples[0].t;
  let last = start;
  let sum = 0;
  let n = 0;
  for (const sample of samples) {
    if (sample.t - start >= blockLength && n > 0) {
      blocks.push({ t0: start, t1: last, mean: sum / n, n });
      start = sample.t;
      sum = 0;
      n = 0;
    }
    sum += sample.value;
    n++;
    last = sample.t;
  }
  return { blocks, droppedSamples: n };
}

/**
 * Sampling cadence (samples per unit of `t`) of a series — the exact quantity
 * `requiredBlockLength`'s second argument wants, and the input `blockMeans`/
 * `requiredBlockLength` don't otherwise need you to compute yourself.
 *
 * fix-confirmed-physics-defects, task 9.3: this was triplicated byte-for-byte as
 * `samplesPerTConv` across `ahmed-baseline-2m.gpu.spec.ts`, `ahmed-ladder.gpu.spec.ts` and
 * `m9-closure.gpu.spec.ts` — the cadence input to the very convergence rule this module
 * exists to centralize, left out of the centralization. NaN for fewer than two samples or
 * a non-positive time span (mirrors `relSpread`'s NaN-for-underdetermined convention).
 */
export function samplesPerUnitTime(samples: readonly TimeSample[]): number {
  if (samples.length < 2) return Number.NaN;
  const span = samples[samples.length - 1].t - samples[0].t;
  return span > 0 ? (samples.length - 1) / span : Number.NaN;
}

export interface RequiredBlockLengthOptions {
  /** The spread gate `blocksAgree` will judge blocks against (the same value, not a copy). */
  gate: number;
  /** Floor on the returned block length, in the same time unit as `samples[i].t`. */
  min: number;
  /** Ceiling on the returned block length — a pathologically noisy series fails on the run's
   *  time/step budget instead of demanding a block the budget can never fill, which is the
   *  honest outcome. */
  max: number;
}

/**
 * Block length that makes `gate` resolvable for the observed noise in `samples`, rather than
 * fixed a priori.
 *
 * A fixed block length is only as good as its author's guess at the series' variance: on a
 * quiet signal it wastes budget, and on a noisy one the gate can be unreachable by construction
 * — an n-sample block mean has standard error σ/√n, so a block too short to resolve `gate`
 * measures its own sampling error, not the flow, and a rung can spin forever reporting a
 * spread it can never close. Solving n ≥ (σ / (gate·|mean|))² for the block length in time
 * units (via the series' own samples-per-unit-time cadence) makes the required length an
 * observed property of the run instead of a guess. Samples inside a block are correlated
 * (they are consecutive draws from an evolving flow, not independent), so this UNDERESTIMATES
 * the true required length — it is a lower bound, never an optimistic one.
 */
export function requiredBlockLength(
  samples: readonly TimeSample[],
  samplesPerUnitTime: number,
  opts: RequiredBlockLengthOptions,
): number {
  const { gate, min, max } = opts;
  if (samples.length < 2 || !Number.isFinite(samplesPerUnitTime) || samplesPerUnitTime <= 0) {
    return min;
  }
  const values = samples.map((s) => s.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!Number.isFinite(mean) || mean === 0) return max;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, values.length - 1);
  const sigma = Math.sqrt(variance);
  if (!Number.isFinite(sigma)) return max;
  const needed = (sigma / (gate * Math.abs(mean))) ** 2;
  const length = needed / samplesPerUnitTime;
  return Math.min(max, Math.max(min, Math.ceil(length)));
}
