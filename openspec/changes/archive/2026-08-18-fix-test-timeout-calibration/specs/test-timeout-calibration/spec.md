## Purpose

Defines what the CPU test suite's timeout budgets must guarantee so that `npm test` — the
harness CLAUDE.md names as part of the required pre-commit gate — reports a solver defect only
when there is one, never a false failure caused by the test harness's own miscalibration.

## ADDED Requirements

### Requirement: Per-test timeout budgets are derived from measurement

Every CPU physics test that overrides vitest's default timeout SHALL set that timeout from a
recorded measurement of the test's actual runtime plus a stated margin, not from a value chosen
to look "safely larger" without a measurement behind it. The margin SHALL be documented (a
comment or a shared constant) so a future contributor can tell the budget was derived, not
guessed. This includes conditionally enabled or opt-in tests: their timeout SHALL be calibrated
from an execution with the condition enabled, not from the ordinary skipped path. A dated,
configuration-identical measurement already preserved by the repository MAY be reused rather
than repeated solely for this calibration.

#### Scenario: A slow test's timeout has margin over its measured runtime

- **WHEN** a CPU physics test's actual wall-clock runtime is measured on the reference
  development machine
- **THEN** that test's configured timeout is at least the derived margin above the measured
  runtime (mirroring the "~10x above measured floor" methodology already used for
  `PARITY_BAR` in `H6-parity-panel.md` §4, or an explicitly stated alternative margin), and the
  margin is recorded next to the timeout value

#### Scenario: An opt-in test is measured while enabled

- **WHEN** a CPU physics test with an explicit timeout is skipped unless an environment flag or
  equivalent condition is enabled
- **THEN** its runtime evidence SHALL come from an enabled execution that performs the timed work

#### Scenario: The suite passes without a re-run under ordinary background load

- **WHEN** `npm test` is run on the reference development machine with ordinary background
  load present (not an idle machine)
- **THEN** no test fails solely because it exceeded its configured timeout while its
  assertions would otherwise have passed

### Requirement: No test starves the test runner's own reporting channel

No CPU test's synchronous execution SHALL run long enough to prevent the test worker process
from servicing its own inter-process heartbeat to the test runner's main process. A test with
a long, CPU-bound, single-threaded loop SHALL yield control periodically so the runner's
liveness/reporting channel is serviced within its own timeout, independent of the test's
configured pass/fail timeout. The yield SHALL allow timer and inter-process I/O callbacks to
run; yielding only within the JavaScript microtask queue does not satisfy this requirement.

#### Scenario: A long CPU-bound test yields before the runner's heartbeat timeout

- **WHEN** a CPU physics test runs a stepping loop whose total synchronous runtime would
  otherwise exceed the test runner's inter-process heartbeat timeout
- **THEN** the loop yields through a real event-loop turn at an interval short enough that the
  heartbeat is always serviced in time, and the runner reports no heartbeat/RPC timeout error
  for that test

#### Scenario: `npm test` output contains no unhandled runner-transport errors

- **WHEN** the full CPU test suite is run to completion with all assertions passing
- **THEN** the run reports zero unhandled errors from the test runner's own transport/reporting
  layer (e.g. no `[vitest-worker]: Timeout calling "onTaskUpdate"`), so a clean exit code
  reliably means both "every assertion passed" and "the harness itself behaved"
