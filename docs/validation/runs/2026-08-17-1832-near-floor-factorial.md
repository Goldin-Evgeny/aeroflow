# 2026-08-17-1832 — near-floor mechanism factorial (CPU empty tunnel, τ₀ = 0.5000005)

Discriminating experiment for `openspec/changes/discriminate-near-floor-instability`. Measures
a **mechanism**, not a benchmark: `PHYSICS_TARGET` is `N/A` throughout, and recording a target
verdict here would be a category error.

## 1. Identity

| Field              | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| UTC start          | 2026-08-17T15:32:42Z                                                      |
| UTC end            | 2026-08-17T15:44:52Z                                                      |
| Wall clock         | 730.4 s total (ledger 13.6 s, probe 120.3 s, probe-long 596.5 s)           |
| Commit             | `227afc0` + dirty                                                          |
| Dirty tree         | yes — `git diff HEAD` sha256 `ac89b32c80854fb943a39ea4cb13ee9670df5a76ac4097c86bb46614bb46c65d` (at run start) |
| Schema             | v2 (five axes)                                                            |
| Hardware           | Intel Core i9-12900K, 24 threads, 31.7 GiB, win32 10.0.26200, Node v22.14.0 |
| Precision          | Float64 (CPU reference solver), single-threaded                            |
| Command            | `AEROFLOW_FACTORIAL=1 AEROFLOW_RUN_ID=2026-08-17-1832-near-floor-factorial npx vitest run packages/core/test/nearFloorFactorial.test.ts` |
| Harness            | `packages/core/test/harness/nearFloorFactorial.ts`                        |
| Raw artifacts      | `docs/validation/runs/artifacts/2026-08-17-1832-near-floor-factorial/`     |

Dirty-tree file list at run start:

```
 M packages/core/src/analysis/strainComparison.ts
 M packages/core/src/cpu/collide.ts
 M packages/core/src/cpu/esoteric.ts
 M packages/core/src/cpu/solver2d.ts
 M packages/core/src/cpu/solver3d.ts
 M packages/core/src/index.ts
?? packages/core/src/analysis/freestreamEddyViscosity.ts
?? packages/core/test/freestreamEddyViscosity.test.ts
?? packages/core/test/harness/
?? packages/core/test/nearFloorFactorial.test.ts
?? packages/core/test/nearFloorOmegaMinus.test.ts
?? packages/core/test/relaxationRates.test.ts
?? openspec/changes/discriminate-near-floor-instability/
?? openspec/changes/fix-test-timeout-calibration/
```

None of those edits change the default solver path. The bit-identity regression covering it
(`packages/core/test/relaxationRates.test.ts`) passes, including on the Esoteric path.

### Superseded companion artifact directories

Both were executed, both are preserved, neither is the result:

- `artifacts/2026-08-17-1820-near-floor-factorial/` — D4's literal 2×2×2, probe scene only,
  **pressure outlet**. Superseded: did not reproduce the phenomenon (see §5.1).
- `artifacts/2026-08-17-1825-near-floor-factorial/` — same 2×2×2 with the ledger scene added as
  a reproduction control. That control **failed**, which is what produced the outlet axis.

## 2. Configuration

Verbatim, from `factorial.json`'s `configuration` block:

| Field                 | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| τ₀                    | 0.5000005 (ω = 1/τ₀); ν_mol = (τ₀ − ½)/3 = 1.6666666665295557e-7    |
| Collision             | TRT                                                                |
| Λ (magic parameter)   | 3/16 (default, unchanged in every arm)                             |
| LES                   | Smagorinsky, Cs = 0.1, lesK = 0.25455844122715715                  |
| Forcing               | none (no gravity)                                                  |
| conserveMass          | true (H13)                                                         |
| Inlet velocity        | 0.05 (lattice)                                                     |
| Initial ρ             | 1.0                                                                |
| Free-slip faces       | yMax, zMin, zMax (H11)                                             |
| Ground                | y = 0, no-slip Solid                                               |
| Body                  | **absent** — empty tunnel by construction (D3 requires it)         |
| Probe exclusion       | ledger 2, probe 3 (cells within this of any face are excluded)     |

