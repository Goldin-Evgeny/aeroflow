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

/**
 * The Frobenius norm ‖Π^neq‖ = √(Σ_αβ Π_αβ²), as specified in docs/PHYSICS.md §5 and
 * paired there with the coefficient 18√2·Cs². Off-diagonals count twice — the tensor is
 * symmetric, so Σ_αβ = Σ diag + 2·Σ off-diag. This is `lesNorm: 'spec'`.
 *
 * fix-confirmed-physics-defects, les-subgrid-closure: an independent re-derivation from
 * ν_t = Cs²|S|, |S| = √(2S:S), S_αβ = −3Π_αβ/(2ρτ_eff) reproduces exactly this norm paired
 * with exactly this coefficient. `piNeqNormLegacy` below computes √2 times this value —
 * see its docstring for why that is a defect, not an alternative convention.
 */
export function piNeqNormSpec(p: Float64Array): number {
  return Math.sqrt(
    p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + 2 * (p[3] * p[3] + p[4] * p[4] + p[5] * p[5]),
  );
}

/**
 * ‖Π^neq‖ = √(2 Π:Π), mathematically √2 · `piNeqNormSpec`(p) — but computed as the
 * original single-sqrt expression, NOT as that product, so this function is bit-for-bit
 * identical to the pre-existing (pre-fix-confirmed-physics-defects) `piNeqNorm`.
 * `Math.sqrt(2) * Math.sqrt(x)` and `Math.sqrt(2 * x)` are mathematically equal but not
 * IEEE754-identical, and at least one recorded case (the M5 Re=1000 LES stability
 * envelope) sits close enough to a stability boundary that the last-bit difference
 * flipped it from converging to diverging — exactly the reproducibility this function
 * exists to guarantee. This is `lesNorm: 'legacy'` — the pre-existing convention,
 * preserved ONLY so historical results (V5/V6/V11/V13/V14 at Cs=0.1) remain reproducible
 * while the ladder is re-baselined under `'spec'`.
 *
 * **This is a defect, not a second valid convention.** docs/PHYSICS.md §5 specifies the
 * Frobenius norm (`piNeqNormSpec`) paired with `18√2·Cs²`; this function instead computes
 * `√2` times that norm, so `lesK · piNeqNormLegacy(p)` evaluates to `36·Cs²·Π̄` rather than
 * the documented `18√2·Cs²·Π̄` — an effective `Cs` high by 2^¼ ≈ 1.19× in the `τ₀→½` limit
 * (where the subgrid model supplies essentially all the viscosity) and by up to √2 ≈ 1.41×
 * elsewhere. See `openspec/changes/fix-confirmed-physics-defects` for the full derivation
 * and the migration plan off this default.
 */
export function piNeqNormLegacy(p: Float64Array): number {
  return Math.sqrt(
    2 * (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + 2 * (p[3] * p[3] + p[4] * p[4] + p[5] * p[5])),
  );
}

/**
 * @deprecated Use `piNeqNormSpec` or `piNeqNormLegacy` explicitly, selected via
 * `CollideContext.lesNorm`. Kept as an alias of the legacy (pre-existing) behavior so
 * external callers that imported this name directly do not silently change results;
 * `collideCell` itself does not call this function.
 */
export const piNeqNorm = piNeqNormLegacy;

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

/**
 * The Smagorinsky closure coefficient's Cs-dependent factor: `lesK = 18√2·Cs²` (Hou et al.
 * 1996, docs/PHYSICS.md §5). Single definition — every solver (CPU, D3Q19 WGSL, D2Q9 WGSL,
 * the D3Q27 central-moment path) and every test that needs `lesK` from a `Cs` imports this
 * rather than re-declaring the literal `18 * Math.SQRT2`
 * (fix-confirmed-physics-defects, les-subgrid-closure — a test that re-declares the
 * constant asserts the implementation against a copy of itself and cannot detect an error
 * in the shared definition).
 */
export function lesKFromCs(cs: number): number {
  return 18 * Math.SQRT2 * cs * cs;
}

/** Inverse of `lesKFromCs` — recovers the Cs a solver actually used from its own `lesK`. */
export function csFromLesK(lesK: number): number {
  return Math.sqrt(lesK / (18 * Math.SQRT2));
}

