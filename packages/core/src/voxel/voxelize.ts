import { CellType } from '../lattice.js';

/**
 * CPU reference voxelizer for M8 mesh import — the correctness oracle for the WGSL
 * voxelization kernels (H8-voxelizer.md; CPU/GPU-parity rule in CLAUDE.md).
 *
 * Pipeline (H8 §1):
 *   1. Conservative surface pass — mark every cell whose unit cube overlaps any triangle,
 *      via the full 13-axis separating-axis test (Akenine-Möller, JGT 6(1), 2001).
 *   2. Exterior flood fill — BFS from every non-surface cell on the six domain faces,
 *      6-connected through non-surface cells.
 *   3. Classify — solid = surface ∪ unreached interior; exterior = fluid. Orientation-
 *      agnostic on purpose: no winding/normal/ray-parity tests, so dirty CAD with holes
 *      smaller than the ~1–2-cell conservative thickening still classifies correctly.
 *
 * Input positions are already in lattice space (1 unit = 1 cell; the caller applies
 * `latticeUnits()` scaling). Cell centers sit at integer coordinates with half-extent 0.5
 * — the same halfway-bounce-back convention as `geometry/sphere.ts`, so the effective wall
 * sits half a cell outside the surface layer for meshes and analytic masks alike.
 * Index convention matches the solvers: `idx = x + nx·(y + ny·z)`.
 */

/** Intermediate per-cell flags used between the surface pass and classification. */
export const VOXEL_SURFACE = 1;
export const VOXEL_EXTERIOR = 2;

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
}

/**
 * 13-axis SAT triangle–box overlap test (Akenine-Möller 2001), H8 §2.
 *
 * `v0..v2` are `[x, y, z]` triangle vertices; the box is centered at `(cx, cy, cz)` with
 * half-extent `h` (0.5 for a lattice cell). Returns true iff triangle and box overlap.
 * Degenerate (zero-area) triangles skip only the normal-plane axis — slivers must still
 * mark surface cells conservatively.
 */
export function triBoxOverlap(
  v0: readonly number[],
  v1: readonly number[],
  v2: readonly number[],
  cx: number,
  cy: number,
  cz: number,
  h = 0.5,
): boolean {
  // Translate so the box center is the origin.
  const p0x = v0[0] - cx,
    p0y = v0[1] - cy,
    p0z = v0[2] - cz;
  const p1x = v1[0] - cx,
    p1y = v1[1] - cy,
    p1z = v1[2] - cz;
  const p2x = v2[0] - cx,
    p2y = v2[1] - cy,
    p2z = v2[2] - cz;

  // Axes 1–3: the box face normals (triangle AABB vs box).
  if (Math.min(p0x, p1x, p2x) > h || Math.max(p0x, p1x, p2x) < -h) return false;
  if (Math.min(p0y, p1y, p2y) > h || Math.max(p0y, p1y, p2y) < -h) return false;
  if (Math.min(p0z, p1z, p2z) > h || Math.max(p0z, p1z, p2z) < -h) return false;

  // Triangle edges.
  const e0x = p1x - p0x,
    e0y = p1y - p0y,
    e0z = p1z - p0z;
  const e1x = p2x - p1x,
    e1y = p2y - p1y,
    e1z = p2z - p1z;
  const e2x = p0x - p2x,
    e2y = p0y - p2y,
    e2z = p0z - p2z;

  // Axes 5–13: the nine edge × unit-axis cross products. Written generically (project all
  // three vertices, box radius r = h·Σ|aᵢ|) — this is a CPU oracle, never optimized (H8 §2).
  const axisSeparates = (ax: number, ay: number, az: number): boolean => {
    const q0 = ax * p0x + ay * p0y + az * p0z;
    const q1 = ax * p1x + ay * p1y + az * p1z;
    const q2 = ax * p2x + ay * p2y + az * p2z;
    const r = h * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
    return Math.min(q0, q1, q2) > r || Math.max(q0, q1, q2) < -r;
  };
  // e0 × x̂, e0 × ŷ, e0 × ẑ
  if (axisSeparates(0, -e0z, e0y)) return false;
  if (axisSeparates(e0z, 0, -e0x)) return false;
  if (axisSeparates(-e0y, e0x, 0)) return false;
  // e1 × x̂, e1 × ŷ, e1 × ẑ
  if (axisSeparates(0, -e1z, e1y)) return false;
  if (axisSeparates(e1z, 0, -e1x)) return false;
  if (axisSeparates(-e1y, e1x, 0)) return false;
  // e2 × x̂, e2 × ŷ, e2 × ẑ
  if (axisSeparates(0, -e2z, e2y)) return false;
  if (axisSeparates(e2z, 0, -e2x)) return false;
  if (axisSeparates(-e2y, e2x, 0)) return false;

  // Axis 4: the triangle normal (plane–box test). Skipped for degenerate triangles.
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  if (nx * nx + ny * ny + nz * nz >= 1e-24) {
    const r = h * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
    const d = nx * p0x + ny * p0y + nz * p0z; // all three vertices project to d
    if (Math.abs(d) > r) return false;
  }

  return true;
}

