import { describe, expect, it } from 'vitest';
import { latticeUnits, forceToNewtons, AIR_DENSITY } from '../src/units.js';

describe('latticeUnits', () => {
  it('preserves the Reynolds number across unit systems', () => {
    // 10 m/s wind over a 20 m building, 100 cells.
    const m = latticeUnits({ physLength: 20, physVelocity: 10, cells: 100, uLattice: 0.05 });
    const rePhys = (10 * 20) / 1.5e-5;
    const reLattice = (m.uLattice * 100) / m.nuLattice;
    expect(m.Re).toBeCloseTo(rePhys, 6);
    expect(reLattice).toBeCloseTo(rePhys, 6);
  });

  it('computes τ from lattice viscosity: τ = 3ν + ½', () => {
    const m = latticeUnits({
      physLength: 1,
      physVelocity: 1,
      physViscosity: 1e-3,
      cells: 64,
      uLattice: 0.1,
    });
    expect(m.tau).toBeCloseTo(3 * m.nuLattice + 0.5, 12);
    expect(m.omega).toBeCloseTo(1 / m.tau, 12);
  });

  it('flags high-Re plain-BGK configurations as unstable (τ→0.5)', () => {
    // Real wind at building scale: Re ~ 10^7 — τ is indistinguishable from 0.5 without LES.
    const m = latticeUnits({ physLength: 20, physVelocity: 10, cells: 200, uLattice: 0.05 });
    expect(m.tau - 0.5).toBeLessThan(0.005);
    expect(m.stable).toBe(false);
  });

  it('LES lifts the τ₀ floor: the same high-Re config is stable with the subgrid model', () => {
    // Same building-scale Re~10⁷ case as above (τ→0.5): plain BGK is unstable, but with
    // LES the τ_eff ≥ τ₀ subgrid dissipation supplies the missing stability (M5, H1 §3).
    const base = { physLength: 20, physVelocity: 10, cells: 200, uLattice: 0.05 } as const;
    expect(latticeUnits(base).stable).toBe(false);
    expect(latticeUnits({ ...base, les: true }).stable).toBe(true);
    // LES does NOT rescue a Mach violation — the u ≤ 0.1 gate still applies.
    expect(latticeUnits({ ...base, les: true, uLattice: 0.2 }).stable).toBe(false);
  });

  it('rejects invalid input', () => {
    expect(() => latticeUnits({ physLength: 0, physVelocity: 1, cells: 10 })).toThrow();
    expect(() =>
      latticeUnits({ physLength: 1, physVelocity: 1, cells: 10, uLattice: 0.5 }),
    ).toThrow();
  });
});

describe('forceToNewtons (M8 step 7)', () => {
  it('matches the hand computation F = ½·ρ·Cd·A·U² (M8 acceptance 5 cross-check)', () => {
    // A D = 0.5 m sphere in a U = 10 m/s wind at an assumed Cd = 0.47 (Re≈3×10⁵ ballpark;
    // the value is arbitrary — the check is that the SAME Cd expressed in lattice units
    // and converted with ρ_phys·dx⁴/dt² reproduces the physical drag equation exactly.
    // dx³/dt² or dx⁴/dt — the classic wrong exponents (M8 pitfall) — fail this by ×dt/dx.)
    const Cd = 0.47;
    const U = 10;
    const D = 0.5;
    const m = latticeUnits({ physLength: D, physVelocity: U, cells: 40, uLattice: 0.05 });
    // Lattice-side drag on the same sphere: F_lat = ½·ρ_lat·Cd·A_lat·u_lat², ρ_lat = 1.
    const rLat = D / 2 / m.dx;
    const fLattice = 0.5 * 1 * Cd * Math.PI * rLat * rLat * m.uLattice * m.uLattice;
    const hand = 0.5 * AIR_DENSITY * Cd * (Math.PI * (D / 2) ** 2) * U * U; // ≈ 5.56 N
    expect(forceToNewtons(fLattice, m)).toBeCloseTo(hand, 10);
    expect(hand).toBeGreaterThan(5); // sanity: order-1..10 newtons, not 1e±3 (unit slip)
    expect(hand).toBeLessThan(6);
  });

  it('scales linearly in force and density', () => {
    const m = { dx: 0.01, dt: 0.001 };
    expect(forceToNewtons(2, m, 1000)).toBeCloseTo(2 * forceToNewtons(1, m, 1000), 12);
    expect(forceToNewtons(1, m, 1000)).toBeCloseTo((1000 / AIR_DENSITY) * forceToNewtons(1, m), 9);
  });
});
