// Fullscreen visualization of the velocity field: speed (sequential colormap),
// vorticity (diverging colormap), or the LES eddy-viscosity ratio τ_t/τ₀ (sequential).
// Canvas drawing buffer is exactly nx × ny texels.

struct RenderParams {
  nx: u32,
  ny: u32,
  uin: f32,
  mode: u32, // 0 = speed, 1 = vorticity, 2 = τ_t (LES eddy viscosity)
}

@group(0) @binding(0) var<uniform> R: RenderParams;
@group(0) @binding(1) var<storage, read> vel: array<vec2f>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;
// τ_t/τ₀ per cell (Smagorinsky eddy-viscosity ratio); nonzero only under LES.
@group(0) @binding(3) var<storage, read> tauField: array<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(pos[vi], 0.0, 1.0);
}

// Compact sequential colormap (dark navy → teal → green → yellow), t in [0,1].
fn speedColor(t: f32) -> vec3f {
  let c0 = vec3f(0.05, 0.06, 0.15);
  let c1 = vec3f(0.12, 0.38, 0.55);
  let c2 = vec3f(0.20, 0.72, 0.51);
  let c3 = vec3f(0.98, 0.91, 0.36);
  let s = clamp(t, 0.0, 1.0) * 3.0;
  if (s < 1.0) {
    return mix(c0, c1, s);
  } else if (s < 2.0) {
    return mix(c1, c2, s - 1.0);
  }
  return mix(c2, c3, s - 2.0);
}

// Diverging colormap (blue → near-white → red), t in [-1,1].
fn divergingColor(t: f32) -> vec3f {
  let neg = vec3f(0.23, 0.42, 0.82);
  let mid = vec3f(0.93, 0.93, 0.93);
  let pos = vec3f(0.84, 0.24, 0.20);
  let c = clamp(t, -1.0, 1.0);
  if (c < 0.0) {
    return mix(mid, neg, -c);
  }
  return mix(mid, pos, c);
}

fn cellIndex(x: u32, y: u32) -> u32 {
  return min(y, R.ny - 1u) * R.nx + min(x, R.nx - 1u);
}

@fragment
fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let x = min(u32(p.x), R.nx - 1u);
  // Flip so lattice y points up on screen.
  let y = R.ny - 1u - min(u32(p.y), R.ny - 1u);
  let idx = y * R.nx + x;

  let flag = flags[idx];
  if (flag == 1u) {
    return vec4f(0.16, 0.17, 0.20, 1.0); // solid
  }

  if (R.mode == 0u) {
    let speed = length(vel[idx]);
    // Normalize so the free stream sits ~mid-scale and accelerated regions stand out.
    return vec4f(speedColor(speed / (1.8 * R.uin)), 1.0);
  }

  if (R.mode == 2u) {
    // τ_t/τ₀: 0 in the resolved free stream, rising in the modelled shear layers/wake.
    // sqrt boosts the low end so the (legitimately tiny) τ_t at moderate Re is still
    // visible; it saturates only where the subgrid model is genuinely doing heavy work.
    return vec4f(speedColor(sqrt(clamp(3.0 * tauField[idx], 0.0, 1.0))), 1.0);
  }

  // Vorticity ω = ∂u_y/∂x − ∂u_x/∂y via central differences (clamped at edges).
  let xr = vel[cellIndex(x + 1u, y)];
  let xl = vel[cellIndex(max(x, 1u) - 1u, y)];
  let yu = vel[cellIndex(x, y + 1u)];
  let yd = vel[cellIndex(x, max(y, 1u) - 1u)];
  let omega = 0.5 * ((xr.y - xl.y) - (yu.x - yd.x));
  return vec4f(divergingColor(omega / (0.25 * R.uin)), 1.0);
}
