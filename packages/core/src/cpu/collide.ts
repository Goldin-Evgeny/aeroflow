import { D2Q9 } from '../lattice.js';
import { D3Q19 } from '../lattice3d.js';

/**
 * The SHARED per-cell collision core: BGK/TRT, optional Smagorinsky LES, optional
 * Guo or legacy shifted-velocity forcing. Implemented per docs/handoff/H1-trt-les-forcing.md.
 *
 * This single function is used by Solver2D, Solver3D and EsotericPull3D. The esoteric
 * bit-identity test (docs/handoff/H4-esoteric-pull.md §8) requires the naive and
 * in-place 3D solvers to perform IDENTICAL floating-point operations — which they get
 * by calling this one code object. Do not fork or "inline for speed".
 */

export interface LatticeSpec {
  readonly q: number;
  readonly ex: readonly number[];
  readonly ey: readonly number[];
  readonly ez: readonly number[];
  readonly w: readonly number[];
  readonly opp: readonly number[];
  /** Opposite-direction pairs [a, b] with a < b = opp(a); rest direction excluded. */
  readonly pairs: ReadonlyArray<readonly [number, number]>;
}

function derivePairs(opp: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 1; i < opp.length; i++) {
    if (i < opp[i]) pairs.push([i, opp[i]]);
  }
  return pairs;
}

export const D2Q9_SPEC: LatticeSpec = {
  q: D2Q9.q,
  ex: D2Q9.ex,
  ey: D2Q9.ey,
  ez: new Array<number>(D2Q9.q).fill(0),
  w: D2Q9.w,
  opp: D2Q9.opp,
  pairs: derivePairs(D2Q9.opp),
};

export const D3Q19_SPEC: LatticeSpec = {
  q: D3Q19.q,
  ex: D3Q19.ex,
  ey: D3Q19.ey,
  ez: D3Q19.ez,
  w: D3Q19.w,
  opp: D3Q19.opp,
  pairs: derivePairs(D3Q19.opp),
};

/** f_i^eq = w_i ρ (1 + 3(e·u) + 4.5(e·u)² − 1.5|u|²), 3-component form. */
export function equilibrium3(
  lat: LatticeSpec,
  i: number,
  rho: number,
  ux: number,
  uy: number,
  uz: number,
): number {
  const eu = lat.ex[i] * ux + lat.ey[i] * uy + lat.ez[i] * uz;
  const usq = ux * ux + uy * uy + uz * uz;
  return lat.w[i] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * usq);
}

export type Collision = 'bgk' | 'trt';
export type Forcing = 'guo' | 'shift' | 'none';

/**
 * Π^neq_αβ = Σ_i e_iα e_iβ (f_i − f_i^eq) — the six independent components of the symmetric
 * non-equilibrium momentum-flux tensor, written into `out` as [xx, yy, zz, xy, xz, yz].
 *
 * Extracted from `collideCell` (2026-08-06, M9) so the τ_eff **diagnostic** and the solver
 * share one implementation. A τ_eff oracle that re-derives this from the handoff spec would
 * be a second implementation of a formula whose whole purpose is to describe what the solver
 * did — any drift between them would be reported as physics. The operation order is
 * unchanged from the inlined version, so results stay bit-identical.
 */
export function piNeq(
  f: Float64Array,
  feq: Float64Array,
  lat: LatticeSpec,
  out: Float64Array,
): void {
  const { q, ex, ey, ez } = lat;
  let pxx = 0;
  let pyy = 0;
  let pzz = 0;
  let pxy = 0;
  let pxz = 0;
  let pyz = 0;
  for (let i = 0; i < q; i++) {
    const fneq = f[i] - feq[i];
    pxx += ex[i] * ex[i] * fneq;
    pyy += ey[i] * ey[i] * fneq;
    pzz += ez[i] * ez[i] * fneq;
    pxy += ex[i] * ey[i] * fneq;
    pxz += ex[i] * ez[i] * fneq;
    pyz += ey[i] * ez[i] * fneq;
  }
  out[0] = pxx;
  out[1] = pyy;
  out[2] = pzz;
  out[3] = pxy;
  out[4] = pxz;
  out[5] = pyz;
}

