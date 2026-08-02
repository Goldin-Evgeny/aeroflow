// pack_field_3d — demo-only visualization pass (M6 step 9).
//
// Reads the solver's planar ux, uy, uz f32 buffers (cell index
// idx = x + Nx·(y + Ny·z), same convention as packages/core/src/lattice3d.ts) and writes a
// 3D velocity texture (rgba16float: vx, vy, vz, |u|) sampled by the Three.js slice planes
// and the GPU streamline-particle advection. NOT part of the solver — carries no parity
// obligation.

struct Dims { nx: u32, ny: u32, nz: u32, _pad: u32 };

@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> macroUx: array<f32>;
@group(0) @binding(2) var<storage, read> macroUy: array<f32>;
@group(0) @binding(3) var<storage, read> macroUz: array<f32>;
@group(0) @binding(4) var velTex: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(64)
fn pack(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= dims.nx || gid.y >= dims.ny || gid.z >= dims.nz) { return; }
  let idx = gid.x + dims.nx * (gid.y + dims.ny * gid.z);
  let ux = macroUx[idx];
  let uy = macroUy[idx];
  let uz = macroUz[idx];
  let speed = sqrt(ux * ux + uy * uy + uz * uz);
  textureStore(velTex, vec3<i32>(gid.xyz), vec4<f32>(ux, uy, uz, speed));
}
