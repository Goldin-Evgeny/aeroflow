## Context

See `proposal.md` for motivation. The current production path is D3Q19, quadratic equilibrium,
TRT, projected second-order regularization, and Smagorinsky closure. Its CPU authority and GPU
kernel agree, but the operator itself has measured mean-flow high-wavenumber gain above one near
`tau0 = 0.5`. Plain TRT damps that mode while worsening the constitutive ratio; RR3 failed the
frozen damping and `Pi/Pi_hydro < 1.2` gates; the research D3Q27 central-moment operator damps the
mode with comparable constitutive response but has a superlinear collision-carried momentum drift
and a larger storage footprint.

The existing D3Q19 memory layout, Esoteric Pull streaming, shifted-FP16 storage, boundary rules,
checkpoint format, numerical-health policy, and validation bands are constraints. The repository
also requires CPU authority before WGSL, explicit configuration provenance, and durable negative
evidence. The active pressure-outlet policy remains separate: changing collision must not make a
failed outlet qualification appear to pass retroactively.

Primary method reference: De Rosis and Coreixas, “Multiphysics flow simulations using D3Q19
lattice Boltzmann methods based on central moments,” _Physics of Fluids_ 32, 117101 (2020),
https://doi.org/10.1063/5.0026316. The paper motivates a D3Q19 central-moment candidate but does not
establish AeroFlow's near-floor envelope; only the repository's frozen matrix can do that.

## Goals / Non-Goals

**Goals:**

- Produce one independently testable D3Q19 collision candidate that does not use the measured
  projected-regularization path and preserves the existing 19-population storage architecture.
- Decide that candidate against the same high-k and constitutive observables that falsified the
  production operator and RR3, then extend the decision through parity, boundaries, memory, and
  throughput.
- Make a failed candidate a complete, useful result without changing production behavior.
- If the candidate qualifies, promote collision and the physically specified LES norm only through
  explicit policy records with rollback and historical reproduction.

**Non-Goals:**

- Repair or promote the existing D3Q27 research operator in this change.
- Relax the Q27 momentum gate, any numerical-health guard, physics band, or throughput target.
- Diagnose the internal zero-gradient outlet feedback or waive the failed pressure-outlet matrix.
- Claim V11-V15 accuracy from bounded collision qualification.
- Implement a menu of tunable collision models for end users.

## Decisions

### D1. The first new candidate is D3Q19 central-moment MRT

Implement a Float64 D3Q19 central-moment authority, identified as a versioned research candidate.
It retains the production lattice and storage footprint while replacing the projected
second-order reconstruction implicated by the measured instability. Conserved moments are left
unchanged; shear moments relax with the local `1/tauEff`; bulk and non-hydrodynamic moments use
fixed rates declared in the frozen manifest. The Smagorinsky input is taken from the candidate's
pre-collision non-equilibrium second moments using the shared closure constants and selected norm.

The candidate's exact moment basis, attractors, and rates are written as equations in
`docs/PHYSICS.md` and asserted independently by manufactured-moment tests. Parameter sweeps are
diagnostic only: the manifest selects one parameterization before qualification and no
post-result tuning can turn that run into a pass.

**Alternatives considered:**

- Repair D3Q27 first. Rejected for this change because its current collision-carried momentum drift
  is unexplained and 27 populations violate the goal of retaining the 19-population browser memory
  architecture.
- Retry RR3 or disable regularization. Rejected by existing frozen negative evidence.
- Start with a full cumulant implementation. Deferred because it adds a more complex nonlinear
  transform and relaxation surface before the central-moment hypothesis has been tested on the
  existing lattice. A failed D3Q19 central-moment record can justify that separate change.

### D2. Candidate selection is separate from the production `Collision` default

Add a versioned collision-policy record and a research-candidate registry. Existing `bgk`/`trt`
configuration continues to select the same path. Diagnostic selection requires an explicit
candidate identity and produces a non-acceptance configuration fingerprint. Only a qualifying
artifact can change the production policy to the new identity.

The identity is copied into live readouts, durable artifacts, exported reports, and checkpoints.
Checkpoint restore compares the identity before writing populations or averaging state.

**Alternative considered:** add the candidate immediately as another public `Collision` enum value.
Rejected because it would make an unqualified operator look shipped and would broaden every scene
API before the evidence exists.

### D3. Qualification proceeds from local CPU invariants to bounded GPU scenes

The execution order is deliberately asymmetric:

1. Manufactured local moments and conservation on the Float64 authority.
2. Exact Jacobian/von-Neumann analysis over the frozen near-floor matrix.
3. Nonlinear periodic shear waves and constitutive comparison.
4. Periodic conservation step/wavelength scaling and uniform-flow analytic-zero control.
5. Bounded empty-tunnel, ABL-fetch, Ahmed-body, Case A, and urban representatives on CPU.
6. A literal WGSL port, raw-population parity, FP32/shifted-FP16 parity, and the same bounded scenes.
7. Memory and throughput comparison on the declared adapter class.

A failed stage is recorded and blocks later production work. The GPU port may be omitted after a
CPU failure, in which case the overall result is `failed`, not `inconclusive`, because the
candidate already violated a decisive gate.