/** ‖Π^neq‖ = √(2 Π:Π). Off-diagonals count twice — the tensor is symmetric. */
export function piNeqNorm(p: Float64Array): number {
  return Math.sqrt(
    2 * (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + 2 * (p[3] * p[3] + p[4] * p[4] + p[5] * p[5])),
  );
}

/**
 * Smagorinsky τ_eff (Hou et al. 1996): τ_eff = τ₀ + τ_t, τ_t = ½(√(τ₀² + K‖Π‖/ρ) − τ₀).
 *
 * **There is no clamp and no floor here, and that is the point.** τ_t ≥ 0 always, so τ₀ is
 * itself the lower bound on τ_eff — "a cell at the floor" means the LES is contributing
 * nothing there, not that a limiter fired. Since ν = (τ − ½)/3, a τ₀ driven toward ½ by a
 * high nominal Re leaves the *entire* effective viscosity to the subgrid model.
 */
export function smagorinskyTauEff(tau0: number, lesK: number, qNorm: number, rho: number): number {
  const tauT = 0.5 * (Math.sqrt(tau0 * tau0 + (lesK * qNorm) / rho) - tau0);
  return tau0 + tauT;
}

/** Lattice kinematic viscosity from a relaxation time: ν = (τ − ½)/3. */
export function viscosityFromTau(tau: number): number {
  return (tau - 0.5) / 3;
}

export interface CollideContext {
  lat: LatticeSpec;
  tau0: number;
  collision: Collision;
  /** TRT magic parameter Λ; canonical default 3/16. */
  lambda: number;
  /** Precomputed 18·√2·Cs² (0 = LES off). */
  lesK: number;
  /** Projected (Latt–Chopard) regularization of the pre-collision f^neq. See H10. */
  regularize: boolean;
  /** Restore the incoming zeroth moment after finite-precision collision. See H13. */
  conserveMass: boolean;
  forcing: Forcing;
  gx: number;
  gy: number;
  gz: number;
  /** Scratch, length q — allocated once per solver. */
  feq: Float64Array;
  /** Scratch, length 6 — Π^neq as [xx, yy, zz, xy, xz, yz]. Allocated once per solver. */
  piNeq: Float64Array;
  /** Output: [rho, ux, uy, uz, tauEff]. ux/uy/uz are the PHYSICAL velocity
   * (Guo: moment/ρ + g/2; shift: legacy raw moment/ρ). */
  macro: Float64Array;
}

export function makeCollideContext(
  lat: LatticeSpec,
  opts: {
    tau: number;
    collision?: Collision;
    lambda?: number;
    lesCs?: number;
    forcing?: Forcing;
    gravity?: readonly number[];
    regularize?: boolean;
    conserveMass?: boolean;
  },
): CollideContext {
  const g = opts.gravity ?? [0, 0, 0];
  const gx = g[0] ?? 0;
  const gy = g[1] ?? 0;
  const gz = g[2] ?? 0;
  const hasG = gx !== 0 || gy !== 0 || gz !== 0;
  const forcing: Forcing = !hasG ? 'none' : (opts.forcing ?? 'guo');
  const collision = opts.collision ?? 'bgk';
  const lesK = opts.lesCs ? 18 * Math.SQRT2 * opts.lesCs * opts.lesCs : 0;
  if (forcing === 'shift' && (collision !== 'bgk' || lesK !== 0)) {
    // Legacy compatibility mode only — its τ-dependent error defeats TRT exactness
    // and its interaction with per-cell τ_eff is undefined (H1 §4).
    throw new Error("forcing 'shift' is legacy-only: requires collision 'bgk' and LES off");
  }
  if ((opts.regularize ?? false) && forcing !== 'none') {
    // The projection zeroes f^(1)'s momentum, which drops the −½ρg that the Guo-shifted
    // non-equilibrium carries, leaking ½ρg(1−ω) per step. A force-aware projection is
    // needed and is deferred to M7 (3D forces); M6 flows are unforced (H10 "Pitfalls").
    throw new Error('regularization is not yet compatible with forcing (deferred to M7)');
  }
  if (opts.tau <= 0.5) throw new Error('tau must be > 0.5');
  return {
    lat,
    tau0: opts.tau,
    collision,
    lambda: opts.lambda ?? 3 / 16,
    lesK,
    regularize: opts.regularize ?? false,
    conserveMass: opts.conserveMass ?? false,
    forcing,
    gx,
    gy,
    gz,
    feq: new Float64Array(lat.q),
    piNeq: new Float64Array(6),
    macro: new Float64Array(5),
  };
}

