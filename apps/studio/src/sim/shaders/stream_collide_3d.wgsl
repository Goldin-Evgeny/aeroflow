// D3Q19 fused stream-collide — Esoteric Pull in-place streaming (M6, step 4).
//
// constants paired with packages/core/src/lattice3d.ts D3Q19 — keep synchronized by hand.
// This is a 1:1 transliteration of the CPU reference packages/core/src/cpu/esoteric.ts
// (in-place Esoteric Pull, docs/handoff/H4-esoteric-pull.md). Direction-for-direction.
//
// Variants selected by shaderPreprocess.ts:
//   STORAGE_FP16 — DDFs stored as f16 (shader-f16 path), shifted by −w_i (H5). Arithmetic
//                  is always f32. When undefined, DDFs are stored as plain f32 (no shift).
//   TRT          — two-relaxation-time collision (Λ via omegaMinus). When undefined, BGK.
//   REGULARIZE   — projected (Latt–Chopard) velocity-stable collision (H10). When undefined,
//                  the plain collision runs.
//   LES          — Smagorinsky subgrid model (M7): per-cell τ_eff from ‖Π^neq‖. FP32
//                  arithmetic. NEED_TENSOR is set by the driver when LES or REGULARIZE is on
//   CONSERVE_MASS — restore the represented incoming zeroth moment through f0 after collision
//                   (H13). Compile-time selected so the M6 benchmark path stays unchanged.
//                  (they share the one Π^neq reduction).
//   MULTI_DDF    — the 19 DDF planes span ${NUM_DDF_BUFFERS} storage buffers (${PER_BUFFER}
//                  planes each) so every binding stays under the device cap (iOS ~1 GiB, #5).
//                  When undefined, a single DDF buffer is bound (byte-identical fast path).
//   FORCES       — momentum-exchange force pass (M7, step 4). Adds a per-cell cellForce
//                  buffer; each fluid cell writes the force its solid-neighbour bounce-back
//                  links exert on the body (2·e_ī·f*_ī, docs/handoff/H2 §1) when the
//                  collectForces uniform is 1. reduce_forces_3d.wgsl sums it. When undefined
//                  the kernel is byte-identical to the M6 stream-collide (no extra binding,
//                  no writes). The link rule mirrors packages/core/src/cpu/esoteric.ts
//                  line-for-line, reading f*_ī from the SAME parity slot the gather uses.

//   ABL          — M10 boundary conditions (H12): per-height inlet profile buffer and the
//                  VelocityInlet ρ-snapshot buffer (flux-imposing velocity inlet). When
//                  undefined no extra bindings exist and plain Inlet reads P.inletVel.
//                  Free-slip (H11) needs no bindings and is always compiled; scenes without
//                  FreeSlip cells never reach that branch.

//#ifdef STORAGE_FP16
enable f16;
//#endif

// ---- D3Q19 lattice (adjacent opposite pairs: opp(0)=0, opp(a)=a+1 for odd a) ----
const EX = array<i32,19>(0, 1,-1, 0, 0, 0, 0, 1,-1, 1,-1, 1,-1, 1,-1, 0, 0, 0, 0);
const EY = array<i32,19>(0, 0, 0, 1,-1, 0, 0, 1,-1,-1, 1, 0, 0, 0, 0, 1,-1, 1,-1);
const EZ = array<i32,19>(0, 0, 0, 0, 0, 1,-1, 0, 0, 0, 0, 1,-1,-1, 1, 1,-1,-1, 1);
const W  = array<f32,19>(
  1.0/3.0,
  1.0/18.0, 1.0/18.0, 1.0/18.0, 1.0/18.0, 1.0/18.0, 1.0/18.0,
  1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0,
  1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0,
);

