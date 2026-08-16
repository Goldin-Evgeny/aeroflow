# wall-height-convention Specification

## Purpose

Defines the mapping between a lattice row index and physical height above a no-slip wall
under halfway bounce-back, and requires every consumer of that mapping — inlet profiles,
probe placement, and validation scoring — to use the same one.

## Requirements

### Requirement: Height is measured from the bounce-back wall plane

Under halfway bounce-back the no-slip plane lies midway between the solid node and its
first fluid neighbour. Where a wall occupies the boundary row, the physical height of a
lattice row SHALL be measured from that plane, placing the first fluid row half a cell
above the wall.

The convention SHALL be stated normatively in the physics documentation, including which
row the wall occupies, so that it is resolved by specification rather than inferred from
code comments.

#### Scenario: First fluid row sits half a cell above the wall

- **WHEN** the height of the first fluid row above a wall row is requested
- **THEN** it SHALL be one half of the cell spacing

#### Scenario: Height mapping round-trips

- **WHEN** a physical height is converted to a lattice coordinate and back
- **THEN** the original height SHALL be recovered to within floating-point tolerance

#### Scenario: Wall plane maps to zero height

- **WHEN** the lattice coordinate of the bounce-back plane is converted to a height
- **THEN** the result SHALL be zero

### Requirement: All consumers of the mapping agree

Inlet profile generation, probe placement, and validation scoring SHALL use one shared
definition of the height mapping.

These consumers are individually self-consistent even when all of them are wrong together,
so agreement among them is not evidence of correctness; agreement with the wall plane is.

#### Scenario: Prescribed inlet velocity matches the row's true height

- **WHEN** an inlet profile is generated for a domain with a wall row
- **THEN** the velocity prescribed at each fluid row SHALL be the profile evaluated at that
  row's true height above the wall plane

#### Scenario: A measurement probe resolves to its stated height

- **WHEN** a validation probe specified at a physical height is resolved to a lattice
  position
- **THEN** that position's true height above the wall plane SHALL equal the specified height

#### Scenario: Changing the mapping moves every consumer together

- **WHEN** the shared height mapping is changed
- **THEN** inlet generation, probe placement, and scoring SHALL all reflect the change, with
  no consumer retaining an independent copy

### Requirement: Near-wall resolution rules are evaluated against true height

Rules that constrain how close a measurement may sit to a wall — such as a minimum node
index for a probe — SHALL be evaluated against the true height mapping.

Evaluating such a rule against an offset mapping can report a probe as satisfying a
resolution requirement it does not satisfy, or as violating one it does.

#### Scenario: Probe resolution status reflects true height

- **WHEN** a probe's compliance with a near-wall resolution rule is determined
- **THEN** the determination SHALL use the probe's true height above the wall plane

#### Scenario: Under-resolved probes are reported, not silently scored

- **WHEN** a probe sits below the height its resolution rule requires
- **THEN** the run SHALL report that condition rather than score the point as if it were
  resolved
