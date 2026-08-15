# Run 2026-08-15-1620-v12-fetch-rows-control

**Schema v2.** A read-only control re-running the V12 empty-domain fetch gate with the
per-row evidence (`sim`, `ref` at every gated lattice row) attached, which the harness
computed but did not publish. Purpose: decide between three hypotheses for the 66.19% miss
recorded in [2026-08-15-1327-v12-v13-aij-gpu-rerun](2026-08-15-1327-v12-v13-aij-gpu-rerun.md).

No solver code changed. No gate or band changed. The only edits were instrumentation:
`fetchRows` added to the aij test hook, published from `ui/aij.ts`, attached by the spec.

Raw artifact (Playwright JSON, attachments included) in
[artifacts/2026-08-15-1620-v12-fetch-rows-control/](artifacts/2026-08-15-1620-v12-fetch-rows-control/).

---

## 1. Identity

| Field           | Value                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run id          | `2026-08-15-1620-v12-fetch-rows-control`                                                                                                                                          |
| Wall time (UTC) | ≈ 2026-08-15T18:30Z – 18:35Z                                                                                                                                                      |
| Commit          | `9591433`                                                                                                                                                                         |
| Dirty tree      | **yes** — `git diff HEAD` sha256 `5acb2ef27fa0bbed996df27a3549bb4f9cbd53df1f51e42e990a5eebd209c738`                                                                               |
| Command line    | `PLAYWRIGHT_JSON_OUTPUT_NAME=… rtk proxy npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij.gpu.spec.ts -g "acceptance 3" --reporter=json` |
| Hardware        | NVIDIA GeForce RTX 3090; Intel Core i9-12900K; Windows 11 Pro 10.0.26200                                                                                                          |

**Reproduction is exact.** `fetchMaxRel` 66.19%, `driftScaled` 0.00961074995430826 and raw
drift 0.043208923662595135 are bit-identical to the 13:27 run. The instrumentation did not
perturb the result.

---

## 2. Configuration

Unchanged from the 13:27 fetch run: 496×96×178 = 8,473,344 cells, dx 5.0 mm, b = 16,
H = 32 cells, wind 0°, blockage 0.00% (empty domain), τ₀ 0.500223 (LES + regularized),
u_lat 0.08, z0 0.5 m, T_conv 574 steps, cumulative time-mean after a 3-flow-through
transient discard. URL `/?aij`.

