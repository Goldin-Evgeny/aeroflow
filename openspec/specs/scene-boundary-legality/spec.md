# scene-boundary-legality Specification

## Purpose

Defines which boundary-cell configurations are well-posed under the Esoteric Pull streaming
pattern, and requires that ill-posed scenes be rejected at construction rather than run to
completion producing silently wrong values.

## Requirements

### Requirement: An outlet must have a well-defined upstream source

An outlet cell copies from its upstream neighbour. The solver SHALL reject a scene in which
that copy has no defined value.

Under Esoteric Pull, a cell's populations are distributed across itself and its neighbours,
and out-of-domain writes are skipped. An outlet whose upstream neighbour lies on a domain
face therefore reads populations that were never written. This is a third case alongside
the two already rejected — an upstream neighbour that is solid, and one that is free-slip —
and SHALL be rejected on the same terms.

#### Scenario: Outlet adjacent to a domain face is rejected

- **WHEN** a scene places an outlet cell whose upstream neighbour lies on a domain face
- **THEN** scene construction SHALL fail with an error naming the offending cell and the
  reason

#### Scenario: Outlet with a solid or free-slip upstream neighbour remains rejected

- **WHEN** a scene places an outlet whose upstream neighbour is solid, or is free-slip
- **THEN** scene construction SHALL continue to fail, as it does today

#### Scenario: Strictly interior outlet is accepted

- **WHEN** an outlet plane is inset from every domain face such that each outlet cell's
  upstream neighbour is an interior fluid cell
- **THEN** the scene SHALL be accepted

#### Scenario: Legality does not depend on the lateral boundary condition

- **WHEN** the same body and domain are built under each supported lateral boundary
  condition
- **THEN** every resulting scene SHALL satisfy the same outlet-legality rule, so that the
  lateral boundary condition is the only variable between arms

### Requirement: Scene legality is enforced on every execution path

Scene validation SHALL be applied before a scene is executed, on every path that can
execute one, including paths that upload a scene to an accelerator.

A validation that only some execution paths perform allows one implementation to run a
configuration another refuses, which converts a rejected scene into an unreported wrong
answer.

#### Scenario: Accelerator path rejects what the reference path rejects

- **WHEN** a scene that the reference implementation rejects at construction is submitted
  to the accelerated implementation
- **THEN** it SHALL be rejected there too, before any step is executed, with an equivalent
  error

#### Scenario: Free-slip cells are validated against the configured faces

- **WHEN** a scene contains free-slip cells that do not lie on a configured free-slip face
- **THEN** it SHALL be rejected regardless of which execution path receives it

### Requirement: Boundary-condition coverage in the parity check

The correctness comparison between implementations SHALL cover the boundary and collision
configurations that shipped scenes actually use.

A comparison restricted to one collision operator, one relaxation time, and interior-only
outlets cannot observe divergence in the configurations under which results are recorded.

#### Scenario: Parity covers each shipped collision operator

- **WHEN** the parity check runs
- **THEN** it SHALL include every collision operator available to shipped scenes, not only
  the default

#### Scenario: Parity covers the near-floor relaxation regime

- **WHEN** the parity check runs
- **THEN** it SHALL include a case whose bare relaxation time is near the stability floor,
  the regime in which acceptance runs operate

#### Scenario: Parity covers boundary layouts used by shipped scenes

- **WHEN** the parity check runs
- **THEN** its scenes SHALL include the boundary layouts that shipped scenes use, so that a
  layout-dependent divergence is observable