// Adjacent-pair opposites: opp(0)=0, opp(a)=a+1 for odd a (lattice3d.ts D3Q19.opp).
const OPP = array<u32,19>(0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17);
// Specular reflection tables (H11) — paired with lattice3d.ts D3Q19.reflectY/reflectZ.
// x faces are never free-slip (H11 §3.2), so no REFX.
const REFY = array<u32,19>(0, 1, 2, 4, 3, 5, 6, 9, 10, 7, 8, 11, 12, 13, 14, 18, 17, 16, 15);
const REFZ = array<u32,19>(0, 1, 2, 3, 4, 6, 5, 7, 8, 9, 10, 13, 14, 11, 12, 17, 18, 15, 16);

// Cell flags (packages/core/src/lattice.ts CellType).
const FLUID    = 0u;
const SOLID    = 1u;
const INLET    = 2u;
const OUTLET   = 3u;
const FREESLIP = 4u;
const VELINLET = 5u;
// Solid cell belonging to the MEASURED body. Streams and bounces exactly like SOLID —
// isSolidFlag() covers both — but only these links contribute to the momentum-exchange
// force, so a no-slip ground (plain SOLID) can no longer be counted as drag. Mirrors
// CellType.BodySolid; keep the value synchronized by hand with lattice.ts.
const BODY     = 6u;

fn isSolidFlag(f: u32) -> bool { return f == SOLID || f == BODY; }

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  parity: u32,        // 0 = even (canonical after step), 1 = odd
  omegaPlus: f32,     // 1/tau0
  omegaMinus: f32,    // TRT anti-symmetric rate at tau0 (= omegaPlus for BGK); LES overrides
  inletVel: f32,
  lambda: f32,        // TRT magic parameter Λ — re-derives ω⁻ per cell under LES
  lesK: f32,          // Smagorinsky 18√2·Cs² (used only when the LES variant is compiled)
  collectForces: u32, // 1 = write per-cell momentum-exchange force into cellForce (FORCES)
  // H11 free-slip face config: bit0 yMin, bit1 yMax, bit2 zMin, bit3 zMax (0 = none).
  freeSlipMask: u32,
  // H12 inlet profile axis: 0 = scalar P.inletVel, 1 = index by y, 2 = index by z.
  profileAxis: u32,
};

@group(0) @binding(0) var<uniform> P: Params;

//#ifndef MULTI_DDF
// Single DDF binding — the grid fits one storage buffer under the device cap (the common
// case: all grids at FP16, and ≤192³ at FP32). Byte-identical to the pre-#5 kernel.
//#ifdef STORAGE_FP16
@group(0) @binding(1) var<storage, read_write> ddf: array<f16>;
//#else
@group(0) @binding(1) var<storage, read_write> ddf: array<f32>;
//#endif
//#else
// Multi-buffer DDF split (M6 #5): the 19 planes span ${NUM_DDF_BUFFERS} storage buffers so
// every binding stays ≤ the device's maxStorageBufferBindingSize (iOS ~1 GiB, a single
// buffer caps at 2 GiB). Buffer k holds a contiguous run of ${PER_BUFFER} planes; ld/st
// route plane → (buffer = plane/${PER_BUFFER}, local plane = plane%${PER_BUFFER}).
//#ifdef STORAGE_FP16
@group(0) @binding(1) var<storage, read_write> ddf0: array<f16>;
//#ifdef DDF_BUF_1
@group(0) @binding(2) var<storage, read_write> ddf1: array<f16>;
//#endif
//#ifdef DDF_BUF_2
@group(0) @binding(3) var<storage, read_write> ddf2: array<f16>;
//#endif
//#ifdef DDF_BUF_3
@group(0) @binding(4) var<storage, read_write> ddf3: array<f16>;
//#endif
//#else
@group(0) @binding(1) var<storage, read_write> ddf0: array<f32>;
//#ifdef DDF_BUF_1
@group(0) @binding(2) var<storage, read_write> ddf1: array<f32>;
//#endif
//#ifdef DDF_BUF_2
@group(0) @binding(3) var<storage, read_write> ddf2: array<f32>;
//#endif
//#ifdef DDF_BUF_3
@group(0) @binding(4) var<storage, read_write> ddf3: array<f32>;
//#endif
//#endif
//#endif
// Common whole-field resources follow the one-to-four DDF bindings.
@group(0) @binding(${B_FLAGS}) var<storage, read> flagWords: array<u32>;
// M11: planar macros keep each whole-bound output at one f32 per cell (4 B/cell).
@group(0) @binding(${B_MACRO_RHO}) var<storage, read_write> macroRho: array<f32>;
@group(0) @binding(${B_MACRO_UX}) var<storage, read_write> macroUx: array<f32>;
@group(0) @binding(${B_MACRO_UY}) var<storage, read_write> macroUy: array<f32>;
@group(0) @binding(${B_MACRO_UZ}) var<storage, read_write> macroUz: array<f32>;
// outlet zero-gradient snapshot: q values per (y,z) column on the +x face.
@group(0) @binding(${B_OUTLET}) var<storage, read_write> outletSnap: array<f32>;
//#ifdef FORCES
// Per-cell momentum-exchange force (H2 §5), one vec3f per cell. Written only when
// collectForces == 1; reduced by reduce_forces_3d.wgsl. Non-contributing cells write 0
// so no stale value survives between sampled steps.
@group(0) @binding(${B_FORCE}) var<storage, read_write> cellForce: array<vec3f>;
//#endif
//#ifdef ABL
// M10/H12: per-height inlet u_in (length ny or nz per P.profileAxis) and the VelocityInlet
// ρ snapshot — one f32 per (y,z) column of the x=0 face, written by snapshot_boundaries.
@group(0) @binding(${B_PROFILE}) var<storage, read> inletProfile: array<f32>;
@group(0) @binding(${B_VELRHO}) var<storage, read_write> velInletRho: array<f32>;
//#endif

