## Context

See proposal.md — Why. Constraints and facts established while scoping, all read from current
source:

- `collide.ts:411` — `omm = collision === 'trt' ? 1/(0.5 + lambda/(tauEff − 0.5)) : omp`. The
  antisymmetric rate is derived per cell from `Λ` and `τ_eff`, used at `:424`, and never
  written to `ctx.macro` (`:465-470` records `rho, ux, uy, uz, tauEff` only).
- `lambda` is **already** a settable option (`makeCollideContext:307`, `Solver2DOptions`,
  `Solver3DOptions`), defaulting to `3/16`. So `ω⁻` is already indirectly reachable — but `Λ`
  simultaneously sets the effective bounce-back wall position, which is what `3/16` is chosen
  for. Sweeping `Λ` therefore confounds `ω⁻` with wall placement wherever a bounce-back wall
  exists. This is the reason for a direct override rather than reuse of `Λ`.
- `collide.ts:388-406` — the projection writes `f_i = f_i^eq + 4.5·w_i·(Q_i:Π)`. `Q_i` is
  quadratic in `e_i` and `w_i` is even, so `f − f^eq` is **purely even**, its antisymmetric
  part is identically zero, and `dAnti = omm · 0` at `:424`. The code says so at `:391`
  ("Even in i ⇒ the TRT ω⁻ acts on nothing") but nothing tests it.
- `pressureOutlet3d.test.ts:299-321` — an empty-tunnel case at the acceptance-tier operating
  point: `τ₀ = 0.5000005`, `collision: 'trt'`, `les: { cs: 0.1 }`, `regularize: true`,
  `conserveMass: true`, free-slip `yMax/zMin/zMax`, `inletVelocity: 0.05`. Recorded behaviour:
  non-finite between step 3000 and 3500 under `'spec'`; finite through 6000 under `'legacy'`.
  **This is a CPU test on a small grid** — the whole discriminator is affordable here.
- `analysis/strainComparison.ts` already computes `medianRatioSlope` (closure-implied strain
  over finite-difference strain) and `residualByBoundaryDistance`, and is already `lesNorm`-
  aware. 6.7b measured `medianRatio` 2.38 → 2.75 and `ν_LES/ν_mol` p50 548.7 → 703.5 under a
  √2 *smaller* coefficient, which is the observation that rules out a pure rescaling and
  establishes a feedback loop of one kind or the other.

## Goals / Non-Goals

**Goals:**

- Decide whether mechanism (A) can operate at all in the acceptance configuration, analytically
  and then by test.
- Produce a per-configuration record — finite/non-finite, step to divergence, freestream
  `ν_t/ν_mol`, strain-audit ratio — across a factorial that varies the two candidates
  independently.
- Leave `ω⁻` permanently observable and independently settable, so the next near-floor result
  is self-attributing rather than needing this work repeated.

**Non-Goals:**

- **Not fixing the instability.** That is M6's velocity-stable collision operator. This change
  ends with a mechanism identified or explicitly not identified, and nothing in the production
  operator changed.
- **Not flipping the `lesNorm` default.** That is 6.9's decision and it stays deferred; this
  change supplies the evidence 6.9 was waiting on, and takes no position on the flip.
- **Not touching WGSL, and not requiring a GPU run.** The CPU reference is the implementation
  oracle and reproduces the destabilization; the GPU transliteration follows only once a
  production change is actually proposed, which this change does not do.
- Not proposing a replacement collision operator — hard rule 1 requires a published source for
  that, and nothing here reaches for one.

## Decisions

### D1 — Run the ω⁻-inertness null test first, before building anything else

Two runs of the existing regularized empty tunnel, identical but for `Λ` (or the new override)
set to two widely separated values; assert bit-identical populations. Cost: seconds.

The analytic argument in Context says the result must be "identical". Three outcomes, all
informative:

| Outcome | Meaning |
| --- | --- |
| Bit-identical | Mechanism (A) is **excluded** at every regularized operating point, including all acceptance configs. The near-floor pathology there is (B) or unnamed. The remaining factorial shrinks. |
| Differs | The projection does not do what `:391` claims — an implementation defect in the collision core, found for the price of two short runs, and a far bigger finding than the one being chased. |
| Differs only near the floor | Something (conserve-mass correction, fp round-off in the projection) breaks the evenness only in this regime — a third mechanism, and the most interesting outcome of the three. |

Doing this first is the doctrine's "cheapest experiment that discriminates" applied literally:
it can retire half the hypothesis space before any new diagnostic is written.

**Alternative considered:** build the full factorial and read inertness off it. Rejected — the
null test is a strict prerequisite for interpreting the factorial's `ω⁻` axis, and it costs
almost nothing to run separately and first.

### D2 — Add a direct `omegaMinus` override rather than sweeping `Λ`

`Λ` sets both the antisymmetric rate *and* the effective bounce-back wall position. On a scene
with any no-slip wall — the empty tunnel has a ground — a `Λ` sweep moves the wall, so a
stability change could be attributed to either. A direct `ω⁻` override changes exactly one
thing.

