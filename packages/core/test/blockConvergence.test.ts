import { describe, expect, it } from 'vitest';
import {
  blockMeans,
  blocksAgree,
  relSpread,
  requiredBlockLength,
  type TimeSample,
} from '../src/analysis/blockConvergence.js';

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

/** t = 0, 1, 2, ... ; value = t, so block means are trivially predictable. */
function series(n: number): TimeSample[] {
  return Array.from({ length: n }, (_, t) => ({ t, value: t }));
}

describe('blockMeans', () => {
  it('returns no blocks and no drop for an empty series', () => {
    expect(blockMeans([], 4)).toEqual({ blocks: [], droppedSamples: 0 });
  });

  it('reports everything as dropped when the series never spans one block', () => {
    // t = 0..2, blockLength 10: the close condition (t - start >= blockLength) never fires.
    const result = blockMeans(series(3), 10);
    expect(result.blocks).toEqual([]);
    expect(result.droppedSamples).toBe(3);
  });

  it('cuts non-overlapping blocks and drops the trailing partial one', () => {
    // t = 0..9, blockLength 4: closes at t=4 (samples 0-3) and t=8 (samples 4-7); 8 and 9
    // are a 2-sample tail that never reaches blockLength and must not become a block.
    const result = blockMeans(series(10), 4);
    expect(result.blocks).toEqual([
      { t0: 0, t1: 3, mean: 1.5, n: 4 },
      { t0: 4, t1: 7, mean: 5.5, n: 4 },
    ]);
    expect(result.droppedSamples).toBe(2);
  });

  it('REGRESSION: never lets the dropped tail leak into a block mean', () => {
    // The bug this guards: comparing a short trailing remainder as if it were a full block
    // inverted a verdict on the Ahmed ladder (2.43% genuine spread read as 14.52%). The
    // invariant that catches any regression of that kind: every sample is accounted for
    // exactly once, either inside a complete block or in the drop count — never both, and
    // never silently folded into a block's mean.
    const samples = series(37); // an awkward, non-multiple length on purpose
    const blockLength = 6;
    const result = blockMeans(samples, blockLength);
    const inBlocks = result.blocks.reduce((sum, b) => sum + b.n, 0);
    expect(inBlocks + result.droppedSamples).toBe(samples.length);
    expect(result.droppedSamples).toBeLessThan(blockLength);
    for (const b of result.blocks) {
      expect(b.t1 - b.t0).toBeGreaterThanOrEqual(blockLength - 1);
    }
  });

  it('a single sample is always dropped, never a one-sample "block"', () => {
    const result = blockMeans(series(1), 4);
    expect(result.blocks).toEqual([]);
    expect(result.droppedSamples).toBe(1);
  });
});

describe('requiredBlockLength', () => {
  const OPTS = { gate: 0.03, min: 20, max: 400 };

  it('floors at min with fewer than two samples', () => {
    expect(requiredBlockLength([], 10, OPTS)).toBe(OPTS.min);
    expect(requiredBlockLength([{ t: 0, value: 1 }], 10, OPTS)).toBe(OPTS.min);
  });

  it('floors at min for a non-finite or non-positive sampling cadence', () => {
    const samples: TimeSample[] = [
      { t: 0, value: 1 },
      { t: 1, value: 1 },
    ];
    expect(requiredBlockLength(samples, 0, OPTS)).toBe(OPTS.min);
    expect(requiredBlockLength(samples, -5, OPTS)).toBe(OPTS.min);
    expect(requiredBlockLength(samples, NaN, OPTS)).toBe(OPTS.min);
  });

  it('ceilings at max when the mean is zero (division by the mean is undefined)', () => {
    const samples: TimeSample[] = [
      { t: 0, value: -1 },
      { t: 1, value: 1 },
    ];
    expect(requiredBlockLength(samples, 10, OPTS)).toBe(OPTS.max);
  });

  it('floors at min for a perfectly quiet series (zero variance needs zero block length)', () => {
    const samples: TimeSample[] = [
      { t: 0, value: 1 },
      { t: 1, value: 1 },
      { t: 2, value: 1 },
    ];
    expect(requiredBlockLength(samples, 10, OPTS)).toBe(OPTS.min);
  });

  it('solves n >= (sigma / (gate*|mean|))^2 and converts to time units', () => {
    // mean 1, sample variance 2 (sigma = sqrt(2)) by construction:
    //   values [0, 2] -> mean 1, sum of squared deviations 2, n-1 = 1 -> variance 2.
    // needed = (sqrt(2) / (0.1 * 1))^2 = 2 / 0.01 = 200 samples in exact arithmetic; at 1
    // sample per unit time that is 200 time units. Comfortably inside [1, 1000] so nothing
    // clamps — the function's own Math.ceil (it must round UP, a fractional block is not
    // observable) is what turns the double-rounded 200.00000000000003 into 201, not a bug
    // in the test.
    const samples: TimeSample[] = [
      { t: 0, value: 0 },
      { t: 1, value: 2 },
    ];
    const opts = { gate: 0.1, min: 1, max: 1000 };
    expect(requiredBlockLength(samples, 1, opts)).toBe(201);
  });

  it('clamps a noisy series to max rather than demanding an unfillable block', () => {
    const samples: TimeSample[] = [
      { t: 0, value: 0 },
      { t: 1, value: 2 },
    ];
    const opts = { gate: 0.1, min: 1, max: 50 };
    expect(requiredBlockLength(samples, 1, opts)).toBe(50);
  });

  it('clamps a series demanding less than min up to min', () => {
    const samples: TimeSample[] = [
      { t: 0, value: 1 },
      { t: 1, value: 1.001 },
    ];
    const opts = { gate: 0.5, min: 20, max: 400 };
    expect(requiredBlockLength(samples, 10, opts)).toBe(20);
  });
});

