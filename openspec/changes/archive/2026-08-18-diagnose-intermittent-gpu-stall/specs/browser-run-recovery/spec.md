## ADDED Requirements

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
