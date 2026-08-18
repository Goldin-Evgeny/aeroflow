## ADDED Requirements

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
