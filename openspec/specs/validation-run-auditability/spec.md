# validation-run-auditability Specification

## Purpose

Ensures every GPU validation outcome has a durable, self-contained evidence record that can be
audited as execution, numerical health, and physics target without reconstructing lost console
output or rerunning an expensive case.

## Requirements

### Requirement: Every run writes a durable versioned artifact

Each validation run SHALL write a schema-versioned JSON artifact to a deterministic durable
location controlled by the harness rather than relying on reporter attachments. Artifact updates
SHALL be atomic so interruption cannot replace the last readable record with a torn file.

#### Scenario: Completed run survives reporter cleanup

- **WHEN** a validation run completes
- **THEN** its durable artifact SHALL remain readable even if Playwright attachments and the
  browser context are removed

#### Scenario: Interrupted run leaves partial evidence

- **WHEN** a run times out, stalls, loses its device, is aborted, or otherwise fails after starting
- **THEN** a partial artifact SHALL retain the latest successfully observed state
- **AND** the artifact SHALL identify itself as incomplete and state the termination reason

#### Scenario: Artifact update is interrupted

- **WHEN** writing a newer artifact is interrupted
- **THEN** either the previous complete write or the newer complete write SHALL remain readable
- **AND** a partially written document SHALL NOT replace both

### Requirement: The artifact records reproducibility context

The artifact SHALL contain the run identity, source revision and dirty-state indication,
validation case, scene and grid dimensions, material solver configuration, precision, boundary
conditions, closure conventions, time and convergence budgets, and acceptance-ledger entry used
for comparison.

#### Scenario: Result can be reproduced from its record

- **WHEN** an artifact records a completed or partial validation run
- **THEN** a reviewer SHALL be able to identify the material configuration and budgets without
  consulting console output or a page snapshot

#### Scenario: Convention under migration is recorded

- **WHEN** a solver convention has more than one selectable form
- **THEN** the artifact SHALL name the form used rather than relying on the current default

### Requirement: Aggregate verdicts retain their underlying evidence

An artifact SHALL record the aggregate measurements and verdict axes used by the harness. When a
scorer produces per-point, per-row, per-plane, or per-block evidence, that evidence SHALL be
included rather than exposing only its count or aggregate reduction.

#### Scenario: Urban hit rate is auditable per point

- **WHEN** an urban validation reports aggregate hit rate or correlation
- **THEN** the artifact SHALL include each scored point's reference value, measured value,
  comparison error, and hit or miss result

#### Scenario: Fetch maximum is auditable per row

- **WHEN** a fetch validation reports a maximum profile deviation
- **THEN** the artifact SHALL include the row evidence from which the maximum was selected

### Requirement: Numerical health is a distinct verdict axis

Each GPU physics validation artifact SHALL report whether numerical health was evaluated and, when
evaluated, SHALL include at least non-finite-cell count, density bounds, and relative mass drift.
Boundary flux or conservation-ledger closure SHALL also be recorded when the scene has an applicable
open-boundary ledger. An unevaluated metric SHALL carry a reason rather than silently appearing as a
pass.

#### Scenario: Healthy field supports a physics verdict

- **WHEN** all required numerical-health metrics were evaluated and satisfy their declared limits
- **THEN** the artifact SHALL report numerical health separately from the physics-target result

#### Scenario: Invalid field cannot masquerade as a physics measurement

- **WHEN** required numerical-health diagnostics detect non-finite or otherwise invalid field state
- **THEN** the run SHALL be classified as a numerical failure
- **AND** an aggregate probe value SHALL NOT be presented as a trustworthy physics verdict

#### Scenario: Health metric is unavailable

- **WHEN** a required health metric cannot be evaluated
- **THEN** the numerical-health axis SHALL be marked unevaluated with a machine-readable reason
- **AND** it SHALL NOT be reported as passing

### Requirement: Verdict windows are explicit and phase-aware

The artifact and verdict computation SHALL distinguish initialization, transient, averaging, and
evaluation phases. A steady-state bound SHALL be computed over its declared evaluation window
rather than over an earlier transient unless the acceptance rule explicitly includes that transient.

#### Scenario: Long startup ringing precedes a healthy final window

- **WHEN** a metric exceeds its steady-state bound during the declared transient but satisfies it
  throughout the declared evaluation window
- **THEN** the steady-state verdict SHALL use the evaluation window
- **AND** the transient exceedance SHALL remain recorded as transient evidence

#### Scenario: Evaluation window is reconstructable

- **WHEN** a verdict is read from an artifact
- **THEN** the artifact SHALL identify the start, end, and selection rule of the samples used for
  that verdict

### Requirement: Failure evidence identifies the last known execution state

A partial artifact SHALL record the last observed progress, active phase, latest complete
checkpoint, last successful artifact update, device-loss status, and captured error. A stall
detector SHALL report what stopped changing without claiming an unobserved root cause.

#### Scenario: No-progress detector fires

- **WHEN** the progress counter remains unchanged for the configured stall interval
- **THEN** the partial artifact SHALL report the last step, active phase, elapsed no-progress
  interval, latest checkpoint, and device-loss state
- **AND** it SHALL classify the observation as no progress rather than assigning an unsupported
  GPU, CPU, checkpoint, or scoring cause

#### Scenario: Device loss is observed

- **WHEN** the browser reports device loss before termination
- **THEN** the partial artifact SHALL retain the reported reason, message, and observation time
