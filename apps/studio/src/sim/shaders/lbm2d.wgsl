// D2Q9 lattice-Boltzmann step: fused pull-streaming + collision (BGK or TRT, optional
// Smagorinsky LES, H10 regularization, and H13 finite-precision mass conservation).
// Direct transliteration of packages/core/src/cpu/collide.ts
// (collideCell, forcing='none') — the proven Float64 CPU oracle. Any change here must
// be re-checked with the parity panel (?dev) against that oracle. See
// docs/handoff/H1-trt-les-forcing.md and docs/handoff/H6-parity-panel.md.
//
// Direction ordering, weights and opposites MUST match packages/core/src/lattice.ts:
//   i:  0      1      2      3      4      5      6      7      8
//   e:  (0,0) (1,0)  (0,1) (-1,0) (0,-1) (1,1) (-1,1) (-1,-1) (1,-1)
//   D2Q9 opposite pairs (a,b=opp(a)): (1,3) (2,4) (5,7) (6,8)
// Distribution storage is SoA direction-major: f[i*n + idx], idx = y*nx + x.
// Arrays hold POST-collision values; each step pulls from `fin`, writes to `fout`
// (ping-pong buffers swapped host-side). Cell flags: 0 fluid, 1 solid, 2 inlet, 3 outlet.
//
// Moving-wall (lid) BC: a solid cell may carry a wall velocity in `wallVel[cell]`
// (lattice units). When a fluid cell bounces a population off such a solid neighbour,
// the Ladd halfway correction  + 6·w_i·(e_i·u_wall)  is added (ρ₀ = 1). This mirrors
// packages/core/src/cpu/solver2d.ts (wallVelocity option). For the force-free tunnel
// wallVel is all-zero, so the term vanishes and the kernel is bit-identical to before.
//
// NOTE: this kernel has no body force (the interactive tunnel and the parity scene are
// force-free). Guo forcing lives only in the CPU solver for the Poiseuille validation.
//
// Momentum-exchange forces (M4): when P.collectForces == 1 each fluid cell writes the
// force its solid-neighbour bounce-back links exert on the body (2·e_ī·f*_ī, H2 §1) to
// cellForce[idx]; reduce_forces.wgsl sums that buffer. Cylinder scenes have only the
// obstacle as solid, so the total equals the obstacle force (H2 §2 — no per-cell mask).
// Pressure outlet (P.outletMode == 1) mirrors solver2d.ts for external-flow parity.

