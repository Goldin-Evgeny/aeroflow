## Context

See proposal.md for motivation and the preserved measurements. The root `vitest.config.ts` has
no global `testTimeout`; CPU physics tests opt into longer budgets at their `it(...)` call
sites. The initial inventory found 18 files with explicit overrides. Loaded full-suite
verification then proved seven default-5-second tests also require calibrated overrides, in
four additional files:

`abl-fetch`, `ahmedForceSampling`, `aijCaseA`, `cavity`, `cylinder-re200-repro`, `esoteric`,
`fetch-steadiness`, `forceLedger`, `forces2d`, `groundForceContamination`, `les`,
`nearFloorFactorial`, `pressureOutlet3d`, `regularize`, `solver2d`, `solver3d`, `sphere`, and
`velocityInlet`, plus `ahmed3d`, `centralMomentEigenProof`, `shearWaveStress`, and `urbanScene`
under `packages/core/test/`. `nearFloorFactorial.test.ts` is in scope even though its expensive
test is opt-in, because the timeout applies when that test is enabled.

CLAUDE.md rule 3 remains controlling: this change repairs test execution only. It cannot change
physics assertions, tolerances, acceptance bands, scene parameters, step counts, grids, solver
code, or production defaults.

## Goals / Non-Goals

**Goals:**

- Give every current CPU-test timeout override a traceable runtime measurement and the same
  stated margin rule.
- Eliminate Vitest `onTaskUpdate` transport timeouts by ensuring all nine observed CPU-bound tests
  service Node timer/IPC phases at least four times inside birpc's 60 s window.
- Make idle and loaded verification reproducible enough that a later recurrence is evidence,
  not an invitation to guess a larger timeout.

**Non-Goals:**

- No persistent calibration tool, dependency, global Vitest timeout, or RPC-timeout increase.
- No GPU/Playwright timeout work.
- No optimization or reduction of the physics workload being measured.
- No assertion, tolerance, band, scene, grid, step-count, or production-code change.

## Decisions

### D1 — Inventory first; measure each timeout-bearing test in isolation

Snapshot the explicit override inventory with `rg` before measuring. Add any default-timeout
test that fails the required loaded verification, then measure it by the same rule. Run each file three times
at idle with verbose per-test timing and once under the same synthetic 20-core load used by the
existing measurements. Record min/median/max per timeout-bearing `it(...)`, not merely file
duration.

Reuse a dated measurement only when it identifies the individual test and the test, machine,
and execution condition are unchanged. The existing worst-of-three idle plus loaded numbers for
the two single-test heavy files meet that bar. File-level timings in proposal.md remain useful
upper-bound evidence but do not replace per-test timings for files with multiple timed tests.
The preserved 730.4 s enabled near-floor factorial run is idle sample 1. Idle sample 2 is the
706.264 s test committed in run record `ca961f9`; it passed every assertion and reproduced one
transport timeout. Its skipped path is not a measurement, and sample 3 still needs collection.

**Alternative considered:** calibrate budgets from a full-suite run. Rejected because worker
contention changes over the run and hides the worst isolated runtime of a specific test. The
full-suite run remains a discovery and verification gate; newly exposed tests are remeasured in
isolation before assigning a budget.

### D2 — Synthetic load is fixed and bounded

Use 20 concurrent CPU busy loops on the 24-logical-core reference machine, matching the load
already recorded in proposal.md. Start them immediately before the measured command and stop
them in an unconditional cleanup path immediately afterwards. The measurement note records the
load count and command so the verification condition can be reproduced. No load process may be
left running after a measurement, including after a failed test command.

### D3 — Timeout formula is 3× worst, with a 30 s absolute floor

For each timed test:

`timeout = ceilTo5s(max(3 × worstMeasured, worstMeasured + 30 s))`

The multiplier covers the observed contention slowdown while bounding detection time for a real
hang. The additive floor protects short tests from GC and scheduler pauses. Record the worst
measurement, date, loaded/idle provenance, and resulting budget immediately above the call site.

**Alternative considered:** a 10× multiplier like `PARITY_BAR`. Rejected because a numeric
tolerance can be generously separated from a floating-point floor at no runtime cost, while a
10× test timeout delays detection of a real hang by the same factor.

### D4 — Keep timeout evidence inline, with one canonical convention comment

Keep literal `{ timeout: N }` values at each `it(...)`. Put the full formula and recurrence rule
in `abl-fetch.test.ts`, alphabetically first in the inventory, and a one-line pointer plus the
local measurement above every other override. This avoids a constants module whose entries have
no shared runtime meaning while keeping the derivation discoverable.

