import { describe, it, expect } from 'vitest';
import { sphereDragCoefficient, sphereDragStats } from '../src/analysis/sphereDrag.js';

describe('sphereDragCoefficient (M7 step 8)', () => {
  it('normalizes by the projected frontal area πR² (round-trips an exact Cd)', () => {
    const u = 0.05;
    const R = 12;
    const Cd = 1.09;
    // fx that must reproduce Cd = Fx / (½·ρ0·u²·πR²).
    const fx = Cd * 0.5 * 1 * u * u * (Math.PI * R * R);
    expect(sphereDragCoefficient(fx, u, R)).toBeCloseTo(Cd, 12);
  });

  it('uses πR² (frontal), not 4πR² (surface) — a 4× guard', () => {
    const u = 0.05;
    const R = 10;
    const fx = 0.7;
    const cd = sphereDragCoefficient(fx, u, R);
    const surfaceMistake = fx / (0.5 * u * u * (4 * Math.PI * R * R));
    expect(cd / surfaceMistake).toBeCloseTo(4, 12);
  });
});

describe('sphereDragStats (M7 step 8)', () => {
  const base = { sampleInterval: 5, convectiveTimeSteps: 10, radius: 12, u: 0.05 };

  it('averages a constant series exactly and reports zero drift', () => {
    const fx = 0.5;
    const series = new Array(40).fill(fx);
    const s = sphereDragStats(series, { ...base, transientTc: 2, driftWindowTc: 2 });
    const expected = sphereDragCoefficient(fx, base.u, base.radius);
    expect(s.meanCd).toBeCloseTo(expected, 12);
    expect(s.minCd).toBeCloseTo(expected, 12);
    expect(s.maxCd).toBeCloseTo(expected, 12);
    expect(s.runningMeanDrift).toBeCloseTo(0, 12);
    expect(s.converged).toBe(true);
  });

  it('discards the startup transient (junk samples must not shift the mean)', () => {
    // transientSteps = 2·10 = 20; sample j is timestep (j+1)·5 ⇒ firstIdx = ceil(20/5)-1 = 3.
    const steady = 0.4;
    const series = [50, 50, 50, ...new Array(37).fill(steady)]; // first 3 samples are transient
    const s = sphereDragStats(series, { ...base, transientTc: 2, driftWindowTc: 2 });
    const expected = sphereDragCoefficient(steady, base.u, base.radius);
    // If the transient leaked in, the mean would be enormous; discarding gives exactly steady.
    expect(s.meanCd).toBeCloseTo(expected, 12);
    expect(s.samples).toBe(37);
  });

  it('flags a still-drifting series with a large running-mean drift', () => {
    // Post-transient Cd ramps linearly; the cumulative mean keeps climbing ⇒ drift ≫ 0.03.
    const series: number[] = [];
    for (let j = 0; j < 60; j++) series.push(0.1 + 0.02 * j); // strong upward trend
    const drifting = sphereDragStats(series, { ...base, transientTc: 2, driftWindowTc: 5 });
    expect(drifting.runningMeanDrift).toBeGreaterThan(0.03);

    // A series that settles to a constant after the transient drifts ≈ 0 in the final window.
    // firstIdx = 3 (see above), so exactly the first 3 samples are the discarded transient.
    const settled = [...new Array(3).fill(5), ...new Array(57).fill(0.42)];
    const conv = sphereDragStats(settled, { ...base, transientTc: 2, driftWindowTc: 5 });
    expect(conv.runningMeanDrift).toBeLessThan(0.03);
  });
});
