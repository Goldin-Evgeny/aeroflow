import { describe, expect, it } from 'vitest';
import { fitMeshToDomain, toLatticeSpace } from '../src/sim/fitMesh';
import type { MeshBounds } from '../src/sim/meshImport';

/**
 * Auto-scaling wizard math (M8 step 6). Reference figures are hand-computed from the spec's
 * padding rule (≥2 charLens upstream, ≥6 downstream, ≥2 lateral) and latticeUnits():
 * a 1 m cube at 10 m/s in air (ν = 1.5e-5) gives Re = 10·1/1.5e-5 ≈ 6.7e5.
 */
describe('fitMeshToDomain', () => {
  const cube = () => fitMeshToDomain({ bboxSize: [1, 1, 1], charLen: 1, windSpeed: 10, les: true });

  it('applies the 2/6/2 padding rule and spends (but never exceeds) the cell budget', () => {
    const fit = cube();
    // Physical domain: x = 1+8 = 9 m, y = z = 1+4 = 5 m.
    expect((fit.grid.nx * fit.dx) / 9).toBeGreaterThanOrEqual(1);
    expect((fit.grid.ny * fit.dx) / 5).toBeGreaterThanOrEqual(1);
    expect(fit.totalCells).toBeLessThanOrEqual(16_700_000);
    expect(fit.totalCells).toBeGreaterThan(0.85 * 16_700_000); // budget actually spent
    // Aspect follows the physical box: nx/ny ≈ 9/5.
    expect(fit.grid.nx / fit.grid.ny).toBeCloseTo(9 / 5, 1);
  });

  it('routes conversions through latticeUnits (Re, τ, dt consistent)', () => {
    const fit = cube();
    expect(fit.mapping.Re).toBeCloseTo((10 * 1) / 1.5e-5, 3);
    expect(fit.mapping.dx).toBe(fit.dx);
    expect(fit.mapping.dt).toBeCloseTo((0.05 * fit.dx) / 10, 12);
    expect(fit.cellsPerCharLen).toBeCloseTo(1 / fit.dx, 9);
  });

  it('places the mesh min corner at the upstream/lateral padding offsets', () => {
    const fit = cube();
    const cells = fit.cellsPerCharLen;
    expect(fit.meshOffset[0]).toBeCloseTo(2 * cells, 6);
    expect(fit.meshOffset[1]).toBeCloseTo(2 * cells, 6);
    expect(fit.meshOffset[2]).toBeCloseTo(2 * cells, 6);
  });

  it('computes bbox blockage and warns above 5%', () => {
    const ok = cube();
    expect(ok.blockage).toBeCloseTo(1 / 25, 6); // 4%
    expect(ok.warnings.find((w) => w.code === 'blockage')).toBeUndefined();

    const tight = fitMeshToDomain({
      bboxSize: [1, 1, 1],
      charLen: 1,
      windSpeed: 10,
      les: true,
      padding: { lateral: 0.75 },
    });
    expect(tight.blockage).toBeGreaterThan(0.05);
    expect(tight.warnings.find((w) => w.code === 'blockage')).toBeDefined();
  });

  it('warns τ-floor without LES (100 m building at 20 m/s) and offers the LES fix', () => {
    const building = fitMeshToDomain({ bboxSize: [30, 100, 30], charLen: 100, windSpeed: 20 });
    expect(building.mapping.tau).toBeLessThan(0.505);
    const warning = building.warnings.find((w) => w.code === 'tau-floor');
    expect(warning?.fix).toBe('enable-les');
    // Same setup with LES enabled: the warning clears (the wizard's one-click fix).
    const fixed = fitMeshToDomain({
      bboxSize: [30, 100, 30],
      charLen: 100,
      windSpeed: 20,
      les: true,
    });
    expect(fixed.warnings.find((w) => w.code === 'tau-floor')).toBeUndefined();
  });

  it('warns on Mach-limit violation with the reduce-u fix', () => {
    const fast = fitMeshToDomain({
      bboxSize: [1, 1, 1],
      charLen: 1,
      windSpeed: 10,
      uLattice: 0.15,
      les: true,
    });
    expect(fast.warnings.find((w) => w.code === 'mach')?.fix).toBe('reduce-u');
  });

  it('warns when the budget leaves under 24 cells per characteristic length', () => {
    const coarse = fitMeshToDomain({
      bboxSize: [1, 1, 1],
      charLen: 1,
      windSpeed: 10,
      les: true,
      maxCells: 200_000,
    });
    expect(coarse.cellsPerCharLen).toBeLessThan(24);
    expect(coarse.warnings.find((w) => w.code === 'resolution')).toBeDefined();
  });
});

describe('toLatticeSpace', () => {
  it('maps the bbox min corner to meshOffset and scales by 1/dx', () => {
    const fit = fitMeshToDomain({ bboxSize: [1, 1, 1], charLen: 1, windSpeed: 10, les: true });
    const bounds: MeshBounds = { min: [-0.5, 0, 2], max: [0.5, 1, 3], size: [1, 1, 1] };
    const lattice = toLatticeSpace(new Float32Array([-0.5, 0, 2, 0.5, 1, 3]), bounds, fit);
    for (let a = 0; a < 3; a++) {
      expect(lattice[a]).toBeCloseTo(fit.meshOffset[a], 5);
      expect(lattice[3 + a]).toBeCloseTo(fit.meshOffset[a] + 1 / fit.dx, 4);
    }
  });
});
