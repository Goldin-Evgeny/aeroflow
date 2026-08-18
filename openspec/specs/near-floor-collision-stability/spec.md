# near-floor-collision-stability Specification

## Purpose

Defines how a collision operator is identified, tested, and promoted for mean-flow operation
near the relaxation-time floor without sacrificing conservation, constitutive fidelity, parity,
or the browser solver's memory and throughput envelope.

## Requirements

### Requirement: Collision candidates are explicit non-production configurations

Every collision candidate SHALL have a stable identity, lattice, equilibrium, moment basis,
relaxation policy, regularization policy, conservation policy, and implementation version. A
candidate SHALL be opt-in until a durable qualification record authorizes promotion, and its
identity SHALL participate in configuration fingerprints, artifacts, and checkpoints.

#### Scenario: Candidate run is created

- **WHEN** a diagnostic run selects a collision candidate
- **THEN** every execution and evidence surface SHALL record the candidate identity and complete
  material configuration
- **AND** the run SHALL NOT publish a production physics verdict

#### Scenario: Unknown or mismatched identity is restored

- **WHEN** a checkpoint's collision identity is unknown or differs from the requested run
- **THEN** restore SHALL fail before any additional solver step executes

#### Scenario: No candidate is selected

- **WHEN** a solver or existing scene omits collision-candidate selection
- **THEN** the pre-change production collision behavior SHALL remain in force bit-for-bit

### Requirement: Qualification is decided by a frozen complete matrix

Before candidate results are inspected, the qualification manifest SHALL fix every required arm,
configuration, exposure, metric, limit, and classifier rule. It SHALL include the production
operator and established negative/research controls, and SHALL cover linear and nonlinear mode
behavior, collision invariants, constitutive fidelity, numerical health, conservation, CPU/GPU
parity, memory, and throughput.

#### Scenario: Matrix is frozen

- **WHEN** qualification begins
- **THEN** the manifest identity and all gates SHALL be durably recorded before candidate output
- **AND** changing a gate SHALL require a new manifest identity and a new complete run

#### Scenario: Required evidence is missing

- **WHEN** any required arm, metric, provenance field, or configuration fingerprint is absent
- **THEN** the result SHALL be `inconclusive`
- **AND** no candidate SHALL be promoted

#### Scenario: A candidate fails one gate

- **WHEN** a candidate completes but violates any frozen correctness, health, parity, memory, or
  throughput gate
- **THEN** the result SHALL be `failed` with machine-readable failed-gate identities
- **AND** all measured values SHALL remain available as negative evidence

### Requirement: A qualified operator is stable and constitutively faithful in the near-floor envelope

A candidate SHALL damp the measured mean-flow high-wavenumber transverse mode throughout the
declared near-floor operating envelope, preserve resolved long-wavelength behavior, and keep the
non-equilibrium-stress estimate within the predeclared constitutive bound. Stability obtained only
by manufacturing excessive subgrid viscosity SHALL NOT qualify.

#### Scenario: Target high-wavenumber mode is evaluated

- **WHEN** the candidate is tested at every declared mean velocity, relaxation point, orientation,
  polarization, and target wavelength
- **THEN** its linear amplification and nonlinear modal gain SHALL satisfy the frozen damping gates
- **AND** the run SHALL remain finite

#### Scenario: Long resolved wave is evaluated

- **WHEN** the candidate is tested on the declared resolved-wavelength controls
- **THEN** modal gain and constitutive response SHALL stay within their frozen deviation from the
  hydrodynamic reference

#### Scenario: Apparent stability comes from excess eddy viscosity

- **WHEN** a candidate is finite but its closure-implied strain or eddy viscosity violates the
  constitutive-fidelity gate
- **THEN** qualification SHALL fail even if every stability arm completes

### Requirement: A qualified operator preserves local and global conservation

Collision SHALL preserve density and momentum to the precision-appropriate frozen bounds before
boundary exchange is applied. Periodic evolution SHALL satisfy normalized mass and momentum-drift
gates over the declared step and wavelength ladder, and open-boundary arms SHALL retain complete-
shell conservation accounting.

#### Scenario: Local collision invariant is checked

- **WHEN** a manufactured population is collided by the reference or accelerated candidate
- **THEN** pre/post density and momentum residuals SHALL satisfy the declared precision-specific
  limits

#### Scenario: Periodic scaling ladder is checked

- **WHEN** the candidate runs the frozen periodic step and wavelength ladder
- **THEN** normalized drift and its scaling classification SHALL pass for every conserved component
- **AND** a correction that merely hides an unexplained growing mode SHALL NOT be described as a
  root-cause repair

#### Scenario: Open-boundary arm is checked

- **WHEN** a bounded near-floor scene includes inlet or outlet exchange
- **THEN** its artifact SHALL distinguish physical inventory change from complete-shell closure
- **AND** both numerical-health and closure gates SHALL pass

### Requirement: Reference and accelerated candidates agree before promotion

The candidate SHALL be implemented first as a deterministic reference authority and only then on
the accelerated path. CPU/GPU parity SHALL cover the candidate's populations, macroscopic fields,
collision invariants, subgrid inputs, near-floor regime, and boundary layouts used by affected
scenes in both supported storage precisions.

#### Scenario: Accelerated implementation is enabled

- **WHEN** the reference candidate has not passed its CPU-only qualification subset
- **THEN** the accelerated candidate SHALL remain unavailable for promotion

#### Scenario: Parity matrix runs

- **WHEN** both implementations are available
- **THEN** every frozen parity arm SHALL meet its precision-specific gate
- **AND** implementation disagreement SHALL fail qualification rather than be attributed to physics

### Requirement: Promotion is atomic, reversible, and evidence-gated

At most one collision candidate SHALL be promoted by a complete `qualified` record. Promotion SHALL
update the authoritative production policy and every affected CPU, GPU, scene, runner, artifact,
checkpoint, and report consumer together while retaining the former operator for historical
reproduction and rollback.

#### Scenario: One candidate qualifies

- **WHEN** exactly one candidate passes every frozen gate
- **THEN** the production collision policy MAY select it
- **AND** all acceptance surfaces SHALL resolve the same policy and candidate identity

#### Scenario: No candidate qualifies

- **WHEN** every candidate fails or the matrix is inconclusive
- **THEN** production selection SHALL remain unchanged
- **AND** the durable record SHALL state the next discriminating evidence without claiming repair

#### Scenario: Historical artifact is read after promotion

- **WHEN** evidence produced under the former collision operator is displayed or compared
- **THEN** its original configuration and verdict SHALL remain unchanged
- **AND** comparisons SHALL identify the collision-operator difference

### Requirement: Qualification does not substitute for benchmark acceptance

The bounded collision matrix SHALL establish operator admissibility only. It SHALL NOT change a
physics acceptance band, rescore historical evidence, or claim V11-V15 accuracy without new
benchmark-faithful runs under the promoted configuration.

#### Scenario: Bounded matrix qualifies an operator

- **WHEN** every qualification gate passes
- **THEN** the result SHALL be reported as collision qualification
- **AND** all affected physics cases SHALL retain their prior outcome until rerun at valid scale
