import { describe, expect, it } from 'vitest';
import {
  TAU_PERCENTILES,
  ahmedTauRegions,
  smagorinskyTauEff,
  tauLayersAt,
  tauStats,
  viscosityFromTau,
} from '../src/index.js';

/**
 * M9 step 6. These pin the reduction, not the physics — the physics lives in `collideCell`
 * and is covered by the LES and parity suites. What can silently go wrong here is the ν ratio
 * (an eddy viscosity reported relative to the wrong baseline inverts the conclusion the whole
 * measurement exists to reach) and the masking (a statistic that quietly includes solid cells
 * reads as a τ_eff of zero and drags every percentile down).
 */
describe('τ_eff statistics (M9)', () => {
  const tau0 = 0.501439; // the Ahmed Re=1e4 rung

  it('reports ν_mol = (τ₀ − ½)/3 and ν_LES/ν_mol relative to it', () => {
    const nuMol = viscosityFromTau(tau0);
    expect(nuMol).toBeCloseTo((0.501439 - 0.5) / 3, 15);

    // A cell whose eddy viscosity exactly equals the molecular one sits at τ₀ + (τ₀ − ½).
    const doubled = tau0 + (tau0 - 0.5);
    const s = tauStats(new Float64Array([doubled]), tau0, () => true);
    expect(s.nuRatioMean).toBeCloseTo(1, 12);
    expect(s.lesDominantFraction).toBe(0); // strictly greater, so exactly 1 does not count
    expect(s.atFloorFraction).toBe(0);
  });

  it('counts a cell at τ₀ as being at the floor, not as an error', () => {
    // τ_eff = τ₀ + τ_t with τ_t ≥ 0, so τ₀ IS the lower bound — there is no clamp anywhere.
    const s = tauStats(new Float64Array([tau0, tau0, tau0]), tau0, () => true);
    expect(s.atFloorFraction).toBe(1);
    expect(s.nuRatioMax).toBe(0);
    expect(s.tauMin).toBe(tau0);
    expect(s.tauMax).toBe(tau0);
  });

  it('separates dominant from overwhelming eddy viscosity', () => {
    const d = tau0 - 0.5;
    const field = new Float64Array([
      tau0, // ratio 0    — at floor
      tau0 + 0.5 * d, // ratio 0.5  — subdominant
      tau0 + 2 * d, // ratio 2    — dominant
      tau0 + 50 * d, // ratio 50   — overwhelming
    ]);
    const s = tauStats(field, tau0, () => true);
    expect(s.cells).toBe(4);
    expect(s.atFloorFraction).toBe(0.25);
    expect(s.lesDominantFraction).toBe(0.5); // ratios 2 and 50
    expect(s.lesOverwhelmingFraction).toBe(0.25); // ratio 50 only
    expect(s.nuRatioMax).toBeCloseTo(50, 9);
  });

  it('honours the mask — excluded cells never reach a percentile', () => {
    // Cells 0 and 2 hold 0 (a solid cell's uninitialized slot). Including them would drag
    // the minimum to 0 and report a physically impossible τ_eff below ½.
    const field = new Float64Array([0, tau0 + 0.01, 0, tau0 + 0.02]);
    const s = tauStats(field, tau0, (i) => i % 2 === 1);
    expect(s.cells).toBe(2);
    expect(s.tauMin).toBeCloseTo(tau0 + 0.01, 12);
    expect(s.tauMax).toBeCloseTo(tau0 + 0.02, 12);
  });

  it('returns NaN statistics rather than zeros for an empty mask', () => {
    const s = tauStats(new Float64Array([tau0]), tau0, () => false);
    expect(s.cells).toBe(0);
    expect(Number.isNaN(s.tauMean)).toBe(true);
    expect(Number.isNaN(s.atFloorFraction)).toBe(true);
    // ν_mol is a property of τ₀ alone and stays finite.
    expect(s.nuMolecular).toBeGreaterThan(0);
  });

  it('rejects τ₀ ≤ ½ instead of emitting infinite ratios', () => {
    expect(() => tauStats(new Float64Array([0.5]), 0.5, () => true)).toThrow(/tau0/);
  });

  it('uses nearest-rank percentiles over the requested positions', () => {
    const field = new Float64Array(100);
    for (let i = 0; i < 100; i++) field[i] = tau0 + i * 1e-4;
    const s = tauStats(field, tau0, () => true);
    expect(s.tauPercentiles).toHaveLength(TAU_PERCENTILES.length);
    // p50 of 100 ascending values is the 50th (index 49) by nearest rank.
    expect(s.tauPercentiles[3]).toBeCloseTo(tau0 + 49e-4, 12);
    expect(s.tauPercentiles[0]).toBeCloseTo(tau0, 12); // p1 → index 0
    expect(s.tauMax).toBeCloseTo(tau0 + 99e-4, 12);
    // Percentiles must be non-decreasing.
    for (let i = 1; i < s.tauPercentiles.length; i++) {
      expect(s.tauPercentiles[i]).toBeGreaterThanOrEqual(s.tauPercentiles[i - 1]);
    }
  });

  it('agrees with the solver formula on a hand-computed cell', () => {
    // Independent check that the ratio really is ν_LES/ν_mol: build τ_eff from the shared
    // Smagorinsky helper, then confirm the statistic recovers (τ_eff − τ₀)/(τ₀ − ½).
    const lesK = 18 * Math.SQRT2 * 0.1 * 0.1;
    const tEff = smagorinskyTauEff(tau0, lesK, 1e-3, 1.0);
    expect(tEff).toBeGreaterThan(tau0);
    const s = tauStats(new Float64Array([tEff]), tau0, () => true);
    expect(s.nuRatioMean).toBeCloseTo((tEff - tau0) / (tau0 - 0.5), 10);
  });

  it('builds y-layer profiles at a station, skipping non-fluid cells', () => {
    const nx = 4;
    const ny = 3;
    const nz = 2;
    const field = new Float64Array(nx * ny * nz);
    const solid = new Set<number>();
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + nx * (y + ny * z);
          field[idx] = tau0 + (y + 1) * 1e-3;
          if (y === 0) solid.add(idx); // ground row
        }
      }
    }
    const layers = tauLayersAt(field, tau0, nx, ny, nz, 2, ny, (i) => !solid.has(i));
    expect(layers).toHaveLength(3);
    expect(layers[0].cells).toBe(0); // ground row entirely masked out
    expect(Number.isNaN(layers[0].tauMean)).toBe(true);
    expect(layers[1].cells).toBe(nz);
    expect(layers[1].tauMean).toBeCloseTo(tau0 + 2e-3, 12);
    expect(layers[1].nuRatioMean).toBeCloseTo(2e-3 / (tau0 - 0.5), 9);
  });

  it('builds region masks that depend only on geometry, so two runs share them', () => {
    const nx = 40;
    const ny = 20;
    const nz = 10;
    const regions = ahmedTauRegions({
      nx,
      ny,
      noseX: 10,
      bodyLength: 12,
      bodyHeight: 5,
      slantStartX: 18,
      stations: [2, 5, 9],
      isFluid: () => true,
    });
    const names = regions.map((r) => r.name);
    expect(names).toContain('whole domain');
    expect(names).toContain('slant');
    expect(names).toContain('near wake (≤1 body length aft)');
    expect(names).toContain('station x=9');

    // The approach-freestream mask must exclude the ground band and everything aft of the
    // nose — otherwise "undisturbed freestream" quietly includes the body's own wake.
    const approach = regions.find((r) => r.name === 'approach freestream')!;
    const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
    expect(approach.select(at(5, 10, 5))).toBe(true);
    expect(approach.select(at(5, 2, 5))).toBe(false); // inside the ground band
    expect(approach.select(at(30, 10, 5))).toBe(false); // aft of the nose

    // A region built for a second run with identical geometry must select identical cells.
    const again = ahmedTauRegions({
      nx,
      ny,
      noseX: 10,
      bodyLength: 12,
      bodyHeight: 5,
      slantStartX: 18,
      stations: [2, 5, 9],
      isFluid: () => true,
    });
    for (let r = 0; r < regions.length; r++) {
      expect(again[r].name).toBe(regions[r].name);
      for (let i = 0; i < nx * ny * nz; i += 37) {
        expect(again[r].select(i)).toBe(regions[r].select(i));
      }
    }
  });
});