Scenes:

| Scene    | Dims     | Cells | Step budget    | Purpose                                    |
| -------- | -------- | ----- | -------------- | ------------------------------------------ |
| `ledger` | 10×8×7   | 560   | 6,000          | reproduction control — the grid the effect was recorded on |
| `probe`  | 24×16×14 | 5,376 | 4,000 / 20,000 | sized so a freestream interior survives exclusion |

Factorial axes — **4 axes, 16 arms**, not the 3 axes / 8 arms design.md D4 specified:

| Axis         | Levels                                    |
| ------------ | ----------------------------------------- |
| `outlet`     | `zero-gradient`, `pressure`               |
| `regularize` | on, off                                   |
| `lesNorm`    | `legacy`, `spec`                          |
| `ω⁻`         | derived from Λ (≈ 0.017–0.09), raised to 1.0 |

The outlet axis is a **deviation from D4, added on evidence**, and §5.1 records why.

## 3. Results

Full per-arm records with sample time series: `artifacts/.../factorial.json`. Tabular summary:
`artifacts/.../summary.txt`. Predictions written to `artifacts/.../predictions.json` **before**
the first arm executed.

`ν_t/ν_mol` is the freestream eddy-viscosity probe: the ratio over cells outside the exclusion
distance from every face, where the analytic strain rate — and therefore the analytically
correct `ν_t` — is zero. Values are from the last clean sample; for a diverged arm that is the
last sample **before** divergence, not a post-mortem.

### 3.1 Ledger scene, 10×8×7, budget 6,000 — the reproducing configuration

| outlet | reg | norm   | ω⁻      | outcome        | ν_t/ν_mol p50 | p99     | strain ratio | ω⁺ mean | ω⁻ mean |
| ------ | --- | ------ | ------- | -------------- | ------------- | ------- | ------------ | ------- | ------- |
| zgrad  | on  | legacy | derived | FINITE @6000   | 10 906.4      | 22 811.8 | 6.112        | 1.97636 | 0.03137 |
| zgrad  | on  | legacy | raised  | FINITE @6000   | 10 906.4      | 22 811.8 | 6.112        | 1.97636 | 1.0     |
| zgrad  | on  | spec   | derived | **DIVERGED@3346** | 16 518.0   | 30 971.0 | 5.674        | 1.96813 | 0.04222 |
| zgrad  | on  | spec   | raised  | **DIVERGED@3346** | 16 518.0   | 30 971.0 | 5.674        | 1.96813 | 1.0     |
| zgrad  | off | legacy | derived | DIVERGED@589   | 32 976.2      | 58 180.6 | 5.875        | 1.93555 | 0.08487 |
| zgrad  | off | legacy | raised  | FINITE @6000   | 8 469.4       | 14 981.2 | 5.083        | 1.98036 | 1.0     |
| zgrad  | off | spec   | derived | DIVERGED@382   | 26 379.4      | 102 076  | 4.137        | 1.94157 | 0.07693 |
| zgrad  | off | spec   | raised  | FINITE @6000   | 13 992.7      | 24 632.4 | 6.900        | 1.97004 | 1.0     |
| press  | on  | legacy | derived | FINITE @6000   | 10 826.2      | 22 853.3 | 8.387        | 1.97265 | 0.03627 |
| press  | on  | legacy | raised  | FINITE @6000   | 10 826.2      | 22 853.3 | 8.387        | 1.97265 | 1.0     |
| press  | on  | spec   | derived | FINITE @6000   | 11 516.6      | 20 064.1 | 14.478       | 1.97244 | 0.03655 |
| press  | on  | spec   | raised  | FINITE @6000   | 11 516.6      | 20 064.1 | 14.478       | 1.97244 | 1.0     |
| press  | off | legacy | derived | DIVERGED@806   | 56 698.9      | 120 591  | 4.941        | 1.89583 | 0.13627 |
| press  | off | legacy | raised  | FINITE @6000   | 12 601.4      | 22 504.7 | 6.455        | 1.97185 | 1.0     |
| press  | off | spec   | derived | DIVERGED@351   | 30 562.2      | 101 769  | 3.594        | 1.93156 | 0.08986 |
| press  | off | spec   | raised  | FINITE @6000   | 9 328.8       | 21 388.2 | 4.559        | 1.97857 | 1.0     |

