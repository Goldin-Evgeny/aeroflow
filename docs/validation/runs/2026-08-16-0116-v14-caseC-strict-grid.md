# Run 2026-08-16-0116-v14-caseC-strict-grid

**Schema v2.** V14 AIJ Case C at 270° on the strict third-node grid, run to completion under
the corrected 8-hour budget. `fix-confirmed-physics-defects` task 7.7.

**The run completed and returned a verdict: `q = 0.4583`, a miss against `q ≥ 0.66`.** It
reproduces D1's 2026-07-28 result exactly, under the corrected wall-height mapping.

Raw artifact in [artifacts/2026-08-16-0116-v14-caseC-strict-grid/](artifacts/2026-08-16-0116-v14-caseC-strict-grid/).

---

## 1. Identity

| Field         | Value                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Run id        | `2026-08-16-0116-v14-caseC-strict-grid`                                                                            |
| Wall start    | 2026-08-16T01:16 local (UTC+3)                                                                                     |
| Wall end      | 2026-08-16T07:16 local                                                                                             |
| Wall duration | `wallMs` 21,588,444.8 ms = **5.997 h** (`elapsedMs` 21,071,386.8 = 5.853 h; voxelization 1,778.3 ms)               |
| Commit        | `2c31f81` (harness corrections) — tree otherwise carrying the in-progress change                                   |
| Dirty tree    | **yes**                                                                                                            |
| Command line  | `AEROFLOW_M11_CELLS=190000000 … rtk proxy npx playwright test … aij-urban.gpu.spec.ts -g "V14 Case C" --retries=2` |
| Hardware      | NVIDIA GeForce RTX 3090 (24 GiB); Intel Core i9-12900K; Windows 11 Pro 10.0.26200                                  |

---

## 2. Configuration

| Field                   | Value                                      |
| ----------------------- | ------------------------------------------ |
| Grid                    | 883 × 303 × 701 = **187,543,449 cells**    |
| `requiredCells`         | 183,254,820 (third-node rule) — cleared    |
| `dx`                    | 0.007929767566090647 m                     |
| Direction               | 270°                                       |
| `totalSteps`            | **365,560**                                |
| `averagingFlowThroughs` | 10 (AIJ requires ≥ 10)                     |
| `reportRows`            | 120 / 120 points scored                    |
| `underResolved`         | `false`                                    |
| `resumed`               | `false`                                    |
| Precision               | FP16                                       |
| Checkpoints             | 64 written, 512,292 ms total, last 7.13 GB |

---

## 3. Results

| Metric     | Value                  | Gate                   | Outcome  |
| ---------- | ---------------------- | ---------------------- | -------- |
| `q`        | **0.4583333333333333** | ≥ 0.66                 | **MISS** |
| `r`        | 0.8032441156694273     | (not gated for Case C) | —        |
| `verdict`  | `fail`                 |                        |          |
| `complete` | `true`                 |                        |          |

`q = 0.4583333…` is exactly **55/120**.

### Comparison against D1's recorded strict-grid run (2026-07-28)

| Quantity  | D1 (2026-07-28) | This run    | Agreement   |
| --------- | --------------- | ----------- | ----------- |
| `q`       | 0.458           | **0.4583**  | exact       |
| Steps     | 365,560         | **365,560** | exact       |
| Points    | 120/120         | 120/120     | exact       |
| Wall time | 21,454 s        | 21,588 s    | within 0.6% |

---

## 4. Verdicts

| Axis                        | Value                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **EXECUTION**               | **GREEN** — ran to completion, 64 checkpoints, all 120 points scored, artifacts machine-readable                                       |
| **NUMERICAL_HEALTH**        | **N/A** — the urban harness reports no non-finite count, mass drift or ledger closure                                                  |
| **STATISTICAL_CONVERGENCE** | **GREEN** — 10 averaging flow-throughs, meeting the AIJ ≥ 10 requirement                                                               |
| **PHYSICS_TARGET**          | **PHYSICS_TARGET_MISS** — `q` 0.4583 against ≥ 0.66. Band untouched.                                                                   |
| **PHYSICS_STRUCTURE**       | **RECORDED** — `r` = 0.803 indicates the field correlates well with the fixture while the hit rate does not; not further characterized |

---

## 5. Anomalies

### 5.1 The height repair leaves V14 exactly unchanged

This is the point of task 7.7, and the answer is clean: `q` is **identical** to the
pre-repair value at four decimal places, on an identical step count. Whatever is causing
V14's miss, the wall-height convention is not part of it — consistent with V12 (repair
accounts for ≤ 5% of a 66% miss) and V13 (probe placement untouched by the repair).

All three AIJ tasks now exonerate the height repair independently.

### 5.2 The 8-hour budget was the whole blocker

The run needed 5.997 h against the harness's previous 2 h poll. Every prior attempt was
doomed by arithmetic, not by physics. The corrected budget produced a verdict on the first
completing attempt.

### 5.3 `q` and `r` disagree about the field

`r = 0.803` is a strong correlation, while `q = 0.458` fails badly. A field that tracks the
measurements in shape but misses the ±0.25 tolerance on 65 of 120 points is a different
failure from a field that is uncorrelated. Recorded; not diagnosed. Case C publishes no
per-point vector — the instrumentation added for Case A (`scoreRows`) has no urban
equivalent, so the miss cannot be localized to particular probes or heights.

### 5.4 The stall did not recur on this attempt

The 2026-08-15 21:00 attempt stalled at step 21,090 and the detector caught it. This attempt
ran 365,560 steps with no stall. Combined with D1's history, the hang is intermittent with
at least two confirmed occurrences and at least two clean completions. Root cause remains
unknown; nothing here advances it.

### 5.5 Process anomaly — five GPU hours wasted on a redundant retry

The run was launched with `--retries=2`, added in anticipation of stalls. Playwright retries
on _any_ failure, and a `PHYSICS_TARGET_MISS` is a failing assertion, so attempt 1's valid
completed result immediately triggered a second full ~6 h run of a case whose standing
result was already `q = 0.4583`. That second attempt was killed at 69 min after the
duplication was noticed.

Every input needed to predict this was available at launch: `bands.ts` records V14 as
"currently FAILS at q=0.4583", and the b=24 run minutes earlier had already demonstrated
that a band miss surfaces as a Playwright test failure. The retry flag was chosen without
reasoning about what a retry would retry.

Compounding it, attempt 1's completed result sat on disk from 07:16 and was not noticed for
over an hour, because monitoring checked _whether the process was alive_ rather than _what
it had produced_. Recorded as an `EXECUTION` process finding: retry policy on a known-failing
acceptance case must distinguish infrastructure failure from physics failure, and progress
checks must read results rather than liveness.
