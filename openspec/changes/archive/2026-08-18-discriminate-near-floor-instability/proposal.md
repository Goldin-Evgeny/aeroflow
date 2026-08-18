## Why

The solver ships a Smagorinsky coefficient it has **proven wrong**. `lesNorm` defaults to
`'legacy'`, giving effective `Cs ≈ 0.119` where `docs/PHYSICS.md` §5 specifies `0.1`; the
`'spec'` norm is implemented, tested against an analytic Chapman-Enskog oracle, and not used.
Two attempts to flip the default (2026-08-14) were reverted because near-floor cases went
non-finite — most damningly `pressureOutlet3d.test.ts`'s M9 empty tunnel at `τ₀ = 0.5000005`,
which is the *actual* acceptance operating point, not a proxy for it.

Task 6.9 deferred the flip to M6 and named the blocker precisely: two candidate mechanisms are
on the table and **nothing has separated them**.

- **(A) ω⁻ collapse.** `ω⁻ = 1/(½ + Λ/(τ_eff − ½))` → 0 as `τ₀ → ½`. At the acceptance point
  `ω⁺ ≈ 1.995` against `ω⁻ ≈ 6.6e-3`, so the antisymmetric moments are essentially unrelaxed
  and a period-2 staggered momentum mode goes undamped. D1 established this mode empirically:
  it contaminated every M7 force reading and forced the withdrawal of that table.
- **(B) Projected-regularization anti-dissipation.** D1 records the Latt–Chopard projection as
  anti-dissipative at high wavenumber once `τ₀ → ½` with a mean flow, and `a55f4e1` localizes
  the Ahmed instability there rather than in the lattice.

Both predict the same signature — 2-cell structure, a strain sensor firing on undisturbed
freestream, and *worse* behaviour when `ν_t` is reduced — which is exactly why the two reverts
did not distinguish them. Five tasks are held behind this single unanswered question: 6.9
(the flip), 8.1 and 8.3 (explicitly `HELD` pending "the near-floor mechanism test"), and 8.5/8.6
(gate promotion and removal of the `'legacy'` convention) downstream of those.

**Reading the collision code while scoping this change produced an analytic result that may
settle half the question before a single run.** `collide.ts:388-406`: the projection rebuilds
`f_i = f_i^eq + 4.5 w_i Q_i:Π`, and `Q_i`, `w_i` are both **even** in `e_i`. In exact arithmetic
the non-equilibrium part is therefore purely even, so its antisymmetric component is identically
zero and — as the code's own comment at `:391` states — **`ω⁻` multiplies exactly nothing in a
regularized cell.** Every near-floor acceptance configuration (M9 Ahmed, AIJ, the empty tunnel)
runs `regularize: true`. If the comment is correct, mechanism (A) **cannot** be operating at the
acceptance point, and the whole near-floor pathology there belongs to (B) or to something not
yet named. That is a falsifiable, seconds-long, CPU-only null test — and if it *fails
dynamically*, the kernel does not do what its comment claims, which is a defect worth finding on
its own.

The experiment later qualified the word "exactly" at the implementation level without changing
that conclusion. Separately rounded opposite-direction reconstructions can leave an O(ulp)
antisymmetric residual. The regularized null test remains bit-identical while `ω⁻` stays below
the measured half-ULP activation threshold; at `ω⁻ = 1.0`, populations can differ at roughly
1e-15 while macroscopic diagnostics, stability outcome, and divergence step remain unchanged.
That roundoff-scale effect carries no observed dynamical content and does not reinstate
mechanism (A) for a regularized acceptance configuration.

This change runs the discriminating experiment. It does **not** fix the instability; that
remains M6's velocity-stable collision operator.

## What Changes

- **Expose `ω⁻` as a first-class, reportable, independently-settable quantity.** Today it is
  derived from `Λ` inside `collideCell` and never reported, so the run records that would
  attribute a near-floor failure to it cannot see it. Adds an explicit `omegaMinus` override
  alongside the existing `lambda` parameterization (the same TRT operator, parameterized by
  `τ⁻` instead of by `Λ` — Ginzburg's standard form, not a new algorithm), and reports both
  `ω⁺` and `ω⁻` in the collide context's macro output.
- **Add a zero-strain freestream eddy-viscosity probe.** On an empty tunnel the analytic
  strain rate in the freestream interior is exactly zero, so any `ν_t > 0` there is a pure
  numerical artifact with a known correct answer of 0 — the strongest oracle available for
  this question, and one no benchmark comparison can provide.
- **Run the 2×2×2 discriminating factorial** — `{regularize on/off} × {lesNorm spec/legacy} ×
  {Λ default / ω⁻ raised}` — on the CPU empty tunnel at the acceptance-tier `τ₀`, recording
  finiteness, step-to-divergence, freestream `ν_t/ν_mol`, and the existing
  `strainComparison` audit for each cell of the factorial.
- **Run the ω⁻-inertness null test** described above, as the first and cheapest step.
- Record every configuration under the repo's five-axis run-history doctrine, whichever way
  it comes out.
- **No acceptance band, tolerance, or gate is touched**, and the `lesNorm` default is **not**
  flipped by this change — flipping it remains 6.9's decision, to be taken once the mechanism
  is known.

## Capabilities

### New Capabilities

- `near-floor-collision-diagnostics`: the solver must expose the observables required to
  attribute a near-floor (`τ₀ → ½`) instability to a mechanism — the actual `ω⁺`/`ω⁻` in
  force, an `ω⁻` settable independently of `Λ`, and an eddy-viscosity probe sited where the
  analytic strain is zero. Today `ω⁻` is derived-and-discarded, which is precisely why two
  reverts produced no attribution.

### Modified Capabilities

- `les-subgrid-closure`: adds the requirement that a recorded LES result carry the `ω⁻` and
  freestream-`ν_t` context under which it was obtained, so a near-floor result is
  self-describing rather than needing reconstruction from the commit that produced it.

## Impact

- `packages/core/src/cpu/collide.ts` — `CollideContext` gains `omegaMinus`; `makeCollideContext`
  gains the override; `collideCell` reports `ω⁺`/`ω⁻` in `macro`. The default path
  (`Λ = 3/16`, derived `ω⁻`) must stay **bit-identical** — every recorded result depends on it.
- `packages/core/src/cpu/solver2d.ts`, `solver3d.ts`, `esoteric.ts` — pass the new option
  through; `macro` layout change is internal but touches every reader.
- `packages/core/src/analysis/` — new freestream eddy-viscosity probe, alongside the existing
  `strainComparison.ts`.
- `packages/core/test/` — the null test, the factorial harness, and a bit-identity regression
  pinning the default path.
- **No WGSL change and no GPU run required.** The experiment is CPU-only by construction: the
  empty tunnel reproduces the destabilization at `τ₀ = 0.5000005` within ~3,500 steps on a
  small grid. This is deliberate — it is the cheapest configuration that discriminates, and
  it sidesteps the unrelated D1 Wall-3 hang entirely.
- Downstream: unblocks 6.9, 8.1, 8.3, and thereby 8.5/8.6. Does not itself resolve any of them.
