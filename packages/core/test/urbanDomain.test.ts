import { describe, expect, it } from 'vitest';
import {
  assertUrbanDomainAcceptanceReady,
  bounds3,
  planUrbanDomain,
  windAlignEnuPositions,
  type Bounds3,
} from '../src/scenes/urbanDomain.js';

describe('windAlignEnuPositions', () => {
  it('subtracts large ENU origins before f32 storage and rotates geometry with the wind', () => {
    const origin = { east: 411_000, north: 4_171_000, up: 10 };
    const positions = [
      origin.east + 2,
      origin.north + 3,
      origin.up + 5,
      origin.east - 4,
      origin.north + 1,
      origin.up,
    ];
    // Wind from north flows south: solver x = -north, y = up, z = -east.
    const aligned = windAlignEnuPositions(positions, origin, 0);
    expect(Array.from(aligned)).toEqual([-3, 5, -2, -1, 0, 4]);
    // Translation-before-cast preserves the 1-4 m deltas despite the large UTM origin.
    expect(bounds3(aligned).size).toEqual([2, 5, 6]);
  });

  it('rejects malformed or non-finite geometry', () => {
    const origin = { east: 0, north: 0, up: 0 };
    expect(() => windAlignEnuPositions([1, 2], origin, 0)).toThrow(/triplets/);
    expect(() => windAlignEnuPositions([1, 2, NaN], origin, 0)).toThrow(/non-finite/);
  });
});

describe('planUrbanDomain', () => {
  const urbanBounds: Bounds3 = {
    min: [-10, 0, -20],
    max: [10, 60, 20],
    size: [20, 60, 40],
  };

  it('applies the AIJ 5H/10H/5H domain rules and direction-specific blockage cap', () => {
    const plan = planUrbanDomain({
      geometryBounds: urbanBounds,
      maxBuildingHeight: 60,
      probeHeight: 2,
      maxCells: 500_000_000,
    });
    expect(plan.domainSize).toEqual([920, 360, 640]);
    expect(plan.geometryOffset).toEqual([310, 0, 320]);
    expect(plan.blockage).toBeCloseTo((60 * 40) / (360 * 640), 12);
    expect(plan.blockage).toBeLessThan(0.03);
  });

  it('marks a browser-scale Case-E-like budget under-resolved instead of publishing a verdict', () => {
    // 384x384x128-class budget from M11. With a 60 m Hmax and 2 m probes, the third-cell
    // rule requires dx <= 0.8 m; uniform-grid domain padding makes that much more costly.
    const budget = 384 * 384 * 128;
    const plan = planUrbanDomain({
      geometryBounds: urbanBounds,
      maxBuildingHeight: 60,
      probeHeight: 2,
      maxCells: budget,
    });
    expect(plan.totalCells).toBeLessThanOrEqual(budget);
    expect(plan.probeLatticeY).toBeLessThan(2);
    expect(plan.acceptanceReady).toBe(false);
    expect(plan.checks.find((check) => check.code === 'probe-height')?.pass).toBe(false);
    expect(plan.requiredDx).toBeCloseTo(0.8, 12);
    expect(plan.requiredCells).toBeGreaterThan(400_000_000);
    expect(() => assertUrbanDomainAcceptanceReady(plan)).toThrow(/third fluid-node/);
  });

  it('becomes acceptance-ready when the same physical domain receives the required budget', () => {
    const coarse = planUrbanDomain({
      geometryBounds: urbanBounds,
      maxBuildingHeight: 60,
      probeHeight: 2,
      maxCells: 384 * 384 * 128,
    });
    const resolved = planUrbanDomain({
      geometryBounds: urbanBounds,
      maxBuildingHeight: 60,
      probeHeight: 2,
      maxCells: coarse.requiredCells * 2,
    });
    expect(resolved.probeLatticeY).toBeGreaterThanOrEqual(2);
    expect(resolved.cellsPerBuildingHeight).toBeGreaterThanOrEqual(10);
    expect(resolved.acceptanceReady).toBe(true);
    expect(() => assertUrbanDomainAcceptanceReady(resolved)).not.toThrow();
  });

  it('uses the blockage requirement when it is stricter than lateral clearance', () => {
    const broadFacade: Bounds3 = {
      min: [0, 0, 0],
      max: [20, 60, 1_000],
      size: [20, 60, 1_000],
    };
    const plan = planUrbanDomain({
      geometryBounds: broadFacade,
      maxBuildingHeight: 60,
      probeHeight: 2,
      maxCells: 20_000_000,
      padding: { lateralH: 0 },
    });
    expect(plan.domainSize[2]).toBeCloseTo((60 * 1_000) / (0.03 * 360), 9);
    expect(plan.blockage).toBeCloseTo(0.03, 12);
  });
});
