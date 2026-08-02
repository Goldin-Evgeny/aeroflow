# H1 — TRT collision, Smagorinsky LES, and Guo forcing: executable specification

> **Handoff doc.** Milestones: M2 (TRT), M5 (LES). Upgrades
> `packages/core/src/cpu/solver2d.ts` first (CPU oracle + tests), then the WGSL kernel
> is a transliteration gated by the parity panel (`H6-parity-panel.md`). Math sources:
> `docs/PHYSICS.md` §3–§6; everything is restated here with implementation-level
> precision so this file alone suffices.

## 1. API changes to `Solver2D` (backward compatible)

```ts
export interface Solver2DOptions {
  // ...existing options unchanged...
  /** Collision operator. Default 'bgk' (current behavior). */
  collision?: 'bgk' | 'trt';
  /** TRT magic parameter. Default 3/16. Only used when collision === 'trt'. */
  lambda?: number;
  /** Smagorinsky LES. Off when undefined. cs ≈ 0.1. */
  les?: { cs: number };
  /** Body-force scheme. Default 'guo' WHEN gravity is nonzero. 'shift' = legacy. */
  forcing?: 'guo' | 'shift';
}
```

Keep the existing tests green: the current Poiseuille BGK test (2% gate) passes under
Guo forcing too (it gets _more_ accurate). The mass-conservation and tunnel tests are
forcing-independent.

**Structure requirement:** extract the per-cell collision into a standalone function
(e.g. `collideCell(f, ctx) → fOut` in a new `src/cpu/collide.ts`) so `Solver3D` and
`EsotericPull3D` (H3/H4) can share the exact same code object — bit-identity in H4
depends on identical floating-point operation order.

## 2. TRT collision (PHYSICS.md §4, implementation form)

Given post-streaming `f[i]`, macroscopic `ρ, u` (per §4 below), and equilibria
`feq[i] = equilibrium(i, ρ, u)`:

```
ωp = 1/τ_eff                                  // "omega plus": carries viscosity
ωm = 1 / (0.5 + λ / (τ_eff − 0.5))            // "omega minus" from Λ = (τp−½)(τm−½)

// rest direction (purely symmetric):
fOut[0] = f[0] − ωp·(f[0] − feq[0])

// pairs (a, b = opp(a)), iterate a where a < opp(a):
fp  = 0.5·(f[a] + f[b]);   fm  = 0.5·(f[a] − f[b])      // f⁺, f⁻ for direction a
ep  = 0.5·(feq[a] + feq[b]); em = 0.5·(feq[a] − feq[b])
fOut[a] = f[a] − ωp·(fp − ep) − ωm·(fm − em)
fOut[b] = f[b] − ωp·(fp − ep) + ωm·(fm − em)             // NOTE the sign flip on ωm
```

- D2Q9 pairs: (1,3), (2,4), (5,7), (6,8). D3Q19 pairs: (1,2), (3,4), … (17,18).
  Derive them from `opp[]` at construction — never hardcode both tables.
- BGK is the special case ωm = ωp (useful debug identity: TRT with λ = (τ−½)² must
  reproduce BGK bit-for-bit — make this a unit test).
- **Why Λ = 3/16**: places the halfway bounce-back wall exactly midway between nodes
  independent of viscosity → Poiseuille becomes exact (the τ-independence test in §6
  is the check). Λ is a _default_, not a constant — keep it a parameter.

## 3. Smagorinsky LES (PHYSICS.md §5, implementation form)

Computed per cell, **from pre-collision f and the same feq used for collision**,
BEFORE the relaxation rates are used:

```
// 2D: three independent components (3D: six — xx, yy, zz, xy, xz, yz)
Pxx = Σ_i ex[i]·ex[i]·(f[i] − feq[i])
Pyy = Σ_i ey[i]·ey[i]·(f[i] − feq[i])
Pxy = Σ_i ex[i]·ey[i]·(f[i] − feq[i])
Q   = sqrt( 2·(Pxx² + Pyy² + 2·Pxy²) )       // ‖Π‖ = √(2 Π:Π); off-diagonals count TWICE
                                              // 3D: 2·(Pxx²+Pyy²+Pzz² + 2·(Pxy²+Pxz²+Pyz²))
tau_t   = 0.5·( sqrt(tau0² + 18·sqrt(2)·cs²·Q / ρ) − tau0 )
tau_eff = tau0 + tau_t                        // ALWAYS ≥ tau0 > 0.5 — assert, never clamp
```