struct Params {
  nx: u32,
  ny: u32,
  omega: f32,        // ω = 1/τ₀ (base relaxation)
  uin: f32,          // inlet velocity
  collision: u32,    // 0 = BGK, 1 = TRT
  lambda: f32,       // TRT magic parameter Λ (default 3/16)
  lesK: f32,         // 18·√2·Cs²  (0 = LES off)
  outletMode: u32,   // 0 = zero-gradient, 1 = fixed-ρ pressure outlet (M4 cylinder)
  collectForces: u32,// 1 = write per-cell momentum-exchange force into cellForce
  periodicX: u32,    // 1 = wrap the x edges instead of bouncing
  periodicY: u32,    // 1 = wrap the y edges (M4 cylinder: periodicY)
  regularize: u32,   // 1 = project f^neq onto the 2nd-order Hermite subspace (H10)
  conserveMass: u32, // 1 = restore incoming rho through f0 after collision (H13)
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> fin: array<f32>;
@group(0) @binding(2) var<storage, read_write> fout: array<f32>;
@group(0) @binding(3) var<storage, read> flags: array<u32>;
@group(0) @binding(4) var<storage, read_write> vel: array<vec2f>;
@group(0) @binding(5) var<storage, read> wallVel: array<vec2f>;
// Per-cell momentum-exchange force contribution (docs/handoff/H2 §5). Written only when
// P.collectForces == 1; reduced by reduce_forces.wgsl. Non-contributing cells write 0,
// so no stale values survive between collected steps.
@group(0) @binding(6) var<storage, read_write> cellForce: array<vec2f>;
// Per-cell eddy-viscosity ratio τ_t/τ₀ (Smagorinsky LES). 0 where LES is off or the
// resolved flow is laminar; grows in shear layers and wakes. Read by the τ_t render mode.
@group(0) @binding(7) var<storage, read_write> tauField: array<f32>;

const FLUID: u32 = 0u;
const SOLID: u32 = 1u;
const INLET: u32 = 2u;
const OUTLET: u32 = 3u;

fn feq(w: f32, e: vec2f, rho: f32, u: vec2f) -> f32 {
  let eu = dot(e, u);
  return w * rho * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * dot(u, u));
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) gid: vec3u) {
  let n = P.nx * P.ny;
  let idx = gid.x;
  if (idx >= n) {
    return;
  }

  // Lattice constants (function-local var arrays: dynamically indexable in WGSL).
  var E = array<vec2i, 9>(
    vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(-1, 0), vec2i(0, -1),
    vec2i(1, 1), vec2i(-1, 1), vec2i(-1, -1), vec2i(1, -1),
  );
  var W = array<f32, 9>(
    4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
    1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0,
  );
  var OPP = array<u32, 9>(0u, 3u, 4u, 1u, 2u, 7u, 8u, 5u, 6u);

  let x = i32(idx % P.nx);
  let y = i32(idx / P.nx);
  let flag = flags[idx];

  if (flag == SOLID) {
    vel[idx] = vec2f(0.0);
    tauField[idx] = 0.0;
    if (P.collectForces == 1u) { cellForce[idx] = vec2f(0.0); }
    return;
  }

  if (flag == INLET) {
    // Prescribed equilibrium inlet at density 1.
    let u = vec2f(P.uin, 0.0);
    for (var i = 0u; i < 9u; i++) {
      fout[i * n + idx] = feq(W[i], vec2f(E[i]), 1.0, u);
    }
    vel[idx] = u;
    tauField[idx] = 0.0;
    if (P.collectForces == 1u) { cellForce[idx] = vec2f(0.0); }
    return;
  }

  if (flag == OUTLET) {
    let src = select(idx, idx - 1u, x > 0);
    var rho = 0.0;
    var m = vec2f(0.0);
    for (var i = 0u; i < 9u; i++) {
      let fi = fin[i * n + src];
      rho += fi;
      m += vec2f(E[i]) * fi;
    }
    let un = m / rho;
    if (P.outletMode == 1u) {
      // Fixed-density (ρ=1) Guo non-equilibrium extrapolation (mirrors solver2d.ts):
      //   f_i(out) = f_i^eq(1, u_n) + (f_i(xn) − f_i^eq(ρ_n, u_n)).
      for (var i = 0u; i < 9u; i++) {
        let e = vec2f(E[i]);
        fout[i * n + idx] = feq(W[i], e, 1.0, un) + (fin[i * n + src] - feq(W[i], e, rho, un));
      }
    } else {
      // Zero-gradient outflow: replicate the left neighbor's post-collision state.
      for (var i = 0u; i < 9u; i++) { fout[i * n + idx] = fin[i * n + src]; }
    }
    vel[idx] = un;
    tauField[idx] = 0.0;
    if (P.collectForces == 1u) { cellForce[idx] = vec2f(0.0); }
    return;
  }

  // Fluid: pull streaming with halfway bounce-back from solids and domain edges.
  // Bouncing off a solid neighbour also picks up its moving-wall velocity (Ladd).
  var f: array<f32, 9>;
  var force = vec2f(0.0);  // momentum-exchange force from solid-neighbour links (H2 §1)
  let inx = i32(P.nx);
  let iny = i32(P.ny);
  for (var i = 0u; i < 9u; i++) {
    var sx = x - E[i].x;
    var sy = y - E[i].y;
    var edge = false;
    if (sx < 0 || sx >= inx) {
      if (P.periodicX == 1u) { sx = (sx + inx) % inx; } else { edge = true; }
    }
    if (sy < 0 || sy >= iny) {
      if (P.periodicY == 1u) { sy = (sy + iny) % iny; } else { edge = true; }
    }
    var solidNb = -1;
    if (!edge && flags[u32(sy) * P.nx + u32(sx)] == SOLID) {
      solidNb = i32(u32(sy) * P.nx + u32(sx));
    }
    if (edge || solidNb >= 0) {
      let bounced = fin[OPP[i] * n + idx];  // = base value (H2 §1: link direction ī = opp(i))
      var streamed = bounced;
      if (solidNb >= 0) {
        // + 6·w_i·(e_i·u_wall); zero for a stationary wall (bit-identical to before).
        streamed += 6.0 * W[i] * dot(vec2f(E[i]), wallVel[u32(solidNb)]);
        // Force ON the solid from this link: 2·e_ī·f*_ī (only solid links, not edges).
        force += 2.0 * vec2f(E[OPP[i]]) * bounced;
      }
      f[i] = streamed;
    } else {
      f[i] = fin[i * n + u32(sy) * P.nx + u32(sx)];
    }
  }
  if (P.collectForces == 1u) { cellForce[idx] = force; }

  // Moments and equilibrium (no forcing → u = m/ρ).
  var rho = 0.0;
  var m = vec2f(0.0);
  for (var i = 0u; i < 9u; i++) {
    rho += f[i];
    m += vec2f(E[i]) * f[i];
  }
  let u = m / rho;

  var fe: array<f32, 9>;
  for (var i = 0u; i < 9u; i++) {
    fe[i] = feq(W[i], vec2f(E[i]), rho, u);
  }

  // One pre-collision non-equilibrium second moment shared by Smagorinsky LES and H10
  // regularization (collide.ts; 2D means Π_zz = Π_xz = Π_yz = 0).
  let tau0 = 1.0 / P.omega;
  var tauEff = tau0;
  var pxx = 0.0;
  var pyy = 0.0;
  var pxy = 0.0;
  if (P.lesK != 0.0 || P.regularize == 1u) {
    for (var i = 0u; i < 9u; i++) {
      let fneq = f[i] - fe[i];
      let ex = f32(E[i].x);
      let ey = f32(E[i].y);
      pxx += ex * ex * fneq;
      pyy += ey * ey * fneq;
      pxy += ex * ey * fneq;
    }
  }

  if (P.lesK != 0.0) {
    let qn = sqrt(2.0 * (pxx * pxx + pyy * pyy + 2.0 * pxy * pxy));
    let tauT = 0.5 * (sqrt(tau0 * tau0 + P.lesK * qn / rho) - tau0);
    tauEff = tau0 + tauT;
  }

  if (P.regularize == 1u) {
    let trace = (pxx + pyy) / 3.0;
    for (var i = 0u; i < 9u; i++) {
      let ex = f32(E[i].x);
      let ey = f32(E[i].y);
      let qContract = ex * ex * pxx + ey * ey * pyy + 2.0 * ex * ey * pxy - trace;
      f[i] = fe[i] + 4.5 * W[i] * qContract;
    }
  }

  let omp = 1.0 / tauEff;
  var omm = omp;
  if (P.collision == 1u) {
    omm = 1.0 / (0.5 + P.lambda / (tauEff - 0.5));  // TRT ω⁻ from Λ = (τ⁺−½)(τ⁻−½)
  }

  if (P.collision == 1u) {
    // TRT: rest direction is purely symmetric; relax pairs with sym/anti rates.
    fout[idx] = f[0] + omp * (fe[0] - f[0]);
    var PA = array<u32, 4>(1u, 2u, 5u, 6u);
    var PB = array<u32, 4>(3u, 4u, 7u, 8u);
    for (var p = 0u; p < 4u; p++) {
      let a = PA[p];
      let b = PB[p];
      let fp = 0.5 * (f[a] + f[b]);
      let fm = 0.5 * (f[a] - f[b]);
      let ep = 0.5 * (fe[a] + fe[b]);
      let em = 0.5 * (fe[a] - fe[b]);
      let dSym = omp * (fp - ep);
      let dAnti = omm * (fm - em);
      fout[a * n + idx] = f[a] - dSym - dAnti;
      fout[b * n + idx] = f[b] - dSym + dAnti;
    }
  } else {
    for (var i = 0u; i < 9u; i++) {
      fout[i * n + idx] = f[i] + omp * (fe[i] - f[i]);
    }
  }

  // H13: exact-arithmetic collision conserves rho, but separately rounded outputs leave
  // a systematic f32 residual. Direction 0 carries no momentum or stress, so it alone
  // receives the represented residual. Sum order mirrors collide.ts.
  if (P.conserveMass == 1u) {
    var rhoOut = 0.0;
    for (var i = 0u; i < 9u; i++) { rhoOut += fout[i * n + idx]; }
    fout[idx] += rho - rhoOut;
  }
  vel[idx] = u;
  tauField[idx] = tauEff / tau0 - 1.0;  // τ_t/τ₀ — 0 when LES off or laminar
}
