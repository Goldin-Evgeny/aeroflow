import { describe, expect, it } from 'vitest';
import { hitRate, pearson } from '../src/validation/score.js';

/**
 * Validation scoring (M10 step 2), hand-computed targets stated inline.
 */
describe('hitRate', () => {
  it('identical arrays give q = 1', () => {
    expect(hitRate([0.2, 0.5, 0.9], [0.2, 0.5, 0.9])).toBe(1);
  });

  it('4-point hand case with exactly 3 hits gives q = 0.75', () => {
    // allowed 0.25, ref 1: |Δ| = 0.1 hit, 0.25 hit (boundary inclusive), 0.3 miss, 0 hit.
    const sim = [0.5, 0.75, 1.0, 0.2];
    const exp = [0.6, 0.5, 0.7, 0.2];
    expect(hitRate(sim, exp)).toBe(0.75);
  });

  it('applies the ref normalization: same Δ, ref 2 doubles the allowed band', () => {
    // |Δ| = 0.4 > 0.25 with ref 1 (miss) but 0.4/2 = 0.2 ≤ 0.25 with ref 2 (hit).
    expect(hitRate([1.0], [0.6])).toBe(0);
    expect(hitRate([1.0], [0.6], 0.25, 2)).toBe(1);
  });

  it('rejects mismatched lengths and bad parameters; empty gives NaN', () => {
    expect(() => hitRate([1], [1, 2])).toThrow('length');
    expect(() => hitRate([1], [1], 0)).toThrow('positive');
    expect(hitRate([], [])).toBeNaN();
  });
});

describe('pearson', () => {
  it('identical arrays give r = 1; perfectly anti-correlated give r = −1', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
    // Linear rescaling preserves r = 1 exactly.
    expect(pearson([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12);
  });

  it('matches a hand-computed 4-point case', () => {
    // sim = [1,2,3,4] (mean 2.5), exp = [1,2,2,4] (mean 2.25):
    // cov = Σ(a·b) = (−1.5·−1.25)+(−0.5·−0.25)+(0.5·−0.25)+(1.5·1.75) = 4.5
    // var_s = 5, var_e = 4.75 ⇒ r = 4.5/√(5·4.75) = 4.5/4.873397 ≈ 0.923378
    expect(pearson([1, 2, 3, 4], [1, 2, 2, 4])).toBeCloseTo(4.5 / Math.sqrt(5 * 4.75), 12);
  });

  it('constant series give NaN (undefined correlation), short series too', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN();
    expect(pearson([2], [3])).toBeNaN();
  });
});
