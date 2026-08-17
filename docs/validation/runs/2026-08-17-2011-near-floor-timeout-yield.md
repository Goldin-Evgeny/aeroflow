# 2026-08-17-2011 — near-floor factorial event-loop-yield verification

Post-change enabled verification for `fix-test-timeout-calibration`: the scientific workload is
unchanged, while `runArm` yields a real `setImmediate` turn every 1,000 solver steps.

## 1. Identity

| Field | Value |
| --- | --- |
| UTC start | 2026-08-17T20:10:20Z |
| UTC end | 2026-08-17T20:22:19Z |
| Wall clock | 718.891 s command; 716.740 s timed factorial test |
| Commit | `be2ea0a` + dirty |
| Dirty tree | yes — PowerShell UTF-8 `git diff HEAD` SHA-256 `fc8d9253b4a3001957fe835cf864426489fc54a6e09fd9cb2327593d570e390a` |
| Configuration hash | `37c0374441e6f7e1a91c5cf781d6123c5c2a18e9ff67f871e9a09fd2144ded68` |
| Schema | v2 (five axes), unchanged |
| Hardware | Intel Core i9-12900K, 24 logical processors, 31.7 GiB, Node v22.14.0, idle |
| Precision | Float64 CPU reference, single-threaded per arm |
| Command | `$env:AEROFLOW_FACTORIAL='1'; $env:AEROFLOW_RUN_ID='2026-08-17-2011-near-floor-timeout-yield'; npx vitest run packages/core/test/nearFloorFactorial.test.ts` |
| Raw artifacts | `docs/validation/runs/artifacts/2026-08-17-2011-near-floor-timeout-yield/` |

Dirty-tree file list at start included the 18 calibrated test files, the near-floor harness,
the untracked OpenSpec changes, and the pre-existing solver/analysis work. The exact dirty diff
is identified by the hash above.

## 2. Configuration and structural change

The three factorial blocks are unchanged: ledger 10x8x7 at 6,000 steps, probe 24x16x14 at
4,000 steps, and long probe 24x16x14 at 20,000 steps, with the same five axes, sampling
intervals, tau0, LES configuration, boundaries, and assertions. The only execution-structure
change is an awaited `setImmediate` every 1,000 solver steps. The calibrated explicit timeout is
4,685 s from the 1,560.206 s loaded worst case.

## 3. Result

- All 48 arm-executions completed or terminated on their designed non-finite signal with
  `error: null`; block wall times were 13.720 s, 120.750 s, and 582.250 s.
- All five file tests passed; the timed factorial test passed in **716.740 s**.
- Vitest exited **0** with zero unhandled errors and zero `onTaskUpdate`/transport errors.
- `summary.txt` is byte-identical to idle sample 3: both SHA-256 hashes are
  `bc24bb42387a80c5d0514e631aa5ab40e36705aca2efb29261e72b72cda2012b`.
- The ledger zero-gradient/regularized/spec arm still diverges at step 3346 and its
  omega-minus-raised null control still does the same; every other terminal summary is also
  unchanged.

## 4. Verdicts

- **EXECUTION — GREEN.** The harness, artifacts, reporter transport, and command exit are clean.
- **NUMERICAL_HEALTH — AMBER.** Designed factorial arms reproduce the same non-finite signal;
  finite arms remain bounded. The scheduling fix changes no numerical result.
- **STATISTICAL_CONVERGENCE — N/A.** No time-averaged statistic is estimated.
- **PHYSICS_TARGET — N/A.** This is a mechanism experiment and harness verification.
- **PHYSICS_STRUCTURE — CONCERN.** The previously recorded freestream eddy-viscosity artifact
  remains present; this run intentionally adds no new scientific interpretation.

## 5. Interpretation

**Observation:** before the macrotask yield, all three idle factorial samples and the loaded
sample passed their assertions but exited 1 with an `onTaskUpdate` timeout. With the yield, the
same artifact summary completes with exit 0.

**Interpretation:** event-loop starvation, not scientific workload failure, caused the reporter
errors. The periodic `setImmediate` fixes transport progress without changing the experiment.

**What this run does not establish:** no new mechanism, GPU behavior, acceptance result, or
production-solver conclusion.
