## Why

The production D3Q19 regularized-TRT operator amplifies mean-flow transverse modes near
`tau0 = 0.5`, overstates grid-scale strain, and drives Smagorinsky viscosity far above the
resolved value. This invalidates nominal-Reynolds-number claims and confounds V11-V14; outlet
changes cannot repair it, disabling regularization worsens constitutive fidelity, RR3 failed its
predeclared gates, and D3Q27 central moments still fail their momentum-drift gate.

## What Changes

- Define a frozen, bounded qualification matrix for velocity-stable collision candidates at the
  measured near-floor operating envelope, covering linear amplification, nonlinear decay,
  constitutive fidelity, conservation, numerical health, CPU/GPU parity, and throughput.
- Introduce explicit candidate identities and configuration fingerprints so exploratory collision
  results cannot be confused with the production operator or historical evidence.
- Implement and evaluate candidates behind opt-in selection. No candidate becomes a scored-run or
  solver default until every predeclared correctness and performance gate passes.
- Promote exactly one qualified candidate, if one exists, consistently across CPU, GPU, parity,
  checkpoints, durable artifacts, and affected near-floor validation runners. A failed or
  inconclusive matrix leaves production behavior unchanged.
- Re-attempt the physically specified Smagorinsky norm only after collision qualification, with a
  separate bounded stability gate and without changing any physics acceptance band.
- Record negative results durably, including the already-established plain-TRT, RR3, and D3Q27
  controls, without relabeling them as repairs.

## Capabilities

### New Capabilities

- `near-floor-collision-stability`: Defines collision-candidate identity, the frozen qualification
  matrix, admissible promotion rules, and the production operating-envelope evidence required for
  a velocity-stable near-floor operator.

### Modified Capabilities

- `les-subgrid-closure`: Binds migration to the physically specified LES norm to a collision
  operator that passes near-floor stability and constitutive-fidelity gates, and requires the
  selected collision and norm identities in resulting evidence.

## Impact

Affected areas include the shared CPU collision authority, GPU collision shader generation or
kernels, solver option types, parity and eigenanalysis harnesses, near-floor/LES diagnostics,
durable run and checkpoint configuration identity, validation policy, and physics documentation.
The change may add an opt-in collision implementation but does not change the current production
default, outlet policy, acceptance bands, numerical-health limits, or historical artifacts unless
and until the frozen qualification record authorizes promotion.
