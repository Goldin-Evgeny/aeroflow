## Purpose

Makes long WebGPU computations observable and bounded at operation boundaries so a lost device,
non-completing queue, or stuck readback becomes a classified recoverable failure instead of an
indefinite silent wait.

## ADDED Requirements

### Requirement: Long simulation intervals use bounded submissions

A validation run SHALL divide a long simulation interval into command submissions bounded by a
declared maximum step count and SHALL observe GPU completion between submissions. The bound MAY
adapt from completed timing samples, but the initial submission and every later submission SHALL
remain within a conservative hard cap.

#### Scenario: Acceptance interval exceeds one batch

- **WHEN** a sampling interval contains more steps than the declared submission cap
- **THEN** it SHALL be submitted as multiple ordered batches
- **AND** each batch SHALL reach an observed completion boundary before the next batch is treated
  as completed

#### Scenario: Completed timing adapts the next batch

- **WHEN** a batch completes and supplies a trustworthy wall or GPU duration
- **THEN** the controller MAY adjust the next batch toward its declared duration target
- **AND** the adjusted step count SHALL remain within the hard bounds recorded for the run

#### Scenario: Batching preserves solver output

- **WHEN** a deterministic bounded scene runs the same number of steps with monolithic and bounded
  submission schedules
- **THEN** its final populations, parity, sampled macroscopics, and accumulated validation state
  SHALL be bit-identical

### Requirement: Submitted work is distinct from completed work

The run SHALL track encoded or submitted steps separately from GPU-completed steps. Only completed
steps SHALL advance the liveness heartbeat, become eligible for checkpointing, or contribute to
sampling and scoring.

#### Scenario: Submitted batch completes

- **WHEN** the completion boundary for a submitted step range resolves successfully
- **THEN** the completed-step counter SHALL advance atomically to the end of that range

#### Scenario: Submitted batch does not complete

- **WHEN** a submitted batch reaches its deadline or the device is lost before completion
- **THEN** its step range SHALL remain submitted but not completed
- **AND** no checkpoint or score SHALL claim that range as committed work

#### Scenario: Failed simulation instance is abandoned

- **WHEN** submitted and completed steps differ at failure
- **THEN** that simulation instance SHALL NOT be reused for further stepping or readback
- **AND** any continuation SHALL restore a complete checkpoint in a newly initialized instance

### Requirement: Every awaited operation has a lifecycle and deadline

Every awaited GPU or harness phase capable of blocking progress SHALL have a unique operation
identity, typed phase, start time, activity time, deadline policy, and terminal state. Covered
phases SHALL include queue completion, probe readback, health readback, checkpoint transfer,
checkpoint persistence, and scoring.

#### Scenario: Operation completes within its budget

- **WHEN** an awaited operation settles before its deadline
- **THEN** it SHALL be recorded as completed with its wall duration and available GPU duration

#### Scenario: Operation stops responding

- **WHEN** neither completion nor qualifying phase activity occurs before the operation deadline
- **THEN** the operation SHALL terminate as a typed liveness timeout
- **AND** the outer run SHALL NOT remain blocked waiting for the original promise

#### Scenario: Slow operation continues reporting activity

- **WHEN** a multi-part checkpoint operation exceeds its initial wall interval but continues
  completing bounded chunks within their deadlines
- **THEN** it SHALL remain live rather than being classified as stalled solely from total duration

### Requirement: Device loss and asynchronous WebGPU errors are surfaced

An in-flight WebGPU wait SHALL be raced against the device-loss signal. The run SHALL also capture
uncaptured WebGPU errors and owned validation errors with their operation context. A resource from
a lost or quarantined device SHALL NOT be reused.

#### Scenario: Device is lost during a queue wait

- **WHEN** the device-loss signal settles before the queue-completion operation
- **THEN** the operation and run attempt SHALL terminate as device-lost
- **AND** the recorded evidence SHALL include the loss reason and message

#### Scenario: Validation error belongs to an operation

- **WHEN** an owned error scope or uncaptured-error event reports an error during an active
  operation
- **THEN** the error SHALL be recorded with that operation identity and phase
- **AND** it SHALL NOT be reduced to an unclassified no-progress timeout

### Requirement: Liveness failures are classified from observed boundaries

The harness SHALL distinguish at least device loss, queue-completion timeout, readback-map timeout,
checkpoint I/O timeout, CPU scoring timeout, WebGPU validation error, and unexpected application
error. Classification SHALL describe the last observed boundary and SHALL NOT infer an operating-
system, driver, TDR, GPU, or CPU root cause without direct evidence.

#### Scenario: Queue completes but readback does not

- **WHEN** a queue-completion boundary succeeds and the following map operation reaches its
  deadline
- **THEN** the failure SHALL be classified as readback-map timeout rather than queue timeout

#### Scenario: Queue completion does not arrive

- **WHEN** a submitted batch's queue-completion boundary reaches its deadline without device-loss
  or WebGPU error evidence
- **THEN** the failure SHALL be classified as queue-completion timeout
- **AND** the cause SHALL remain unspecified

#### Scenario: CPU scoring exceeds its budget

- **WHEN** GPU readback has completed but the scoring phase reaches its own deadline
- **THEN** the failure SHALL be classified as CPU scoring timeout rather than GPU stall

### Requirement: Failure classes are deterministically testable

The operation-liveness contract SHALL expose deterministic fault injection at the promise and
phase boundaries needed to test each classification and recovery path. Completion SHALL NOT
require a naturally occurring device stall or a production-duration validation run.

#### Scenario: Injected unresolved queue wait

- **WHEN** a bounded test substitutes a never-settling queue-completion operation
- **THEN** the configured deadline SHALL classify it as queue-completion timeout and return
  control within the ordinary test budget

#### Scenario: Injected device loss wins the race

- **WHEN** a bounded test settles the device-loss signal while a GPU operation remains pending
- **THEN** device-lost SHALL win the classification and the pending operation's later settlement
  SHALL NOT create an unhandled rejection

#### Scenario: Healthy delayed operation is not a false stall

- **WHEN** an operation completes below its deadline after a non-zero delay
- **THEN** it SHALL be recorded as completed and SHALL NOT trigger recovery

### Requirement: Liveness protection has a measured overhead budget

Bounded submissions and liveness instrumentation SHALL be measured against the legacy submission
schedule on a declared representative bounded workload. The median steady-state throughput loss
SHALL NOT exceed 10 percent with optional verbose diagnostics disabled.

#### Scenario: Bounded performance comparison

- **WHEN** the legacy and bounded schedules each run at least three steady-state samples on the
  same adapter and scene
- **THEN** the artifact SHALL record both medians, the selected batch policy, and relative overhead
- **AND** relative throughput loss SHALL be at most 10 percent
