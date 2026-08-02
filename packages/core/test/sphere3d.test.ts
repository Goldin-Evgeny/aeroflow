import { describe, it, expect } from 'vitest';
import { CellType } from '../src/lattice.js';
import { sphereScene, SPHERE_CASES, SPHERE_FREESLIP_FACES } from '../src/scenes/sphere3d.js';
import { validateFreeSlip } from '../src/cpu/freeslip.js';

/**
 * Scene-builder invariants for the M7 sphere-drag ladder. These are cheap structural
 * checks (no solver run): sphere resolution, blockage bound, boundary layout, and the
 * y/z symmetry that makes Fy/Fz average to ≈0.
 */
describe('sphereScene (M7 sphere-drag scenes)', () => {
  it('sets Re through τ: ν = u·D/Re and τ₀ = 3ν + 0.5 for every case', () => {
    for (const spec of Object.values(SPHERE_CASES)) {
      const s = sphereScene(spec);
      expect(s.nu).toBeCloseTo((spec.uLattice * spec.D) / spec.Re, 12);
      expect(s.tau).toBeCloseTo(3 * s.nu + 0.5, 12);
      expect(s.omega).toBeCloseTo(1 / s.tau, 12);
      // τ must stay above the 0.5 stability floor (LES regularizes the tightest case).
      expect(s.tau).toBeGreaterThan(0.5);
    }
  });

  it('keeps ≥ 24 cells/diameter and blockage below the 5 % inflation line', () => {
    // Blockages: Re=100 → 2.76 %, Re=1000 → 3.14 %, Re=10⁴ → 4.91 %. The Re=10⁴ case keeps
    // D=48 (over the ≤3 % guideline) because resolution, not blockage, dominates its error —
    // a D=36 run (2.76 %) read HIGHER Cd. All stay under the pitfall's 5 % "drag inflates" line.
    for (const spec of Object.values(SPHERE_CASES)) {
      const s = sphereScene(spec);
      expect(s.cellsPerDiameter).toBeGreaterThanOrEqual(24);
      expect(s.blockage).toBeLessThan(0.05);
    }
  });

  it('voxelizes the sphere within 2 % of (4/3)πR³', () => {
    const s = sphereScene(SPHERE_CASES.Re1000);
    const analytic = (4 / 3) * Math.PI * s.radius ** 3;
    expect(Math.abs(s.sphereVoxels - analytic) / analytic).toBeLessThan(0.02);
  });

  it('lays out inlet/outlet planes and free-stream lateral inlets; sphere is the only Solid', () => {
    const s = sphereScene(SPHERE_CASES.Re100); // freestream default
    const { nx, ny, nz, flags } = s;
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    // x=0 plane all Inlet, x=nx-1 plane all Outlet.
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        expect(flags[at(0, y, z)]).toBe(CellType.Inlet);
        expect(flags[at(nx - 1, y, z)]).toBe(CellType.Outlet);
      }
    }
    // Lateral faces are Inlet (free stream), not Solid.
    expect(flags[at(nx >> 1, 0, nz >> 1)]).toBe(CellType.Inlet);
    expect(flags[at(nx >> 1, ny - 1, nz >> 1)]).toBe(CellType.Inlet);
    expect(flags[at(nx >> 1, ny >> 1, 0)]).toBe(CellType.Inlet);
    // The only Solid cells are the sphere (interior), so their count equals sphereVoxels.
    let solids = 0;
    for (let i = 0; i < flags.length; i++) if (flags[i] === CellType.Solid) solids++;
    expect(solids).toBe(s.sphereVoxels);
  });

  it("'wall' lateral BC turns the lateral faces Solid", () => {
    const s = sphereScene(SPHERE_CASES.Re100, { lateralBC: 'wall' });
    const at = (x: number, y: number, z: number) => x + s.nx * (y + s.ny * z);
    expect(s.flags[at(s.nx >> 1, 0, s.nz >> 1)]).toBe(CellType.Solid);
  });

  it("'freeslip' lateral BC: four free-slip faces, interior outlet, and validateFreeSlip passes", () => {
    const s = sphereScene(SPHERE_CASES.Re100, { lateralBC: 'freeslip' });
    const { nx, ny, nz, flags } = s;
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    // Mid-face of each of the four lateral faces is FreeSlip (not Solid, not Inlet).
    expect(flags[at(nx >> 1, 0, nz >> 1)]).toBe(CellType.FreeSlip);
    expect(flags[at(nx >> 1, ny - 1, nz >> 1)]).toBe(CellType.FreeSlip);
    expect(flags[at(nx >> 1, ny >> 1, 0)]).toBe(CellType.FreeSlip);
    expect(flags[at(nx >> 1, ny >> 1, nz - 1)]).toBe(CellType.FreeSlip);
    // Inlet spans the whole x=0 face; outlet is strictly interior (edge ring stays FreeSlip).
    expect(flags[at(0, ny >> 1, nz >> 1)]).toBe(CellType.Inlet);
    expect(flags[at(nx - 1, ny >> 1, nz >> 1)]).toBe(CellType.Outlet);
    expect(flags[at(nx - 1, 0, nz >> 1)]).toBe(CellType.FreeSlip); // outlet-face edge, not Outlet
    // The sphere is still the ONLY Solid ⇒ total force == sphere force (free-slip ≠ Solid).
    let solids = 0;
    for (let i = 0; i < flags.length; i++) if (flags[i] === CellType.Solid) solids++;
    expect(solids).toBe(s.sphereVoxels);
    // No Outlet has a FreeSlip upstream (−x) neighbor — the H11 §3.2 constraint the run relies on.
    expect(() => validateFreeSlip(flags, nx, ny, nz, SPHERE_FREESLIP_FACES)).not.toThrow();
  });

  it('is symmetric under y- and z-reflection about the mid-plane (⇒ Fy, Fz ≈ 0)', () => {
    const s = sphereScene(SPHERE_CASES.Re100);
    const { nx, ny, nz, flags, cx, cy, cz, D } = s;
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    // Sweep only the sphere's bounding box (+margin); reflection maps cell k → (n-1-k), and
    // with the centre at (n-1)/2 the staircase sphere is exactly mirror-symmetric. Count
    // mismatches and assert once (per-cell expect() over ~10⁵ cells is prohibitively slow).
    let mismatches = 0;
    for (let z = Math.floor(cz - D); z <= Math.ceil(cz + D); z++) {
      for (let y = Math.floor(cy - D); y <= Math.ceil(cy + D); y++) {
        for (let x = cx - D; x <= cx + D; x++) {
          const solid = flags[at(x, y, z)] === CellType.Solid;
          if ((flags[at(x, ny - 1 - y, z)] === CellType.Solid) !== solid) mismatches++;
          if ((flags[at(x, y, nz - 1 - z)] === CellType.Solid) !== solid) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});
