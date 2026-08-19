## ADDED Requirements

### Requirement: Outlet feedback localization is hypothesis- and evidence-gated

The near-floor diagnostic suite SHALL declare the candidate mechanisms, the observation each
mechanism predicts, the comparison topology, the sampling or exact-step refinement rule, and all
repeatability thresholds before inspecting a new localization result. The declaration SHALL
distinguish a mismatch with the normative boundary rule from a correctly implemented rule that
participates in unstable system feedback.

#### Scenario: Localization begins from a frozen manifest

- **WHEN** an outlet-feedback localization run starts
- **THEN** its durable record SHALL identify the frozen hypothesis manifest and configuration
  fingerprint
- **AND** the manifest SHALL state the evidence required to support or reject each result branch

#### Scenario: A post-result threshold or hypothesis changes

- **WHEN** a threshold, prediction, topology, or classifier branch is changed after result data
  has been inspected
- **THEN** the existing result SHALL remain classified under its original manifest
- **AND** the changed manifest SHALL receive a new identity before another run is interpreted

#### Scenario: Different outlet formulas produce different values

- **WHEN** zero-gradient and pressure arms differ because their declared normative transforms are
  different
- **THEN** that expected difference alone SHALL NOT be classified as an implementation defect or
  internal root cause

### Requirement: The first abnormal boundary transformation is independently auditable

The localization record SHALL refine the first aggregate separation to an exact solver step and
retain enough population- and link-level state to evaluate the applicable boundary rule without
calling the production boundary implementation as its own oracle. The evidence SHALL identify the
cell coordinates, lattice direction and opposite direction, source and destination ownership,
boundary class or intersection, parity, pre-transform population, canonical incoming population,
replacement population, and resulting mass and momentum delta.

#### Scenario: A production boundary transform disagrees with its normative rule

- **WHEN** the same input state evaluated by the independent boundary oracle and the production
  transform produces a difference above the predeclared arithmetic tolerance
- **THEN** the record SHALL identify the first exact step, link, population values, and moment
  residual that disagree
- **AND** the result MAY be classified as an implementation discrepancy only if the mismatch
  repeats from the same saved input state

#### Scenario: The production transform matches the independent oracle

- **WHEN** every audited transform through the first abnormal system response matches the
  applicable normative rule within its predeclared tolerance
- **THEN** an implementation-discrepancy branch SHALL be rejected for that exposure
- **AND** the matching evidence SHALL remain available when formulation and interaction controls
  are interpreted

#### Scenario: Boundary ownership is ambiguous

- **WHEN** a link lies at an inlet, outlet, wall, free-slip, edge, or corner intersection whose
  owning rule cannot be reconstructed uniquely from the record
- **THEN** the localization SHALL be inconclusive
- **AND** it SHALL identify the missing ownership or ordering evidence instead of assigning the
  difference to an outlet implementation

### Requirement: Controlled ablations localize the feedback stage

The localization suite SHALL use matching initialized states to compare same-outlet repeats,
naive and Esoteric execution, flat and intersecting boundary layouts, collision-neutral and
production-collision behavior, and LES-disabled and configured-LES behavior. Each result SHALL
name the earliest stage supported by the evidence and SHALL retain competing mechanisms that the
controls do not separate.

#### Scenario: Same-outlet or execution-layout controls differ

- **WHEN** same-outlet repeats exceed their frozen repeatability limits or naive and Esoteric
  execution disagree before the candidate mechanism is reached
- **THEN** the causal classifier SHALL be inconclusive
- **AND** it SHALL retain the control failure as an execution or implementation finding

#### Scenario: A boundary intersection is necessary for the abnormal response

- **WHEN** a flat outlet control remains within its predicted response and adding one named
  boundary intersection repeatably introduces the first abnormal link or system response
- **THEN** the result MAY identify dependence on that boundary intersection
- **AND** it SHALL NOT generalize the finding to every zero-gradient outlet layout

#### Scenario: The normative zero-gradient transform produces feedback without an intersection

- **WHEN** the independent oracle confirms the normative transform, the flat outlet layout
  exhibits the predeclared abnormal mass-mode response, and collision-neutral and LES-disabled
  controls do not remove it
- **THEN** the result MAY classify formulation-level zero-gradient feedback as observed
- **AND** it SHALL report the perturbation response and boundary exchange that support the branch

#### Scenario: Collision or LES is required to amplify a bounded boundary response

- **WHEN** boundary transforms remain oracle-consistent and bounded in the neutral controls but
  the abnormal response appears only after enabling one collision or LES stage
- **THEN** the result SHALL identify that stage as a required amplifier
- **AND** it SHALL NOT describe the boundary rule alone as the complete mechanism

### Requirement: Localization does not silently become a repair

The localization change SHALL preserve production outlet, collision, LES, pressure, validation,
and historical-evidence policy. A named mechanism SHALL be recorded separately from a proposed
replacement, and the defect ledger SHALL advance only as far as the durable evidence supports.

#### Scenario: A mechanism branch is supported

- **WHEN** a localization branch satisfies every predeclared evidence condition
- **THEN** the durable record and defect ledger SHALL name the measured mechanism and its scope
- **AND** any production or handoff repair SHALL require a separate proposal with a normative or
  published source and independent acceptance gates

#### Scenario: No branch is uniquely supported

- **WHEN** multiple candidate mechanisms remain compatible with the completed controls
- **THEN** the result SHALL be classified as inconclusive with the surviving candidates listed
- **AND** no production default, acceptance outlet, health limit, or physics band SHALL change
