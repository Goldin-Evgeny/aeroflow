# H8 — Conservative voxelizer (SAT + flood fill): executable specification

> **Handoff doc.** Milestone: M8. CPU reference first
> (`packages/core/src/cpu/voxelize.ts` when executed), GPU port after it passes.
> Isolated geometry code — no solver coupling. Reference: Akenine-Möller's
> triangle-box overlap test (standard, public-domain algorithm family).

## 1. Pipeline

Input: triangle soup `{positions: Float32Array (xyz triplets), indices?: Uint32Array}`
already transformed into lattice space (1 unit = 1 cell; the caller applies
`latticeUnits()` scaling). Output: `Uint8Array` mask, `1 = solid`, over an
nx×ny×nz grid (index convention `x + nx·(y + ny·z)` — same as H3 §2, frozen).

1. **Surface pass (conservative):** for each triangle, compute its AABB in cell
   coordinates (floor/ceil ± 0), and for each cell in the AABB run the SAT
   triangle-box overlap test with the cell's cube (center c, half-extent h = 0.5).
   Overlap ⇒ mark `SURFACE`.
2. **Exterior flood fill:** BFS/DFS from every non-`SURFACE` boundary cell of the
   grid, 6-connectivity, through non-`SURFACE` cells ⇒ mark `EXTERIOR`.
3. **Classify:** `solid = SURFACE ∪ (¬SURFACE ∧ ¬EXTERIOR)` (surface + enclosed
   interior). Everything `EXTERIOR` is fluid.

This classifies dirty (non-watertight) meshes correctly as long as holes are smaller
than the conservative surface thickening seals (≈1–2 cells at target resolution) —
the honest limit stated in the M8 spec.

## 2. SAT triangle-box test (the 13 axes, enumerated)

Translate the triangle so the box center is the origin (`v0..v2 −= c`); box
half-extents `h = (0.5, 0.5, 0.5)`. Edges `e0 = v1−v0, e1 = v2−v1, e2 = v0−v2`.
Overlap iff NO separating axis exists among:

- **3 box axes**: test `max(v·axis) < −h_axis || min(v·axis) > h_axis` for x, y, z
  (i.e., triangle AABB vs box).
- **1 triangle normal**: `n = e0 × e1`; plane-box test — box "radius" along n is
  `r = h.x·|n.x| + h.y·|n.y| + h.z·|n.z|`; separated iff
  `|n·v0| > r` with all vertices on one side (equivalently: distance of plane from
  origin exceeds r).
- **9 cross-product axes** `a_ij = e_i × û_j` (i = edge 0..2, j = x,y,z axis unit
  vectors). For each: project the three vertices, `p_min/p_max`; box radius
  `r = h.x·|a.x| + h.y·|a.y| + h.z·|a.z|`; separated iff `p_min > r || p_max < −r`.
  (Each cross with a unit axis has a zero component — write the 9 cases with the
  standard two-term projections for speed, or generically first and optimize never;
  this is a CPU oracle.)

Degenerate triangles (zero-area, `|n| < 1e-12`): still test the 3+9 axes (skip the
normal axis) — slivers must still mark surface cells conservatively.

**Unit tests for the SAT itself** (before any mesh-level test): triangle fully inside
a cell ⇒ overlap; triangle in a plane 0.6 cells away, parallel to a face ⇒ no overlap;
triangle piercing a corner ⇒ overlap; sliver along a diagonal near-miss at 0.51 offset
⇒ no overlap — all with hardcoded coordinates and expected booleans.

## 3. Mesh-level tests

- **T-VOX-SPHERE:** icosphere mesh (3 subdivisions, generated procedurally in the
  test — no asset files), radius 10.3 cells, centered in a 32³ grid. Compare against
  the analytic mask `|p_cell_center − c| ≤ r`: every mismatch must lie within
  distance 1.5 cells of the sphere surface (conservative shell tolerance), and
  interior fill must be 100% (no unfilled interior cells). Count check: total solid
  count within 2% of the **exact conservative oracle** — the count of cells whose
  _cube_ touches the ball, `√(Σ max(|Δᵢ|−0.5, 0)²) ≤ r` — plus a ≥ 0.95·(4/3)πr³
  under-marking floor.
  > **Spec correction (2026-07-16, M8 implementation):** this doc originally asked
  > for "total solid count within 5% of (4/3)πr³". That is unattainable for a
  > conservative voxelizer: the solid set is the Minkowski sum ball ⊕ cell-cube,
  > which at r = 10.3 measures **+22.7%** over (4/3)πr³ (5616 vs 4577 cells;
  > Steiner-formula inflation, not bloat). The conservative-oracle comparison above
  > is strictly tighter as the pitfall-1 bloat guard (measured −1.68% vs oracle —
  > the inscribed-facet deficit) and is what `voxelize.test.ts` implements.
- **T-VOX-HOLE:** 20³ hollow cube mesh (12 triangles per face) with ONE face triangle
  removed (a ~14-cell-wide gap is too big to seal — so instead remove a triangle from
  a face built as a 8×8 grid of small triangles, leaving a ≤2-cell hole). Assert the
  interior still classifies as solid (flood cannot leak through a ≤2-cell hole after
  conservative thickening). Also the negative control: remove an entire face (huge
  hole) ⇒ interior becomes EXTERIOR (documents the limit honestly).
- **T-VOX-EQUIV (bridges to physics):** the M8 gate "STL sphere reproduces the
  analytic-mask Cd within 2%" is a solver-level test specified in
  the M8 spec — the voxelizer's contribution is that T-VOX-SPHERE passes
  first.

## 4. GPU port notes (after CPU passes)

One dispatch per triangle-AABB is load-imbalanced; the simple correct scheme: kernel
over ALL cells × a per-cell loop over a small triangle list from a uniform grid
binning (build bins on CPU first — the mesh is static). `atomicOr` on a u32 bitmask
buffer is available (u32 atomics exist; it's f32 atomics that don't). Flood fill on
GPU is iterative kernel ping-pong until no change (frontier flag via atomic counter) —
or keep flood on CPU (a 256³ BFS is ~50 ms in JS; measure before porting). Parity
gate: GPU mask must equal CPU mask **exactly** (it's integer work — bitwise identical,
unlike float kernels).

## 5. Pitfalls

1. Testing only triangle AABB vs cell (skipping the 9 cross axes) — marks fat
   diagonals of empty space as surface; sphere count test catches the bloat.
2. `h = 1.0` instead of `0.5` (full extent vs half extent — classic; everything
   doubles).
3. Flood fill 26-connectivity — leaks through diagonal "cracks" that 6-connectivity
   respects; use 6.
4. Seeding flood only from one corner — disconnected exterior pockets (concave scenes)
   stay unfilled and misclassify as interior; seed from ALL boundary cells.
5. Forgetting `indices` may be absent (non-indexed soup) — support both.
6. Mesh in meters fed directly (no lattice transform) — everything lands in one cell;
   assert the mesh AABB spans ≥ 4 cells and throw otherwise with a helpful message.
7. Winding/normal orientation does NOT matter for this pipeline (no inside/outside
   from normals — that's the point of flood-fill classification); don't add
   winding-dependent "optimizations".
