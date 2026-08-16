# solver-failure-visibility Specification

## Purpose

Requires the solver to fail loudly rather than plausibly: undefined, diverged, or
unresolvable state must never be reported as a finite in-range value that a downstream
consumer would mistake for a measurement.

## Requirements

### Requirement: Undefined state is never reported as a plausible value

Where the reference implementation raises an error on unresolvable state, the accelerated
implementation SHALL surface an equally detectable condition rather than returning a value
that appears valid.

An accelerated kernel cannot raise, so it SHALL propagate a value that existing field
diagnostics already detect and report, and the run SHALL surface that condition rather than
completing silently.

#### Scenario: Unresolvable boundary read is detectable

- **WHEN** a boundary resolution fails to terminate, or terminates in a state the reference
  implementation rejects
- **THEN** the accelerated implementation SHALL produce a value that field diagnostics
  detect as invalid, rather than reading unrelated storage

#### Scenario: Singular decomposition is detectable

- **WHEN** a matrix decomposition encounters a pivot the reference implementation rejects as
  singular
- **THEN** the accelerated implementation SHALL surface the condition rather than dividing
  and propagating a non-finite result without diagnosis

#### Scenario: A detected condition fails the run

- **WHEN** field diagnostics detect an invalid value
- **THEN** the run SHALL report it as a failure rather than proceeding to record a result

### Requirement: Diverged cells are not reported as quiescent

A cell whose density is not a valid positive number SHALL NOT have its velocity reported as
zero.

Reporting zero velocity for a diverged cell makes it indistinguishable from still fluid to
any consumer that reduces over velocity alone, which is the majority of the wake, profile,
flux and symmetry diagnostics.

#### Scenario: Velocity-only reducers observe divergence

- **WHEN** a cell's density is not a valid positive number
- **THEN** the reported velocity for that cell SHALL be invalid rather than zero
- **AND** a diagnostic that reduces only over velocity SHALL be able to detect it

### Requirement: A conservation correction that cannot take effect is not reported as active

Where a correction's magnitude is below the resolution of the storage format it is written
to, the configuration SHALL be rejected, or the associated metric SHALL report that the
correction is inactive.

A metric that reports on a correction quantized away at the point of storage describes a
control that is not connected to anything.

#### Scenario: Ineffective correction is not silently enabled

- **WHEN** a conservation correction is requested together with a storage format whose
  resolution exceeds the correction's magnitude
- **THEN** the configuration SHALL be rejected, or the correction SHALL be reported as
  inactive

#### Scenario: Conservation metric reflects reality

- **WHEN** the conservation metric is reported
- **THEN** it SHALL distinguish "correction applied and holding" from "correction not in
  effect"

### Requirement: Documented behaviour matches shipped behaviour

Where the physics documentation describes a scheme the solver implements, the description
SHALL match what the solver does.

#### Scenario: Forcing scheme description matches the default

- **WHEN** the documentation describes the forcing scheme
- **THEN** it SHALL describe the scheme the solver actually applies by default, and note
  which alternatives are rejected and under what conditions

#### Scenario: Reported velocity description matches implementation

- **WHEN** the documentation states what quantity the macroscopic velocity accessor returns
- **THEN** that statement SHALL match the value returned

#### Scenario: Momentum exchange on a moving wall is complete

- **WHEN** a momentum-exchange force is computed at a boundary whose wall velocity is
  non-zero
- **THEN** the computation SHALL include the wall-velocity contribution to the returning
  population, consistent with the documented derivation