/**
 * Conservative surface voxelization (H8 §1 step 1): mark `VOXEL_SURFACE` on every cell
 * whose unit cube overlaps any triangle. `indices` may be null for a non-indexed soup
 * (consecutive vertex triplets). Throws if the mesh AABB spans < 4 cells in its largest
 * dimension — the symptom of feeding meters without the lattice transform (H8 pitfall 6).
 */
export function voxelizeSurface(
  positions: Float32Array,
  indices: Uint32Array | null,
  grid: VoxelGrid,
): Uint8Array {
  const { nx, ny, nz } = grid;
  const flags = new Uint8Array(nx * ny * nz);
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  if (triCount === 0) return flags;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (span < 4) {
    throw new Error(
      `voxelizeSurface: mesh AABB spans only ${span.toFixed(3)} cells — positions must be ` +
        `pre-transformed to lattice space (1 unit = 1 cell); a meters-as-cells import lands ` +
        `the whole mesh in one cell`,
    );
  }

  const v0 = [0, 0, 0];
  const v1 = [0, 0, 0];
  const v2 = [0, 0, 0];
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = indices ? indices[3 * t + k] : 3 * t + k;
      const dst = k === 0 ? v0 : k === 1 ? v1 : v2;
      dst[0] = positions[3 * vi];
      dst[1] = positions[3 * vi + 1];
      dst[2] = positions[3 * vi + 2];
    }
    // Cell (x,y,z) has box [x−0.5, x+0.5]³, so the triangle can only touch cells with
    // integer coordinates in [min−0.5, max+0.5], clamped to the grid.
    const x0 = Math.max(0, Math.ceil(Math.min(v0[0], v1[0], v2[0]) - 0.5));
    const x1 = Math.min(nx - 1, Math.floor(Math.max(v0[0], v1[0], v2[0]) + 0.5));
    const y0 = Math.max(0, Math.ceil(Math.min(v0[1], v1[1], v2[1]) - 0.5));
    const y1 = Math.min(ny - 1, Math.floor(Math.max(v0[1], v1[1], v2[1]) + 0.5));
    const z0 = Math.max(0, Math.ceil(Math.min(v0[2], v1[2], v2[2]) - 0.5));
    const z1 = Math.min(nz - 1, Math.floor(Math.max(v0[2], v1[2], v2[2]) + 0.5));
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const idx = x + nx * (y + ny * z);
          if (flags[idx] !== VOXEL_SURFACE && triBoxOverlap(v0, v1, v2, x, y, z)) {
            flags[idx] = VOXEL_SURFACE;
          }
        }
  }
  return flags;
}

/**
 * Exterior flood fill (H8 §1 step 2): BFS seeded from EVERY non-surface cell on all six
 * domain faces (a single-corner seed misses disconnected exterior pockets — H8 pitfall 4),
 * spreading 6-connected (26-connectivity would leak through diagonal cracks — pitfall 3)
 * through non-surface cells, marking `VOXEL_EXTERIOR` in place.
 */
export function floodFillExterior(flags: Uint8Array, nx: number, ny: number, nz: number): void {
  const queue = new Int32Array(flags.length);
  let head = 0;
  let tail = 0;
  const seed = (idx: number): void => {
    if (flags[idx] === 0) {
      flags[idx] = VOXEL_EXTERIOR;
      queue[tail++] = idx;
    }
  };
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1) {
          seed(x + nx * (y + ny * z));
        }
      }
  const nxy = nx * ny;
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % nx;
    const y = ((idx - x) / nx) % ny;
    const z = (idx - x - nx * y) / nxy;
    if (x > 0) seed(idx - 1);
    if (x < nx - 1) seed(idx + 1);
    if (y > 0) seed(idx - nx);
    if (y < ny - 1) seed(idx + nx);
    if (z > 0) seed(idx - nxy);
    if (z < nz - 1) seed(idx + nxy);
  }
}

/**
 * Full pipeline (H8 §1): surface pass → exterior fill → classify. Returns a `CellType`
 * mask (`Solid` = surface + enclosed interior, `Fluid` = exterior), same shape as
 * `sphereMask()`; callers overlay inlet/outlet/wall flags afterward.
 */
export function voxelizeSolid(
  positions: Float32Array,
  indices: Uint32Array | null,
  grid: VoxelGrid,
): Uint8Array {
  const flags = voxelizeSurface(positions, indices, grid);
  floodFillExterior(flags, grid.nx, grid.ny, grid.nz);
  const mask = new Uint8Array(flags.length);
  for (let i = 0; i < flags.length; i++) {
    mask[i] = flags[i] === VOXEL_EXTERIOR ? CellType.Fluid : CellType.Solid;
  }
  return mask;
}