fn cellCount() -> u32 { return P.nx * P.ny * P.nz; }
fn cellIndex(x: u32, y: u32, z: u32) -> u32 { return x + P.nx * (y + P.ny * z); }

fn getFlag(idx: u32) -> u32 {
  let word = flagWords[idx >> 2u];
  return (word >> ((idx & 3u) * 8u)) & 0xFFu;
}

// ---- storage load/store: f32 arithmetic, optional −w_i shift for FP16 (H5 §2) ----
//#ifndef MULTI_DDF
fn ld(plane: u32, cell: u32) -> f32 {
  let s = plane * cellCount() + cell;
//#ifdef STORAGE_FP16
  return f32(ddf[s]) + W[plane];
//#else
  return ddf[s];
//#endif
}
fn st(plane: u32, cell: u32, v: f32) {
  let s = plane * cellCount() + cell;
//#ifdef STORAGE_FP16
  ddf[s] = f16(v - W[plane]);
//#else
  ddf[s] = v;
//#endif
}
//#else
// Route plane → (buffer, local plane) across the split. ${PER_BUFFER} planes per buffer;
// f32(ddfK[s]) covers both storage types. A single-case switch (NUM_DDF_BUFFERS==1 never
// takes this path) compiles away; the division is a const multiply-shift, negligible on a
// bandwidth-bound kernel.
fn ld(plane: u32, cell: u32) -> f32 {
  let b = plane / ${PER_BUFFER}u;
  let s = (plane % ${PER_BUFFER}u) * cellCount() + cell;
  var raw = 0.0;
  switch b {
    case 0u: { raw = f32(ddf0[s]); }
//#ifdef DDF_BUF_1
    case 1u: { raw = f32(ddf1[s]); }
//#endif
//#ifdef DDF_BUF_2
    case 2u: { raw = f32(ddf2[s]); }
//#endif
//#ifdef DDF_BUF_3
    case 3u: { raw = f32(ddf3[s]); }
//#endif
    default: {}
  }
//#ifdef STORAGE_FP16
  return raw + W[plane];
//#else
  return raw;
//#endif
}
fn st(plane: u32, cell: u32, v: f32) {
  let b = plane / ${PER_BUFFER}u;
  let s = (plane % ${PER_BUFFER}u) * cellCount() + cell;
//#ifdef STORAGE_FP16
  let sv = f16(v - W[plane]);
//#else
  let sv = v;
//#endif
  switch b {
    case 0u: { ddf0[s] = sv; }
//#ifdef DDF_BUF_1
    case 1u: { ddf1[s] = sv; }
//#endif
//#ifdef DDF_BUF_2
    case 2u: { ddf2[s] = sv; }
//#endif
//#ifdef DDF_BUF_3
    case 3u: { ddf3[s] = sv; }
//#endif
    default: {}
  }
}
//#endif

