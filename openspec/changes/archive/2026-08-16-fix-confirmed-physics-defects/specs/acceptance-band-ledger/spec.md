## Purpose

Establishes one authoritative machine-readable source for every validation case's
acceptance band and gate status, so that specs, harnesses, user-facing text and documentation
cannot disagree about what a case must achieve to pass.

## ADDED Requirements

### Requirement: Acceptance bands have one authoritative source

Every validation case's acceptance band SHALL be defined in exactly one machine-readable
location, and every consumer SHALL reference it rather than restating its values.

Consumers include validation harnesses, user-facing readouts, and the validation
documentation. A band restated in a second location can drift from the first, and neither
copy carries evidence of which is current.

#### Scenario: No duplicated band values exist

- **WHEN** the source tree is searched for a case's acceptance band values
- **THEN** they SHALL appear in the authoritative ledger and nowhere else as literals

#### Scenario: Documentation agrees with the ledger

- **WHEN** the validation documentation states a case's acceptance band
- **THEN** that band SHALL be derived from the ledger, or verified against it automatically

#### Scenario: Each entry carries its provenance

- **WHEN** a case's band is read from the ledger
- **THEN** the entry SHALL identify the quantity being bounded and cite the source the band
  comes from

### Requirement: Every case declares whether it is gated

Each ledger entry SHALL declare whether the case is enforced as a hard assertion or is
recorded without assertion.

This makes the enforcement state of the validation suite readable in one place, rather than
inferable only by reading each harness to see whether it asserts.

#### Scenario: A gated case is actually asserted

- **WHEN** a case is declared gated
- **THEN** an automated check SHALL confirm that a harness asserts that case's band, and
  SHALL fail if none does

#### Scenario: A recording case does not assert

- **WHEN** a case is declared recording
- **THEN** its harness SHALL compute and record the measured value and its band comparison
  without failing the run

#### Scenario: Enforcement state cannot regress unnoticed

- **WHEN** a case declared gated has its assertion removed
- **THEN** the automated check SHALL fail

### Requirement: Cases are promoted to gated only when they pass

A case SHALL be promoted from recording to gated in the same change that establishes it
meets its band.

This keeps the continuous-integration signal meaningful: a case with a known, recorded
failure remains in the recording state until it is repaired, so the suite is never left
permanently failing, and a repaired case cannot silently remain unenforced.

#### Scenario: A known-failing case stays recording

- **WHEN** a case's measured value is outside its band and the cause is not yet repaired
- **THEN** the case SHALL remain in the recording state and its failure SHALL remain
  documented

#### Scenario: A repaired case is promoted with its repair

- **WHEN** a change causes a previously failing case to meet its band
- **THEN** that change SHALL also promote the case to gated

#### Scenario: Promotion state is visible

- **WHEN** the validation suite is summarised
- **THEN** the count of gated and recording cases SHALL be reportable from the ledger alone

### Requirement: Results record the conditions they were obtained under

A recorded result SHALL carry the configuration that materially determines it, including
any solver convention that is under migration.

Results obtained under different conventions are not comparable, and a ledger that records
values without conventions cannot tell a regression from a convention change.

#### Scenario: Convention accompanies a recorded value

- **WHEN** a result is recorded for a case
- **THEN** the record SHALL include the solver conventions in force for that run

#### Scenario: Incomparable results are not compared

- **WHEN** two results for the same case were obtained under different conventions
- **THEN** any comparison between them SHALL identify the convention difference rather than
  present the difference as a physical change
