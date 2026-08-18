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
