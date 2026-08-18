## Why

Long WebGPU validations have twice stopped making progress with both GPU and CPU idle, while the
current outer heartbeat can only say that the step counter stopped. Recovery is now durable, so
the next harness priority is to prevent one opaque GPU operation from waiting forever, identify
the exact operation boundary that failed, and resume unattended work from its last checkpoint.

## What Changes

- Split acceptance-sized simulation intervals into bounded command submissions with an observed
  completion boundary between them, eliminating the current approximately 80-second opaque
  submission as an untested TDR-class candidate.
- Distinguish encoded/submitted steps from GPU-completed steps; only completed work advances the
  liveness heartbeat or becomes eligible for checkpointing and scoring.
- Give every awaited WebGPU operation a typed lifecycle and deadline, including queue completion,
  probe readback, health readback, checkpoint readback/write, and scoring.
- Race in-flight GPU waits against `device.lost` and their operation deadline, and classify
  device loss, queue non-completion, readback non-completion, CPU-phase timeout, and ordinary
  error without assigning an unsupported root cause.
- Capture WebGPU uncaptured errors, device-loss details, operation identifiers, submitted and
  completed step ranges, batch duration, and optional GPU timestamps in the durable run artifact.
- Automatically quarantine a failed browser/device attempt and resume an unattended run from
  its latest complete checkpoint, subject to an explicit retry budget and no-progress guard.
- Provide deterministic fault injection for each failure class and bit-equivalence checks for
  bounded versus legacy batching; neither a naturally occurring stall nor a multi-hour Case C
  run is required to complete this change.
- Retain an optional production soak procedure for later confidence evidence, but do not use
  absence of a rare stall in one soak as proof of root cause or correctness.

## Capabilities

### New Capabilities

- `gpu-operation-liveness`: Bounded WebGPU submissions, committed-progress accounting, operation
  deadlines, asynchronous error visibility, and evidence-based stall classification.

### Modified Capabilities

- `browser-run-recovery`: Add bounded automatic checkpoint resume for unattended runs after a
  classified stalled or device-lost attempt.
- `validation-run-auditability`: Add the per-operation timeline and submitted-versus-completed
  progress evidence needed to localize the last responsive WebGPU boundary.

## Impact

- Affects the 3D solver submission/readback surface, the AIJ urban run loop, persistent
  Playwright run lifecycle, and shared validation artifact schema.
- Adds deterministic liveness/fault-injection test seams and operation-level telemetry; optional
  timestamp queries remain an accelerator, not a requirement.
- May modestly reduce peak throughput by introducing bounded queue-completion fences. Batch size
  will be derived from measured completion time within conservative limits, and overhead will be
  recorded explicitly.
- Does not change WGSL kernels, collision or boundary mathematics, checkpoint numerical payload,
  scoring, acceptance bands, or physics verdicts.
- Does not claim to identify an operating-system or driver root cause unless a future captured
  incident contains direct evidence for it.
