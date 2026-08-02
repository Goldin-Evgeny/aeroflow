import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { icosphere } from '../src/geometry/icosphere.js';
import {
  triBoxOverlap,
  voxelizeSurface,
  voxelizeSolid,
  floodFillExterior,
  VOXEL_EXTERIOR,
} from '../src/voxel/voxelize.js';

/**
 * M8 step 1 / H8-voxelizer.md: CPU reference voxelizer oracle tests.
 * SAT cases are H8 §2's hardcoded fixtures; mesh-level tests are H8 §3
 * (T-VOX-SPHERE, T-VOX-HOLE). Meshes are generated procedurally — no asset files
 * (icosphere from geometry/icosphere.ts, hollow cube below).
 */

/**
 * Hollow axis-aligned cube [lo, hi]³ as a triangle soup; every face is an n×n grid of
 * quads (2 triangles each), so removing ONE triangle opens a hole of (hi−lo)/n cells.
 * `omit` skips triangles by their global index (face-major, deterministic).
 */
function hollowCube(
  lo: number,
  hi: number,
  n: number,
  omit: Set<number> = new Set(),
): Float32Array {
  const tris: number[] = [];
  const s = (hi - lo) / n;
  let triIndex = 0;
  const emit = (a: number[], b: number[], c: number[]): void => {
    if (!omit.has(triIndex++)) tris.push(...a, ...b, ...c);
  };
  // For each of the 6 faces: fixed axis (value lo or hi), the other two axes gridded.
  for (const [axis, value] of [
    [0, lo],
    [0, hi],
    [1, lo],
    [1, hi],
    [2, lo],
    [2, hi],
  ] as const) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const p = (ui: number, vj: number): number[] => {
          const q = [0, 0, 0];
          q[axis] = value;
          q[u] = lo + ui * s;
          q[v] = lo + vj * s;
          return q;
        };
        emit(p(i, j), p(i + 1, j), p(i + 1, j + 1));
        emit(p(i, j), p(i + 1, j + 1), p(i, j + 1));
      }
  }
  return new Float32Array(tris);
}

describe('triBoxOverlap (13-axis SAT, H8 §2 fixtures)', () => {
  // Unit cube centered at the origin (h = 0.5) in every case.
  it('triangle fully inside the cell overlaps', () => {
    expect(triBoxOverlap([-0.2, -0.2, 0], [0.2, -0.2, 0.1], [0, 0.3, -0.1], 0, 0, 0)).toBe(true);
  });

  it('triangle in a face-parallel plane 0.6 cells away does not overlap', () => {
    expect(triBoxOverlap([-2, -2, 0.6], [2, -2, 0.6], [0, 2, 0.6], 0, 0, 0)).toBe(false);
  });

  it('triangle piercing a corner overlaps', () => {
    // Plane x+y+z = 1.4 cuts the box near the (+,+,+) corner (corner support 1.5);
    // the centroid (0.467, 0.467, 0.467) lies inside the box.
    expect(triBoxOverlap([0.2, 0.2, 1.0], [1.0, 0.2, 0.2], [0.2, 1.0, 0.2], 0, 0, 0)).toBe(true);
    // A triangle in the plane x+y+z = 1.8, past the corner, must be rejected — its AABB
    // ([0.1, 1.6]³) overlaps the box, so only the normal/cross axes can separate it.
    expect(triBoxOverlap([1.6, 0.1, 0.1], [0.1, 1.6, 0.1], [0.1, 0.1, 1.6], 0, 0, 0)).toBe(false);
  });

  it('sliver along a diagonal at 0.51 offset does not overlap (needs the 9 cross axes)', () => {
    // Plane x + y = 1.02: outside the box (corner support = 0.5 + 0.5 = 1.0) but the
    // triangle AABB spans the box in x and y — only a cross/normal axis separates it.
    expect(triBoxOverlap([1.02, 0, -1], [0, 1.02, -1], [0.51, 0.51, 1], 0, 0, 0)).toBe(false);
  });

  it('same diagonal sliver at 0.49 offset overlaps (tolerance sanity)', () => {
    expect(triBoxOverlap([0.98, 0, -1], [0, 0.98, -1], [0.49, 0.49, 1], 0, 0, 0)).toBe(true);
  });

  it('degenerate (zero-area) triangle still overlaps conservatively', () => {
    // Collinear points crossing the cell — the normal axis is skipped, the rest must hit.
    expect(triBoxOverlap([-1, 0, 0], [1, 0, 0], [0, 0, 0], 0, 0, 0)).toBe(true);
    // …and a collinear segment far away must still be rejected by the box axes.
    expect(triBoxOverlap([-1, 0, 3], [1, 0, 3], [0, 0, 3], 0, 0, 0)).toBe(false);
  });
});