fn equilibrium(i: u32, rho: f32, ux: f32, uy: f32, uz: f32) -> f32 {
  let eu = f32(EX[i]) * ux + f32(EY[i]) * uy + f32(EZ[i]) * uz;
  let usq = ux * ux + uy * uy + uz * uz;
  return W[i] * rho * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * usq);
}

// Inlet velocity at a shell cell: the per-height ABL profile when configured (H12/M10),
// else the scalar. Mirrors esoteric.ts (inletProfile lookup by y or z).
fn inletU(y: u32, z: u32) -> f32 {
//#ifdef ABL
  if (P.profileAxis == 1u) { return inletProfile[y]; }
  if (P.profileAxis == 2u) { return inletProfile[z]; }
//#endif
  return P.inletVel;
}

//#ifdef FREESLIP
// H11 free-slip gather: 1:1 with esoteric.ts freeSlipRead + freeslip.ts resolveFreeSlipPull.
// Fluid cell (x,y,z) pulls direction i whose source nIdx is a FreeSlip shell cell: walk the
// reflection loop (per configured face, undo the displacement THEN negate the component —
// H11 pitfall 2; a slip∩slip edge resolves both axes in one pass), then read f_J^out(S,t)
// from where the previous step's layout put it: EVEN step reads canonical A[S][J], ODD step
// reads the EVEN crosswise slot A[S+e_J][opp(J)] (ownership audit in H11 §5). A Solid final
// source (slip∩solid edge, §3.1) falls back to plain local bounce-back of the original
// direction, with no force contribution (far-field wall). Scene validity (FreeSlip only on
// configured faces) is enforced CPU-side by validateFreeSlip before flags upload.
fn freeSlipRead(x: u32, y: u32, z: u32, i: u32, even: bool, idx: u32, nIdx: u32) -> f32 {
  let sx = i32(x) - EX[i]; // x faces never free-slip: the x component never reflects
  var sy = i32(y) - EY[i];
  var sz = i32(z) - EZ[i];
  var dir = i;
  var flag = FREESLIP;
  for (var iter = 0u; iter < 3u; iter++) {
    flag = getFlag(cellIndex(u32(sx), u32(sy), u32(sz)));
    if (flag != FREESLIP) { break; }
    if (((sy == 0 && (P.freeSlipMask & 1u) != 0u)
      || (sy == i32(P.ny) - 1 && (P.freeSlipMask & 2u) != 0u)) && EY[dir] != 0) {
      sy += EY[dir];
      dir = REFY[dir];
    }
    if (((sz == 0 && (P.freeSlipMask & 4u) != 0u)
      || (sz == i32(P.nz) - 1 && (P.freeSlipMask & 8u) != 0u)) && EZ[dir] != 0) {
      sz += EZ[dir];
      dir = REFZ[dir];
    }
  }
  if (isSolidFlag(flag)) {
    return select(ld(i, nIdx), ld(OPP[i], idx), even);
  }
  let sIdx = cellIndex(u32(sx), u32(sy), u32(sz));
  if (even) { return ld(dir, sIdx); }
  let tIdx = cellIndex(u32(sx + EX[dir]), u32(sy + EY[dir]), u32(sz + EZ[dir]));
  return ld(OPP[dir], tIdx);
}
//#endif