/**
 * Collide one cell in place. `f` holds the q gathered (post-streaming) populations;
 * on return it holds the post-collision populations. Macroscopics land in ctx.macro.
 */
export function collideCell(f: Float64Array, ctx: CollideContext): void {
  const { lat, feq } = ctx;
  const q = lat.q;
  const ex = lat.ex;
  const ey = lat.ey;
  const ez = lat.ez;

  // Moments.
  let rho = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < q; i++) {
    const fi = f[i];
    rho += fi;
    mx += ex[i] * fi;
    my += ey[i] * fi;
    mz += ez[i] * fi;
  }

  // Velocity entering the equilibrium.
  let ux = mx / rho;
  let uy = my / rho;
  let uz = mz / rho;
  if (ctx.forcing === 'guo') {
    // Guo 2002: ρu = Σe·f + F/2 with F = ρg  ⇒  u += g/2.
    ux += 0.5 * ctx.gx;
    uy += 0.5 * ctx.gy;
    uz += 0.5 * ctx.gz;
  } else if (ctx.forcing === 'shift') {
    // Legacy shifted-velocity forcing: u_eq = u + τ·g/ρ (equilibrium only).
    ux += (ctx.tau0 * ctx.gx) / rho;
    uy += (ctx.tau0 * ctx.gy) / rho;
    uz += (ctx.tau0 * ctx.gz) / rho;
  }

  for (let i = 0; i < q; i++) feq[i] = equilibrium3(lat, i, rho, ux, uy, uz);

  // Non-equilibrium momentum-flux tensor Π^neq_αβ = Σ_i e_iα e_iβ (f_i − f_i^eq), the one
  // second moment shared by Smagorinsky LES (its norm sets τ_t) and Latt–Chopard
  // regularization (its projection rebuilds f^neq). Computed once when either is on.
  let tauEff = ctx.tau0;
  if (ctx.lesK !== 0 || ctx.regularize) {
    const p = ctx.piNeq;
    piNeq(f, feq, lat, p);
    const pxx = p[0];
    const pyy = p[1];
    const pzz = p[2];
    const pxy = p[3];
    const pxz = p[4];
    const pyz = p[5];

    // Smagorinsky LES (Hou et al. 1996): τ_eff from ‖Π^neq‖ = √(2 Π:Π); off-diagonals
    // count twice (symmetric tensor). The projection below preserves Π^neq, so τ_eff is
    // identical whether computed before or after regularization (H10 "Ordering vs LES").
    if (ctx.lesK !== 0) {
      tauEff = smagorinskyTauEff(ctx.tau0, ctx.lesK, piNeqNorm(p), rho);
    }

    // Projected regularization (Latt & Chopard 2005, Eq. 10; H10): overwrite the gathered
    // populations with the pure 2nd-order-Hermite projection of Π^neq, discarding the
    // ghost moms that carry the under-resolved instability. f_i = f_i^eq + 4.5 w_i·Q_i:Π,
    // Q_iαβ = e_iα e_iβ − c_s²δ_αβ, c_s²=1/3. Even in i ⇒ the TRT ω⁻ acts on nothing.
    if (ctx.regularize) {
      const trace = (pxx + pyy + pzz) / 3;
      for (let i = 0; i < q; i++) {
        const eix = ex[i];
        const eiy = ey[i];
        const eiz = ez[i];
        const qContract =
          eix * eix * pxx +
          eiy * eiy * pyy +
          eiz * eiz * pzz +
          2 * (eix * eiy * pxy + eix * eiz * pxz + eiy * eiz * pyz) -
          trace;
        f[i] = feq[i] + 4.5 * lat.w[i] * qContract;
      }
    }
  }

  const omp = 1 / tauEff;
  // TRT: Λ = (τ⁺−½)(τ⁻−½) with τ⁺ = τ_eff, re-derived PER CELL under LES.
  const omm = ctx.collision === 'trt' ? 1 / (0.5 + ctx.lambda / (tauEff - 0.5)) : omp;

  if (ctx.collision === 'trt') {
    f[0] = f[0] + omp * (feq[0] - f[0]);
    const pairs = lat.pairs;
    for (let p = 0; p < pairs.length; p++) {
      const a = pairs[p][0];
      const b = pairs[p][1];
      const fp = 0.5 * (f[a] + f[b]);
      const fm = 0.5 * (f[a] - f[b]);
      const ep = 0.5 * (feq[a] + feq[b]);
      const em = 0.5 * (feq[a] - feq[b]);
      const dSym = omp * (fp - ep);
      const dAnti = omm * (fm - em);
      f[a] = f[a] - dSym - dAnti;
      f[b] = f[b] - dSym + dAnti;
    }
  } else {
    for (let i = 0; i < q; i++) f[i] = f[i] + omp * (feq[i] - f[i]);
  }

  // Guo source term, split ± with the matching relaxation prefactors (H1 §4).
  if (ctx.forcing === 'guo') {
    const { gx, gy, gz } = ctx;
    const ug = ux * gx + uy * gy + uz * gz;
    const cp = 1 - 0.5 * omp;
    const cm = 1 - 0.5 * omm;
    // S_i = w_i·ρ·( 3(e·g) − 3(u·g) + 9(e·u)(e·g) )
    // Rest: e = 0 ⇒ S_0 = −3·w_0·ρ·(u·g), purely symmetric.
    f[0] += cp * (lat.w[0] * rho * (-3 * ug));
    const pairs = lat.pairs;
    for (let p = 0; p < pairs.length; p++) {
      const a = pairs[p][0];
      const b = pairs[p][1];
      const eg = ex[a] * gx + ey[a] * gy + ez[a] * gz; // e_b·g = −eg
      const eu = ex[a] * ux + ey[a] * uy + ez[a] * uz; // e_b·u = −eu
      const sa = lat.w[a] * rho * (3 * eg - 3 * ug + 9 * eu * eg);
      const sb = lat.w[b] * rho * (-3 * eg - 3 * ug + 9 * eu * eg);
      const sp = 0.5 * (sa + sb);
      const sm = 0.5 * (sa - sb);
      f[a] += cp * sp + cm * sm;
      f[b] += cp * sp - cm * sm;
    }
  }

  // H13 finite-precision conservation: collision and the Guo source conserve density in
  // exact arithmetic, but independently rounded populations can leave a systematic
  // residual. Put only that residual into f0; e0=0, so momentum and stress are unchanged.
  if (ctx.conserveMass) {
    let rhoOut = 0;
    for (let i = 0; i < q; i++) rhoOut += f[i];
    f[0] += rho - rhoOut;
  }

  const macro = ctx.macro;
  macro[0] = rho;
  macro[1] = ux;
  macro[2] = uy;
  macro[3] = uz;
  macro[4] = tauEff;
}
