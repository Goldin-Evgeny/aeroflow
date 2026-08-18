## ADDED Requirements

### Requirement: Pressure-outlet promotion is evidence-gated

The pressure outlet SHALL become the acceptance outlet for near-floor Ahmed, ABL fetch, Case A,
and urban validation scenes only after a predeclared bounded qualification matrix completes.
The matrix SHALL cover the material closure conventions used by those scenes, reference and
accelerated execution, complete-shell conservation, numerical health, and exposure beyond the
known zero-gradient failure step. Qualification evidence SHALL distinguish execution,
numerical-health, parity, and physics-measurement axes.

#### Scenario: Qualification evidence is collected

- **WHEN** the pressure-outlet qualification matrix runs
- **THEN** it SHALL exercise every affected validation scene family with its acceptance-tier
  boundary layout and near-floor relaxation regime
- **AND** it SHALL record the outlet, closure convention, initial-state identity, exposure,
  execution result, numerical-health metrics, conservation closure, and applicable CPU/GPU
  comparison for every arm

#### Scenario: Every promotion gate passes

- **WHEN** every required matrix arm completes and satisfies its predeclared execution,
  numerical-health, conservation, and parity gates
- **THEN** the pressure outlet SHALL be promoted as the explicit acceptance outlet for the
  affected validation scenes
- **AND** the promotion SHALL link the complete qualification evidence

#### Scenario: A promotion gate fails or is unavailable

- **WHEN** any required arm fails a gate, omits required evidence, or cannot complete for an
  unrelated execution reason
- **THEN** pressure-outlet qualification SHALL be classified as failed or inconclusive
- **AND** the acceptance selection SHALL NOT be promoted from that evidence
- **AND** measured results SHALL remain available without being presented as proof of
  qualification

### Requirement: Near-floor acceptance outlet selection is explicit and consistent

The selected outlet for each affected validation case SHALL be defined in one machine-readable
acceptance policy and consumed consistently by scene construction, reference and accelerated
runners, browser readouts, durable artifacts, and checkpoint/resume. A run using a different
outlet SHALL remain reproducible but SHALL identify itself as a non-acceptance configuration.

#### Scenario: A scored validation run starts after promotion

- **WHEN** an affected validation case starts a scored run after pressure qualification
- **THEN** its scene and solver SHALL use the pressure outlet selected by the acceptance policy
- **AND** its live readout, durable artifact, and exported report SHALL record that same outlet

#### Scenario: A non-policy outlet is selected explicitly

- **WHEN** a user or diagnostic harness overrides an affected validation case to use an outlet
  other than the acceptance policy
- **THEN** the run SHALL retain its measurements and recorded outlet convention
- **AND** it SHALL NOT publish a physics acceptance verdict as though it used the acceptance
  configuration

#### Scenario: A checkpoint is resumed

- **WHEN** an affected validation run resumes from a checkpoint
- **THEN** the restored outlet convention SHALL match the checkpoint and acceptance-policy
  identity used when the checkpoint was written
- **AND** a mismatch SHALL be rejected before additional solver steps execute

#### Scenario: Acceptance surfaces disagree

- **WHEN** a scene, runner, artifact, report, or resume path names an outlet different from the
  acceptance policy without declaring a diagnostic override
- **THEN** an automated consistency check SHALL fail

### Requirement: Outlet promotion preserves historical and causal boundaries

Promoting the pressure outlet for near-floor validation SHALL NOT change the solver-wide outlet
default, remove the zero-gradient option, alter a physics acceptance band, rescore historical
evidence, or close the open defect concerning the internal cause of zero-gradient feedback.

#### Scenario: Historical evidence is read after promotion

- **WHEN** an artifact recorded before promotion is displayed or compared
- **THEN** its original outlet convention and verdict SHALL remain unchanged
- **AND** any comparison with a pressure-outlet result SHALL identify the boundary-condition
  difference

#### Scenario: A solver is created outside an affected acceptance scene

- **WHEN** no outlet is explicitly configured
- **THEN** the existing solver-wide default SHALL remain in force bit-for-bit

#### Scenario: Pressure qualification completes

- **WHEN** every pressure-outlet promotion gate passes
- **THEN** the result SHALL establish the qualified validation configuration only
- **AND** it SHALL NOT be described as identifying or repairing the internal zero-gradient
  feedback mechanism
