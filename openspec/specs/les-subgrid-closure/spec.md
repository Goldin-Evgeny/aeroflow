# les-subgrid-closure Specification

## Purpose

Defines the Smagorinsky subgrid closure the solver applies at high Reynolds number: which
tensor norm pairs with which coefficient, what effective relaxation time results, and how
any diagnostic that inverts the closure is kept consistent with it.

## Requirements

### Requirement: The subgrid closure matches its published form

The solver SHALL compute the turbulent relaxation time from the non-equilibrium momentum
flux tensor using the Hou et al. (1996) closure as stated in `docs/PHYSICS.md` §5, in
which the coefficient `18√2·Cs²` is paired with the **Frobenius** norm of the tensor,
`Π̄ = √(Σ_αβ Π_αβ²)`.

The pairing of coefficient and norm is normative. An implementation SHALL NOT substitute
a norm that differs from the Frobenius norm by a constant factor while retaining the
coefficient, because the product — not either factor alone — determines the eddy
viscosity.

#### Scenario: Closure reproduces the analytic Smagorinsky target

- **WHEN** the closure is evaluated for a manufactured non-equilibrium tensor whose
  implied strain rate is known analytically
- **THEN** the resulting turbulent viscosity SHALL equal `Cs²·|S|` to within floating-point
  tolerance, where `|S| = √(2·S:S)`
- **AND** the check SHALL derive its expected value from the analytic target, not from
  the solver's own constants

#### Scenario: Effective Cs equals nominal Cs

- **WHEN** the solver is configured with a nominal `Cs`
- **THEN** the eddy viscosity produced in the resolved limit SHALL correspond to that
  same `Cs`, with no constant inflation factor

#### Scenario: Closure is inert in resolved laminar flow

- **WHEN** the flow is resolved and laminar, so the non-equilibrium tensor approaches zero
- **THEN** the turbulent relaxation time SHALL approach zero
- **AND** the effective relaxation time SHALL approach the bare relaxation time from above,
  never below it

### Requirement: The closure convention is selectable during migration

Because correcting the closure moves every recorded result obtained with the subgrid model
active, the solver SHALL expose the closure convention as an explicit configuration choice
with two values: the specified convention, and the legacy convention that reproduces
previously recorded results bit-for-bit.

The legacy convention SHALL remain available until every affected validation case has been
re-baselined under the specified convention, and SHALL be documented as an error preserved
for reproducibility rather than as a modelling option.

#### Scenario: Legacy convention reproduces historical results

- **WHEN** a case is run under the legacy convention
- **THEN** it SHALL produce the same result as before this change

#### Scenario: Convention is recorded with every result

- **WHEN** a result is recorded from a run with the subgrid model active
- **THEN** the closure convention in force SHALL be recorded alongside it, so that any two
  results can be compared only when their conventions agree

### Requirement: Diagnostics that invert the closure stay consistent with it

Any diagnostic that recovers a strain rate from an observed effective relaxation time
SHALL invert the closure convention actually in force.

This requirement exists because the inversion and the closure share a constant: an
inversion tuned to one convention silently rescales its output when the closure changes,
which would move a reported diagnostic for a bookkeeping reason rather than a physical one.

#### Scenario: Round-trip through closure and inversion is the identity

- **WHEN** a known strain rate is passed through the closure to obtain an effective
  relaxation time, and that relaxation time is passed back through the diagnostic inversion
- **THEN** the recovered strain rate SHALL equal the original, under either convention

#### Scenario: Strain audit is invariant to the convention change

- **WHEN** the same stored field is audited under both conventions, each with its matching
  inversion
- **THEN** the reported ratio of closure-implied strain to finite-difference strain SHALL
  be identical, because that ratio is a property of the field and not of the constant

### Requirement: The closure constant has a single definition

The coefficient relating `Cs` to the closure SHALL be defined in exactly one place and
referenced everywhere it is used, including by tests.

A test that re-declares the constant locally asserts the implementation against a copy of
itself and cannot detect an error in the shared definition.

#### Scenario: No independent re-declaration exists

- **WHEN** the source tree is searched for the closure coefficient
- **THEN** it SHALL appear as one definition and any number of references to it, with no
  independently written copies in tests or diagnostics

### Requirement: A near-floor subgrid result carries the context needed to attribute it

Where a result is recorded from a run whose bare relaxation time is close to its floor, the
recorded context SHALL include the relaxation rates in force and the subgrid activity measured
where the analytic strain rate is zero, in addition to the closure convention already required.

This requirement exists because two attempts to correct the closure convention were reverted on
near-floor destabilization, and neither revert could attribute the failure: the antisymmetric
relaxation rate was never reported, and subgrid activity was never measured against a known
zero. A result that cannot be attributed costs the run and settles nothing.

#### Scenario: Near-floor result records its relaxation rates

- **WHEN** a result is recorded from a run with the subgrid model active and a bare relaxation
  time near the floor
- **THEN** the recorded context SHALL include the symmetric and antisymmetric relaxation rates
  in force, alongside the closure convention

#### Scenario: Near-floor result records freestream subgrid activity

- **WHEN** such a run has a region whose analytic strain rate is zero
- **THEN** the subgrid activity measured over that region SHALL be recorded with the result

#### Scenario: A destabilized run records what it reached before diverging

- **WHEN** such a run terminates on a non-finite value rather than completing
- **THEN** the step at which it diverged and the recorded context above SHALL still be
  preserved, because a divergence is the observation the comparison rests on

### Requirement: An analytic-zero subgrid claim remains valid for its full measurement window

A recorded analytic-zero subgrid measurement SHALL establish that every included cell has zero analytic strain throughout the declared measurement window. The selection SHALL account for boundary influence that grows with elapsed simulation time. A fixed geometric exclusion SHALL NOT support a long-run analytic-zero claim once measured boundary influence reaches the selected region.

#### Scenario: Boundary influence grows during a wall-bounded run

- **WHEN** the measured boundary-influence distance increases during the measurement window
- **THEN** the included region SHALL be recomputed from the largest supported influence distance for that window
- **AND** the artifact SHALL record the influence criterion, included count, excluded count, and spatial extent

#### Scenario: Boundary influence reaches the selected region

- **WHEN** no non-empty region can still be shown to have zero analytic strain
- **THEN** the wall-bounded measurement SHALL be marked invalid for an analytic-zero claim
- **AND** its values MAY remain available only as boundary-contaminated diagnostics

#### Scenario: Boundary-free manufactured oracle is used

- **WHEN** a wall-bounded scene cannot retain a valid analytic-zero region for the required exposure
- **THEN** the closure SHALL be evaluated on a manufactured uniform-flow oracle without a strain-producing boundary
- **AND** the oracle SHALL report any non-zero subgrid activity with its magnitude, spatial distribution, precision, closure convention, and exposure

#### Scenario: Empty selection cannot report zero artifact

- **WHEN** the validity filter leaves no included cells
- **THEN** the measurement SHALL fail as unavailable rather than report a zero statistic or a passing result

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