The override is a re-parameterization of Ginzburg's two-relaxation-time operator (`Λ =
(τ⁺−½)(τ⁻−½)`), setting `τ⁻` instead of `Λ`. Same operator, same published form — this is
explicitly **not** a new algorithm under hard rule 1.

The default path must stay bit-identical: when `omegaMinus` is unset, `collideCell` must
execute the existing expression unchanged, not an algebraically-equal rearrangement.
`fix-confirmed-physics-defects` task 6.2 records exactly this trap — `√2·√x` for `√(2x)` was
mathematically equal, not IEEE-754 equal, and flipped a marginal stability test.

**Alternative considered:** sweep `Λ` and correct for wall placement analytically. Rejected —
the correction would itself be an unvalidated model sitting between the measurement and the
conclusion.

### D3 — Site the oracle in the freestream of an empty domain

The analytic strain rate of a uniform freestream is exactly zero, so the correct `ν_t` is
exactly zero and any measured value is wholly artifact. This beats every alternative oracle
available here: no acceptance band is involved, no benchmark fixture, no convergence argument,
and the answer does not shift with resolution.

The probe must exclude cells within the boundary-influence distance of inlet, outlet and walls,
where the analytic strain is *not* zero — otherwise it measures the boundary layer and reports
it as artifact. `strainComparison.ts`'s `residualByBoundaryDistance` already establishes the
binning convention to reuse; the exclusion distance is a stated parameter of the probe, and the
excluded count is reported so the selection is auditable.

**Alternative considered:** measure on the Ahmed scene at the acceptance point. Rejected —
there is real strain there, so there is no analytic zero to measure against, and it is
orders of magnitude more expensive.

### D4 — The factorial, and what each cell predicts

`{regularize: on|off} × {lesNorm: legacy|spec} × {ω⁻: derived|raised}` at fixed
`τ₀ = 0.5000005`, on the CPU empty tunnel, to a fixed step budget past the known divergence
point (~3,500), recording per configuration: finite/non-finite, step to divergence, freestream
`ν_t/ν_mol` distribution, and the `strainComparison` ratio.

Predictions stated **before** running, so the result can falsify something:

| If the mechanism is | Then raising `ω⁻` with `regularize: off` | Then `regularize: off` at `lesNorm: spec` |
| --- | --- | --- |
| **(A) ω⁻ collapse** | stabilizes, and freestream `ν_t` falls | still unstable (regularization was not the cause) |
| **(B) regularization anti-dissipation** | no effect on stability | **stabilizes** — the projection was the cause |
| **Both, additively** | partial improvement | partial improvement |
| **Neither** | no effect | no effect — and a third mechanism is indicated |

The `ω⁻: raised` arm is only meaningful in the `regularize: off` half if D1 returns
bit-identical; in the `regularize: on` half it is then a null control, and should be *kept* as
one rather than dropped, because a null that stops being null later is a regression detector.

**Alternative considered:** vary `τ₀` instead, sweeping toward the floor. Rejected as the
*first* experiment — it varies both candidates simultaneously (both degrade as `τ₀ → ½`),
which is the confound this change exists to break. Worth adding afterwards as a confirmation
sweep once a mechanism is indicated.

### D5 — Record the run files even though this is CPU and fast

CLAUDE.md's run-history rule is explicit that it binds runs "of any duration", and this is
precisely the kind of cheap run whose result would otherwise live only in a terminal scroll.
Each factorial cell gets its numbers persisted; the factorial as a whole gets one run file with
the five verdict axes. `PHYSICS_TARGET` is `N/A` throughout — this change measures a mechanism,
it does not score a benchmark, and recording a target verdict here would be a category error.

## Risks / Trade-offs

- **[Risk]** `macro` gains fields, and every reader of `ctx.macro` indexes it positionally. →
  **Mitigation:** append the new fields rather than inserting; pin the existing indices with a
  test that reads `macro[0..4]` on a known cell and compares against the pre-change values.
- **[Risk]** The `omegaMinus` override, threaded through `Solver2D`/`Solver3D`/`EsotericPull3D`,
  could perturb the default path through option-plumbing alone. → **Mitigation:** the
  bit-identity regression in the spec is the gate, and it must cover the Esoteric path
  specifically, since that is what production runs.
- **[Risk]** The empty tunnel at `10×8×7` is too small to have a genuine freestream interior
  after boundary exclusion. → **Mitigation:** size the probe scene independently of the ledger
  scene; report the surviving cell count, and treat an empty selection as a harness failure
  (`EXECUTION` finding), never as "zero artifact measured".
- **[Trade-off]** A CPU-only result does not establish GPU behaviour. Accepted and stated: the
  WGSL is a transliteration of this reference, so a mechanism found here is a live suspect
  there, but confirming it on GPU is separate work this change does not claim.
- **[Risk]** The factorial returns "neither mechanism" and the question stays open. → **This is
  an acceptable outcome, not a failure.** It would rule out both standing candidates, which is
  worth more than the two reverts produced, and "recorded, mechanism not established" is a
  complete answer under the doctrine.

## Migration Plan

No data or schema migration. Order: null test (D1) → `omegaMinus` + reporting with bit-identity
regression (D2) → freestream probe (D3) → factorial (D4) → run files (D5). The null test's
outcome may shrink D4 before it is built, which is why it comes first. Rollback is a plain
revert; nothing in the production default path changes, so no recorded result moves.

## Open Questions

- What exclusion distance makes the freestream selection defensible on this tunnel? Deferrable:
  it is a parameter of the probe, reported with the result, and can be swept cheaply once the
  probe exists. It does not change the specs, the approach, or the task breakdown.
