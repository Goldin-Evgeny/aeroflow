## 1. Inventory and measurement (design.md D1, D2)

- [x] 1.1 Snapshot the initial timeout-bearing CPU-test inventory with `rg`; record all 18
      explicit-override files and identify every timed `it(...)` call.
- [x] 1.2 Reuse only qualifying preserved measurements: the per-test idle/load measurements for
      `groundForceContamination.test.ts` and `ahmedForceSampling.test.ts`, plus the enabled
      near-floor factorial run as one idle sample. Record why each reused sample is equivalent.
      **Equivalence:** both heavy files are unchanged from their 2026-08-17 per-test idle/load
      measurements; the enabled near-floor harness is unchanged from committed run `644a750`
      (730.4 s), with the same three blocks, grids, budgets, and environment flag.
- [x] 1.3 Run each timeout-bearing file enough times at idle to reach three per-test samples.
      Use verbose per-test timing; enable the near-floor factorial for its measurements.
      Preserve each enabled factorial execution under the run-history doctrine. Samples 1 and 2
      are 730.4 s (`644a750`), 706.264 s (`ca961f9`), and 704.595 s (`880b55c`).
- [x] 1.4 Run each timed test lacking a qualifying loaded sample once under the bounded 20-core
      synthetic load from design.md D2, with unconditional cleanup of every load worker.
- [x] 1.5 Tabulate per-test idle min/median/max, loaded runtime, worst observed runtime, existing
      timeout, and the D3-derived replacement timeout in a scratch/PR note.
- [x] 1.6 After loaded full-suite verification exposed seven default-5-second failures, add
      `ahmed3d`, `centralMomentEigenProof`, `shearWaveStress`, and `urbanScene`; collect the same
      three idle plus one 20-worker loaded samples and append them to the table.

## 2. Timeout budgets and convention (design.md D3, D4, D7)

- [x] 2.1 Calculate every replacement as
      `ceilTo5s(max(3 × worstMeasured, worstMeasured + 30 s))` and check the arithmetic against
      the measurement table before editing test files.
- [x] 2.2 Update every explicit or newly required timeout override in these 22 files:
      `abl-fetch`, `ahmedForceSampling`, `aijCaseA`, `cavity`, `cylinder-re200-repro`,
      `esoteric`, `fetch-steadiness`, `forceLedger`, `forces2d`,
      `groundForceContamination`, `les`, `nearFloorFactorial`, `pressureOutlet3d`,
      `regularize`, `solver2d`, `solver3d`, `sphere`, and `velocityInlet`, plus `ahmed3d`,
      `centralMomentEigenProof`, `shearWaveStress`, and `urbanScene`.
- [x] 2.3 Above every override, record the worst runtime, UTC measurement date, idle/load
      provenance, formula, and resulting budget. Put the full convention in
      `abl-fetch.test.ts` and point to it from the other 21 files.
- [x] 2.4 Include the recurrence rule in the canonical comment: record the exact test, runtime,
      machine/load, configured budget, and runner error before any future timeout widening.

## 3. Event-loop starvation fix (design.md D5)

- [x] 3.1 Make `groundForceContamination.test.ts`'s timed body async and add a `setImmediate`-
      backed yield to its stepping loop at a measured interval no longer than 15 s.
- [x] 3.2 Apply the same real-event-loop yield to every long stepping loop in
      `ahmedForceSampling.test.ts`, using throughput-derived intervals no longer than 15 s.
- [x] 3.3 Make the near-floor harness's `runArm`/`runFactorial` path asynchronous and yield via
      `setImmediate` every 1,000 solver steps; update callers to await it without changing arms,
      grids, budgets, sampling cadence, assertions, or artifact schema.
- [x] 3.4 Rewrite the three files' stale starvation comments to describe the applied fix and the
      invariant: workloads, assertions, artifact content, and physics results are unchanged.
- [x] 3.5 Run all three starvation-prone files individually and confirm zero
      `onTaskUpdate`/transport errors and unchanged assertion output before proceeding to the
      suite. Preserve the enabled factorial run record and raw artifacts.
- [x] 3.6 Apply measured, real-macrotask yields to the six additional loaded-suite starvation
      sites (`abl-fetch`, `cavity`, `fetch-steadiness`, `forceLedger`, `solver3d`,
      `velocityInlet`) and run
      them individually with unchanged assertion output.

## 4. Verification (design.md D6)

- [x] 4.1 Run all 22 timeout-bearing files individually post-change, with opt-in work enabled,
      and confirm every timed test completes comfortably below its derived budget.
- [x] 4.2 Run `npm test` at idle after the expanded-scope edits; require exit code 0, zero failed
      tests, and zero unhandled
      `[vitest-worker]: Timeout calling "onTaskUpdate"` errors.
- [x] 4.3 Run `npm test` under the same bounded 20-core load; require the same clean result and
      verify all load workers are stopped afterwards.
- [x] 4.4 Diff-review every touched implementation file and confirm only timeout values/comments,
      async markers, and event-loop yields changed—no assertion, tolerance, band, scene, grid,
      step count, solver code, production default, or WGSL change.
- [x] 4.5 Run `npm run lint && npm run typecheck && npm test` at idle; record exact file/test
      counts and confirm all three commands are green. Final gate: 84 files passed, 576 tests
      passed, one opt-in test skipped; lint, typecheck, and Vitest all exited 0.
