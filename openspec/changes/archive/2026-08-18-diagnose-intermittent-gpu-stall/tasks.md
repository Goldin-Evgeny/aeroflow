## 1. Operation Liveness Model

- [x] 1.1 Define typed GPU/harness operation records, terminal outcomes, direct observations,
  classifications, deadline policies, and unique operation/attempt identities.
- [x] 1.2 Implement an operation supervisor that races an owned promise against its deadline and
  optional device-loss signal, emits lifecycle transitions, consumes late settlement, and cannot
  overwrite a terminal outcome.
- [x] 1.3 Add deterministic unit tests for successful delay, rejection, never-settling promise,
  timeout followed by late resolve/reject, device loss before and after rejection, and activity-
  extended multipart operations.
- [x] 1.4 Capture `device.lost`, `uncapturederror`, and short owned WebGPU error scopes with the
  active operation identity; test that validation errors remain distinct from timeouts.

## 2. Bounded GPU Submission

- [x] 2.1 Add submitted-step and GPU-completed-step watermarks to the 3D run surface, advancing the
  completed watermark only after an observed queue-completion boundary.
- [x] 2.2 Implement the adaptive step-batch controller with an eight-step initial batch, two-second
  target, 2–256-step hard bounds, gradual adjustment from completed timings, and injectable
  constants for tests.
- [x] 2.3 Add a supervised bounded-submission path that records encode, submit, queue-completion,
  step range, wall duration, and optional timestamp-query duration for every batch.
- [x] 2.4 Separate probe and health readback into supervised macro/copy queue completion followed
  by a distinct staging-map operation so queue and map timeouts are independently observable.
- [x] 2.5 Reject checkpointing, sampling, scoring, or normal completion whenever submitted and
  completed watermarks differ; quarantine rather than reuse such a simulation instance.
- [x] 2.6 Cover completed advancement, in-flight failure, lost-device quarantine, parity tracking,
  remainder batches, and checkpoint eligibility with bounded tests.

## 3. Artifact and Classification Integration

- [x] 3.1 Version the durable validation artifact schema to include ordered operation timelines,
  submitted/completed progress, batch policy and calibration, attempt identities, WebGPU errors,
  and diagnostic-confidence fields; update runtime validation and compatibility tests.
- [x] 3.2 Implement evidence-based classification for device loss, queue timeout, readback timeout,
  checkpoint I/O timeout, scoring timeout, WebGPU error, and application error.
- [x] 3.3 Add negative tests proving that queue completion followed by a stuck map is not classified
  as queue failure, scoring timeout is not classified as GPU failure, and a deadline without
  direct loss/error evidence does not assert TDR or driver root cause.
- [x] 3.4 Preserve incomplete operations and submitted-but-uncommitted ranges in partial artifacts,
  and require submitted/completed equality at any published evaluation boundary.

## 4. Urban Run Liveness

- [x] 4.1 Migrate the urban sampling interval from one monolithic submission to supervised bounded
  batches while preserving its exact sample boundary and averaging cadence.
- [x] 4.2 Supervise urban probe readback, health readback, checkpoint transfer/persistence, and
  scoring with per-kind deadlines and phase activity updates.
- [x] 4.3 Expose operation lifecycle, batch calibration, submitted/completed steps, errors, and the
  active attempt through the urban hook and durable artifact snapshots.
- [x] 4.4 Retain the outer no-progress detector as a process-level backstop and test that ordinary
  operation deadlines return control and classify the failure before that backstop fires.

## 5. Automatic Attempt Recovery

- [x] 5.1 Extend the persistent-run orchestrator with logical-run and attempt identities plus the
  default policy of two replacement attempts total and one consecutive retry from the same
  checkpoint.
- [x] 5.2 On device loss, queue timeout, or readback timeout, atomically terminate the attempt,
  preserve its artifact/profile evidence, quarantine the browser/device, and enforce a bounded
  graceful-close then process-termination path.
- [x] 5.3 Launch a replacement persistent context for the same logical run, require a compatible
  complete checkpoint, drive explicit resume, and record restored and first post-restore completed
  steps.
- [x] 5.4 Keep missing/incompatible checkpoint, numerical failure, WebGPU validation error,
  checkpoint I/O failure, scoring failure, and application error terminal unless a future spec
  explicitly declares them recoverable.
- [x] 5.5 Test same-checkpoint retry exhaustion, total-attempt exhaustion, forward-progress counter
  reset, no-checkpoint termination, terminal-class non-retry, and one logical artifact spanning all
  attempts.

## 6. Deterministic Browser Recovery Proof

- [x] 6.1 Add test-only fault injection at queue-completion, readback-map, device-loss, checkpoint,
  and scoring boundaries without placing injection switches in production user controls.
- [x] 6.2 Add a bounded persistent-browser test that checkpoints a small urban run, injects one
  queue timeout, verifies browser/device quarantine, automatically resumes in a replacement
  attempt, and completes progress beyond the restored step.
- [x] 6.3 Add bounded browser controls for injected device loss, map timeout after queue completion,
  and healthy delayed completion, asserting their exact classifications and retry behavior.
- [x] 6.4 Assert that all required liveness/recovery acceptance tests finish within the ordinary
  end-to-end budget without a strict Case C grid or naturally occurring stall.

## 7. Equivalence and Performance

- [x] 7.1 Compare monolithic and bounded schedules on deterministic fp32 and fp16 fixtures at the
  same completed step; require bit-identical populations, parity, probe macros, averaging state,
  health inputs, and score inputs.
- [x] 7.2 Measure at least three steady-state samples of each schedule on the same representative
  bounded GPU workload with verbose diagnostics disabled; record medians, batch policy, and
  relative throughput.
- [x] 7.3 Tune within the specified hard bounds until bounded-submission median throughput loss is
  at most 10 percent, without weakening deadlines or equivalence checks.
- [x] 7.4 Verify checkpoint restore remains byte/step compatible and no collision, boundary, WGSL,
  scoring, acceptance-band, or physics-verdict logic changed.

## 8. Verification and Evidence

- [x] 8.1 Run formatting, lint, type checking, unit tests, artifact-schema tests, checkpoint tests,
  deterministic fault-injection tests, bounded browser recovery tests, and the bounded performance
  comparison; record exact commands and outcomes.
- [x] 8.2 Update harness documentation with operation classifications, submitted/completed meaning,
  deadline and retry policy, artifact inspection, and recovery-exhaustion handling.
- [x] 8.3 Amend the D1/run-history record to state which historical hypotheses the new boundaries
  can discriminate, while preserving both original stalls as root-cause unknown.
- [x] 8.4 Record completion evidence stating that silent indefinite waits are bounded and
  classifiable, automatic recovery is proven by injection, and no natural stall or vendor root
  cause is claimed.
- [x] 8.5 Document an optional production soak command and evidence template, but do not make the
  soak or absence of an intermittent stall a completion gate.
