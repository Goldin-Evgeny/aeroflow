# browser-run-recovery Specification

## Purpose

Makes checkpointed browser GPU validations durable across harness and browser-context failures,
so interrupted computation can resume from verified committed state without contaminating a
new run.

## Requirements

### Requirement: A checkpointed run has a durable identity

Every checkpointed validation run SHALL have a unique run identity whose checkpoint storage
survives replacement of the browser context and whose location is reported to the operator.
Checkpoint storage SHALL be isolated between run identities.

#### Scenario: Checkpoint survives context replacement

- **WHEN** a run commits a checkpoint and its browser context is then closed
- **THEN** a new harness invocation using the same run identity SHALL discover that checkpoint

#### Scenario: A fresh run is isolated

- **WHEN** a harness invocation starts a fresh run with a new run identity
- **THEN** it SHALL NOT restore or overwrite another run identity's checkpoint

#### Scenario: Durable location is reported

- **WHEN** the harness creates or opens checkpoint storage
- **THEN** it SHALL report the run identity and the durable location needed to resume it

### Requirement: Resume restores only compatible complete state

A resume request SHALL validate the saved scene, solver configuration, checkpoint format, and
payload completeness before applying any state. A successful resume SHALL restore the exact
committed step and every accumulated state component required for an equivalent continuation,
including time-averaging state where the validation uses it.

#### Scenario: Compatible checkpoint resumes continuously

- **WHEN** a compatible complete checkpoint is resumed in a newly created browser context
- **THEN** the first reported restored step SHALL equal the checkpoint's committed step
- **AND** the resumed run SHALL retain its pre-checkpoint accumulated validation state

#### Scenario: Incompatible checkpoint is rejected

- **WHEN** the requested scene or material solver configuration differs from the checkpoint
- **THEN** resume SHALL fail before applying checkpoint state
- **AND** the error SHALL identify the incompatible field

#### Scenario: Torn checkpoint is not applied

- **WHEN** the newest checkpoint is incomplete
- **THEN** resume SHALL use the previous complete checkpoint if one exists
- **AND** otherwise SHALL fail without partially mutating the new simulation

### Requirement: Interrupted runs remain resumable

Unexpected browser closure, harness timeout, detected stall, device loss, and operator abort SHALL
preserve the most recent complete checkpoint. Checkpoint deletion SHALL occur only for an explicit
fresh-start or cleanup operation, not as an incidental consequence of failure.

#### Scenario: Stall preserves committed work

- **WHEN** the harness declares a run stalled after it has committed a checkpoint
- **THEN** the harness SHALL terminate with the latest complete checkpoint still available to a
  later resume invocation

#### Scenario: Successful completion can be cleaned up

- **WHEN** a run has completed and its durable result has been written
- **THEN** an explicit cleanup operation SHALL be able to remove that run's checkpoint storage
  without affecting other run identities

### Requirement: Recovery is testable without a production-duration run

The recovery contract SHALL be verifiable with a bounded deterministic scene and a controlled
context interruption. Validation of this capability SHALL NOT require reproducing the intermittent
long-run GPU stall or completing a multi-hour acceptance case.

#### Scenario: Controlled cross-context recovery

- **WHEN** a bounded scene is advanced, checkpointed, interrupted by closing its context, and
  resumed in a replacement context
- **THEN** the test SHALL demonstrate compatible-state restoration and forward progress from the
  committed step within the ordinary end-to-end test budget

### Requirement: Unattended runs recover automatically within a bounded policy

An unattended checkpointed validation SHALL automatically start a replacement browser and device
attempt after a classified device loss or GPU-operation liveness timeout, restore the latest
complete compatible checkpoint, and continue subject to an explicit retry budget. Other failure
classes SHALL remain terminal unless explicitly declared recoverable.

#### Scenario: One recoverable attempt fails

- **WHEN** a run with a complete checkpoint encounters a classified device loss or GPU-operation
  liveness timeout and has retry budget remaining
- **THEN** the failed attempt SHALL be quarantined
- **AND** a replacement attempt SHALL resume from that checkpoint and continue forward

#### Scenario: Failure occurs before any checkpoint

- **WHEN** a recoverable-class failure occurs before a complete checkpoint exists
- **THEN** the harness SHALL terminate with an explicit no-checkpoint recovery result
- **AND** it SHALL NOT silently restart the case from zero

#### Scenario: Failure class is not recoverable

- **WHEN** a run fails from invalid numerical state, incompatible checkpoint, scoring error, or
  another class not declared recoverable
- **THEN** automatic resume SHALL NOT hide the failure by starting another attempt

### Requirement: Automatic recovery cannot loop without progress

The recovery policy SHALL bound total attempts and consecutive recoveries from the same checkpoint.
Observed completed progress beyond the restored checkpoint SHALL reset only the consecutive same-
checkpoint counter, not the total-attempt history.

#### Scenario: Replacement attempt advances

- **WHEN** a resumed attempt completes work beyond its restored checkpoint
- **THEN** the run SHALL record the forward progress and MAY recover again within its remaining
  total retry budget

#### Scenario: Repeated failure at the same checkpoint

- **WHEN** replacement attempts repeatedly fail without completed progress beyond the same
  checkpoint
- **THEN** the harness SHALL stop after the configured same-checkpoint limit
- **AND** it SHALL report retry exhaustion rather than looping indefinitely

#### Scenario: Total retry budget is exhausted

- **WHEN** the run reaches its total automatic-attempt limit
- **THEN** it SHALL terminate with all attempt and recovery evidence preserved

### Requirement: Recovery preserves one logical run history

Every replacement attempt SHALL remain part of the same logical run identity while receiving a
distinct attempt identity. The final artifact SHALL preserve the ordered failure, quarantine,
restore, and progress history across all attempts.

#### Scenario: Recovered run completes

- **WHEN** a replacement attempt resumes from a checkpoint and reaches normal completion
- **THEN** the logical run SHALL report completion together with its prior failed-attempt history
- **AND** the physics result SHALL identify the completed attempt and restored step on which it is
  based
