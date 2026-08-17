# 2026-08-17-1848 — near-floor factorial timeout calibration, idle sample 3

Third enabled idle timing sample for `nearFloorFactorial.test.ts` under
`fix-test-timeout-calibration`. This repeats the recorded scientific configuration solely to
calibrate the harness timeout and event-loop behavior.

## 1. Identity

| Field | Value |
| --- | --- |
| UTC start | 2026-08-17T18:48:17Z |
| UTC end | 2026-08-17T19:00:10Z |
| Wall clock | 706.973 s command; 704.595 s timed factorial test |
| Commit | `ca961f9` + dirty |
| Dirty tree | yes — `git diff HEAD` SHA-256 `06a2c1840d3213d844cf09a323a1eb05841bf9a0f89e1bf22cff4881f64b7aef` |
| Configuration hash | `37c0374441e6f7e1a91c5cf781d6123c5c2a18e9ff67f871e9a09fd2144ded68` (same canonical three-block configuration as the source run) |
| Schema | v2 (five axes) |
| Hardware | Intel Core i9-12900K, 24 logical processors, 31.7 GiB, Node v22.14.0, idle |
| Precision | Float64 CPU reference, single-threaded per arm |
| Command | `$env:AEROFLOW_FACTORIAL='1'; $env:AEROFLOW_RUN_ID='2026-08-17-1848-near-floor-timeout-idle3'; npx vitest run packages/core/test/nearFloorFactorial.test.ts` |
| Raw artifacts | `docs/validation/runs/artifacts/2026-08-17-1848-near-floor-timeout-idle3/` |

Dirty-tree file list at start:

```text
 M docs/VALIDATION.md
 M docs/decisions/D1-resolution-wall.md
 M openspec/changes/archive/2026-08-16-fix-confirmed-physics-defects/tasks.md
 M packages/core/src/analysis/strainComparison.ts
 M packages/core/src/cpu/collide.ts
 M packages/core/src/cpu/esoteric.ts
 M packages/core/src/cpu/solver2d.ts
 M packages/core/src/cpu/solver3d.ts
 M packages/core/src/index.ts
?? .codex/
?? openspec/changes/discriminate-near-floor-instability/
?? openspec/changes/fix-test-timeout-calibration/
?? packages/core/src/analysis/freestreamEddyViscosity.ts
?? packages/core/test/freestreamEddyViscosity.test.ts
?? packages/core/test/harness/
?? packages/core/test/nearFloorFactorial.test.ts
?? packages/core/test/nearFloorOmegaMinus.test.ts
?? packages/core/test/relaxationRates.test.ts
```

## 2. Configuration

The three `configuration` objects are preserved verbatim in `factorial.json` and hash to the
value above. Human-readable expansion:

| Field | Value |
| --- | --- |
| tau0 / molecular viscosity | 0.5000005 / 1.6666666665295557e-7 |
| Collision / Lambda | TRT / 3/16 |
| LES | Cs=0.1, lesK=0.25455844122715715; `legacy` and `spec` arms |
| Regularization / omega-minus | on/off; derived and explicitly raised to 1.0 |
| Outlet | zero-gradient and pressure |
| Inlet / initial density | velocity 0.05 / rho=1.0 |
| Mass correction | `conserveMass: true` |
| Boundaries | no-slip ground; free-slip yMax, zMin, zMax; no body |
| Ledger block | 10x8x7 = 560 cells; 6,000 steps; sample interval 250; exclusion 2 |
| Probe block | 24x16x14 = 5,376 cells; 4,000 steps; sample interval 250; exclusion 3 |
| Long probe block | 24x16x14 = 5,376 cells; 20,000 steps; sample interval 1,000; exclusion 3 |

## 3. Result

- All 48 arm-executions completed or terminated on their designed non-finite signal with
  `error: null`; block wall times were 13.279 s, 117.363 s, and 573.950 s.
- The timed test passed in **704.595 s**. All five file tests passed.
- Vitest nevertheless exited 1 with one unhandled
  `[vitest-worker]: Timeout calling "onTaskUpdate"` error.
- Scientific metrics reproduced the source run exactly to the digits in `summary.txt`, including
  the ledger zero-gradient/regularized/spec divergence at step 3346 and omega-minus-raised null
  control at the same step. Every per-arm metric and sample series is retained in
  `factorial.json`; `summary.txt` contains all 48 terminal summaries.

## 4. Verdicts

- **EXECUTION — AMBER.** The harness completed and persisted machine-readable artifacts, but
  Vitest's worker transport timed out and made the command exit non-zero.
- **NUMERICAL_HEALTH — AMBER.** Designed factorial arms went non-finite; finite arms remained
  bounded. This repeats the measured signal rather than introducing a new failure.
- **STATISTICAL_CONVERGENCE — N/A.** No time-averaged statistic is estimated.
- **PHYSICS_TARGET — N/A.** This is a mechanism experiment and timeout calibration sample.
- **PHYSICS_STRUCTURE — CONCERN.** The repeated zero-strain freestream eddy-viscosity artifact
  remains present; this run adds no new interpretation.

## 5. Calibration interpretation

**Observation:** the three idle timed-test samples are 730.4 s, 706.264 s, and 704.595 s. This
sample again starved Vitest's worker transport while its assertions and artifact generation
completed successfully.

**Interpretation:** the idle baseline is repeatable enough to calibrate from its 730.4 s worst
case. The transport error is independent evidence that the long synchronous loop needs a real
event-loop yield; merely raising the test timeout cannot resolve reporter starvation.

**What this run does not establish:** no new mechanism, GPU behavior, acceptance result, or
production-solver conclusion. It is one idle runtime sample of an already recorded CPU run.