// Collide the gathered populations f[] in place (BGK or TRT; optional LES and/or
// REGULARIZE). Mirrors collide.ts with forcing off (forces are M7's force pass, not here).
// Returns nothing; f[] holds post-collision values.
fn collide(f: ptr<function, array<f32,19>>) {
  var rho = 0.0;
  var mx = 0.0; var my = 0.0; var mz = 0.0;
  for (var i = 0u; i < 19u; i++) {
    let fi = (*f)[i];
    rho += fi;
    mx += f32(EX[i]) * fi;
    my += f32(EY[i]) * fi;
    mz += f32(EZ[i]) * fi;
  }
  let ux = mx / rho; let uy = my / rho; let uz = mz / rho;
  var feq: array<f32,19>;
  for (var i = 0u; i < 19u; i++) { feq[i] = equilibrium(i, rho, ux, uy, uz); }

//#ifdef NEED_TENSOR
  // Π^neq_αβ = Σ_i e_iα e_iβ (f_i − f_i^eq): the one second moment shared by Smagorinsky
  // LES (‖Π‖ sets τ_t) and Latt–Chopard regularization (its projection rebuilds f^neq).
  // Mirrors the shared block in packages/core/src/cpu/collide.ts.
  var pxx = 0.0; var pyy = 0.0; var pzz = 0.0;
  var pxy = 0.0; var pxz = 0.0; var pyz = 0.0;
  for (var i = 0u; i < 19u; i++) {
    let fneq = (*f)[i] - feq[i];
    pxx += f32(EX[i]) * f32(EX[i]) * fneq;
    pyy += f32(EY[i]) * f32(EY[i]) * fneq;
    pzz += f32(EZ[i]) * f32(EZ[i]) * fneq;
    pxy += f32(EX[i]) * f32(EY[i]) * fneq;
    pxz += f32(EX[i]) * f32(EZ[i]) * fneq;
    pyz += f32(EY[i]) * f32(EZ[i]) * fneq;
  }
//#endif

//#ifdef LES
  // Smagorinsky (Hou et al. 1996): τ_eff = τ₀ + τ_t from ‖Π^neq‖ = √(2 Π:Π); off-diagonals
  // count twice. lesK = 18√2·Cs². 1:1 with collide.ts. Per-cell; FP32 arithmetic always.
  let tau0 = 1.0 / P.omegaPlus;
  let qNorm = sqrt(2.0 * (pxx * pxx + pyy * pyy + pzz * pzz
    + 2.0 * (pxy * pxy + pxz * pxz + pyz * pyz)));
  let tauT = 0.5 * (sqrt(tau0 * tau0 + P.lesK * qNorm / rho) - tau0);
  let tauEff = tau0 + tauT;
//#endif

//#ifdef REGULARIZE
  // Projected (Latt–Chopard 2005) regularization — rebuild f^neq as the pure 2nd-order
  // Hermite projection of Π^neq, discarding the ghost modes that carry the under-resolved
  // instability (H10). f_i = f_i^eq + 4.5·W_i·(Q_i:Π), Q_iαβ = e_iα e_iβ − c_s²δ.
  let trace = (pxx + pyy + pzz) / 3.0;
  for (var i = 0u; i < 19u; i++) {
    let eix = f32(EX[i]); let eiy = f32(EY[i]); let eiz = f32(EZ[i]);
    let qContract = eix * eix * pxx + eiy * eiy * pyy + eiz * eiz * pzz
      + 2.0 * (eix * eiy * pxy + eix * eiz * pxz + eiy * eiz * pyz) - trace;
    (*f)[i] = feq[i] + 4.5 * W[i] * qContract;
  }
//#endif

//#ifdef LES
  // TRT ω⁻ re-derived per cell from τ_eff (BGK: ω⁻ = ω⁺).
  let omp = 1.0 / tauEff;
//#ifdef TRT
  let omm = 1.0 / (0.5 + P.lambda / (tauEff - 0.5));
//#else
  let omm = omp;
//#endif
//#else
  let omp = P.omegaPlus;
  let omm = P.omegaMinus;
//#endif
//#ifdef TRT
  (*f)[0] = (*f)[0] + omp * (feq[0] - (*f)[0]);
  for (var a = 1u; a < 19u; a += 2u) {
    let b = a + 1u;
    let fp = 0.5 * ((*f)[a] + (*f)[b]);
    let fm = 0.5 * ((*f)[a] - (*f)[b]);
    let ep = 0.5 * (feq[a] + feq[b]);
    let em = 0.5 * (feq[a] - feq[b]);
    let dSym = omp * (fp - ep);
    let dAnti = omm * (fm - em);
    (*f)[a] = (*f)[a] - dSym - dAnti;
    (*f)[b] = (*f)[b] - dSym + dAnti;
  }
//#else
  for (var i = 0u; i < 19u; i++) { (*f)[i] = (*f)[i] + omp * (feq[i] - (*f)[i]); }
//#endif

//#ifdef CONSERVE_MASS
  // H13: exact-arithmetic collision conserves rho, but separately rounded outputs leave
  // a systematic f32 residual. e0=0, so correcting only f0 preserves momentum and stress.
  var rhoOut = 0.0;
  for (var i = 0u; i < 19u; i++) { rhoOut += (*f)[i]; }
  (*f)[0] += rho - rhoOut;
//#endif
}