/**
 * Which Π^neq norm the Smagorinsky closure uses. `'spec'` is the Frobenius norm
 * (`piNeqNormSpec`) docs/PHYSICS.md §5 specifies, paired with `lesK`'s `18√2·Cs²`.
 * `'legacy'` is `piNeqNormLegacy` (√2 too large) — the pre-existing behavior, preserved
 * for reproducibility of results already recorded in docs/VALIDATION.md. Default
 * `'legacy'` until every affected case is re-baselined under `'spec'`
 * (openspec/changes/fix-confirmed-physics-defects, les-subgrid-closure).
 *
 * **2026-08-14, attempt 1: flip, reverted same day.** V5/V6 held on real GPU, but the CPU
 * reduced-grid Re=1000 LES stability test (`les.test.ts`) went non-finite under `'spec'` —
 * a genuine destabilization outside the tested canary set, because that test's operating
 * point (`τ₀=0.503`) was calibrated only against `'legacy'`'s excess damping.
 *
 * **2026-08-14, attempt 2: recalibrate `les.test.ts` to `Re=300` (`τ₀=0.51`, holds with a
 * clean margin under `'spec'` through 12,000 steps), flip, reverted same day.** With V5,
 * V6, and the recalibrated proxy all holding, the default was flipped again — and
 * `pressureOutlet3d.test.ts`'s M9 empty-tunnel harness went non-finite between step 3000
 * and 3500 under `'spec'`, at `τ₀=0.5000005` — deliberately the actual acceptance-tier
 * near-floor operating point (matching Ahmed/AIJ's real `τ₀≈0.5000042`, not a proxy for
 * it), so this case cannot be recalibrated away the way the cylinder proxy was without
 * defeating the point of the test. `'legacy'` is stable at this exact `τ₀` (confirmed:
 * `rhoMean` grows smoothly to ~1.4 over 6,000 steps, stays finite throughout).
 *
 * Two independent near-floor cases have now destabilized under `'spec'`, and the second is
 * much closer to the real acceptance operating point than anything in the V5/V6 canary
 * set. Reverted to `'legacy'` again.
 *
 * **Task 6.9 is DEFERRED to M6, not merely blocked.** At τ₀→0.5, τ_eff = τ₀ + τ_t and the
 * subgrid model supplies essentially all the stabilizing viscosity — τ₀ itself contributes
 * almost nothing. `'legacy'`'s excess eddy viscosity was, in effect, an accidental
 * stability margin at every near-floor operating point in this codebase simultaneously, not
 * an accuracy error at one of them in isolation. Production Ahmed acceptance runs sit at
 * `τ₀≈0.5000042` — comparably near-floor to the two cases that have already destabilized.
 * Correcting the closure there without first landing a velocity-stable collision operator
 * (M6 — already named by `les.test.ts`'s own comment, for the related under-resolved
 * high-Re instability) removes exactly the margin the current BGK/TRT operator needs to
 * stay finite at that τ₀. The fix belongs in the collision operator, not in this closure's
 * norm convention or in further test recalibration — no further diagnostics or
 * recalibrations on this issue are planned before M6 lands. `'legacy'` stays the default
 * until then. The `lesNorm` A/B infrastructure built across both attempts stays in place so
 * the flip can be re-attempted directly once M6 lands. See docs/VALIDATION.md "Smagorinsky
 * closure A/B" for the full record.
 */
export type LesNorm = 'spec' | 'legacy';

export interface CollideContext {
  lat: LatticeSpec;
  tau0: number;
  collision: Collision;
  /** TRT magic parameter Λ; canonical default 3/16. */
  lambda: number;
  /**
   * Explicit TRT antisymmetric rate ω⁻, overriding the value `lambda` would derive.
   * `undefined` (the default) keeps the derived path bit-identical — see `makeCollideContext`.
   */
  omegaMinus: number | undefined;
  /** Precomputed 18·√2·Cs² (0 = LES off). */
  lesK: number;
  /** Which Π^neq norm `lesK` is paired with. Irrelevant when `lesK === 0`. */
  lesNorm: LesNorm;
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
  /** Output: [rho, ux, uy, uz, tauEff, omegaPlus, omegaMinus]. ux/uy/uz are the PHYSICAL
   * velocity (Guo: moment/ρ + g/2; shift: legacy raw moment/ρ). Indices 0–4 are frozen —
   * `esoteric.ts` and several tests index them positionally; new fields append only. The two
   * rates are the ones the cell ACTUALLY relaxed with, so under LES they carry that cell's
   * per-cell τ_eff, and under BGK they are equal. */
  macro: Float64Array;
}