describe('T-VOX-SPHERE: icosphere (3 subdivisions, r=10.3) in a 32³ grid', () => {
  const N = 32;
  const R = 10.3;
  const C = 15.5;
  const { positions, indices } = icosphere(3, R, C, C, C);
  const mask = voxelizeSolid(positions, indices, { nx: N, ny: N, nz: N });
  const at = (x: number, y: number, z: number): number => mask[x + N * (y + N * z)];
  const dist = (x: number, y: number, z: number): number => Math.hypot(x - C, y - C, z - C);

  it('every mismatch vs the analytic mask lies within 1.5 cells of the sphere surface', () => {
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const d = dist(x, y, z);
          const analytic = d <= R ? CellType.Solid : CellType.Fluid;
          if (at(x, y, z) !== analytic) {
            expect(Math.abs(d - R)).toBeLessThanOrEqual(1.5);
          }
        }
  });

  it('interior fill is 100% — every cell deeper than 1.5 cells inside is solid', () => {
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          if (dist(x, y, z) <= R - 1.5) expect(at(x, y, z)).toBe(CellType.Solid);
        }
  });

  it('solid count matches the exact conservative oracle (cube-intersects-ball) within 2%', () => {
    // A conservative voxelizer marks every cell whose CUBE touches the surface, so the
    // solid set is the Minkowski sum ball ⊕ cell-cube — systematically larger than the
    // center-inside count (4/3)πr³ (H8's 5%-of-volume figure is not attainable for a
    // conservative surface; the bloat guard the count test exists for — H8 pitfall 1 —
    // is caught tighter by comparing against the exact conservative set).
    let solid = 0;
    let oracle = 0;
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          if (at(x, y, z) === CellType.Solid) solid++;
          const gx = Math.max(Math.abs(x - C) - 0.5, 0);
          const gy = Math.max(Math.abs(y - C) - 0.5, 0);
          const gz = Math.max(Math.abs(z - C) - 0.5, 0);
          if (gx * gx + gy * gy + gz * gz <= R * R) oracle++;
        }
    const analytic = (4 / 3) * Math.PI * R * R * R;
    expect(solid).toBeGreaterThanOrEqual(analytic * 0.95); // no under-marking either
    expect(Math.abs(solid - oracle) / oracle).toBeLessThanOrEqual(0.02);
  });
});

describe('T-VOX-HOLE: hollow cube with fine-tessellated faces, 20³ grid', () => {
  // Cube [3, 17]³ (span 14 cells), faces as 8×8 quad grids → hole from one missing
  // triangle is ≤ 14/8 = 1.75 cells wide.
  const N = 20;
  const grid = { nx: N, ny: N, nz: N };
  const interiorIsSolid = (mask: Uint8Array): boolean => {
    for (let z = 4; z <= 16; z++)
      for (let y = 4; y <= 16; y++)
        for (let x = 4; x <= 16; x++) {
          if (mask[x + N * (y + N * z)] !== CellType.Solid) return false;
        }
    return true;
  };

  it('watertight cube: interior classifies solid, outside stays fluid', () => {
    const mask = voxelizeSolid(hollowCube(3, 17, 8), null, grid);
    expect(interiorIsSolid(mask)).toBe(true);
    expect(mask[1 + N * (1 + N * 1)]).toBe(CellType.Fluid);
  });

  it('a ≤2-cell hole (one missing triangle) cannot leak — interior stays solid', () => {
    const mask = voxelizeSolid(hollowCube(3, 17, 8, new Set([60])), null, grid);
    expect(interiorIsSolid(mask)).toBe(true);
  });

  it('negative control: an entire missing face floods the interior (documents the limit)', () => {
    // Face 0 (x = lo) is triangles 0..127; removing all of them opens a 14-cell hole.
    const omit = new Set(Array.from({ length: 128 }, (_, i) => i));
    const mask = voxelizeSolid(hollowCube(3, 17, 8, omit), null, grid);
    expect(interiorIsSolid(mask)).toBe(false);
    // The very center must now be reachable from outside → fluid.
    expect(mask[10 + N * (10 + N * 10)]).toBe(CellType.Fluid);
  });
});

describe('voxelizeSurface / floodFillExterior plumbing', () => {
  it('supports non-indexed triangle soup (indices = null)', () => {
    // One big triangle spanning the grid mid-plane.
    const soup = new Float32Array([1, 1, 4, 8, 1, 4, 4, 8, 4]);
    const flags = voxelizeSurface(soup, null, { nx: 10, ny: 10, nz: 10 });
    let surface = 0;
    for (const f of flags) if (f !== 0) surface++;
    expect(surface).toBeGreaterThan(0);
  });

  it('rejects a mesh whose AABB spans < 4 cells (meters-fed-as-cells guard)', () => {
    const tiny = new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0.5, 0]);
    expect(() => voxelizeSurface(tiny, null, { nx: 10, ny: 10, nz: 10 })).toThrow(/lattice space/);
  });

  it('flood fill reaches disconnected exterior pockets (all-faces seeding)', () => {
    // Empty grid: everything must become EXTERIOR.
    const flags = new Uint8Array(5 * 5 * 5);
    floodFillExterior(flags, 5, 5, 5);
    for (const f of flags) expect(f).toBe(VOXEL_EXTERIOR);
  });
});
