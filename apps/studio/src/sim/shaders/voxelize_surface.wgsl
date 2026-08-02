// Conservative surface voxelization — one thread per triangle (M8, step 2).
//
// 1:1 transliteration of packages/core/src/voxel/voxelize.ts (triBoxOverlap +
// voxelizeSurface) — keep synchronized by hand; the ?voxparity harness gates every
// change (masks must match the CPU oracle bit-for-bit; this is integer output, H8 §4).
// One caveat: the SAT arithmetic runs in f32 here vs f64 on the CPU, so a knife-edge
// overlap case could in principle flip one cell — the harness reports exact mismatch
// coordinates; the expected count is 0.
//
// The host always supplies an index buffer (it synthesizes 0..3N-1 for non-indexed
// soups), so there is no SOUP variant. Vertices are pre-transformed to lattice space
// on the CPU (1 unit = 1 cell, cell centers at integer coordinates, box half-extent
// 0.5); degenerate triangles skip only the normal-axis test — slivers still mark
// surface cells conservatively (H8 §2).
//
// Bitmask convention (M8 pitfall: word vs bit swap corrupts distant cells): cell
// idx = x + nx·(y + ny·z); word = idx >> 5, bit = idx & 31.

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  triCount: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<f32>; // xyz triplets, lattice space
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> surfaceBits: array<atomic<u32>>;

fn min3(a: f32, b: f32, c: f32) -> f32 {
  return min(a, min(b, c));
}
fn max3(a: f32, b: f32, c: f32) -> f32 {
  return max(a, max(b, c));
}

// Projection test for one candidate separating axis (cross-product axes 5–13):
// project the three (box-centered) vertices onto a; box radius r = h·Σ|aᵢ| with h = 0.5.
fn axisSeparates(a: vec3f, p0: vec3f, p1: vec3f, p2: vec3f) -> bool {
  let q0 = dot(a, p0);
  let q1 = dot(a, p1);
  let q2 = dot(a, p2);
  let r = 0.5 * (abs(a.x) + abs(a.y) + abs(a.z));
  return min3(q0, q1, q2) > r || max3(q0, q1, q2) < -r;
}

// 13-axis SAT triangle–box overlap (Akenine-Möller 2001), box center c, half-extent 0.5.
fn triBoxOverlap(v0: vec3f, v1: vec3f, v2: vec3f, c: vec3f) -> bool {
  let p0 = v0 - c;
  let p1 = v1 - c;
  let p2 = v2 - c;
  let h = 0.5;

  // Axes 1–3: the box face normals (triangle AABB vs box).
  if (min3(p0.x, p1.x, p2.x) > h || max3(p0.x, p1.x, p2.x) < -h) { return false; }
  if (min3(p0.y, p1.y, p2.y) > h || max3(p0.y, p1.y, p2.y) < -h) { return false; }
  if (min3(p0.z, p1.z, p2.z) > h || max3(p0.z, p1.z, p2.z) < -h) { return false; }

  let e0 = p1 - p0;
  let e1 = p2 - p1;
  let e2 = p0 - p2;

  // Axes 5–13: edge × unit-axis cross products (same signs/order as the CPU reference).
  if (axisSeparates(vec3f(0.0, -e0.z, e0.y), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(e0.z, 0.0, -e0.x), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(-e0.y, e0.x, 0.0), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(0.0, -e1.z, e1.y), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(e1.z, 0.0, -e1.x), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(-e1.y, e1.x, 0.0), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(0.0, -e2.z, e2.y), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(e2.z, 0.0, -e2.x), p0, p1, p2)) { return false; }
  if (axisSeparates(vec3f(-e2.y, e2.x, 0.0), p0, p1, p2)) { return false; }

  // Axis 4: the triangle normal (plane–box test); skipped for degenerate triangles.
  let n = cross(e0, e1);
  if (dot(n, n) >= 1e-24) {
    let r = 0.5 * (abs(n.x) + abs(n.y) + abs(n.z));
    let d = dot(n, p0); // all three vertices project to d
    if (abs(d) > r) { return false; }
  }

  return true;
}

// 1D dispatch: ceil(triCount / 64) workgroups (1M triangles → 15,625 — under the
// 65,535 per-dimension limit, unlike per-cell passes which need a 3D dispatch).
@compute @workgroup_size(64)
fn voxelize_surface(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= params.triCount) { return; }

  let i0 = indices[3u * t];
  let i1 = indices[3u * t + 1u];
  let i2 = indices[3u * t + 2u];
  let v0 = vec3f(positions[3u * i0], positions[3u * i0 + 1u], positions[3u * i0 + 2u]);
  let v1 = vec3f(positions[3u * i1], positions[3u * i1 + 1u], positions[3u * i1 + 2u]);
  let v2 = vec3f(positions[3u * i2], positions[3u * i2 + 1u], positions[3u * i2 + 2u]);

  // Cell (x,y,z) has box [x−0.5, x+0.5]³ → candidate cells have integer coordinates in
  // [min−0.5, max+0.5], clamped to the grid (identical bounds math to the CPU reference).
  let lo = min(min(v0, v1), v2);
  let hi = max(max(v0, v1), v2);
  let x0 = max(0, i32(ceil(lo.x - 0.5)));
  let x1 = min(i32(params.nx) - 1, i32(floor(hi.x + 0.5)));
  let y0 = max(0, i32(ceil(lo.y - 0.5)));
  let y1 = min(i32(params.ny) - 1, i32(floor(hi.y + 0.5)));
  let z0 = max(0, i32(ceil(lo.z - 0.5)));
  let z1 = min(i32(params.nz) - 1, i32(floor(hi.z + 0.5)));

  for (var z = z0; z <= z1; z++) {
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if (triBoxOverlap(v0, v1, v2, vec3f(f32(x), f32(y), f32(z)))) {
          let idx = u32(x) + params.nx * (u32(y) + params.ny * u32(z));
          atomicOr(&surfaceBits[idx >> 5u], 1u << (idx & 31u));
        }
      }
    }
  }
}
