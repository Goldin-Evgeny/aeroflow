import { describe, expect, it } from 'vitest';
import { ForceHistory } from '../src/stats/forceHistory.js';

/**
 * ForceHistory (M9 step 3). Targets from the spec: isConverged(20, 0.03) fires when the
 * cumulative running-mean over the trailing 20 convective times varies by < 3% — and never
 * before that window is fully populated. Convention matches sphereDragStats (M7).
 */

// 10 steps/sample, 100 steps per T_conv ⇒ 10 samples per convective time.
const mk = (capacity?: number) =>
  new ForceHistory({ sampleIntervalSteps: 10, convectiveTimeSteps: 100, capacity });

describe('ForceHistory', () => {
  it('tracks windowed mean and std', () => {
    const h = mk();
    for (const v of [1, 2, 3, 4]) h.push(v, -v, 0);
    const all = h.stats(0);
    expect(all.samples).toBe(4);
    expect(all.mean).toBeCloseTo(2.5, 12);
    expect(all.std).toBeCloseTo(Math.sqrt(5 / 3), 12); // sample std of 1..4
    expect(h.stats(1).mean).toBeCloseTo(-2.5, 12);
    // Trailing 0.2 T_conv = 2 samples: mean of [3, 4].
    expect(h.stats(0, 0.2).mean).toBeCloseTo(3.5, 12);
  });

  it('does not report converged before the window is fully populated, even if flat', () => {
    const h = mk();
    for (let i = 0; i < 100; i++) h.push(1, 0, 0); // dead flat, but only 10 T_conv
    expect(h.isConverged(20, 0.03)).toBe(false);
    for (let i = 0; i < 100; i++) h.push(1, 0, 0); // now 20 T_conv
    expect(h.isConverged(20, 0.03)).toBe(true);
    expect(h.runningMeanDrift(20)).toBe(0);
  });

  it('detects a drifting mean as unconverged and a settling one as converged', () => {
    const drifting = mk();
    for (let i = 0; i < 400; i++) drifting.push(1 + i / 100, 0, 0); // ramp
    expect(drifting.isConverged(20, 0.03)).toBe(false);

    const settling = mk();
    // Long transient then a steady oscillation around 2.0 — running mean flattens out.
    for (let i = 0; i < 400; i++) settling.push(3 - i / 400, 0, 0);
    for (let i = 0; i < 4000; i++) settling.push(2 + 0.05 * Math.sin(i / 7), 0, 0);
    expect(settling.isConverged(20, 0.03)).toBe(true);
    expect(settling.stats(0, 20).mean).toBeCloseTo(2, 1);
  });

  it('ring eviction keeps the cumulative mean exact', () => {
    const h = mk(8); // tiny ring
    for (let i = 1; i <= 100; i++) h.push(i, 0, 0);
    expect(h.count).toBe(8);
    expect(h.pushed).toBe(100);
    expect(h.cumulativeMeanFx).toBeCloseTo(50.5, 12); // mean of 1..100 despite eviction
    expect(h.stats(0).mean).toBeCloseTo((93 + 100) / 2, 12); // ring holds 93..100
  });

  it('serialize → restore round-trips state and statistics exactly', () => {
    const h = mk(16);
    for (let i = 0; i < 40; i++) h.push(Math.sin(i), Math.cos(i), i / 10);
    const r = ForceHistory.restore(h.serialize());
    expect(r.pushed).toBe(h.pushed);
    expect(r.count).toBe(h.count);
    expect(r.cumulativeMeanFx).toBe(h.cumulativeMeanFx);
    expect(r.stats(0, 1)).toEqual(h.stats(0, 1));
    expect(r.stats(2)).toEqual(h.stats(2));
    expect(r.runningMeanDrift(1)).toBe(h.runningMeanDrift(1));
    // Restored instance keeps accepting samples with a consistent running mean.
    h.push(5, 0, 0);
    r.push(5, 0, 0);
    expect(r.cumulativeMeanFx).toBe(h.cumulativeMeanFx);
    expect(r.stats(0, 1)).toEqual(h.stats(0, 1));
  });
});
