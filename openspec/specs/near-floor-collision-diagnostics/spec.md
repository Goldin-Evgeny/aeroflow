# near-floor-collision-diagnostics Specification

## Purpose

Defines the observables a solver run must expose so that an instability appearing as the bare
relaxation time approaches its floor (`τ₀ → ½`) can be attributed to a specific mechanism,
rather than only observed. Two candidate mechanisms currently predict the same signature and
have twice survived a revert without being separated, because the quantity that distinguishes
them is computed internally and never reported.

## Requirements

### Requirement: The relaxation rates actually in force are observable

The solver SHALL report, per collided cell, both relaxation rates it applied: the symmetric
rate governing the even moments and the antisymmetric rate governing the odd moments. Where
the subgrid closure varies the effective relaxation time per cell, the reported rates SHALL
be the ones that cell actually used, not the nominal values implied by configuration.

This requirement exists because the antisymmetric rate is presently derived from the magic
parameter inside the collision routine and discarded. A run that fails near the floor
therefore cannot report the value of the quantity most likely to explain it.

#### Scenario: Both rates are reported alongside the macroscopic state

- **WHEN** a cell is collided under any collision operator and any subgrid setting
- **THEN** the symmetric and antisymmetric relaxation rates applied to that cell SHALL be
  available to the caller in the same output the macroscopic quantities are read from

#### Scenario: Reported rates reflect per-cell subgrid variation

- **WHEN** the subgrid closure raises the effective relaxation time in one cell and not in
  another
- **THEN** the rates reported for those two cells SHALL differ accordingly, rather than both
  reporting a single configured value

#### Scenario: A single-relaxation operator reports consistent rates

- **WHEN** the collision operator applies one relaxation rate to all moments
- **THEN** both reported rates SHALL be equal, so a consumer need not special-case the
  operator to interpret them

### Requirement: The antisymmetric relaxation rate is independently controllable

The solver SHALL allow the antisymmetric relaxation rate to be set directly, independently of
the magic parameter that otherwise derives it. This is a re-parameterization of the same
two-relaxation-time operator, not an alternative operator.

The default parameterization SHALL remain unchanged and SHALL produce bit-identical results to
those recorded before this capability existed, because every recorded result depends on it.

#### Scenario: Default parameterization is bit-identical

- **WHEN** a case is run without setting the antisymmetric rate explicitly
- **THEN** every population SHALL be bit-identical to the same case run before this capability
  was added

#### Scenario: Explicit rate overrides the derived one

- **WHEN** the antisymmetric rate is set explicitly and the magic parameter is also set
- **THEN** the explicit rate SHALL be the one applied, and the resulting behaviour SHALL be
  distinguishable from the derived-rate run at the same bare relaxation time

#### Scenario: An out-of-range rate is rejected, not silently clamped

- **WHEN** the antisymmetric rate is set outside the stable interval the operator admits
- **THEN** the solver SHALL reject the configuration with an error naming the parameter and
  the admissible interval

### Requirement: Subgrid activity is measurable against an analytic zero

The solver SHALL expose the eddy viscosity it produced per cell, so it can be evaluated in a
region where the analytically correct value is exactly zero.

A freestream in an empty domain has zero strain rate by construction. Any eddy viscosity
reported there is therefore a numerical artifact measured against a known answer, which is a
stronger oracle than agreement with a benchmark and does not depend on any acceptance band.

#### Scenario: Eddy viscosity is reported per cell

- **WHEN** a case is run with the subgrid model active
- **THEN** the ratio of eddy viscosity to molecular viscosity SHALL be readable per cell

#### Scenario: Undisturbed freestream reports zero subgrid activity

- **WHEN** the eddy viscosity is evaluated over freestream cells of an empty domain, away
  from inlet, outlet and wall influence, where the analytic strain rate is zero
- **THEN** any non-zero value SHALL be reported as a measured artifact with its magnitude and
  spatial distribution, rather than reduced to a pass/fail

#### Scenario: The probe excludes cells whose analytic strain is not zero

