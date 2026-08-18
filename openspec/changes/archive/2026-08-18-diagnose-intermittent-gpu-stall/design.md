## Context

See `proposal.md` for motivation. The archived recovery/auditability change now provides durable
browser profiles, checkpoint resume, partial artifacts, phase heartbeat, and `device.lost`
evidence. The remaining blind spot is inside one urban sampling interval:
`AijUrbanRun.advance()` encodes and submits all `sampleIntervalSteps` at once, then waits for the
probe staging buffer to map. On strict Case C this is 1,406 steps and approximately 80–85 seconds
of GPU work. CPU-side parity and `totalSteps` advance while commands are encoded, before GPU
completion is known, and the outer six-minute watchdog sees no internal boundary.

The Ahmed worker already demonstrates the essential loss-race pattern: a pending GPU promise can
be raced against `device.lost` so loss is observable even if `mapAsync` never settles. The urban
path needs that lifecycle treatment plus a separate queue-completion boundary before readback, so
queue non-completion and map non-completion are distinguishable.

## Goals / Non-Goals

**Goals:**

- Bound the amount of opaque GPU work and the time any harness await can block without a typed
  result.
- Make completed GPU work, rather than CPU encoding, authoritative for progress and checkpoints.
- Localize failure to the last observed queue, readback, checkpoint, or CPU phase.
- Recover unattended work from durable checkpoints without retry loops.
- Prove behavior through deterministic bounded tests and measure performance overhead.

**Non-Goals:**

- Prove whether the two historical stalls were caused by Windows TDR, the Chromium/Dawn stack,
  the GPU driver, hardware, or an application bug without new direct evidence.
- Guarantee cancellation of commands already submitted to WebGPU; timed-out devices are
  quarantined instead.
- Change command ordering inside a lattice step, WGSL kernels, solver mathematics, scoring, or
  checkpoint numerical representation.
- Require a six-hour Case C run or a naturally occurring stall for implementation completion.
- Treat one successful optional soak as proof that an intermittent vendor-level cause is gone.

## Decisions

### 1. Introduce an operation supervisor above raw WebGPU promises

A shared supervisor wraps each potentially blocking phase in an operation record. It races the
owned promise against a per-kind deadline and, for WebGPU operations, the current device-loss
signal. It emits start, activity, completion, error, loss, and timeout transitions to the durable
artifact coordinator. Late settlement is consumed to prevent unhandled rejection but cannot
change the already terminal classification.

This generalizes the proven Ahmed `stepOrLost` pattern and adds the missing timeout and operation
identity. A single outer Playwright poll is retained as a final process-level guard, not the
primary GPU liveness mechanism.

Alternative considered: rely only on the existing six-minute step heartbeat. It detects eventual
no-progress but cannot distinguish an executing command buffer, queue wait, map wait, checkpoint,
or CPU scoring phase and cannot return control to the page's run loop.

### 2. Separate queue completion from readback completion

Each simulation batch is submitted, then fenced with `queue.onSubmittedWorkDone()` under the
operation supervisor. Probe or health readback is a subsequent independently supervised map
operation. This creates the discriminating boundary:

```text
encode -> submit -> queue completion -> macro/copy submit -> queue completion -> map -> score
```

If the first fence times out, the observation is queue non-completion. If both queue fences
complete but mapping does not, the observation is readback-map non-completion. Neither label
asserts why the browser implementation failed.

Owned validation error scopes surround structural submission/readback operations, while a device-
level uncaptured-error listener records asynchronous errors. Scopes are short-lived and balanced;
there is no application-wide scope that could capture unrelated work.

### 3. Use conservative adaptive step batches

The first batch uses eight steps. Successful completion time estimates steps per two-second
target batch, clamped to 2–256 steps and to the remaining sampling interval. Adaptation uses only
completed batches and changes gradually so one anomalously fast sample cannot create another
80-second command buffer. The selected policy and every measured duration are recorded.

Queue completion has a 30-second initial deadline. A completed-duration history may raise a
per-operation deadline conservatively, but never to the outer six-minute watchdog. Checkpoint
transfers retain activity-based chunk deadlines so a healthy multi-chunk 6.64 GiB save is not
mistaken for one unresponsive operation. Constants remain configurable for controlled tests.

Alternative considered: a fixed small step count. It is simple but imposes needless submission
overhead on small grids and gives no consistent wall-duration bound across adapters and scenes.

### 4. Maintain submitted and completed step watermarks

Encoding a batch advances the simulation object's parity and submitted step as today, but a
separate completed watermark advances only after the queue fence succeeds. Public run progress,
sampling, scoring, checkpoint eligibility, and artifact heartbeat use the completed watermark.

