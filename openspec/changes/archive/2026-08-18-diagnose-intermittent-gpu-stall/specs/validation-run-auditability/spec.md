## ADDED Requirements

### Requirement: The artifact preserves the GPU operation timeline

The durable validation artifact SHALL preserve an ordered timeline of operation attempts across
browser recovery boundaries. Each operation record SHALL include its unique identity, attempt,
typed phase, start and last-activity times, deadline policy, terminal state, submitted and
completed step ranges where applicable, wall duration, available GPU duration, and associated
device-loss or WebGPU error evidence.

#### Scenario: Submitted batch completes

- **WHEN** a bounded GPU batch reaches its completion boundary
- **THEN** the artifact SHALL record the submitted and completed step range, batch step count,
  wall duration, available GPU duration, and active batch policy

#### Scenario: Operation remains pending at failure

- **WHEN** a run attempt terminates while an operation has not settled
- **THEN** the artifact SHALL retain that operation as timed-out or interrupted rather than
  rewriting it as completed
- **AND** its last observed boundary SHALL remain identifiable

#### Scenario: Run crosses a recovery boundary

- **WHEN** the harness quarantines one attempt and resumes another
- **THEN** the artifact SHALL retain both attempt identities, the triggering operation, the
  checkpoint selected for restore, and the first completed progress after restore

### Requirement: Artifact progress distinguishes submitted and completed state

Every liveness snapshot SHALL record the latest submitted step and latest GPU-completed step.
Checkpoint, sample, and score records SHALL reference completed steps only.

#### Scenario: Failure occurs with work in flight

- **WHEN** an attempt terminates with submitted step greater than completed step
- **THEN** the artifact SHALL expose that difference as in-flight uncommitted work
- **AND** the latest checkpoint SHALL NOT claim a step beyond the completed counter

#### Scenario: Final result is published

- **WHEN** a run reaches a physics or recording verdict
- **THEN** its submitted and completed steps SHALL agree at the evaluation boundary

### Requirement: Diagnostic confidence is explicit

An operation failure record SHALL distinguish direct observations from derived classifications
and untested hypotheses. A successful run without a naturally occurring stall SHALL NOT be
reported as proving a driver or operating-system root cause fixed.

#### Scenario: Deadline expires without device-loss evidence

- **WHEN** a queue operation times out and neither device loss nor WebGPU error was observed
- **THEN** the artifact SHALL record queue non-completion as observed
- **AND** TDR, driver reset, and silent device loss SHALL remain unconfirmed hypotheses

#### Scenario: Optional soak completes without a stall

- **WHEN** a production-duration soak completes successfully
- **THEN** the artifact SHALL report the completed exposure and zero observed stalls
- **AND** it SHALL NOT claim that an intermittent root cause was disproved
