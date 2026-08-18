## ADDED Requirements

### Requirement: Outlet-dependent near-floor feedback is discriminated by a controlled pair

The near-floor diagnostic suite SHALL compare the reproducing zero-gradient outlet with the stable pressure outlet at the same bare relaxation time, closure convention, collision settings, grid, initial state, and exposure budget. The comparison SHALL preserve enough time-resolved evidence to identify the earliest observed separation and SHALL distinguish observation from causal inference.

#### Scenario: Paired arms differ only by outlet behavior

- **WHEN** the outlet-feedback discriminator is started
- **THEN** the two arms SHALL record identical material configuration and initial-state identity except for the outlet behavior under test
- **AND** any unintended configuration difference SHALL make the comparison inconclusive

#### Scenario: The first measurable separation is retained

- **WHEN** the paired arms begin to diverge before either becomes non-finite
- **THEN** the record SHALL identify the earliest sampled interval and diagnostic in which they separate
- **AND** it SHALL retain boundary-local mass and momentum exchange, density evolution, subgrid activity, and resolved high-wavenumber content through that interval

#### Scenario: One outlet arm destabilizes

- **WHEN** one arm becomes non-finite while the paired arm remains finite through the declared exposure
- **THEN** the result SHALL report the divergence step, the last common interval, and the earliest preceding separation
- **AND** it SHALL classify outlet-dependent feedback as observed without claiming an unmeasured implementation, driver, or hardware root cause

#### Scenario: Neither arm separates within the exposure

- **WHEN** both arms remain finite and no diagnostic separation exceeds its predeclared repeatability threshold
- **THEN** the result SHALL report the completed exposure and no observed outlet-dependent separation
- **AND** it SHALL NOT claim that the previously reproduced instability was disproved

#### Scenario: Execution or numerical health invalidates the pair

- **WHEN** an arm fails to complete for a reason unrelated to the measured near-floor mechanism, or its required evidence is missing
- **THEN** the comparison SHALL be classified as inconclusive
- **AND** no mechanism verdict SHALL be emitted