Then §2 runs with `τ_eff` — and **ωm is recomputed from τ_eff per cell** so Λ = 3/16
holds cell-by-cell. (Recomputing ωm from a stale τ0 is a classic silent bug.)

Notes:

- With LES off or in uniform equilibrium flow, `Π ≡ 0 ⇒ τ_eff ≡ τ0` (unit test).
- Constant-convention drift exists in the literature for the 18√2 factor; our
  convention is fixed here and guarded by the V6 gate (LES-on shifts laminar cylinder
  St/Cd by ≤ 3%), not by trusting any one paper's typography.

## 4. Guo forcing — and why the current 'shift' forcing must be replaced for TRT

**The trap this section exists to prevent:** the current solver uses shifted-velocity
forcing (`u_eq = u + τ·g/ρ`). Its discrete error carries a **τ-dependent term** — the
equilibrium is evaluated at a velocity displaced by τ·g, which perturbs the
non-equilibrium stress by O(τ·g·u). Estimate for the channel test: relative profile
error ~ 8·τ·ν/H² ≈ 1.3e-3 at τ=1.5, H=8 — an order of magnitude above the 1e-4 gate.
So with 'shift' forcing, **TRT's τ-independence is destroyed by the forcing scheme even
when the collision is perfect**, and a debugging session that doesn't know this will
"fix" the wrong component. Keep 'shift' only as a legacy option for the old test's
semantics.

**Guo, Zheng & Shi 2002** (Phys. Rev. E 65:046308) is the standard cure:

```
// Macroscopic velocity INCLUDES the half-force correction:
u = (Σ_i e_i·f[i]) / ρ + g/2                  // g = acceleration; force density F = ρg
                                               // (the +g/2 does NOT divide by ρ twice: +F/(2ρ) = +g/2)

feq[i] = equilibrium(i, ρ, u)                  // at the CORRECTED u, not the raw moment

// Source term, BEFORE relaxation factors:
S[i] = w[i] · ( 3·((e_i − u)·g) + 9·(e_i·u)·(e_i·g) ) · ρ

// BGK:   fOut[i] = (collision per §2 with ωm=ωp) + (1 − ωp/2)·S[i]
// TRT:   split S like f:  Sp = ½(S[a]+S[b]),  Sm = ½(S[a]−S[b])
//        fOut[a] += (1 − ωp/2)·Sp + (1 − ωm/2)·Sm
//        fOut[b] += (1 − ωp/2)·Sp − (1 − ωm/2)·Sm
//        rest:   fOut[0] += (1 − ωp/2)·S[0]        // S[0] = w0·(3·(−u·g))·ρ
// Under LES: the ω in these prefactors is the EFFECTIVE ω (from τ_eff).
```

Reported macroscopics (`macroscopics()`) must return the corrected `u` when forcing is
'guo' (and the legacy raw+shift behavior under 'shift' — do not change existing
semantics silently).

