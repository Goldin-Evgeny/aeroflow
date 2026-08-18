> **RESUMED 2026-08-17 after `discriminate-near-floor-instability`.** The original nine-file
> survey was stale before implementation began: `ahmed3d.test.ts` was a false grep match, while
> additional timeout overrides already existed and the near-floor change added another. The
> governing spec always said the suite must not fail solely from timeout miscalibration. The
> first loaded full-suite verification exposed seven default-5-second failures in four more
> files plus six additional reporter-starvation sites. The inventory is therefore 22 files,
> with per-file calibration still performed in isolation.
>
> **Measurements already taken remain evidence and are not re-purchased when the test and
> machine configuration are unchanged.** Reference box, 24 logical cores, 2026-08-17,
> `npx vitest run <file>`:
>
> | File | idle worst | under 20-core load | configured budget | headroom under load |
> | --- | ---: | ---: | ---: | ---: |
> | `groundForceContamination.test.ts` | 160.7 s | **284.6 s** | 300 s | **5.1%** |
> | `ahmedForceSampling.test.ts` | 92.6 s | 166.2 s | 600 s | 72% |
> | `esoteric.test.ts` | 20.1 s (file) | not measured | 30 s/test | — |
> | `abl-fetch.test.ts` | 19.6 s (file) | not measured | 30–60 s/test | — |
> | `velocityInlet.test.ts` | 13.6 s (file) | not measured | 30 s/test | — |
> | `pressureOutlet3d.test.ts` | 9.3 s (file) | not measured | 30–60 s/test | — |
> | `solver2d.test.ts` | 8.2 s (file) | not measured | 30 s/test | — |
> | `sphere.test.ts` | 6.5 s (file) | not measured | 30 s/test | — |
>
> Both original heavy files reproduced `[vitest-worker]: Timeout calling "onTaskUpdate"` on
> every idle and loaded run. Enabled near-floor idle sample 2 then identified a third starvation
> site: all 5 tests and 48 arms passed in 706.264 s, but Vitest exited 1 with one identical
> transport error. The run and raw artifacts are committed as `ca961f9`.

## Why

`npm test` can exit non-zero even when every assertion passes. Two harness defects are known:

1. CPU physics tests carry per-test timeout budgets that were chosen without traceable runtime
   measurements and, in at least one case, leave only 5.1% headroom under ordinary contention.
2. Nine tests can perform long stretches of unbroken synchronous CPU work under loaded-suite
   contention, starving Vitest's worker transport until birpc's `onTaskUpdate` RPC times out.

These fail loud rather than corrupting a physics result, but they make the repository's required
pre-commit gate unreliable. Correcting the instrument is not weakening a criterion: no physics
assertion, tolerance, scene, acceptance band, or production path changes.

## What Changes

- Inventory and calibrate every current CPU test timeout override from recorded measurements.
  Reuse valid measurements above; collect missing idle and synthetic-load measurements.
- Set each timeout to `max(3 × worstMeasured, worstMeasured + 30 s)`, rounded up to 5 s, and
  record the measurement and rule at its call site.
- Make all nine starvation-prone harnesses yield through a real Node event-loop turn at
  intervals no longer than 15 s. A microtask-only `await Promise.resolve()` is explicitly not
  sufficient because it can continue starving timer and IPC phases.
- Document the calibration and recurrence rules at the point of use.

## Capabilities

### New Capabilities

- `test-timeout-calibration`: CPU test timeout budgets are measurement-derived and CPU-bound
  tests service the runner transport often enough for a clean, reliable suite result.

### Modified Capabilities

(none)

## Impact

- Timeout calibration covers 22 files: the original 18 plus `ahmed3d`,
  `centralMomentEigenProof`, `shearWaveStress`, and `urbanScene`, whose default 5 s watchdogs
  failed during the required loaded full-suite gate. The opt-in near-floor run is calibrated in
  its enabled mode; its ordinary skipped state is not a runtime measurement.
- `groundForceContamination`, `ahmedForceSampling`, the near-floor factorial, `cavity`,
  `fetch-steadiness`, `forceLedger`, `solver3d`, `velocityInlet`, and `abl-fetch` gain asynchronous,
  macrotask-level yields without changing grids, steps, assertions, factorial arms, or results.
- No `packages/core/src/**`, WGSL, Vitest global timeout, dependency, physics criterion, or
  production default changes.