### D5 — Yield through a macrotask, not a resolved promise

Make the affected `it(...)` bodies async and yield from their stepping loops with a real event-
loop turn, for example:

```ts
if ((step + 1) % yieldEveryNSteps === 0) {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
```

Choose `yieldEveryNSteps` from measured steps/second so the worst observed interval is at most
15 s, a 4× margin below birpc's 60 s transport timeout. Apply this to every long stepping loop
inside `groundForceContamination.test.ts` and `ahmedForceSampling.test.ts`.

Apply the same rule inside the near-floor factorial's per-arm stepping loop. Idle sample 2
measured a 51.552 s maximum arm at 20,000 steps, or 2.58 ms/step. Make `runArm` and
`runFactorial` asynchronous and yield every 1,000 steps: about 2.6 s at the idle worst-arm rate,
leaving more than 5× headroom under the 15 s design ceiling before loaded verification. Update
the calling tests to await them; do not change any arm, grid, step budget, sampling cadence, or
artifact format.

The first loaded full-suite attempt identified five more synchronous callbacks whose individual
loaded measurements stayed below 60 s but whose loaded-suite runtimes crossed it: `cavity`
(86.017 s), `fetch-steadiness` (105.457 s), `forceLedger` (65.267 s), `solver3d`'s force test,
and `velocityInlet`'s flux test. Apply the same real-macrotask rule to their existing step loops,
with chunks derived to remain below 15 s. This is required by the spec's universal no-starvation
requirement; file-isolated success is not sufficient when the mandated suite condition fails.

Repeated loaded-suite gates then exposed cumulative starvation across `abl-fetch`'s three
sequential synchronous cases and showed that the isolated 200/400-step Ahmed yield cadences were
too sparse under full-suite contention. `abl-fetch` now steps in 500-step async chunks, both Ahmed
tests yield every 100 steps, and convergence-controlled loops yield before their early-exit check
so a quick convergence cannot bypass every macrotask turn.

`await Promise.resolve()` is rejected: it drains the microtask queue but can repeatedly prevent
Node's timer, message-port, and IPC phases from running, so it does not guarantee the worker
transport can acknowledge `onTaskUpdate`. `setTimeout(0)` would service the event loop but adds
timer clamping and is less direct than `setImmediate` in a Node test environment.

Shrinking the grids or step counts is also rejected because it changes the physical content of
the regression tests. Raising birpc's timeout is rejected because it masks future starvation.

### D6 — Verification distinguishes assertion health from harness health

After edits:

1. Run every timeout-bearing file individually once and confirm its runtime is below its derived
   budget.
2. Run `npm test` at idle and under the same 20-core load. Both runs must have zero failed tests,
   zero unhandled transport errors, and exit code 0.
3. Run lint and typecheck, then one final idle `npm test` for the repository gate.
4. Diff-review touched test files and mechanically confirm that only timeout literals/comments,
   async markers, and event-loop yields changed.

Every enabled near-floor calibration or verification execution remains a validation run under
CLAUDE.md and therefore gets its own run record, INDEX row, raw artifact directory, and required
commit even when its purpose is timing rather than new physics evidence.

### D7 — A recurrence is recorded before any recalibration

Document now that a post-merge flake must be recorded with the file/test, measured runtime,
machine/load condition, configured timeout, and exact runner error before any timeout is widened.
This makes the follow-up rule complete during implementation rather than leaving an impossible
conditional checkbox waiting for a future event.

## Risks / Trade-offs

- **[Risk]** Synthetic load exceeds ordinary contention and produces very large budgets. → The
  fixed 20/24-core condition is already the repository's recorded calibration load; D3 still
  bounds genuine-hang detection at 3× the worst observation.
- **[Risk]** Yielding changes solver results through hidden shared state. → Test state is local,
  no other test executes concurrently within the worker, and assertions/results are compared
  unchanged before and after the structural edit.
- **[Risk]** Inline measurements become stale after later workload changes. → The canonical
  comment requires remeasurement when a timed test's workload changes; silent widening is
  explicitly forbidden.
- **[Trade-off]** Full calibration, especially the enabled near-floor factorial, is expensive. →
  Its explicit one-hour budget is part of the same contract, and preserved valid samples are
  reused so work is not repeated without purpose.

## Migration Plan

Inventory and measure → calculate and annotate budgets → add macrotask yields → run individual,
idle-suite, loaded-suite, and final repository verification → commit. Rollback is a plain
revert; no production system or recorded physics result depends on these harness-only changes.
