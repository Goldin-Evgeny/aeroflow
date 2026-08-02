// Exterior flood fill + classification for the voxelizer (M8, step 3).
//
// GPU counterpart of floodFillExterior + the classify step in
// packages/core/src/voxel/voxelize.ts — keep synchronized by hand; gated by the
// ?voxparity harness (bit-identical masks, H8 §4). The CPU does one BFS; here the fill
// is iterative frontier propagation: `seed` marks every non-surface cell on the six
// domain faces EXTERIOR, then repeated `propagate` passes spread the mark 6-connected
// (never 26 — diagonal cracks must block, H8 pitfall 3) through non-surface cells until
// a whole host batch reports zero changes. Concurrent neighbor reads/writes within one
// pass are benign: the update is monotone (bits only turn on), so the converged fixed
// point is exactly the CPU BFS result regardless of scheduling.
//
// All three entry points share one explicit bind-group layout (a per-entry `layout:
// 'auto'` would mint incompatible layouts — the M6 lesson, docs/WGSL-NOTES.md).
// Bitmask convention as in voxelize_surface.wgsl: word = idx >> 5, bit = idx & 31.
// Per-cell passes use the 3D dispatch (ceil(nx/64), ny, nz) like stream_collide_3d.wgsl.

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> surfaceBits: array<u32>;
@group(0) @binding(2) var<storage, read_write> exteriorBits: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> changed: atomic<u32>;
// Final CellType per cell (0 = Fluid, 1 = Solid; packages/core/src/lattice.ts CellType).
@group(0) @binding(4) var<storage, read_write> outMask: array<u32>;

fn cellIndex(x: u32, y: u32, z: u32) -> u32 {
  return x + params.nx * (y + params.ny * z);
}

fn isSurface(idx: u32) -> bool {
  return (surfaceBits[idx >> 5u] & (1u << (idx & 31u))) != 0u;
}

fn isExterior(idx: u32) -> bool {
  return (atomicLoad(&exteriorBits[idx >> 5u]) & (1u << (idx & 31u))) != 0u;
}

// Seed: every non-surface cell on a domain face becomes EXTERIOR (all six faces —
// a single-corner seed misses disconnected exterior pockets, H8 pitfall 4).
@compute @workgroup_size(64)
fn seed(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  if (x >= params.nx || gid.y >= params.ny || gid.z >= params.nz) { return; }
  let onFace = x == 0u || x == params.nx - 1u || gid.y == 0u || gid.y == params.ny - 1u ||
    gid.z == 0u || gid.z == params.nz - 1u;
  if (!onFace) { return; }
  let idx = cellIndex(x, gid.y, gid.z);
  if (!isSurface(idx)) {
    atomicOr(&exteriorBits[idx >> 5u], 1u << (idx & 31u));
  }
}

// Propagate: a non-surface, non-exterior cell with any EXTERIOR 6-neighbor becomes
// EXTERIOR and bumps the `changed` counter (host stops when a whole batch stays 0).
@compute @workgroup_size(64)
fn propagate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  if (x >= params.nx || y >= params.ny || z >= params.nz) { return; }
  let idx = cellIndex(x, y, z);
  if (isSurface(idx) || isExterior(idx)) { return; }

  var reached = false;
  if (x > 0u && isExterior(idx - 1u)) { reached = true; }
  if (x < params.nx - 1u && isExterior(idx + 1u)) { reached = true; }
  if (y > 0u && isExterior(idx - params.nx)) { reached = true; }
  if (y < params.ny - 1u && isExterior(idx + params.nx)) { reached = true; }
  if (z > 0u && isExterior(idx - params.nx * params.ny)) { reached = true; }
  if (z < params.nz - 1u && isExterior(idx + params.nx * params.ny)) { reached = true; }

  if (reached) {
    atomicOr(&exteriorBits[idx >> 5u], 1u << (idx & 31u));
    atomicAdd(&changed, 1u);
  }
}

// Classify: solid = surface ∪ unreached interior; everything EXTERIOR is fluid (H8 §1).
@compute @workgroup_size(64)
fn classify(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  if (x >= params.nx || gid.y >= params.ny || gid.z >= params.nz) { return; }
  let idx = cellIndex(x, gid.y, gid.z);
  outMask[idx] = select(1u, 0u, isExterior(idx)); // 1 = Solid, 0 = Fluid
}
