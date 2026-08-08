import { describe, expect, it } from 'vitest';
import { linearTrend } from '../src/analysis/linearTrend.js';

describe('linearTrend', () => {
  it('recovers an exact line with zero uncertainty', () => {
    const x = [0, 1, 2, 3, 4];
    const y = x.map((v) => 3 + 2 * v);
    const fit = linearTrend(x, y);
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(3, 12);
    expect(fit.slopeStdErr).toBeCloseTo(0, 12);
    expect(fit.tStatistic).toBe(Infinity);
  });

  it('reports a flat series as a zero slope, not an infinite t', () => {
    const x = [0, 1, 2, 3];
    const fit = linearTrend(x, [7, 7, 7, 7]);
    expect(fit.slope).toBe(0);
    expect(fit.tStatistic).toBe(0);
  });

  /**
   * The reason this helper exists (M9 phase 3c). A saturating trajectory has a positive
   * two-endpoint chord long after its trend has died; the fitted slope of its TAIL is
   * indistinguishable from zero, and the difference is the whole diagnosis.
   */
  it('separates a saturating tail from a genuine linear trend', () => {
    const x = Array.from({ length: 12 }, (_, i) => 20 + i);
    const saturating = x.map((t) => 1 - Math.exp(-t / 2));
    const chord = (saturating[saturating.length - 1] - saturating[0]) / (x[x.length - 1] - x[0]);
    const tail = linearTrend(x, saturating);
    expect(chord).toBeGreaterThan(0);
    expect(tail.tStatistic).toBeGreaterThan(2); // a clean exponential is still resolvable…
    expect(Math.abs(tail.slope)).toBeLessThan(1e-4); // …but the slope itself is ~zero

    const linear = x.map((t) => 0.5 + 1e-3 * t);
    const trending = linearTrend(x, linear);
    expect(trending.slope).toBeCloseTo(1e-3, 12);
  });

  it('flags a noisy flat series as not distinguishable from zero', () => {
    const x = Array.from({ length: 10 }, (_, i) => i);
    const noisy = [0.1, -0.1, 0.05, -0.07, 0.02, 0.09, -0.04, 0.06, -0.02, 0.03];
    expect(linearTrend(x, noisy).tStatistic).toBeLessThan(2);
  });

  it('returns NaN rather than throwing on degenerate input', () => {
    expect(linearTrend([1], [2]).slope).toBeNaN();
    expect(linearTrend([2, 2, 2], [1, 2, 3]).slope).toBeNaN();
    expect(linearTrend([0, 1], [0, 1]).slopeStdErr).toBeNaN();
    expect(() => linearTrend([1, 2], [1])).toThrow();
  });
});
