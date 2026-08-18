## MODIFIED Requirements

### Requirement: Numerical health is a distinct verdict axis

Each GPU physics validation case SHALL declare its required numerical-health metrics and limits in a machine-readable source before a scored run begins. Each artifact SHALL report whether those metrics were evaluated and, when evaluated, SHALL include at least non-finite-cell count, density bounds, and relative mass drift. Boundary flux or conservation-ledger closure SHALL be required when the scene has an applicable open boundary. A missing required metric or limit SHALL carry a machine-readable reason and SHALL NOT silently appear as a pass.

Numerical-health limits are validity guards, distinct from physics acceptance bands. They SHALL have stated provenance and SHALL NOT be calibrated after viewing the result they judge.

#### Scenario: Healthy field supports a physics verdict

- **WHEN** all required numerical-health metrics were evaluated and satisfy their predeclared limits
- **THEN** the artifact SHALL report numerical health separately from the physics-target result
- **AND** the physics-target verdict MAY be published

#### Scenario: Invalid field cannot masquerade as a physics measurement

- **WHEN** required numerical-health diagnostics detect non-finite or otherwise invalid field state
- **THEN** the run SHALL be classified as a numerical failure
- **AND** an aggregate probe value SHALL NOT be presented as a trustworthy physics verdict

#### Scenario: Health metric is unavailable

- **WHEN** a required health metric cannot be evaluated or has no declared limit
- **THEN** the numerical-health axis SHALL be marked unevaluated with a machine-readable reason
- **AND** it SHALL NOT be reported as passing
- **AND** the physics-target outcome SHALL remain recorded as a measurement but SHALL NOT be promoted as a valid verdict

#### Scenario: AIJ open-boundary run is scored

- **WHEN** an AIJ Case A, fetch, or urban run reaches its evaluation window
- **THEN** its artifact SHALL include the applicable open-boundary conservation closure alongside whole-field finiteness, density bounds, and relative mass drift
- **AND** each metric SHALL be compared with the limit declared for that case

#### Scenario: Health limits change

- **WHEN** a declared numerical-health limit is added or revised
- **THEN** the change SHALL record its provenance and rationale
- **AND** existing artifacts SHALL retain the limits under which they were originally judged
