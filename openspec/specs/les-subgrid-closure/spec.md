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
