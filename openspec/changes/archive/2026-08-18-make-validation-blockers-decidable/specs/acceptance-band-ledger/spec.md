## ADDED Requirements

### Requirement: The ledger records current outcomes and unresolved defects

The authoritative validation ledger SHALL record, in machine-readable form, the current measured outcome for each validation case and each known defect that affects interpretation or execution. A defect record SHALL include a stable identity, priority, status, closure criterion, and durable evidence references. Allowed statuses SHALL distinguish at least open, mitigated, closed, and superseded claims.

#### Scenario: A current measured outcome is read

- **WHEN** a ledger entry has recorded evidence
- **THEN** it SHALL identify the measured value or categorical outcome, evidence artifact, source revision, material conventions, observation time, and whether the band passed

#### Scenario: A mitigation does not erase an unresolved cause

- **WHEN** a failure mode can be bounded, classified, or recovered but its initiating cause remains unresolved
- **THEN** the ledger SHALL record the operational mitigation separately from the still-open causal defect
- **AND** documentation SHALL NOT describe the initiating defect as fixed

#### Scenario: A defect is closed

- **WHEN** durable evidence satisfies the defect's predeclared closure criterion
- **THEN** the ledger status MAY become closed
- **AND** the closing evidence SHALL be linked from the record

#### Scenario: An explanation is falsified or superseded

- **WHEN** new evidence contradicts a documented explanation
- **THEN** the explanation SHALL be marked superseded with the contradicting evidence
- **AND** generated or verified documentation SHALL cease presenting it as the current explanation

#### Scenario: Documentation drifts from recorded status

- **WHEN** validation or physics documentation names an outcome, defect status, or causal explanation that disagrees with the ledger
- **THEN** an automated consistency check SHALL fail
