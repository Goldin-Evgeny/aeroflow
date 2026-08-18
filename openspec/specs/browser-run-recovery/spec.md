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