**Exact momentum bookkeeping (used by H2's identity test):** per cell per step, the
collision+source updates add momentum
`Σ_i e_i·(1−ω⁻/2)·S_i = (1−ω⁻/2)·ρg` from the source (the symmetric part carries no
momentum) **plus** `ω⁻·ρg/2` because the equilibria are evaluated at `u + g/2` (the
antisymmetric non-equilibrium relaxation pulls the momentum moment toward ρ(u+g/2)).
Total: `(1−ω⁻/2)·ρg + ω⁻·ρg/2 = ρg` — **exactly**, for any τ, any Λ, LES on or off.
This exactness is what makes the global force-balance identity test (H2 §4) a
machine-precision oracle rather than an approximate check.

## 5. Recommended implementation order (per commit, tests green after each)

1. Extract `collideCell()` (pure refactor, zero behavior change — existing tests are
   the gate).
2. Add Guo forcing + corrected macroscopics; keep default behavior for existing tests
   ('shift' stays default only if you must; better: switch default to 'guo' and
   confirm the old 2% Poiseuille test still passes — it will, with margin).
3. Add TRT (+ the TRT≡BGK-at-λ=(τ−½)² unit test).
4. Add the τ-independence test (§6) — the moment of truth for 2+3 together.
5. Add LES (+ §3 unit tests + V6 gate when M4 exists).
6. WGSL transliteration (uniforms: `collision: u32`, `lambda: f32`, `lesCs: f32`);
   gravity/forcing is NOT needed in the GPU tunnel kernel today (no body force in the
   app) — document the omission in the shader header. Gate on the parity panel (H6)
   with TRT and LES toggled on/off.

## 6. Test specifications (exact)

**T1 — TRT τ-independence (validation gate V1, the headline test).**
Body-force channel: nx=4, ny=10 (H = ny−2 = 8), periodicX, walls = solid rows 0 and 9,
collision 'trt', λ=3/16, forcing 'guo'. For each τ ∈ {0.51, 0.6, 0.8, 1.0, 1.5}:

- ν = (τ−½)/3; choose g so the profile peak is grid-independent-small:
  `g = 8·ν·u_target/H²` with `u_target = 0.02` (keeps Ma error below the gate at every τ).
- Run to convergence: |Δu_center|/u_center < 1e-13 between checks 500 steps apart
  (cap 400k steps; at τ=0.51 expect ~O(10⁵)).
- Analytic: `u(y_j) = g·y_j·(H−y_j)/(2ν)`, `y_j = j − 0.5` for fluid rows j = 1…H.
- **Gate: max_j |u_sim − u_analytic| / u_max ≤ 1e-4 for EVERY τ** (expect ~1e-9;
  the loose gate absorbs float noise, not physics error).
- Also run the same sweep with collision 'bgk': assert the error **grows** with τ and
  exceeds 1e-4 at τ=1.5 — this proves the test can detect the failure TRT fixes
  (a test that can't fail is not a test).

**T2 — TRT reduces to BGK** at λ=(τ−½)²: identical fOut to BGK, `toBe` exact, one cell,
several random f states (hardcoded literals).

**T3 — LES inertness**: uniform equilibrium flow ⇒ τ_eff ≡ τ0 (exact); Poiseuille T1
with LES on still passes 1e-4 (laminar shear produces tiny τ_t; if this fails the
contraction factor-2 is the first suspect).

**T4 — LES activity**: in a sheared state (hardcoded non-equilibrium f), τ_eff > τ0
and increases monotonically with cs.

**T5 — Guo momentum bookkeeping**: single fluid cell, one collision step, assert
`Σ e·fOut − Σ e·f = ρg` to 1e-14 (per the §4 derivation), for BGK and TRT, LES on/off.

## 7. Pitfalls

1. ωm sign flip on the b-member of the pair (§2 last line) — symptom: Poiseuille
   diverges only for TRT.
2. Recomputing ωm from τ0 instead of τ_eff under LES (§3).
3. LES moments from post-collision f, or against a different feq than collision uses.
4. Missing factor 2 on off-diagonal Π components in Q.
5. Guo: forgetting the +g/2 in u, or applying it twice (once in u, once in feq shift —
   Guo uses NO feq shift; the shift belongs to the legacy scheme only).
6. Guo prefactor uses (1 − ω/2), not (1 − 1/(2ω)) — dimension check: ω ∈ (0, 2).
7. Testing τ-independence with 'shift' forcing and concluding TRT is broken (§4).
8. Λ hardcoded as 0.1875 in one place and 3/16 in another — single constant, exported.

## References

- TRT: Ginzburg, Verhaeghe & d'Humières 2008; wall-exactness at Λ=3/16:
  arXiv:2009.04604 (see `docs/research/physics-validation.md` for the digest trail).
- LES: Hou, Sterling, Chen & Doolen 1996; τ_t form as in the Sailfish paper
  (arXiv:1311.2404).
- Forcing: Guo, Zheng & Shi, Phys. Rev. E 65:046308 (2002).