// Scatter post-collision f[] back to storage per parity write rules (H4 §3).
fn scatter(idx: u32, x: u32, y: u32, z: u32, even: bool, f: ptr<function, array<f32,19>>) {
  st(0u, idx, (*f)[0]);
  if (even) {
    for (var a = 1u; a < 19u; a += 2u) {
      let b = a + 1u;
      // neighbor in −e_a gets f[b] into plane a; neighbor in +e_a gets f[a] into plane b.
      let nax = i32(x) - EX[a]; let nay = i32(y) - EY[a]; let naz = i32(z) - EZ[a];
      if (nax >= 0 && nax < i32(P.nx) && nay >= 0 && nay < i32(P.ny) && naz >= 0 && naz < i32(P.nz)) {
        st(a, cellIndex(u32(nax), u32(nay), u32(naz)), (*f)[b]);
      }
      let nbx = i32(x) + EX[a]; let nby = i32(y) + EY[a]; let nbz = i32(z) + EZ[a];
      if (nbx >= 0 && nbx < i32(P.nx) && nby >= 0 && nby < i32(P.ny) && nbz >= 0 && nbz < i32(P.nz)) {
        st(b, cellIndex(u32(nbx), u32(nby), u32(nbz)), (*f)[a]);
      }
    }
  } else {
    for (var a = 1u; a < 19u; a += 2u) {
      let b = a + 1u;
      st(a, idx, (*f)[a]);
      st(b, idx, (*f)[b]);
    }
  }
}

// ---- Pass 1: boundary snapshots — outlet zero-gradient (H4 §3.5) and, under ABL,
// the VelocityInlet ρ pre-pass (H12 §4). One thread per x-face column (y,z); each column
// handles its +x-face outlet cell and its x=0-face VelocityInlet cell. Captures pre-step
// post-collision state before the main sweep overwrites those slots.
@compute @workgroup_size(64)
fn snapshot_outlets(@builtin(global_invocation_id) gid: vec3u) {
  let y = gid.x; let z = gid.y;
  if (y >= P.ny || z >= P.nz) { return; }
  let x = P.nx - 1u;
  let idx = cellIndex(x, y, z);
  let even = P.parity == 0u;
  if (getFlag(idx) == OUTLET) {
    let up = idx - 1u;            // upstream in x
    let ux = x - 1u;
    let base = 19u * (y + P.ny * z);
    if (even) {
      for (var i = 0u; i < 19u; i++) { outletSnap[base + i] = ld(i, up); }
    } else {
      outletSnap[base + 0u] = ld(0u, up);
      for (var a = 1u; a < 19u; a += 2u) {
        let b = a + 1u;
        let pIdx = cellIndex(u32(i32(ux) + EX[a]), u32(i32(y) + EY[a]), u32(i32(z) + EZ[a]));
        let mIdx = cellIndex(u32(i32(ux) - EX[a]), u32(i32(y) - EY[a]), u32(i32(z) - EZ[a]));
        outletSnap[base + a] = ld(b, pIdx);
        outletSnap[base + b] = ld(a, mIdx);
      }
    }
  }
//#ifdef ABL
  // H12 §4 VelocityInlet pre-pass: snapshot ρ of the x=0 cell's +x fluid neighbor from the
  // PREVIOUS step's post-collision state (mid-sweep reads violate EVEN slot ownership —
  // the outlet problem, same cure). Populations gathered per the H4 §7 parity mapping and
  // summed in direction order i=0..18, matching esoteric.ts snapshotVelocityInlets.
  let idx0 = cellIndex(0u, y, z);
  if (getFlag(idx0) == VELINLET) {
    let nb = idx0 + 1u;           // +x neighbor; Fluid by construction (H12 §2)
    var fnb: array<f32,19>;
    if (even) {
      for (var i = 0u; i < 19u; i++) { fnb[i] = ld(i, nb); }
    } else {
      fnb[0] = ld(0u, nb);
      for (var a = 1u; a < 19u; a += 2u) {
        let b = a + 1u;
        let pIdx = cellIndex(u32(1 + EX[a]), u32(i32(y) + EY[a]), u32(i32(z) + EZ[a]));
        let mIdx = cellIndex(u32(1 - EX[a]), u32(i32(y) - EY[a]), u32(i32(z) - EZ[a]));
        fnb[a] = ld(b, pIdx);
        fnb[b] = ld(a, mIdx);
      }
    }
    var rho = 0.0;
    for (var i = 0u; i < 19u; i++) { rho += fnb[i]; }
    velInletRho[y + P.ny * z] = rho;
  }
//#endif
}