### D4. Reuse the established spectral and constitutive gates, broaden their coverage

The RR3 experiment already froze the decisive target gates: nonlinear modal gain below one and
`Pi/Pi_hydro < 1.2` at wavelength 3.2, with wavelength-8 modal gain and constitutive response within
2% of the resolved baseline. The new manifest retains those values and adds all relevant wave axes,
transverse polarizations, background velocities `{0, 0.05, 0.10}`, and bare/effective relaxation
points spanning the measured V11-V14 envelope. Linear amplification must not exceed one anywhere in
that matrix; the nonlinear target must decay after the declared discard window.

The zero-background and `tau = 0.8` arms are controls, not substitutes for the near-floor arms.
Finiteness or extra eddy viscosity cannot compensate for a failed gain or constitutive gate.

### D5. Conservation is tested before any corrective projection is considered

Candidate v1 performs no post-collision momentum patch. Local Float64 mass and momentum residuals
must meet the existing manufactured-collision scale (the current tests use `2e-15`), and the GPU
limit is derived from a forward-error bound for the exact f32 operation count and frozen in the
manifest before WGSL candidate results are read. Periodic gates are normalized by initial conserved
quantity and cell/step exposure so the Q27 unnormalized-gate ambiguity is not repeated.

If the candidate fails conservation, that result ends v1. An invariant-restoring projection would
be a separately identified candidate with its own spectral and constitutive rerun; it cannot be
silently patched into the failed configuration.

### D6. Preserve the D3Q19 memory budget and cap steady-state throughput loss at 10%

The candidate reuses 19 populations, current shifted-FP16 storage, and Esoteric Pull addressing, so
the per-cell storage and maximum-grid calculations must remain unchanged. On the same declared GPU,
scene, precision, workgroup, and submission schedule, at least three steady-state samples are taken
for production and candidate kernels. Candidate median MLUP/s may be at most 10% below production.

This mirrors the existing bounded-operation overhead doctrine and protects the browser-interactive
architecture. A slower scientifically valid operator remains valuable negative evidence but is not
promotable by this change.

### D7. Promotion has two explicit phases

Phase A qualifies collision with LES disabled and with both closure conventions in recording mode.
Phase B reruns the complete applicable matrix with `Cs = 0.1` and the specified Frobenius-norm
closure. The production policy changes only if Phase B remains fully qualified. The collision and
closure identities are then promoted atomically for affected near-floor acceptance paths; legacy
collision and closure remain selectable for historical reproduction.

No benchmark outcome changes during promotion. New V12, V13, V11, and V14 evidence is collected in
that order under separate runs after this change, because bounded admissibility is not physics
acceptance.

### D8. One durable classifier owns the decision

The typed manifest and pure classifier return `qualified`, `failed`, or `inconclusive` and retain
per-arm execution, invariant, spectral, constitutive, health, conservation, parity, memory, and
throughput axes. Machine-readable and human records are written append-only under
`docs/validation/runs/`. The validation defect ledger links the record and changes status only when
its existing closure criteria are actually met.

## Risks / Trade-offs

- **[D3Q19 central moments may retain lattice anisotropy or fail at the production Reynolds
  regime]** -> The orientation/polarization matrix and bounded scene ladder fail the candidate
  without changing production; D3Q27/cumulant work remains a separate next option.
- **[A free higher-order relaxation rate could be tuned to the test]** -> Freeze one literature-
  derived parameterization and its rationale before candidate outputs; any alternate rates receive
  a new identity and complete matrix.
- **[CPU matrix inversion may hide a GPU-specific algebraic error]** -> Use independent
  manufactured moments, literal WGSL porting, raw-population parity, and precision-specific
  invariant bounds before scene tests.
- **[Ten-percent throughput loss may reject the only correct operator]** -> Preserve the negative
  result and propose an explicit performance/architecture decision rather than silently weakening
  the gate.
- **[A bounded candidate passes but production validation remains wrong]** -> Keep V11-V15 outcomes
  unchanged until benchmark-faithful reruns; qualification claims only operator admissibility.
- **[The dirty archived pressure change overlaps artifact/checkpoint identity]** -> Land or otherwise
  stabilize that work before implementation, then extend its material-identity pattern instead of
  creating a competing fingerprint.

## Migration Plan

1. Land the currently verified pressure-policy/checkpoint work so the implementation baseline is
   stable.
2. Commit the frozen manifest, candidate identity, equations, and CPU-only controls before running
   the new candidate.
3. Implement the D3Q19 central-moment authority and run Phase A CPU gates. Record and stop on failure.
4. If CPU-qualified, port literally to WGSL and run parity, bounded scene, memory, and throughput
   gates. Record and stop on failure.
5. If collision-qualified, run Phase B with the specified LES convention.
6. Only on a complete `qualified` record, update the production collision/closure policy and all
   consumers together; otherwise leave defaults untouched.
7. Run full unit, type, lint, browser, GPU parity, checkpoint/recovery, OpenSpec, and diff-scope
   verification. Subsequent benchmark reruns remain separate evidence work.

Rollback selects the previous production policy identity. Because checkpoints bind the collision
and closure identities, incompatible state is rejected rather than migrated. Historical artifacts
remain immutable.
