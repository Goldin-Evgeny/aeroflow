/**
 * The convergence test the M9 Ahmed ladder stops on (step 7 — the Cs sensitivity sweep).
 *
 * Lives here, beside the other reductions, rather than inside the e2e harness because it is
 * pure statistics over a series of independent block means — and because the harness stopping
 * on the wrong statistic is the single most expensive mistake this project has made twice:
 * M7's Cd 0.509 was read off a running mean still climbing and later struck, and the first full
 * 8M ladder (2026-08-06) stopped all three surviving rungs on a clock while every one of them
 * reported block spreads above the gate (3.04%, 5.57%, 7.12%). Code that decides "this run is
 * converged" belongs somewhere it can be tested directly.
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
