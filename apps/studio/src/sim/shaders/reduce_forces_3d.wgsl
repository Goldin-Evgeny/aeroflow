// Second-stage force reduction for the D3Q19 kernel (docs/handoff/H2 §5, Stage B).
// A single workgroup of 256 invocations grid-strides the per-cell force buffer written by
// stream_collide_3d.wgsl (`cellForce`, one vec3f per cell), tree-reduces the partial sums
// in shared memory, and writes the total (Fx, Fy, Fz) into forceHistory[slot].
//
// This is the 3D (vec3f) counterpart of reduce_forces.wgsl — identical structure. One
// workgroup ⇒ the workgroupBarrier() sits in uniform control flow (all 256 threads
// present), avoiding the divergent-barrier hazard of an in-kernel reduction (H2 §6.5).
// Float summation order differs from the CPU oracle → compare within 1e-4 relative, not
// bitwise (H2 §6.7).

struct RParams {
  n: u32,     // number of cells (= nx·ny·nz)
  slot: u32,  // destination index in forceHistory (step % capacity)
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> R: RParams;
@group(0) @binding(1) var<storage, read> cellForce: array<vec3f>;
@group(0) @binding(2) var<storage, read_write> forceHistory: array<vec3f>;

const WG: u32 = 256u;
var<workgroup> scratch: array<vec3f, WG>;

@compute @workgroup_size(256)
fn reduce(@builtin(local_invocation_id) lid: vec3u) {
  let t = lid.x;
  var acc = vec3f(0.0);
  for (var i = t; i < R.n; i += WG) {
    acc += cellForce[i];
  }
  scratch[t] = acc;
  workgroupBarrier();

  for (var stride = WG / 2u; stride > 0u; stride >>= 1u) {
    if (t < stride) {
      scratch[t] += scratch[t + stride];
    }
    workgroupBarrier();
  }

  if (t == 0u) {
    forceHistory[R.slot] = scratch[0];
  }
}