// ---- Pass 2: fused stream-collide, one thread per cell ----
// dispatch (Nx/64, Ny, Nz) — a flat 1D dispatch of 256³ workgroups exceeds the 65535
// per-dimension limit (H4 / M6 step 4).
@compute @workgroup_size(64)
fn stream_collide(@builtin(global_invocation_id) gid: vec3u) {
  let x = gid.x; let y = gid.y; let z = gid.z;
  if (x >= P.nx || y >= P.ny || z >= P.nz) { return; }
  let idx = cellIndex(x, y, z);
  let flag = getFlag(idx);
  // Solid and FreeSlip cells are passive; their slots are functional scratch (H4 §5,
  // H11 §5) — the EVEN crosswise writes into them are load-bearing.
  if (isSolidFlag(flag) || flag == FREESLIP) {
//#ifdef FORCES
    if (P.collectForces == 1u) { cellForce[idx] = vec3f(0.0); }
//#endif
    return;
  }
  let even = P.parity == 0u;

  var f: array<f32,19>;

  if (flag == INLET || flag == VELINLET) {
    let uIn = inletU(y, z);
    // H12: VelocityInlet emits equilibrium at the pre-pass ρ snapshot; plain Inlet at ρ=1.
    var rho = 1.0;
//#ifdef ABL
    if (flag == VELINLET) { rho = velInletRho[y + P.ny * z]; }
//#endif
    for (var i = 0u; i < 19u; i++) { f[i] = equilibrium(i, rho, uIn, 0.0, 0.0); }
    scatter(idx, x, y, z, even, &f);
//#ifdef FORCES
    if (P.collectForces == 1u) { cellForce[idx] = vec3f(0.0); }
//#endif
    return;
  }
  if (flag == OUTLET) {
    let base = 19u * (y + P.ny * z);
    for (var i = 0u; i < 19u; i++) { f[i] = outletSnap[base + i]; }
    scatter(idx, x, y, z, even, &f);
//#ifdef FORCES
    if (P.collectForces == 1u) { cellForce[idx] = vec3f(0.0); }
//#endif
    return;
  }

  // Fluid: gather per parity rules (H4 §3). Fluid neighbors are always in-bounds (shell).
  // FORCES: on a solid-neighbour bounce, accumulate the link's force ON the solid
  // (2·e_ī·f*_ī, H2 §1). For the −e_a link (neighbour naIdx) the into-solid direction is
  // b = opp(a); for the +e_a link (neighbour nbIdx) it is a. Mirrors esoteric.ts.
//#ifdef FORCES
  var force = vec3f(0.0);
//#endif
  f[0] = ld(0u, idx);
  for (var a = 1u; a < 19u; a += 2u) {
    let b = a + 1u;
    let naIdx = cellIndex(u32(i32(x) - EX[a]), u32(i32(y) - EY[a]), u32(i32(z) - EZ[a]));
    let nbIdx = cellIndex(u32(i32(x) + EX[a]), u32(i32(y) + EY[a]), u32(i32(z) + EZ[a]));

    let flagA = getFlag(naIdx);
    var va: f32;
    if (isSolidFlag(flagA)) {
      va = select(ld(a, naIdx), ld(b, idx), even);
//#ifdef FORCES
      // Only the measured body contributes (CPU: EsotericPull3D.isMeasured). A plain
      // SOLID neighbour still bounces — it just is not weighed.
      if (flagA == BODY) {
        force += 2.0 * vec3f(f32(EX[b]), f32(EY[b]), f32(EZ[b])) * va;
      }
//#endif
//#ifdef FREESLIP
    } else if (flagA == FREESLIP) {
      va = freeSlipRead(x, y, z, a, even, idx, naIdx);
//#endif
    } else {
      va = select(ld(b, idx), ld(a, naIdx), even);
    }
    f[a] = va;

    let flagB = getFlag(nbIdx);
    var vb: f32;
    if (isSolidFlag(flagB)) {
      vb = select(ld(b, nbIdx), ld(a, idx), even);
//#ifdef FORCES
      if (flagB == BODY) {
        force += 2.0 * vec3f(f32(EX[a]), f32(EY[a]), f32(EZ[a])) * vb;
      }
//#endif
//#ifdef FREESLIP
    } else if (flagB == FREESLIP) {
      vb = freeSlipRead(x, y, z, b, even, idx, nbIdx);
//#endif
    } else {
      vb = select(ld(a, idx), ld(b, nbIdx), even);
    }
    f[b] = vb;
  }
//#ifdef FORCES
  if (P.collectForces == 1u) { cellForce[idx] = force; }
//#endif

  collide(&f);
  scatter(idx, x, y, z, even, &f);
}