Freestream selection on this scene: **72 surviving cells** of 560 (exclusion 2). That is a weak
statistic and is reported as such — it is why the probe scene exists.

### 3.2 Probe scene, 24×16×14, budget 4,000

| outlet | reg | norm   | ω⁻      | outcome      | ν_t/ν_mol p50 | p99     | strain ratio | ω⁺ mean | ω⁻ mean |
| ------ | --- | ------ | ------- | ------------ | ------------- | ------- | ------------ | ------- | ------- |
| zgrad  | on  | legacy | derived | FINITE @4000 | 5 348.4       | 14 532.5 | 15.447       | 1.98743 | 0.01672 |
| zgrad  | on  | legacy | raised  | FINITE @4000 | 5 348.4       | 14 532.5 | 15.447       | 1.98743 | 1.0     |
| zgrad  | on  | spec   | derived | FINITE @4000 | 5 220.3       | 14 756.4 | 16.318       | 1.98784 | 0.01616 |
| zgrad  | on  | spec   | raised  | FINITE @4000 | 5 220.3       | 14 756.4 | 16.318       | 1.98784 | 1.0     |
| zgrad  | off | legacy | derived | DIVERGED@703 | 12 612.2      | 51 915.1 | 4.594        | 1.96522 | 0.04597 |
| zgrad  | off | legacy | raised  | FINITE @4000 | 4 665.6       | 11 236.7 | 4.484        | 1.98797 | 1.0     |
| zgrad  | off | spec   | derived | DIVERGED@518 | 16 551.6      | 62 901.6 | 4.491        | 1.95284 | 0.06217 |
| zgrad  | off | spec   | raised  | FINITE @4000 | 6 291.3       | 15 670.0 | 5.299        | 1.98509 | 1.0     |
| press  | on  | legacy | derived | FINITE @4000 | 5 331.5       | 14 646.5 | 25.031       | 1.98713 | 0.01711 |
| press  | on  | legacy | raised  | FINITE @4000 | 5 331.5       | 14 646.5 | 25.031       | 1.98713 | 1.0     |
| press  | on  | spec   | derived | FINITE @4000 | 5 105.6       | 14 993.0 | 22.862       | 1.98768 | 0.01638 |
| press  | on  | spec   | raised  | FINITE @4000 | 5 105.6       | 14 993.0 | 22.862       | 1.98768 | 1.0     |
| press  | off | legacy | derived | DIVERGED@697 | 11 654.7      | 52 177.3 | 4.636        | 1.96712 | 0.04346 |
| press  | off | legacy | raised  | FINITE @4000 | 5 530.2       | 11 082.6 | 5.157        | 1.98707 | 1.0     |
| press  | off | spec   | derived | DIVERGED@390 | 11 454.0      | 103 048  | 3.171        | 1.95555 | 0.05831 |
| press  | off | spec   | raised  | FINITE @4000 | 5 841.9       | 16 091.0 | 4.840        | 1.98506 | 1.0     |

Freestream selection: **1,440 surviving cells** (exclusion 3), across ≥ 2 boundary-distance bins.

### 3.3 Probe scene, budget 20,000 (flow-through matched)

Every `regularize: on` arm stayed FINITE through 20,000 steps under **both** norms and both
outlets. Every `regularize: off`, ω⁻-derived arm diverged at the identical step it did at the
4,000 budget (703 / 518 / 697 / 390 — the budget does not affect an early divergence). Every
`regularize: off`, ω⁻-raised arm stayed FINITE through 20,000.

