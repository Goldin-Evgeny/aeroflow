import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { ahmedScene } from '../src/scenes/ahmed3d.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { AHMED } from '../src/geometry/ahmedBody.js';

/**
 * Ahmed scene builder (M9 step 2). Reduced cell budgets keep the tests fast; the fitted
 * constraints (≤5% blockage, 1L/2L fetch, τ from Re=4.29e6 through ν) are budget-
 * independent, which is exactly what the tests pin. The smallest tier is also fed into
 * the EsotericPull3D constructor, whose validate() enforces the H4 shell/outlet
 * invariants — an integration check that the flag field is actually runnable.
 */
describe('ahmedScene', () => {
  const scene = ahmedScene({ maxCells: 2_000_000 });

  it('respects the blockage cap and the fetch requirements', () => {
    expect(scene.blockage).toBeLessThan(0.055); // 5% cap + staircase margin
    expect(scene.blockage).toBeGreaterThan(0.03); // budget actually spent, not oversized
    expect(scene.noseX).toBeGreaterThanOrEqual(Math.floor(scene.lengthCells) - 1); // ≥1 L upstream
    const tailX = scene.noseX + scene.lengthCells;
    expect(scene.nx - tailX).toBeGreaterThanOrEqual(2 * scene.lengthCells - 2); // ≥2 L downstream
    expect(scene.nx * scene.ny * scene.nz).toBeLessThanOrEqual(2_000_000 * 1.02);
  });

  it('sets Re through τ (never guessed): τ = 0.5 + 3·u·L/Re, LES mandatory', () => {
    expect(scene.Re).toBe(4.29e6);
    expect(scene.nu).toBeCloseTo((0.05 * scene.lengthCells) / 4.29e6, 15);
    expect(scene.tau).toBeCloseTo(0.5 + 3 * scene.nu, 15);
    expect(scene.tau).toBeGreaterThan(0.5);
    expect(scene.tau).toBeLessThan(0.501); // microscopically above the floor ⇒ LES carries it
    expect(scene.les).toBe(true);
    expect(scene.convectiveTimeSteps).toBe(Math.round(scene.lengthCells / scene.uLattice));
  });

  it('voxelizes a plausible body: frontal area ≈ W·H, volume-filled interior', () => {
    const frontalAnalytic = (AHMED.width * AHMED.height * 1e-6) / (scene.dx * scene.dx);
    expect(scene.frontalCells).toBeGreaterThan(frontalAnalytic);
    expect(scene.frontalCells).toBeLessThan(frontalAnalytic * 1.25); // coarse-staircase band
    // Solid volume: ≥ loft volume (conservative), ≤ the full bbox volume.
    const bboxCells =
      (AHMED.length * AHMED.width * AHMED.height * 1e-9) / (scene.dx * scene.dx * scene.dx);
    expect(scene.bodyVoxels).toBeGreaterThan(0.8 * bboxCells);
    expect(scene.bodyVoxels).toBeLessThan(1.15 * bboxCells);
  });

  it('builds the published boundary layout: no-slip ground, freestream top/sides', () => {
    const { nx, ny, nz, flags } = scene;
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    for (let k = 1; k < 5; k++) {
      const x = Math.floor((k * nx) / 5);
      const z = Math.floor((k * nz) / 5);
      expect(flags[at(x, 0, z)]).toBe(CellType.Solid); // ground
      expect(flags[at(x, ny - 1, z)]).toBe(CellType.Inlet); // freestream top
      expect(flags[at(x, Math.floor(ny / 2), 0)]).toBe(CellType.Inlet); // sides
      expect(flags[at(0, Math.max(1, Math.floor((k * ny) / 5)), z)]).toBe(CellType.Inlet);
      expect(flags[at(nx - 1, Math.max(1, Math.floor((k * ny) / 5)), z)]).toBe(CellType.Outlet);
    }
    // Ground row must stay Solid across the outlet face (H4 §10.9: no Solid upstream of
    // an Outlet — which is also asserted for the whole field by the solver test below).
    expect(flags[at(nx - 1, 0, Math.floor(nz / 2))]).toBe(CellType.Solid);
  });

  it('produces a flag field EsotericPull3D accepts and can step', () => {
    const small = ahmedScene({ maxCells: 300_000 });
    const solver = new EsotericPull3D({
      nx: small.nx,
      ny: small.ny,
      nz: small.nz,
      omega: small.omega,
      flags: small.flags,
      inletVelocity: small.uLattice,
      collision: 'trt',
      regularize: true,
      les: { cs: 0.1 },
    });
    solver.step(2); // one even + one odd step through the full BC set
    expect(Number.isFinite(solver.totalMass())).toBe(true);
    expect(solver.force.x).not.toBe(0); // the body is in the flow and feels it
  });
});