// ---- Pass 3: canonical macro readout (parity-aware, H4 §7) ----
// Reconstructs canonical populations for fluid cells and writes rho, ux, uy, uz.
@compute @workgroup_size(64)
fn write_macro(@builtin(global_invocation_id) gid: vec3u) {
  let x = gid.x; let y = gid.y; let z = gid.z;
  if (x >= P.nx || y >= P.ny || z >= P.nz) { return; }
  let idx = cellIndex(x, y, z);
  var rho = 0.0; var mx = 0.0; var my = 0.0; var mz = 0.0;
  if (getFlag(idx) == FLUID) {
    let even = P.parity == 0u;
    var f: array<f32,19>;
    if (even) {
      for (var i = 0u; i < 19u; i++) { f[i] = ld(i, idx); }
    } else {
      f[0] = ld(0u, idx);
      for (var a = 1u; a < 19u; a += 2u) {
        let b = a + 1u;
        let pIdx = cellIndex(u32(i32(x) + EX[a]), u32(i32(y) + EY[a]), u32(i32(z) + EZ[a]));
        let mIdx = cellIndex(u32(i32(x) - EX[a]), u32(i32(y) - EY[a]), u32(i32(z) - EZ[a]));
        f[a] = ld(b, pIdx);
        f[b] = ld(a, mIdx);
      }
    }
    for (var i = 0u; i < 19u; i++) {
      let fi = f[i];
      rho += fi;
      mx += f32(EX[i]) * fi; my += f32(EY[i]) * fi; mz += f32(EZ[i]) * fi;
    }
  }
  macroRho[idx] = rho;
  if (rho > 0.0) {
    macroUx[idx] = mx / rho; macroUy[idx] = my / rho; macroUz[idx] = mz / rho;
  } else {
    macroUx[idx] = 0.0; macroUy[idx] = 0.0; macroUz[idx] = 0.0;
  }
}
