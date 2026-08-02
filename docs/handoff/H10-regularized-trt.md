# H10 — Regularized (projected) collision for TRT/BGK

> **Status:** spec authored 2026-07-11 (post-handoff-package; this doc did not exist in
> the 2026-07-08 package because regularization was promoted to an M6 prerequisite only
> after the M5 high-Re stability finding — see the M5 status log and
> M6's "Carried forward from M5" notes). D3Q19 CPU/WGSL/parity landed
> in M6; D2Q9 WGSL + full parity + the original M5 Re=10⁴/10⁵ retry landed 2026-08-01.
>
> **Doctrine:** CPU reference first (this doc → `packages/core/src/cpu/collide.ts` →
> tests), then a 1:1 WGSL transliteration into `stream_collide_3d.wgsl`, then GPU↔CPU
> parity. Never invent the projection math — it is fixed below from the primary source.

## Why

Plain BGK/TRT keeps **all** non-equilibrium content in the populations, including the
higher-order "ghost" moments that carry no hydrodynamics but _do_ carry the numerical
instability that appears when the flow is under-resolved (sharp gradients, high Re). M5
proved this concretely: plain Smagorinsky-TRT overshoots to Ma≈0.5 and diverges to NaN
by Re≈3000 at D=25 (Float64-confirmed). The M6 `?demo3d` cube reproduced it at Re=200 /
D=16 (the field NaNs, then reads back as zero velocity → uniform blue).

**Regularization** (Latt & Chopard 2005) removes exactly those ghost modes: before
relaxing, it _recomputes_ the non-equilibrium populations as the pure projection of the
non-equilibrium momentum-flux tensor onto the second-order Hermite subspace. Everything
outside {ρ, ρu, Π} is discarded each step. Cost is one extra pass over the 19 directions
using the **same** `Π^neq` tensor the Smagorinsky LES model already computes — so LES and
regularization share their one non-trivial reduction.

This is the "recommended first option" of the M6 prerequisite: _projected_ regularization
(a.k.a. RLBM). If a case still fails (very high Re), the escalation is **recursive**
regularization (Malaspinas 2015: also reconstruct 3rd-order Hermite from ρ,u) — deferred
until measured to be necessary. Do not implement recursive first.

## The algorithm (fixed — Latt & Chopard 2005, arXiv:physics/0506157)

Notation matches `packages/core/src/lattice3d.ts`: weights `w_i` (paper's `t_i`),
velocities `e_i` (paper's `v_i`), `c_s² = 1/3`, so `1/(2 c_s⁴) = 4.5`. Greek indices are
physical components x,y,z with summation implied; Latin `i` runs over the 19 directions.

1. Moments and equilibrium — unchanged from the current collision:
   `ρ = Σ_i f_i`, `ρu = Σ_i e_i f_i`, `f_i^eq = w_i ρ (1 + 3(e_i·u) + 4.5(e_i·u)² − 1.5|u|²)`.

2. Non-equilibrium momentum-flux tensor (paper Eq. 2, 6) — symmetric, 6 components in 3D:

   ```
   Π^neq_αβ = Σ_i e_iα e_iβ (f_i − f_i^eq)
   ```

   This is **identical** to `pxx,pyy,pzz,pxy,pxz,pyz` already summed by the LES block.

3. Regularized non-equilibrium populations (paper Eq. 10), with
   `Q_iαβ = e_iα e_iβ − c_s² δ_αβ`:

   ```
   f_i^(1) = (w_i / 2c_s⁴) · Q_iαβ Π^neq_αβ
           = 4.5 w_i · [ e_ix²Πxx + e_iy²Πyy + e_iz²Πzz
                         + 2(e_ix e_iy Πxy + e_ix e_iz Πxz + e_iy e_iz Πyz)
                         − (1/3)(Πxx + Πyy + Πzz) ]
   ```

4. Replace the gathered populations with their regularized form, then run the **existing**
   BGK/TRT relaxation unchanged:

   ```
   f_i ← f_i^eq + f_i^(1)          // regularize in place
   …then collide as usual…         // BGK: f_i += ω⁺(f_i^eq − f_i)  ⇒  f_i^eq + (1−ω⁺)f_i^(1)
   ```

   For BGK this is exactly paper Eq. 12, `f_i^out = f_i^eq + (1−ω) f_i^(1)`. For TRT it is
   the same, because `f_i^(1)` is **even** (`Q_iαβ` is invariant under `e_i → −e_i`, so
   `f_i^(1) = f_opp(i)^(1)`): the antisymmetric part is zero, so `ω⁻` acts on nothing and
   the result is `f_i^eq + (1−ω⁺) f_i^(1)`. We still route through the TRT code path so the
   operator, `Λ`, and the LES `τ_eff` (hence `ω⁺`) are unchanged — regularization is an
   orthogonal pre-step, toggled by a `regularize` flag, composable with BGK|TRT and LES.

**Conservation is exact and free**: `Σ_i Q_iαβ = 0` and `Σ_i Q_iαβ e_i = 0` (paper's
remark under Eq. 12), so `Σ_i f_i^(1) = 0` and `Σ_i e_i f_i^(1) = 0` — regularization
changes neither ρ nor ρu. And `Σ_i e_iα e_iβ f_i^(1) = Π^neq_αβ` — it preserves the
second moment (viscous stress) exactly; only moments ≥ 3 are altered (set to their
projected values).

## Ordering vs LES (important)

`τ_eff` depends on `|Π^neq|`, and the projection **preserves** `Π^neq` (previous
paragraph). So `τ_eff` is identical whether computed before or after regularization.
Compute the `Π^neq` tensor once; use its norm for the Smagorinsky `τ_t → τ_eff → ω⁺`,
then use its components for the Eq. 10 reconstruction. One reduction, two consumers.

## Test oracles (`packages/core/test/collide.test.ts` + a solver-level test)

O1. **Conservation, with `regularize:true`** across {BGK,TRT}×{LES off,on} (unforced):
post-collision `Σf` and `Σ e f` match pre-collision to 13 digits. Proves `Σ Q = Σ Q e = 0`
in code. **Forcing is out of scope for M6 and gated by a throw** — the Guo velocity shift
`u→u+g/2` puts `f^eq`'s momentum at `ρ(u+g/2)` while the populations carry `ρu`; the
projection zeroes `f^(1)`'s momentum and so drops the `−½ρg` the non-equilibrium held,
leaking `½ρg(1−ω)` per step. A force-aware projection is deferred to M7 (3D forces); until
then `makeCollideContext({regularize:true, gravity≠0})` throws (test O1b).

O2. **Ghost-only projection (the analytic identity).** For a generic non-equilibrium
state at τ=0.9 (ω⁺≠1, LES off), let `Δ_i = f_i^{out,reg} − f_i^{out,plain}`. Then
`Δ = −(1−ω⁺)·f^ghost`, so its 0th/1st/**2nd** moments all vanish:
`Σ Δ = 0`, `Σ e_iα Δ = 0`, `Σ e_iα e_iβ Δ = 0` for every α,β — to ~1e-13. This proves
regularization removes **only** the >2nd-order ghost content and leaves {ρ, u, Π}
untouched. This is the doctrine-grade correctness test.

O3. **Equilibrium fixed point.** `f = f^eq ⇒ Π^neq = 0 ⇒ f^(1) = 0`: regularized collide
returns `f^eq` unchanged and `τ_eff = τ₀` (regularization inert at equilibrium).

O4. **LES composition.** With LES on, `τ_eff` (`macro[4]`) is bit-identical with
regularization on vs off (projection preserves `Π^neq`, hence its norm).

O5. **Stability flip (the point of the whole exercise).** The `?demo3d` failure mode in
2D: plain TRT, **LES off**, under-resolved (D=12) at Re=600 where τ≈0.503 sits just off
the 0.5 floor. Only the collision operator differs between the two runs. Plain TRT
diverges to NaN within a few thousand steps (the uniform-blue symptom); `regularize:true`
holds the same scene **finite and subsonic** (`max|u| < 0.3`, measured ≈0.09 ≈ Ma 0.16).
Calibrated boundary: by Re≈1300 with τ→0.5 even regularization diverges — it is a
ghost-mode filter, not a viscosity substitute, so the test stays inside the window where
the operator genuinely decides the outcome.

O6. **V6 non-interference re-run (M6 prerequisite gate).** On a well-resolved steady
laminar case (Re=20 cylinder, the M5 V6 proxy), enabling regularization shifts Cd by
≤3% — ghost modes are negligible when resolved, so regularization must not perturb a
flow it is not needed for. Mirrors the M5 LES V6 test with a `regularize` toggle.

## WGSL mappings

`stream_collide_3d.wgsl` `collide()` gains a `//#ifdef REGULARIZE` block, inserted after
`f_eq` is formed and after the `Π^neq` tensor is summed (reuse the LES tensor), before the
TRT relax: overwrite `f[i] = feq[i] + 4.5*W[i]*(contraction)`. Add `REGULARIZE` to the
`shaderPreprocess.ts` variant matrix alongside `STORAGE_FP16` and `TRT`/`BGK`. Parity:
`?parity3d` must still pass ≤5e-5 with `REGULARIZE` on (CPU reference also regularized) —
it is a transliteration, so the number should be unchanged. Record the parity line in the
commit per H6.

The D2Q9 mapping is the same algorithm without compile-time variants. `lbm2d.wgsl` reads a
`regularize` u32 from the previously padded final slot of its 48-byte uniform. When LES or
regularization is active, it computes Πxx, Πyy, Πxy once; LES consumes its norm, then H10
rebuilds every gathered population as
`f_i = f_i^eq + 4.5 w_i (e_ix²Πxx + e_iy²Πyy + 2e_ixe_iyΠxy − (Πxx+Πyy)/3)` before the
existing BGK/TRT relaxation. `apps/studio/src/dev/parity.ts` sends the same flag to the
shared Float64 D2Q9 oracle and GPU driver.

Real-GPU evidence (RTX 3090, 2026-08-01): all 16 duct/cavity × plain/LES/regularized rows
pass N=10 ≤1e−5 and N=200 ≤1e−4; worst regularized N=200 error is 3.4e−6. With LES + H10,
the canonical M5 D=25/u=0.05 cases at Re=10⁴ and 10⁵ both complete 100,000 steps without
NaN. Direct final-field audits report ρmin 0.9852 / 0.9834, |u|max 0.114 / 0.111, and
τeff,min 0.50038 / 0.50004 respectively.

## Pitfalls

- **The factor is `4.5·w_i`, i.e. `w_i/(2c_s⁴)` with `c_s²=1/3`, not `w_i/(2c_s²)`.** A
  wrong power of `c_s` gives plausible-but-wrong viscous stress. O2's 2nd-moment identity
  catches it (it fails unless the coefficient is exact).
- **Off-diagonals count twice.** The contraction has `2·(e_ix e_iy Πxy + …)` because
  `Π` is symmetric and both αβ and βα appear. Dropping the 2 halves the shear response.
- **Subtract the trace term `−c_s²(Πxx+Πyy+Πzz)`** (the `−c_s²δ_αβ` in `Q`). Omitting it
  breaks conservation (O1) and the equilibrium fixed point (O3).
- **Regularize the gathered (post-stream, pre-collision) `f`, not the equilibrium.**
  `f^(1)` is built from `f − f^eq`; then `f ← f^eq + f^(1)`. Do not also keep the old
  `f^neq` around — it is discarded by construction.
- **Do not add an explicit `ω⁻` term for the regularized part.** `f^(1)` is even; its
  antisymmetric part is identically zero. Routing through the TRT `±` split is fine (it
  yields zero for the odd part) but do not "fix it up" — that would reintroduce ghosts.
- **Recursive regularization is a different (later) algorithm.** This doc specifies the
  projected (2nd-order Hermite) form only. If Re demands more, escalate deliberately.

## References

- **Latt, J. & Chopard, B. (2006).** "Lattice Boltzmann method with regularized
  pre-collision distribution functions." _Math. Comput. Simulation_ 72(2–6):165–168.
  Preprint arXiv:physics/0506157 (2005) — Eqs. (2,4,5,6,10,12) are the spec above. This
  is the sole source for the projection.
- Malaspinas, O. (2015). "Increasing stability and accuracy of the LBM scheme:
  recursive regularization." arXiv:1505.06900 — the _recursive_ escalation (not
  implemented here; reference only).
- Coreixas, C. et al. (2017), _Phys. Rev. E_ 96:033306 — review placing regularized,
  TRT, MRT and cumulant operators in one framework (context; TRT/MRT/cumulant extend the
  stable envelope, per [physics-validation.md](../research/physics-validation.md) §6).
