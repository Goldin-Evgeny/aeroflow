## ADDED Requirements

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
