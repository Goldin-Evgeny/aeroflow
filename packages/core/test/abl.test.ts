import { describe, expect, it } from 'vitest';
import {
  ablProfileLattice,
  logLawProfile,
  powerLawProfile,
  LATTICE_MACH_LIMIT,
} from '../src/abl.js';

/**
 * ABL profiles (M10 step 1). Analytic targets from the definitions: power law is exactly
 * uRef at zRef and uniform at α=0; log law is 0 at ground and strictly monotonic; the
 * lattice sampler uses the (k+0.5)·dx halfway-bounce-back node heights and reports (never
 * hides) the 0.1 lattice Mach clamp.
 */
describe('powerLawProfile', () => {
  it('reproduces uRef exactly at zRef and scales as (z/zRef)^alpha', () => {
    expect(powerLawProfile(10, 10, 6, 0.25)).toBe(6);
    expect(powerLawProfile(160, 10, 6, 0.25)).toBeCloseTo(6 * 2, 12); // 16^0.25 = 2
    expect(powerLawProfile(5, 10, 6, 1)).toBeCloseTo(3, 12);
  });

  it('alpha = 0 gives a uniform profile; ground and below return 0', () => {
    for (const z of [0.01, 1, 50]) expect(powerLawProfile(z, 10, 6, 0)).toBe(6);
    expect(powerLawProfile(0, 10, 6)).toBe(0);
    expect(powerLawProfile(-1, 10, 6)).toBe(0);
  });
});

describe('logLawProfile', () => {
  it('is 0 at the ground (the +z0 form avoids the singularity) and monotonic', () => {
    expect(logLawProfile(0, 0.1, 0.5)).toBe(0);
    let prev = 0;
    for (const z of [0.05, 0.1, 0.5, 2, 10, 100]) {
      const u = logLawProfile(z, 0.1, 0.5);
      expect(u).toBeGreaterThan(prev);
      prev = u;
    }
  });

  it('matches the hand-computed value (u*/κ)·ln((z+z0)/z0)', () => {
    // u* = 0.41, κ = 0.41 ⇒ u(z) = ln((z+z0)/z0); at z = 0.9, z0 = 0.1: ln(10) ≈ 2.302585.
    expect(logLawProfile(0.9, 0.1, 0.41)).toBeCloseTo(Math.log(10), 12);
  });
});

describe('ablProfileLattice', () => {
  it('samples at the halfway-offset node heights (k+0.5)·dx', () => {
    // dx = 2 m, uScale = 0.01: node k=0 sits at z = 1 m, k=4 at z = 9 m — NOT 0 and 8.
    const { profile, clamped } = ablProfileLattice(
      { kind: 'power', uRef: 6, zRef: 9, alpha: 0.25 },
      5,
      2,
      0.01,
    );
    expect(profile[4]).toBeCloseTo(0.06, 6); // z = 9 = zRef exactly ⇒ uRef·uScale
    expect(profile[0]).toBeCloseTo(6 * Math.pow(1 / 9, 0.25) * 0.01, 6);
    expect(profile[0]).toBeGreaterThan(0); // k·dx sampling would give exactly 0 here
    expect(clamped).toBe(false);
  });

  it('clamps at the lattice Mach limit and reports it', () => {
    // uScale chosen so only the TOP nodes exceed 0.1 lattice units: node 0 (z = 0.5 m)
    // gives 6·0.5^0.25·0.012 ≈ 0.061 < 0.1; node 63 (z = 63.5 m) gives ≈ 0.203 > 0.1.
    const { profile, clamped } = ablProfileLattice(
      { kind: 'power', uRef: 6, zRef: 1, alpha: 0.25 },
      64,
      1,
      0.012,
    );
    expect(clamped).toBe(true);
    expect(Math.max(...profile)).toBe(Math.fround(LATTICE_MACH_LIMIT)); // f32 storage
    // Below the clamp the profile is untouched.
    expect(profile[0]).toBeCloseTo(6 * Math.pow(0.5, 0.25) * 0.012, 6);
  });

  it('log-law spec routes through the sampler', () => {
    const { profile } = ablProfileLattice(
      { kind: 'log', uRef: 0, zRef: 0, z0: 0.1, uStar: 0.41 },
      2,
      1,
      0.01,
    );
    expect(profile[0]).toBeCloseTo(Math.log((0.5 + 0.1) / 0.1) * 0.01, 6);
    expect(profile[1]).toBeGreaterThan(profile[0]);
  });

  it('rejects non-positive arguments', () => {
    const spec = { kind: 'power' as const, uRef: 6, zRef: 10 };
    expect(() => ablProfileLattice(spec, 0, 1, 0.01)).toThrow('positive');
    expect(() => ablProfileLattice(spec, 8, -1, 0.01)).toThrow('positive');
  });
});
