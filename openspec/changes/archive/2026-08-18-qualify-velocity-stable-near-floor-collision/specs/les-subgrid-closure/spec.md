## ADDED Requirements

### Requirement: Specified closure promotion is collision-stability gated

The specified Smagorinsky convention SHALL become the default only on a collision operator that has
passed the complete near-floor collision qualification under that convention. The legacy convention
SHALL remain available for historical reproduction, and a failed or incomplete stability matrix
SHALL leave the existing default unchanged.

#### Scenario: Qualified collision is tested with the specified convention

- **WHEN** a collision candidate has passed its collision-only qualification subset
- **THEN** the complete near-floor matrix SHALL be rerun with the specified closure convention
- **AND** stability, constitutive-fidelity, numerical-health, conservation, parity, memory, and
  throughput gates SHALL all remain passing

#### Scenario: Specified convention destabilizes a qualified collision

- **WHEN** any required arm fails or becomes inconclusive after selecting the specified convention
- **THEN** the specified convention SHALL NOT become the default
- **AND** the candidate's earlier collision-only result SHALL remain recorded without being
  presented as closure qualification

#### Scenario: Closure default is promoted

- **WHEN** the selected collision and specified convention pass the complete frozen matrix together
- **THEN** their identities SHALL be promoted atomically in every affected CPU, GPU, scene, runner,
  artifact, checkpoint, and report path
- **AND** no physics acceptance band SHALL change

### Requirement: Near-floor LES evidence identifies collision and closure together

Every near-floor result with the subgrid model active SHALL record the stable collision-policy
identity, concrete collision-candidate identity, closure convention, and their joint configuration
fingerprint. A result missing any of these fields SHALL be ineligible for a physics verdict.

#### Scenario: Near-floor LES result is published

- **WHEN** a run reaches its evaluation window with the subgrid model active
- **THEN** the durable result SHALL identify the collision and closure configuration together
- **AND** its numerical-health and physics axes SHALL be evaluated only against policies for that
  joint configuration

#### Scenario: Historical result lacks the new collision identity

- **WHEN** a pre-change artifact is read
- **THEN** it SHALL remain readable under its historical schema and inferred legacy identity
- **AND** it SHALL NOT be silently relabeled as evidence for the promoted configuration
