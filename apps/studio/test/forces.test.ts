import { describe, it, expect } from 'vitest';
import { analyzeCylinderForces } from '../src/sim/forces';

/**
 * Force post-processing (M4 step 7). Synthetic-signal test: with a known shedding
 * period, mean drag, and lift amplitude injected into the raw lattice-force series, the
 * analyzer must recover Cd, Cl amplitude, and St (both estimators agreeing). No GPU.
 *
 * Construction: sample every `interval` steps. Cl(t) = A·sin(2π t / T_shed) → Fy sample
 * = Cl · (½·ρ0·u²·D). Cd(t) = meanCd + small 2×-frequency ripple → Fx analogously.
 */
describe('analyzeCylinderForces', () => {
  it('recovers St, mean Cd and Cl amplitude from a synthetic series', () => {
    const u = 0.05;
    const D = 25;
    const interval = 20; // even → aliases the period-2 staggered mode to DC (H2 §4a)
    const T_shed = 3000; // steps per shedding period → St = D/(T·u) = 25/150 = 0.1667
    const targetSt = D / (T_shed * u);
    const meanCd = 1.35;
    const clAmp = 0.32;
    const norm = 0.5 * 1 * u * u * D; // ½ρ0 u² D

    const totalSteps = 260_000; // 80k transient + 180k analysis (~60 periods)
    const fx: number[] = [];
    const fy: number[] = [];
    for (let step = interval; step <= totalSteps; step += interval) {
      const cl = clAmp * Math.sin((2 * Math.PI * step) / T_shed);
      // Drag oscillates at 2× shedding frequency (H7 §5) — must NOT leak into St.
      const cd = meanCd + 0.02 * Math.cos((2 * Math.PI * step) / (T_shed / 2));
      fx.push(cd * norm);
      fy.push(cl * norm);
    }

    const s = analyzeCylinderForces(fx, fy, { u, D, sampleInterval: interval });

    expect(s.meanCd).toBeCloseTo(meanCd, 3);
    expect(s.clAmplitude).toBeCloseTo(clAmp, 2);
    expect(s.clAmplitudePeakToPeak).toBeCloseTo(clAmp, 2);
    // Both St estimators within 1 % of the injected value, and of each other.
    expect(Math.abs(s.stZeroCross - targetSt)).toBeLessThan(0.01 * targetSt);
    expect(Math.abs(s.stFft - targetSt)).toBeLessThan(0.01 * targetSt);
    expect(s.estimatorsAgree).toBe(true);
    expect(s.periods).toBeGreaterThan(50);
  });
});
