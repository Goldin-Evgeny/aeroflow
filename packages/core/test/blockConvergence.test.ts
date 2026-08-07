import { describe, expect, it } from 'vitest';
import { blocksAgree, relSpread } from '../src/analysis/blockConvergence.js';

/**
 * The M9 ladder's stop test. These are the cases that decide whether a multi-hour GPU rung is
 * declared converged, so they are pinned here rather than discovered on the ladder.
 */

/** The ladder's own configuration: four-block windows against the 3% gate. */
const OPTS = { minBlocks: 4, gate: 0.03 };

describe('relSpread', () => {
  it('is the range over the mean', () => {
    // range 0.2 over mean 1.0
    expect(relSpread([0.9, 1.0, 1.1])).toBeCloseTo(0.2, 12);
  });

  it('is 0 for a constant series and NaN for fewer than two values', () => {
    expect(relSpread([2, 2, 2])).toBe(0);
    expect(relSpread([1])).toBeNaN();
    expect(relSpread([])).toBeNaN();
  });

  it('uses |mean|, so a negative series reports a positive spread', () => {
    expect(relSpread([-0.9, -1.0, -1.1])).toBeCloseTo(0.2, 12);
  });
});

describe('blocksAgree', () => {
  it('needs minBlocks + 1 complete blocks before it can say anything', () => {
    // Four identical blocks would pass every window test, and must STILL be rejected: the
    // confirmation block does not exist yet, so agreement has not survived anything.
    expect(blocksAgree([1, 1, 1, 1], OPTS)).toBe(false);
    expect(blocksAgree([1, 1, 1, 1, 1], OPTS)).toBe(true);
  });

  it('accepts a settled series inside the gate', () => {
    // ±1% scatter about 1.45, no trend — the shape a converged rung actually has.
    expect(blocksAgree([1.4477, 1.446, 1.4494, 1.4487, 1.4475], OPTS)).toBe(true);
  });

  it('rejects a series whose current window breaks the gate', () => {
    expect(blocksAgree([1.0, 1.0, 1.0, 1.0, 1.05], OPTS)).toBe(false);
  });

  it('rejects when only the CURRENT window agrees — agreement must survive a block', () => {
    // The last four are identical, so a naive "latest window" test would stop here. The
    // previous window still contains the excursion, so this rung is not done.
    expect(blocksAgree([1.2, 1.0, 1.0, 1.0, 1.0], OPTS)).toBe(false);
  });

  it('REGRESSION: rejects slow monotonic drift that both four-block windows accept', () => {
    // The hole in a two-window test (found in review, 2026-08-06). For a linear ramp of step d
    // the 4-block range is 3d and the 5-block range is 4d, so any d with 3d <= gate < 4d passes
    // BOTH four-block windows while the mean walks steadily in one direction — precisely the
    // premature-convergence failure this gate exists to prevent.
    //
    // d = 0.009 about a mean of ~1.018:
    //   previous [1.000..1.027] range 0.027 -> 2.66%  PASS
    //   current  [1.009..1.036] range 0.027 -> 2.64%  PASS
    //   all five [1.000..1.036] range 0.036 -> 3.54%  FAIL  <- the check that saves it
    const drifting = [1.0, 1.009, 1.018, 1.027, 1.036];
    expect(relSpread(drifting.slice(0, -1))).toBeLessThanOrEqual(OPTS.gate);
    expect(relSpread(drifting.slice(1))).toBeLessThanOrEqual(OPTS.gate);
    expect(relSpread(drifting)).toBeGreaterThan(OPTS.gate);

    expect(blocksAgree(drifting, OPTS)).toBe(false);
  });

  it('accepts drift slow enough that the whole confirmation window holds', () => {
    // The same ramp at d = 0.006: 5-block range 0.024 -> 2.36%, inside the gate. Still drifting
    // in principle, but below the criterion the project committed to — the gate is the gate,
    // and tightening it here rather than in VALIDATION.md would be tolerance-shopping.
    expect(blocksAgree([1.0, 1.006, 1.012, 1.018, 1.024], OPTS)).toBe(true);
  });

  it('judges only the trailing window, so a rung that settles LATE can still converge', () => {
    // A wild startup followed by five settled blocks must pass: spread over the whole
    // post-trigger series would be dominated by the 2.06 forever, and the rung could never
    // stop no matter how well the flow behaved.
    expect(blocksAgree([2.06, 1.2, 1.45, 1.4477, 1.446, 1.4494, 1.4487, 1.4475], OPTS)).toBe(true);
  });

  it('honours a different window width', () => {
    const wide = { minBlocks: 6, gate: 0.03 };
    expect(blocksAgree([1, 1, 1, 1, 1], wide)).toBe(false); // needs 7
    expect(blocksAgree([1, 1, 1, 1, 1, 1, 1], wide)).toBe(true);
  });
});