Gate: `maxRel = max over y=2..H of |sim[y] − ref[y]| / ref[y]`, bound ≤ 0.05, where `sim` is
the measured windowed mean at the building station and `ref` is the prescribed inlet profile
`s.profile[y]` ([`aijCaseA.ts:274-278`](../../../apps/studio/src/sim/cases/aijCaseA.ts#L274-L278)).

---

## 3. Results

32 gated rows. Per-row deviation and ratio:

| y   | sim       | ref       | sim/ref   | \|sim−ref\|/ref |
| --- | --------- | --------- | --------- | --------------- |
| 2   | 1.1909e-2 | 3.5222e-2 | **0.338** | **0.6619**      |
| 3   | 2.5094e-2 | 3.7144e-2 | 0.676     | 0.3244          |
| 4   | 3.2354e-2 | 3.8633e-2 | 0.837     | 0.1625          |
| 5   | 3.7035e-2 | 3.9780e-2 | 0.931     | 0.0690          |
| 6   | 4.0814e-2 | 4.0586e-2 | 1.006     | 0.0056          |
| 7   | 4.3230e-2 | 4.1392e-2 | 1.044     | 0.0444          |
| 8   | 4.4514e-2 | 4.2198e-2 | 1.055     | 0.0549          |
| 9   | 4.5128e-2 | 4.2899e-2 | 1.052     | 0.0520          |
| 10  | 4.5611e-2 | 4.3494e-2 | 1.049     | 0.0487          |
| …   |           |           |           |                 |
| 31  | 5.559e-2  | 5.510e-2  | 1.009     | 0.0090          |
| 32  | 5.585e-2  | 5.550e-2  | 1.006     | 0.0064          |
| 33  | 5.615e-2  | 5.577e-2  | 1.007     | 0.0070          |

Summary statistics:

| Quantity                       | Value                                      |
| ------------------------------ | ------------------------------------------ |
| Rows exceeding the 5% gate     | **6 of 32** — y = 2, 3, 4, 5, 8, 9         |
| Max deviation over y ≥ 6       | 0.0549 (y = 8)                             |
| Max deviation over y ≥ 10      | 0.0487 (y = 10) — **under the 5% gate**    |
| Near-wall decay, y = 2→6       | 0.6619 → 0.3244 → 0.1625 → 0.0690 → 0.0056 |
| Successive decay ratios        | 0.490, 0.501, 0.425, 0.081                 |
| Sign of the discrepancy, y ≤ 5 | `sim < ref` (measured flow **slower**)     |
| Sign of the discrepancy, y ≥ 6 | `sim > ref` by ≈ 0.6–5.5%                  |

---

## 4. Verdicts

| Axis                        | Value                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **EXECUTION**               | **GREEN** — completed, gate evaluated, per-row evidence now machine-readable, exact reproduction of 13:27   |
| **NUMERICAL_HEALTH**        | **N/A** — this harness reports no non-finite count, mass drift or ledger closure; the axis cannot be scored |
| **STATISTICAL_CONVERGENCE** | **GREEN** — steadiness reached at driftScaled 9.61e-3 in four windows, and reproduced bit-for-bit           |
| **PHYSICS_TARGET**          | **PHYSICS_TARGET_MISS** — 66.19% against the ≤ 5% band. Band unchanged.                                     |
| **PHYSICS_STRUCTURE**       | **CONCERN** — the measured flow is 1/3 of the prescribed profile at the second fluid node; see §5.2         |

---

## 5. Anomalies and hypothesis disposition

### 5.1 H1 (height repair moved `ref` while the flow stayed on the old convention) — FALSIFIED

Stated before the run: if the measured flow still sat at the height the pre-repair mapping
assigned, then

```
maxRel = ref_old/ref_new − 1 = ln(1.025)/ln(1.015) − 1 = 0.658
```

against the observed 0.6619 — a near-exact match, and the reason this hypothesis was
attractive. **The prediction was directional and it is wrong.** H1 requires
`sim/ref ≈ 1.658`, i.e. the measured flow _faster_ than the prescribed profile. The measured
value at y = 2 is `sim/ref = 0.338` — the flow is roughly **three times slower**, not 1.658×
faster.

The agreement between 0.658 and 0.6619 was coincidence: the same magnitude with the opposite
sign, arising from a different mechanism. Recorded explicitly because a numerical
near-coincidence of that quality is exactly the kind of evidence that produces a confident
and wrong mechanism story.

### 5.2 H3 (the gate compares a numerical wall layer against a pointwise analytic profile) — SUPPORTED, not established

The deviation is confined to the near-wall region and decays by almost exactly a factor of
two per row (ratios 0.490, 0.501, 0.425) before crossing `sim/ref = 1` at y = 6. `sim < ref`
throughout that region: the simulated flow is slower than the prescribed profile in the first
~4 cells, which is the direction a no-slip wall produces and which an analytic profile
evaluated pointwise does not know about.

**The entire 66.19% headline is set by one row.** Excluding y ≤ 5 the worst row is 0.0549;
excluding y ≤ 9 the worst is 0.0487, inside the band.

This is consistent with H3 and it is not proof of H3. Not established: whether the near-wall
deficit is physical (a boundary layer that has not recovered the inlet profile over this
fetch distance, which is what the gate is _supposed_ to detect) or numerical (a bounce-back
wall layer that no pointwise profile comparison can match). Those two have opposite
implications for the gate and this run does not separate them.

### 5.3 A second, milder feature above the wall layer

y = 7–10 sit at `sim/ref` ≈ 1.04–1.055, a persistent ~5% _positive_ bias that decays only
slowly (0.0090 by y = 31). It is a different sign and a different length scale from the
near-wall deficit, so it is likely a separate effect. y = 8 and y = 9 exceed the gate on
their own. Recorded; mechanism not established.

### 5.4 `ref` could not be reconstructed from the recorded configuration

Attempting to fit `ref[y]` to `logLawProfile((y−0.5)·dx)` with the page's recorded
z0 = 0.5 m does not reproduce the observed row ratios (`ref[2]/ref[3] = 0.9483` measured,
0.603 predicted), and a power-law fit gives α ≈ 0.11–0.15 rather than 0.25. So the profile
parameters actually in force are **not** the ones this run file records from the page
readout, and no fit is claimed. This is a gap in configuration capture, not a physics
finding — resolving it needs the profile parameters emitted alongside the rows.

### 5.5 The gate was unfalsifiable before this run

The harness computed `sim` and `ref` for all 32 rows, compared them, and published only
`max()`. A miss could have lived in the flow, in the prescribed profile, or in the
row-to-height mapping, and the published metric could not distinguish them — which is why
the 66.19% stood uninterpreted from 13:27 until now. The per-row attachment is retained.

### 5.6 What this run still does not answer

Whether the height-mapping repair changed any of the above. That needs the pre-repair
control, which was **not** run: `packages/core/src/index.ts` entangles the height repair with
the acceptance-band ledger, the LES-norm work and the scene validators, so a parent-commit
revert is a surgical partial revert across 7 files with 66 dirty files at risk, not a
checkout. The cost of that control was misjudged as "5 minutes" when it was proposed.