export function makeCollideContext(
  lat: LatticeSpec,
  opts: {
    tau: number;
    collision?: Collision;
    lambda?: number;
    /**
     * Set ω⁻ directly instead of deriving it from `lambda`. This is a re-parameterization of
     * the SAME two-relaxation-time operator (Ginzburg: Λ = (τ⁺−½)(τ⁻−½)) by τ⁻ rather than by
     * Λ, not an alternative collision operator.
     *
     * It exists because Λ simultaneously sets the antisymmetric rate and the effective
     * bounce-back wall position, so on any scene with a no-slip wall a Λ sweep confounds
     * relaxation with wall placement. Leave it unset for every production configuration: the
     * derived path must stay bit-identical, since every recorded result depends on it.
     */
    omegaMinus?: number;
    lesCs?: number;
    /** See `LesNorm`. Default `'legacy'` — irrelevant when `lesCs` is unset. */
    lesNorm?: LesNorm;
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
  const lesK = opts.lesCs ? lesKFromCs(opts.lesCs) : 0;
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
  if (opts.omegaMinus !== undefined) {
    // Rejected, never clamped: a silently clamped rate would be reported as the requested one
    // and the run would attribute its behaviour to a value it never used. (0, 2) is the
    // interval over which a lattice relaxation rate is dissipative — ω⁻ → 0 leaves the
    // antisymmetric moments unrelaxed, ω⁻ → 2 over-relaxes them to the marginal limit.
    if (!Number.isFinite(opts.omegaMinus) || opts.omegaMinus <= 0 || opts.omegaMinus >= 2) {
      throw new Error(`omegaMinus must be in the open interval (0, 2); got ${opts.omegaMinus}`);
    }
    if (collision !== 'trt') {
      // Not ignorable: under BGK one rate relaxes every moment, so an omegaMinus here would
      // be silently discarded and the run would misreport what it applied.
      throw new Error(`omegaMinus requires collision 'trt'; got '${collision}'`);
    }
  }
  return {
    lat,
    tau0: opts.tau,
    collision,
    lambda: opts.lambda ?? 3 / 16,
    omegaMinus: opts.omegaMinus,
    lesK,
    lesNorm: opts.lesNorm ?? 'legacy',
    regularize: opts.regularize ?? false,
    conserveMass: opts.conserveMass ?? false,
    forcing,
    gx,
    gy,
    gz,
    feq: new Float64Array(lat.q),
    piNeq: new Float64Array(6),
    macro: new Float64Array(7),
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

    // Smagorinsky LES (Hou et al. 1996): τ_eff from ‖Π^neq‖, norm selected by ctx.lesNorm
    // (see LesNorm docstring — 'spec' is docs/PHYSICS.md §5's Frobenius norm, 'legacy' is
    // √2 too large and exists only for reproducibility of pre-fix results). The projection
    // below preserves Π^neq, so τ_eff is identical whether computed before or after
    // regularization (H10 "Ordering vs LES").
    if (ctx.lesK !== 0) {
      const qNorm = ctx.lesNorm === 'spec' ? piNeqNormSpec(p) : piNeqNormLegacy(p);
      tauEff = smagorinskyTauEff(ctx.tau0, ctx.lesK, qNorm, rho);
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
  // TRT: Λ = (τ⁺−½)(τ⁻−½) with τ⁺ = τ_eff, re-derived PER CELL under LES. When `omegaMinus`
  // is set it replaces the derived value outright; when it is unset the derived expression
  // below is evaluated verbatim, so the default path stays bit-identical. Do not "simplify"
  // it into an algebraically-equal rearrangement — see `piNeqNormLegacy`'s docstring for a
  // recorded case where exactly that flipped a marginal stability result.
  const omm =
    ctx.collision === 'trt' ? (ctx.omegaMinus ?? 1 / (0.5 + ctx.lambda / (tauEff - 0.5))) : omp;

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
  // The rates actually applied above, not the ones configuration implies: under LES τ_eff is
  // per-cell, so these vary cell to cell, and under BGK they are equal by construction.
  // near-floor-collision-diagnostics: ω⁻ was previously derived here and discarded, which is
  // why two near-floor reverts could observe a failure and attribute nothing.
  macro[5] = omp;
  macro[6] = omm;
}