`zgrad reg=on norm=spec` at 20,000: ν_t/ν_mol p50 = 5 441.2, p99 = 14 067.7, strain ratio
17.361, ω⁺ mean 1.98767, ω⁻ mean 0.01639.

### 3.4 Reproduction evidence

The recorded observation being reproduced (from `LesNorm`'s docstring): `'spec'` goes non-finite
**between step 3000 and 3500** at τ₀ = 0.5000005, and `'legacy'` is stable at that τ₀ with
`rhoMean` growing smoothly to **~1.4 over 6,000 steps**.

Both signatures reproduce on the `zgrad reg=on` pair:

- `'spec'` diverged at step **3346** — inside (3000, 3500).
- `'legacy'` `rhoMean` at step 6000 = **1.4098815863895813**, rising smoothly
  (5500 → 1.37783, 5750 → 1.39379, 6000 → 1.40988), max speed steady at 0.0933.
- `'spec'` max speed was steady at ~0.095 through step 2750, reached 0.1015 at 3000, then
  **0.2890 at step 3250** before going non-finite at 3346 — a sharp velocity excursion over the
  final ~300 steps, not a slow drift.

## 4. Verdicts

- **EXECUTION — GREEN.** All 48 arm-executions (16 arms × 3 blocks) completed or terminated
  cleanly with `error: null`. The harness wrote its own machine-readable record
  (`predictions.json` before the run, `factorial.json` + `summary.txt` after) to a committed
  artifact directory. Diverged arms preserved their last clean sample and their divergence step.
- **NUMERICAL_HEALTH — AMBER.** Not green, and the reason is the point of the run: 6 of 16 arms
  on the ledger scene and 4 of 16 on the probe scene went non-finite by design of the
  experiment, which is the measured signal rather than a fault. Where arms stayed finite, ρ
  stayed bounded and positive (`zgrad reg=on legacy`: ρ mean 1.410, max 1.517 at step 6000) and
  no ledger closure violation was observed. Mach stayed low (max speed ≈ 0.093, `Ma ≈ 0.16`)
  in every finite arm. Amber, not green, because the divergences are real non-finite states in
  the recorded configuration.
- **STATISTICAL_CONVERGENCE — N/A.** No statistic here is a time-average or a block estimate.
  The reported quantities are instantaneous field diagnostics at a stated step, and the
  stability outcome is a single binary event per arm. Reporting a convergence verdict would
  imply an averaging procedure that was not performed.
- **PHYSICS_TARGET — N/A.** No acceptance band is involved. This run scores no benchmark, and
  none of its numbers may be read as a validation result.
- **PHYSICS_STRUCTURE — CONCERN.** In a domain with **no body**, where the analytic strain rate
  away from the boundaries is exactly zero, the subgrid closure reports eddy viscosity of order
  5×10³ to 1.6×10⁴ times molecular across the entire freestream selection. The analytically
  correct value there is 0. See §5.3 for the magnitude in absolute terms, which is much less
  dramatic than the ratio, and §6 for what this reading does not establish.

## 5. Observations

Kept deliberately separate from interpretation; §6 holds the readings.

### 5.1 The outlet is a controlling variable for the near-floor `'spec'` destabilization

**Observation.** Run exactly as design.md D4 specified — `{regularize} × {lesNorm} × {ω⁻}`, no
outlet axis — with the pressure outlet, **no `regularize: on` arm destabilizes under `'spec'`
on either scene at any budget up to 20,000 steps.** Switching only the outlet to
`zero-gradient` produces divergence at step 3346 on the ledger scene.

Measured directly, ledger scene, τ₀ = 0.5000005, `regularize: true`, Cs = 0.1:

| outlet         | ρ₀   | `'legacy'`   | `'spec'`      |
| -------------- | ---- | ------------ | ------------- |
| pressure       | 1    | finite @6000 | finite @6000  |
| pressure       | 1.05 | finite @6000 | finite @6000  |
| zero-gradient  | 1    | finite @6000 | DIVERGED@3346 |
| zero-gradient  | 1.05 | finite @6000 | DIVERGED@2942 |

The source of the original observation, `pressureOutlet3d.test.ts`, is an `it.each` over three
cases; only its third uses `outlet: 'zero-gradient'`. The first factorial run took one of the
pressure cases and therefore measured a configuration in which the phenomenon does not occur.

This is an **instrument defect found and corrected**, not a criterion moved: the harness was not
reproducing the phenomenon under investigation, and its numbers were uninterpretable until it
did. The 8-arm pressure-only run is preserved at `artifacts/2026-08-17-1820-.../`.

### 5.2 Under regularization, ω⁻ changes nothing — including the divergence step

**Observation.** `zgrad reg=on norm=spec` diverged at step **3346** at the derived ω⁻ ≈ 0.042
**and** at ω⁻ = 1.0 — the same step, and identical ν_t/ν_mol p50, p99, strain ratio and ω⁺ to
every digit recorded. The same holds for all four `reg=on` arm pairs on all three blocks.

This is the D1 null test holding under the strongest available conditions: not merely at two Λ
values on a stable run, but across a 24× change in ω⁻ on a run that goes non-finite, with the
divergence step itself unmoved.

**Qualification, measured while building the harness and not known when D1 was run.** The
projection is exactly even in `e_i`, but it is reconstructed as `f_i = fl(f_i^eq + 4.5·w_i·Q_i:Π)`
and the two roundings of an opposite-direction pair do not cancel, leaving an O(ulp)
antisymmetric residual that ω⁻ multiplies. On the probe scene at 20 steps this changes **no**
population for ω⁻ ∈ {1e-3, 1e-2, 0.1, 0.5} and changes populations at the 1e-15 relative level
for ω⁻ ∈ {1.0, 1.9} — a threshold at ω⁻ ≈ 1, where `ω⁻ × (½-ulp-scale residual)` first reaches
half an ulp of the population it is added to. D1's Λ sweep could not have exposed this: near the
floor every Λ derives an ω⁻ of order 1e-2. The effect is roundoff-magnitude and carries no
dynamical content — the divergence step is unchanged at ω⁻ = 1.0.

### 5.3 Freestream eddy viscosity, where the analytic answer is exactly zero

**Observation.** Probe scene, 1,440 surviving cells, exclusion distance 3, no body in the
domain: `ν_t/ν_mol` p50 ≈ 5.2–5.4×10³, p99 ≈ 1.4–1.5×10⁴, in every `regularize: on` arm, at
both 4,000 and 20,000 steps. The analytically correct value over this selection is 0.

**The ratio is large mostly because its denominator is tiny, and saying so is part of the
observation.** At τ₀ = 0.5000005, ν_mol = 1.67×10⁻⁷. A ratio of 5,348 is ν_t ≈ 8.9×10⁻⁴, i.e.
τ_eff ≈ 0.5027 against τ₀ = 0.5000005. In absolute terms τ_eff is modest; what the number says
is that **the subgrid model supplies ~99.98% of the total viscosity in a region where the
resolved strain is analytically zero**, not that ν_t is large on any absolute scale.

**A limitation of the oracle on this scene, stated because it bounds the reading.** D3's premise
is that an empty domain has zero freestream strain. This tunnel has a no-slip ground, so a
boundary layer grows and diffuses inward; the exclusion distance is fixed while the layer is
not. With ν_t ≈ 8.9×10⁻⁴, the diffusive thickness √(ν t) is ≈ 1.9 cells at 4,000 steps —
inside the distance-3 exclusion — but ≈ 4.2 cells at 20,000 steps, which **exceeds** it. The
4,000-step probe readings are therefore the defensible ones for this purpose; the 20,000-step
readings are not clean of boundary-layer strain and should not be quoted as pure artifact.

### 5.4 Raising ω⁻ rescues every unregularized arm, and lowers freestream ν_t

**Observation.** All eight `regularize: off`, ω⁻-derived arms diverged (steps 351–806 across
scenes and outlets). All eight `regularize: off`, ω⁻ = 1.0 arms stayed finite to budget
(6,000 or 20,000). Freestream ν_t/ν_mol p50 fell in every case, e.g. ledger `zgrad off legacy`
32 976 → 8 469, `zgrad off spec` 26 379 → 13 993.

### 5.5 Removing regularization makes the near-floor case sharply worse, not better

**Observation.** Ledger, `zgrad`, `'spec'`, derived ω⁻: `regularize: on` diverges at 3346,
`regularize: off` at 382 — **8.8× sooner**. The same ordering holds on `'legacy'` (finite@6000
vs 589), on the pressure outlet, and on the probe scene.

### 5.6 A smaller Smagorinsky coefficient did not lower freestream ν_t

**Observation.** `'spec'` uses a norm √2 smaller than `'legacy'`, i.e. a strictly smaller
closure coefficient. On the probe scene at 4,000 steps with `regularize: on`, freestream
ν_t/ν_mol p50 was 5 348 (`legacy`) vs 5 220 (`spec`) — essentially unchanged, a 2.4% decrease
against a 41% reduction in coefficient. At 20,000 steps `'spec'` is **higher**: 5 441 vs 5 369.

This is consistent in direction with the 6.7b measurement already recorded
(`medianRatio` 2.38 → 2.75, `ν_LES/ν_mol` p50 548.7 → 703.5 under a √2 smaller coefficient) and
is independent evidence for it on a different scene and diagnostic.

## 6. Readings — competing, not settled

Stated as candidate readings. The run establishes the observations in §5; it does not establish
a mechanism, and "recorded, mechanism not established" is the honest summary for the
configuration that matters.

**Against design.md D4's prediction table**, evaluated on the reproducing (`zgrad`) half:

| D4 question                                   | D4: if (A) ω⁻ collapse   | D4: if (B) reg. anti-dissipation | **Observed**                        |
| --------------------------------------------- | ------------------------ | -------------------------------- | ----------------------------------- |
| Raising ω⁻ with `regularize: off`             | stabilizes, ν_t falls    | no effect                        | **stabilizes, ν_t falls** (§5.4)    |
| `regularize: off` at `lesNorm: spec`          | still unstable           | stabilizes                       | **still unstable, 8.8× sooner** (§5.5) |

Both cells read **(A) ω⁻ collapse** — but only for the *unregularized* configuration, which is
not the configuration anything in this repo accepts on.

**The two readings this run leaves standing:**

1. **Two different regimes, and D4's dichotomy does not span the one that matters.** Without
   regularization, ω⁻ collapse is demonstrably the destabilizer (§5.4 — raising ω⁻ rescues all
   eight arms). With regularization — every acceptance configuration — ω⁻ is inert to the
   divergence step itself (§5.2), so (A) is excluded there; and removing the projection makes
   things 8.8× worse (§5.5), so (B) as D4 framed it ("the projection was the cause") is
   contradicted. The `zgrad reg=on spec` divergence at 3346 is therefore attributable to
   **neither standing candidate** — D4's "Neither → a third mechanism is indicated" branch.

2. **The remaining live variable at `reg=on` is the amount of eddy viscosity itself.** The only
   axis that flips stability in the regularized half is the norm (`legacy` finite@6000 vs
   `spec` diverged@3346), with ω⁻ and outlet held fixed. That is consistent with the
   already-recorded deferral rationale in `LesNorm`'s docstring — `'legacy'`'s excess eddy
   viscosity acting as an accidental stability margin at τ₀ → ½ — and this run adds that the
   margin is **not** mediated by ω⁻ and **not** removable by dropping the projection. §5.6
   complicates it: the smaller coefficient did not produce a smaller freestream ν_t, so the
   margin is not a simple monotone function of Cs, and a feedback loop between τ_eff and
   ‖Π^neq‖ is the obvious suspect but is **not** established by anything measured here.

**Not established by this run**, stated explicitly:

- Nothing about GPU behaviour. This is the CPU reference only. The WGSL is a transliteration of
  it, so a mechanism here is a live suspect there, and that is all.
- Nothing about scenes with a body. The probe's oracle depends on an empty domain.
- Nothing about the mechanism of the `zgrad`/`press` difference in §5.1. The outlet was
  established as a controlling variable; **why** a zero-gradient copy-upstream outlet
  destabilizes where a pressure-reconstruction outlet does not is unexamined, and is now the
  single most obvious next experiment.
- Nothing about whether the `lesNorm` default should be flipped. That is
  `fix-confirmed-physics-defects` task 6.9's decision and remains deferred; this run supplies
  evidence, not a verdict.
- The `regularize: off` arms are not a physical configuration anyone runs; they are a control
  used to isolate the projection, and their stability numbers should not be read as a
  recommendation.

## 7. Anomalies

- **A1 — the harness initially did not reproduce the phenomenon.** §5.1. Cause identified
  (outlet), corrected, both superseded artifact sets preserved. Recorded as an `EXECUTION`
  finding against the harness's first two revisions, not against the solver.
- **A2 — ω⁻ = 1.0 is not bit-neutral under regularization, though it is dynamically neutral.**
  §5.2. Mechanism identified as rounding of the projection reconstruction, with the ω⁻ ≈ 1
  threshold measured. This qualifies the spec scenario "Varying the antisymmetric rate under
  regularization changes nothing", which asserts bit-identity without an ω⁻ bound. **The spec
  wording needs amending; it has not been amended.**
- **A3 — the freestream probe's zero-strain premise degrades with run length on a scene with a
  no-slip ground.** §5.3, quantified. The exclusion distance is a fixed parameter while the
  boundary layer is not; a length-aware exclusion, or a scene without a ground, would remove
  the caveat. Not changed here.
- **A4 — vitest emitted `Timeout calling "onTaskUpdate"` unhandled errors** on every long block.
  A reporter RPC timeout, not a solver event; all assertions passed and all artifacts were
  written. Same class as the pre-existing issue tracked by
  `openspec/changes/fix-test-timeout-calibration`.

## ADDENDUM 2026-08-17 — configuration hash

The identity table omitted the run-history doctrine's configuration hash. Appended without
rewriting the original record:

- **Configuration hash (SHA-256):**
  `37c0374441e6f7e1a91c5cf781d6123c5c2a18e9ff67f871e9a09fd2144ded68`
- **Canonical input:** compact UTF-8 JSON with the ordered keys `ledgerScene`, `probeScene`, and
  `probeSceneLongBudget`, whose values are the corresponding `configuration` objects preserved
  verbatim in `artifacts/2026-08-17-1832-near-floor-factorial/factorial.json`.

## ADDENDUM 2026-08-18 — analytic-zero qualification

The raw fixed-distance measurements, including the 20,000-step values in §3.3 and §5.3, are
unchanged. Their interpretation is narrowed: a fixed three-cell exclusion does not prove that
the selected region remains outside the no-slip ground's influence for the full exposure.
The 20,000-step rows are therefore **boundary-contaminated diagnostics**, not analytic-zero
evidence; they must not be quoted as closure activity at zero resolved strain.

The replacement analysis records resolved boundary-influence distance at each sample, uses
the largest supported distance in the selected window, and returns `unavailable` when no cell
survives. The dynamic analytic-zero authority is a fully periodic uniform-flow `Solver3D`
oracle with every cell selected, both closure conventions recorded, and a seeded response
control. This addendum relabels interpretation only; no historical number, artifact, or
verdict axis was deleted or silently rescored.