If a batch fails between submission and completion, the entire simulation/device instance is
quarantined; its CPU-side parity is never rolled back or reused. Recovery builds a fresh instance
and restores the last complete checkpoint, whose step cannot exceed the completed watermark.
This avoids pretending WebGPU commands can be cancelled or safely inspected after timeout.

Alternative considered: delay all parity/step mutation until the fence. The encoder needs parity
to bind the correct ping-pong resources for every step, so that approach would require a broader
solver-state redesign without improving failure recovery.

### 5. Preserve mathematical equivalence across command-buffer boundaries

Splitting an ordered sequence of compute passes across command buffers does not change the pass
dependency graph: each later submission follows the prior completed submission and reads the same
ping-pong authority. A small deterministic fixture compares populations, parity, probe macros,
averaging state, and score inputs bit-for-bit between monolithic and bounded schedules for both
storage precisions supported by the path.

The performance control uses a representative bounded workload, at least three steady-state
samples per schedule, and a 10 percent median-throughput budget with verbose diagnostics off. It
does not need an acceptance-sized grid.

### 6. Classify observations, not presumed causes

The supervisor emits a closed set of actionable observations: `device-lost`, `queue-timeout`,
`readback-timeout`, `checkpoint-io-timeout`, `scoring-timeout`, `webgpu-error`, and
`application-error`. Each record contains direct evidence and the last successful boundary.

TDR, silent device reset, driver failure, browser scheduling, and hardware failure remain
hypotheses unless an error/loss event or external diagnostic directly establishes one. This
preserves the audit discipline already introduced by the run artifact.

### 7. Recover with a new browser/device attempt

Only `device-lost`, `queue-timeout`, and `readback-timeout` are automatically recoverable. The
harness closes the failed persistent context, force-terminates it if graceful closure itself
exceeds a short teardown deadline, reopens the same logical run profile, creates a new device,
and drives `urban-resume`. The attempt receives a new identity; all evidence remains in the same
logical artifact.

The default policy permits two automatic replacement attempts total and one consecutive retry
from the same checkpoint. Completed progress beyond the restored step resets the same-checkpoint
counter. Missing/incompatible checkpoints, numerical failure, validation errors, and CPU scoring
errors are terminal rather than masked by retries.

Alternative considered: recover within the same page/device. WebGPU resources from a lost device
cannot be reused, and a timed-out queue cannot be proven safe, so full attempt quarantine is the
only defensible common path.

### 8. Use deterministic injection as the acceptance proof

Pure tests inject never-settling queue and map promises, delayed success, rejected operations,
device loss before/after rejection, and late settlement. A bounded persistent-browser test injects
one recoverable queue timeout after a checkpoint, verifies quarantine and automatic resume, then
completes beyond the restored step. Negative tests cover missing checkpoints, terminal classes,
same-checkpoint exhaustion, and total retry exhaustion.

An optional production soak can later exercise the real adapter with the new artifact schema. It
is evidence of exposure only and is not an implementation gate.

## Risks / Trade-offs

- [Queue fences reduce throughput or prevent driver-side overlap] -> Adapt batch size toward a
  measured duration, enforce the 10 percent bounded-workload budget, and keep verbose telemetry
  optional.
- [A 30-second deadline is too short for an unusually slow adapter] -> Record calibration and
  allow a conservative measured deadline increase while keeping it below the process watchdog.
- [Closing a context with a hung device also hangs] -> Apply a separate teardown deadline and
  terminate the owning browser process while preserving its persistent profile.
- [Late promises retain buffers after timeout] -> Consume late settlement, quarantine the whole
  attempt, and release remaining references when context termination completes.
- [Automatic retries hide deterministic application errors] -> Recover only the three declared
  liveness/loss classes; validation, numerical, scoring, and compatibility failures stay terminal.
- [A checkpoint may be several minutes behind] -> Report checkpoint age and lost submitted work;
  this change guarantees bounded recovery, not zero replay.
- [Submitted/completed counters diverge during normal in-flight work] -> Treat the difference as
  explicit state and require equality before checkpoint, sampling, scoring, or normal completion.

## Migration Plan

1. Add operation records, supervisor, error capture, and deterministic unit tests without changing
   the legacy urban submission path.
2. Add completed-step accounting and bounded submission support behind a harness option; verify
   bit equivalence and performance on bounded scenes.
3. Make bounded liveness the urban default while retaining a temporary legacy comparison mode.
4. Extend artifact schema/readers for operation timelines and multiple attempt identities.
5. Add automatic persistent-context recovery and its injected end-to-end tests.
6. Remove the legacy monolithic schedule after equivalence, overhead, and recovery gates pass.
7. Record bounded verification evidence; leave any production soak as an explicitly optional
   follow-up.

Rollback disables bounded scheduling and automatic recovery while retaining operation artifacts
that older readers can reject by schema version. Existing checkpoints remain compatible because
their numerical payload and scene keys do not change.
