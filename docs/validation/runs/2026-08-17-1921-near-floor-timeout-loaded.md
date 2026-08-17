# 2026-08-17-1921 — near-floor factorial timeout calibration, 20-worker load

Enabled loaded timing sample for `nearFloorFactorial.test.ts` under
`fix-test-timeout-calibration`. This repeats the recorded scientific configuration solely to
calibrate the harness timeout and event-loop behavior under bounded CPU contention.

## 1. Identity

| Field | Value |
| --- | --- |
| UTC start | 2026-08-17T19:20:21Z |
| UTC end | 2026-08-17T19:46:30Z |
| Wall clock | 1,566.417 s command; 1,560.206 s timed factorial test |
| Commit | `880b55c` + dirty |
| Dirty tree | yes — PowerShell UTF-8 `git diff HEAD` SHA-256 `74439e778a6c15ac5e1620720f40b42e0be3b92356429ca46034b45c82af5d70` |
| Configuration hash | `37c0374441e6f7e1a91c5cf781d6123c5c2a18e9ff67f871e9a09fd2144ded68` (same canonical three-block configuration as the source run) |
| Schema | v2 (five axes) |
| Hardware | Intel Core i9-12900K, 24 logical processors, 31.7 GiB, Node v22.14.0, plus 20 concurrent PowerShell CPU busy loops |
| Load cleanup | all 20 tracked worker PIDs stopped in `finally`; `LOAD_WORKERS_REMAINING=0` |
| Precision | Float64 CPU reference, single-threaded per arm |
| Command | 20 hidden PowerShell busy-loop workers; `$env:AEROFLOW_FACTORIAL='1'; $env:AEROFLOW_RUN_ID='2026-08-17-1921-near-floor-timeout-loaded'; npx vitest run packages/core/test/nearFloorFactorial.test.ts`; exact-PID cleanup in `finally` |
| Raw artifacts | `docs/validation/runs/artifacts/2026-08-17-1921-near-floor-timeout-loaded/` |

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
 M packages/core/test/forces2d.test.ts
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
  `error: null`; block wall times were 30.220 s, 266.240 s, and 1,263.760 s.
- The timed test passed in **1,560.206 s**. All five file tests passed.
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

**Observation:** the loaded timed test took 1,560.206 s versus the 730.4 s idle worst case, a
2.136x slowdown. The worker reporter again timed out while the workload and artifacts completed.

**Derived timeout:** `ceilTo5s(max(3 x 1,560.206 s, 1,560.206 s + 30 s)) = 4,685 s`.

**Interpretation:** the loaded sample controls the calibrated budget. The repeated transport
failure independently requires periodic real-event-loop yields; a larger test timeout alone
cannot keep the reporter responsive.

**What this run does not establish:** no new mechanism, GPU behavior, acceptance result, or
production-solver conclusion. It is one loaded runtime sample of an already recorded CPU run.
