# Run 2026-08-15-2100-v14-caseC-stall-reproduced

**Schema v2.** V14 AIJ Case C at 270°, strict grid, under the corrected 8-hour budget and a
new 6-minute no-progress detector. `fix-confirmed-physics-defects` task 7.7.

**The run stalled, the detector caught it, and D1's intermittent Case C hang is reproduced.**

Raw artifact in [artifacts/2026-08-15-2100-v14-caseC-stall-reproduced/](artifacts/2026-08-15-2100-v14-caseC-stall-reproduced/).

---

## 1. Identity

| Field         | Value                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Run id        | `2026-08-15-2100-v14-caseC-stall-reproduced`                                                                           |
| Wall duration | 26.9 min — ~21 min of progress, then 6.0 min of no progress before the detector fired                                  |
| Commit        | `9dc2ea9` + uncommitted budget and stall-detector changes                                                              |
| Dirty tree    | **yes**                                                                                                                |
| Command line  | `AEROFLOW_M11_CELLS=190000000 … rtk proxy npx playwright test … aij-urban.gpu.spec.ts -g "V14 Case C" --reporter=json` |
| Hardware      | NVIDIA GeForce RTX 3090 (24 GiB); Intel Core i9-12900K; Windows 11 Pro 10.0.26200                                      |

---

## 2. Configuration

Case C, direction 270°, `AEROFLOW_M11_CELLS = 190,000,000`, 120 report points, FP16, strict
third-node probe rule. The `underResolved` self-skip did not fire, so the grid cleared the
resolution requirement — same as the 2026-08-15 14:50 aborted attempt.

Harness changes in force for this run, both time/instrument corrections and neither a gate:

- `completionTimeoutMs` for Case C: 2 h → **8 h**. The 2 h value came from a "~1.4 h"
  estimate D1 records as falsified; the measured cost is 5.96 h (D1:245).
- **New:** a 6-minute no-progress detector on `totalSteps`, throwing an explicit `STALLED`
  error. D1 credits exactly such a detector (checkpoint-resume, 6-minute threshold) for the
  run that completed.

---

## 3. Results

**No physics result.** `q` was never evaluated.

Harness message, verbatim:

> STALLED: case C made no step progress for 6.0 min at step 21090. This matches the
> intermittent hang recorded in D1 (Wall 3), whose root cause is unknown and which did not
> reproduce on the following run. Reported as an EXECUTION failure, NOT a physics result —
> q was never evaluated.

| Quantity                      | Value                       |
| ----------------------------- | --------------------------- |
| Steps completed before stall  | **21,090**                  |
| Time of healthy progress      | ≈ 21 min                    |
| No-progress interval detected | 6.0 min                     |
| Detector threshold            | 6 min                       |
| Total wall before abort       | 26.9 min (of an 8 h budget) |

---

## 4. Verdicts

| Axis                        | Value                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| **EXECUTION**               | **RED** — the run stalled and could not complete. Detected and reported, not silently absorbed. |
| **NUMERICAL_HEALTH**        | **N/A** — no field diagnostics were read before the stall                                       |
| **STATISTICAL_CONVERGENCE** | **N/A** — no averaging window completed                                                         |
| **PHYSICS_TARGET**          | **N/A** — `q` never evaluated. V14's standing result remains `q = 0.4583` from 2026-07-28.      |
| **PHYSICS_STRUCTURE**       | **N/A**                                                                                         |

---

## 5. Anomalies

### 5.1 D1's intermittent hang is reproduced

D1 (Wall 3) records a Case C hang whose root cause is unknown, and states it **did not
reproduce** on the following run, so no fix was claimed. It now has a second occurrence:

|                    | D1's 2026-07-28 hang                   | This run                   |
| ------------------ | -------------------------------------- | -------------------------- |
| Stalled at step    | 15,466                                 | **21,090**                 |
| Wall time at stall | 928 s (15.5 min)                       | ≈ 21 min                   |
| Signature          | steps and compute duty freeze together | no step progress for 6 min |

Same failure mode, different step count. The 2026-08-15 14:50 aborted attempt is plausibly a
third occurrence — it was killed at ~59 min showing 4–8% GPU duty against the 97–99% a
healthy run holds — though that one was terminated by the operator rather than detected, so
it cannot be counted as confirmed.

**On this evidence the hang is not rare.** D1's "did not reproduce" was one clean run, not a
demonstration of rarity. Root cause remains unknown and nothing here establishes one.

### 5.2 The detector converted an 8-hour burn into a 27-minute finding

This is the first Case C attempt where a stall was _detected_ rather than inferred after the
fact. Under the previous harness the same event would have consumed the full budget and
reported an uninformative timeout — which is what the 14:50 attempt was heading for before
it was killed manually.

The correction that made the long budget safe and the correction that made it long are the
same size and landed together, which is the point: raising a budget without stall detection
would have made this failure mode more expensive, not less.

### 5.3 The detector cannot distinguish a stall from a very slow phase

It fires on 6 minutes of no `totalSteps` progress. A legitimate phase that advances no steps
for longer — a long checkpoint write, an unusually slow scoring pass — would be reported as
a stall. Nothing observed here suggests that happened (21 min of steady progress preceded
it), but the detector's false-positive mode is stated rather than assumed absent.

### 5.4 No physics is claimed, and task 7.7 remains unmet

V14's standing result is unchanged: `q = 0.4583` against `q ≥ 0.66`, from the 2026-07-28
strict-grid run. This run adds nothing to the physics record and does not change that verdict
in either direction.
