import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { SPHERE_CASES, sphereScene } from '../src/scenes/sphere3d.js';
import { calibrateMeshSphereRadius, stlSphereScene } from '../src/scenes/stlSphere3d.js';

/**
 * M8 acceptance-2 scene construction (the physics comparison itself runs on the GPU in the
 * browser; these tests pin the geometry the comparison stands on).
 *
 * Target: after radius calibration, the voxelized icosphere must occupy the same number of
 * solid cells as the M7 analytic mask to within 1% — that is what makes the STL-vs-analytic
 * Cd comparison like-with-like under the halfway-bounce-back convention (M8 pitfall). The
 * 1% bar is geometry bookkeeping, far tighter than the 2% Cd acceptance gate it protects.
 */
describe('calibrateMeshSphereRadius', () => {
  it('matches the analytic solid count within 1% for the Re=1000 sphere (R=16)', () => {
    const cal = calibrateMeshSphereRadius(16, 5);
    expect(Math.abs(cal.mismatch)).toBeLessThan(0.01);
    // Conservative voxelization inflates, so the calibrated mesh radius must come out
    // SMALLER than nominal — a negative offset would mean the calibration ran backwards.
    expect(cal.radiusOffset).toBeGreaterThan(0);
    expect(cal.radiusOffset).toBeLessThan(1.5);
  });
});

describe('stlSphereScene', () => {
  const scene = stlSphereScene(SPHERE_CASES.Re1000, { subdivisions: 5 });
  const analytic = sphereScene(SPHERE_CASES.Re1000);

  it('keeps the M7 grid, boundaries, and lattice parameters identical to the analytic case', () => {
    expect([scene.nx, scene.ny, scene.nz]).toEqual([analytic.nx, analytic.ny, analytic.nz]);
    expect(scene.omega).toBe(analytic.omega);
    expect(scene.uLattice).toBe(analytic.uLattice);
    expect(scene.tau).toBe(analytic.tau);
    const { nx, ny, nz } = scene;
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    for (let z = 0; z < nz; z += 7)
      for (let y = 0; y < ny; y += 7) {
        expect(scene.flags[at(0, y, z)]).toBe(CellType.Inlet);
        expect(scene.flags[at(nx - 1, y, z)]).toBe(CellType.Outlet);
      }
  });

  it('voxel count matches the analytic sphere within 1% (the like-with-like guarantee)', () => {
    expect(scene.analyticVoxels).toBe(analytic.sphereVoxels);
    expect(Math.abs(scene.voxelCountMismatch)).toBeLessThan(0.01);
    expect(scene.triangleCount).toBe(20480); // acceptance 2 wants ≥ 20k triangles
  });

  it('places every solid cell inside the sphere neighborhood and away from all faces', () => {
    const { nx, ny, nz, cx, cy, cz, radius } = scene;
    const bound = radius + 2; // calibrated mesh ≤ nominal; conservative shell ≤ ~1 cell out
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          if (scene.flags[x + nx * (y + ny * z)] !== CellType.Solid) continue;
          const d = Math.hypot(x - cx, y - cy, z - cz);
          expect(d, `solid cell (${x},${y},${z}) outside sphere neighborhood`).toBeLessThan(bound);
        }
  });

  it('interior of the voxelized sphere is solid (flood fill did not leak inside)', () => {
    const { nx, ny, cx, cy, cz, radius } = scene;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx * Math.floor(radius / 2);
          const y = Math.round(cy + dy * (radius / 2));
          const z = Math.round(cz + dz * (radius / 2));
          expect(scene.flags[x + nx * (y + ny * z)]).toBe(CellType.Solid);
        }
  });
});