/**
 * fix-confirmed-physics-defects, task 9.2: the circularity risk this diff's design.md flags —
 * `requiredBlockLength` shrinks block-mean spread as sigma/sqrt(n), so a genuinely NOISY run
 * responds by lengthening its blocks, which mechanically makes the 3% gate easier to satisfy.
 * That is the intended behavior for noise. This proves it does NOT also launder a genuine
 * monotonic TREND: at whatever block length the run's own noise derives, a series that is
 * still drifting (not merely noisy) must still fail `blocksAgree` — the union-window check
 * (the same one the REGRESSION test above pins with a fixed length) survives being fed a
 * length that came from `requiredBlockLength` instead of a constant.
 */
describe('requiredBlockLength + blocksAgree: a trend is not disguised by a derived block length', () => {
  // Deterministic pseudo-noise (no RNG, so a failure reproduces) — two incommensurate
  // sine components so consecutive samples are not simply correlated.
  function noisyTrend(n: number, dt: number, base: number, slope: number, noiseAmp: number) {
    const out: TimeSample[] = [];
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      const noise = noiseAmp * Math.sin(t * 0.37 + 1.1) + 0.5 * noiseAmp * Math.sin(t * 1.13);
      out.push({ t, value: base + slope * t + noise });
    }
    return out;
  }

  const dt = 1;
  const n = 4000;
  const noiseAmp = 0.01;
  const opts = { gate: 0.03, min: 5, max: 2000 };

  it('a still-drifting series fails blocksAgree at its OWN requiredBlockLength-derived length', () => {
    const slope = 0.0006; // per unit t — a genuine, steady drift, not just noise
    const trending = noisyTrend(n, dt, 1.0, slope, noiseAmp);

    const derivedLength = requiredBlockLength(trending, 1 / dt, opts);
    expect(derivedLength).toBeGreaterThan(opts.min); // actually derived from the noise, not floored
    expect(derivedLength).toBeLessThan(opts.max); // and not a run that never converges at all

    const { blocks } = blockMeans(trending, derivedLength);
    expect(blocks.length).toBeGreaterThanOrEqual(5); // enough blocks to evaluate minBlocks=4

    const means = blocks.map((b) => b.mean);
    expect(blocksAgree(means, { minBlocks: 4, gate: opts.gate })).toBe(false);
  });

  it('the same noise WITHOUT the trend converges at its own derived length (control)', () => {
    // Proves the failure above is attributable to the trend, not an artifact of the noise
    // model or of requiredBlockLength itself producing an unreachable gate.
    const flat = noisyTrend(n, dt, 1.0, 0, noiseAmp);
    const derivedLength = requiredBlockLength(flat, 1 / dt, opts);
    const { blocks } = blockMeans(flat, derivedLength);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    const means = blocks.map((b) => b.mean);
    expect(blocksAgree(means, { minBlocks: 4, gate: opts.gate })).toBe(true);
  });
});