- **WHEN** the freestream region is selected
- **THEN** cells within the boundary-influence distance of any inlet, outlet, or wall SHALL be
  excluded from the reported statistic, and the excluded count SHALL be reported

### Requirement: Regularized collision is dynamically insensitive to the antisymmetric rate

Where the projected regularization is active, it rebuilds the non-equilibrium populations from
a projection that is even in the lattice directions. In exact arithmetic the antisymmetric part
of the non-equilibrium is therefore identically zero and the antisymmetric relaxation rate acts
on nothing. In floating-point arithmetic, however, separately rounded opposite-direction
populations can leave an O(ulp) antisymmetric residual. A sufficiently large admissible
antisymmetric rate can move that residual across a population's rounding threshold without
giving it dynamical significance. The implementation SHALL satisfy the exact invariant below
that threshold and SHALL remain dynamically insensitive across the admissible interval.

This is currently asserted only by a source comment. It is the property that decides whether an
antisymmetric-relaxation mechanism can operate at all in the configurations used for
acceptance, every one of which runs with regularization active.

#### Scenario: Rates below the rounding threshold are bit-identical under regularization

- **WHEN** the same regularized case is run twice at two widely separated antisymmetric
  relaxation rates that remain below the measured half-ULP activation threshold, with all other
  configuration identical
- **THEN** every population SHALL be bit-identical between the two runs

#### Scenario: A larger admissible rate remains dynamically equivalent under regularization

- **WHEN** the same regularized case is run at a derived near-floor antisymmetric rate and at a
  larger admissible rate that crosses the population-rounding threshold
- **THEN** any population differences SHALL remain at roundoff magnitude
- **AND** the recorded macroscopic diagnostics SHALL agree to a stated floating-point tolerance
- **AND** both runs SHALL have the same stability outcome and, if they diverge, the same
  divergence step

#### Scenario: Varying the antisymmetric rate without regularization does change the result

- **WHEN** the same case is run twice at those same two rates with regularization disabled
- **THEN** the results SHALL differ, confirming the preceding scenario tests an invariant of
  regularization rather than an inert control path

### Requirement: Outlet-dependent near-floor feedback is discriminated by a controlled pair

The near-floor diagnostic suite SHALL compare the reproducing zero-gradient outlet with the stable pressure outlet at the same bare relaxation time, closure convention, collision settings, grid, initial state, and exposure budget. The comparison SHALL preserve enough time-resolved evidence to identify the earliest observed separation and SHALL distinguish observation from causal inference.

#### Scenario: Paired arms differ only by outlet behavior

- **WHEN** the outlet-feedback discriminator is started
- **THEN** the two arms SHALL record identical material configuration and initial-state identity except for the outlet behavior under test
- **AND** any unintended configuration difference SHALL make the comparison inconclusive

#### Scenario: The first measurable separation is retained

- **WHEN** the paired arms begin to diverge before either becomes non-finite
- **THEN** the record SHALL identify the earliest sampled interval and diagnostic in which they separate
- **AND** it SHALL retain boundary-local mass and momentum exchange, density evolution, subgrid activity, and resolved high-wavenumber content through that interval

#### Scenario: One outlet arm destabilizes

- **WHEN** one arm becomes non-finite while the paired arm remains finite through the declared exposure
- **THEN** the result SHALL report the divergence step, the last common interval, and the earliest preceding separation
- **AND** it SHALL classify outlet-dependent feedback as observed without claiming an unmeasured implementation, driver, or hardware root cause

#### Scenario: Neither arm separates within the exposure

- **WHEN** both arms remain finite and no diagnostic separation exceeds its predeclared repeatability threshold
- **THEN** the result SHALL report the completed exposure and no observed outlet-dependent separation
- **AND** it SHALL NOT claim that the previously reproduced instability was disproved

#### Scenario: Execution or numerical health invalidates the pair

- **WHEN** an arm fails to complete for a reason unrelated to the measured near-floor mechanism, or its required evidence is missing
- **THEN** the comparison SHALL be classified as inconclusive
- **AND** no mechanism verdict SHALL be emitted

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
