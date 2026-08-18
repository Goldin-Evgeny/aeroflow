## 1. Stabilize identity and freeze the decision

- [x] 1.1 Verify the archived pressure-policy/checkpoint implementation is landed or otherwise
      isolated as a stable baseline, and record the exact source revision from which collision work
      starts.
- [x] 1.2 Add a typed production collision-policy record and opt-in research-candidate registry with
      stable operator, lattice, equilibrium, moment-basis, relaxation, regularization, conservation,
      and implementation identities.
- [x] 1.3 Extend material configuration fingerprints, durable artifacts, live/exported reports, and
      checkpoint metadata with the collision-policy and candidate identities while retaining
      historical artifact readability.
- [x] 1.4 Add consistency and restore tests proving omitted selection remains bit-identical,
      diagnostic candidates cannot publish physics verdicts, and collision-identity mismatches are
      rejected before state mutation.
- [x] 1.5 Define and persist the versioned qualification manifest before candidate output, including
      the exact D3Q19 central-moment basis/rates, every arm, exposure, precision, configuration,
      fingerprint field, metric, and gate.
- [x] 1.6 Implement a pure `qualified`/`failed`/`inconclusive` classifier and test complete-pass,
      single-axis failure, missing evidence, fingerprint mismatch, and manifest-version mismatch.

## 2. Build the D3Q19 central-moment CPU authority

- [x] 2.1 Document the independently transcribed D3Q19 central-moment basis, inverse, equilibrium
      attractors, and relaxation map in `docs/PHYSICS.md`, with provenance and no dependency on
      license-incompatible source code.
- [x] 2.2 Implement the Float64 forward/inverse central-moment transforms and verify round-trip
      identity, basis rank, equilibrium moments, symmetry, and lower-moment orthogonality on
      manufactured states.
- [x] 2.3 Implement the versioned candidate collision with conserved moments unchanged, shear
      relaxation from local `tauEff`, and the frozen bulk/non-hydrodynamic rates.
- [x] 2.4 Feed the candidate's pre-collision non-equilibrium second moments through the shared
      Smagorinsky constants and selected norm, and expose `tauEff`, stress, rates, and invariant
      residuals to diagnostics.
- [x] 2.5 Add manufactured collision tests for equilibrium invariance, mass/momentum residuals,
      Galilean backgrounds, all tensor orientations, both LES conventions, and invalid configuration
      rejection.
- [x] 2.6 Integrate the candidate into the CPU periodic and bounded diagnostic runners without
      widening the public production `Collision` selection or changing existing scene output.

## 3. Run the frozen CPU qualification subset

- [x] 3.1 Extend the guarded Jacobian/von-Neumann analysis to the candidate and run every frozen
      relaxation, mean-velocity, wave-axis, polarization, and wavelength arm.
- [x] 3.2 Extend the nonlinear periodic shear harness and enforce target modal gain below one,
      `Pi/Pi_hydro < 1.2` at wavelength 3.2, and wavelength-8 gain/constitutive preservation within
      2%, without post-result threshold edits.
- [x] 3.3 Run the normalized periodic mass/momentum step-and-wavelength ladder, uniform-flow
      analytic-zero control, seeded-response control, and local collision-invariant checks.
      **Not executed:** the preceding nonlinear constitutive gate failed decisively.
- [x] 3.4 Run bounded production-operator, plain-TRT, RR3, D3Q27 research-control, and candidate arms
      with identical material and initialized-state fingerprints, preserving established negative
      results rather than recomputing their interpretation.
      **Not executed:** the preceding nonlinear constitutive gate failed; established negative records
      remain unchanged.
- [x] 3.5 Run candidate CPU representatives for the empty tunnel, ABL fetch, Ahmed body, Case A, and
      urban scene families with complete-shell conservation and numerical-health evidence but no
      physics acceptance verdicts.
      **Not executed:** the preceding nonlinear constitutive gate failed decisively.
- [x] 3.6 Write deterministic machine-readable and human CPU qualification records with raw
      measurements, limits, classifier reasons, provenance, and all verdict axes.
- [x] 3.7 If any decisive CPU gate fails, record the candidate as failed, prove production policy is
      unchanged, mark GPU/Phase-B arms as intentionally not executed, and stop candidate implementation
      without classifying absent downstream arms as the cause of failure.

## 4. Port and qualify the accelerated candidate conditionally

**Not executed:** Phase A failed at the decisive CPU nonlinear constitutive gate. Every GPU arm is
recorded as `not-run-upstream-failed` in the durable classifier output.

- [x] 4.1 If and only if the CPU subset qualifies, implement a literal D3Q19 central-moment WGSL
      collision path using the existing 19-population Esoteric Pull and shifted-FP16 storage layouts.
- [x] 4.2 Add candidate selection to GPU pipeline specialization and every bounded diagnostic path
      while keeping normal scene construction on the existing production policy.
- [x] 4.3 Add raw-population, macro-field, stress, `tauEff`, invariant, and health parity arms for
      FP32 and shifted FP16 across periodic, near-floor, and shipped boundary layouts.
- [x] 4.4 Freeze the f32 invariant/parity limits from an explicit forward-error analysis before
      reading candidate GPU results, and reject any candidate-specific tolerance calibrated from its
      output.
- [x] 4.5 Run bounded empty-tunnel, fetch, Ahmed, Case A, and urban GPU representatives plus
      checkpoint/save/restore under matching CPU/GPU configuration fingerprints.
- [x] 4.6 Verify the candidate retains the D3Q19 per-cell memory calculation and measure at least
      three steady-state production/candidate samples on the same adapter; enforce at most 10% median
      MLUP/s loss.
- [x] 4.7 Append accelerated raw evidence and classifier output to the durable qualification record,
      or record the precise failed/inconclusive axis without changing production policy.

## 5. Qualify the specified LES convention conditionally

**Not executed:** collision-only Phase A did not qualify. Every joint LES arm is recorded as
`not-run-upstream-failed`; the specified norm remains non-default.

- [x] 5.1 After collision-only qualification, run the complete applicable matrix with `Cs = 0.1`
      and the specified Frobenius-norm closure while retaining legacy-convention controls.
- [x] 5.2 Verify analytic-zero subgrid activity, seeded response, closure/inversion round-trip,
      near-floor spectral damping, constitutive fidelity, numerical health, conservation, parity,
      checkpoint identity, memory, and throughput under the joint configuration.
- [x] 5.3 Write a joint collision/closure fingerprint and a complete Phase-B artifact whose
      classifier cannot inherit a pass from the collision-only phase.
- [x] 5.4 If Phase B fails or is incomplete, preserve the specified convention as non-default,
      retain the collision-only measurement, and record the joint configuration's failed axes.

## 6. Promote or retain production policy from evidence

- [x] 6.1 If and only if the complete Phase-B record is `qualified`, atomically select the candidate
      collision and specified LES convention in the authoritative production policy and update every
      affected CPU, GPU, scene, runner, UI, artifact, report, and checkpoint consumer.
      **Not executed:** Phase B was blocked by the decisive Phase-A failure.
- [x] 6.2 Preserve explicit legacy collision/closure reproduction, historical schema readability,
      and rollback; prove old evidence is not rescored or relabeled after promotion.
- [x] 6.3 If no joint candidate qualifies, prove all production defaults and scored-run selections
      remain bit-identical and update the defect ledger with the durable negative result and next
      discriminating candidate requirement.
- [x] 6.4 In either outcome, verify the pressure-outlet policy/result, zero-gradient causal defect,
      Q27 drift status, numerical-health limits, physics bands, and V11-V15 recorded outcomes are
      unchanged.

## 7. Final verification and handoff

- [x] 7.1 Run changed-file formatting, lint, typecheck, and the full unit suite; record exact commands,
      counts, skipped opt-in tests, revision, and dirty-state fingerprint.
- [x] 7.2 Run the required bounded browser, CPU/GPU parity, checkpoint/recovery, numerical-health,
      and performance suites appropriate to the last completed qualification stage.
      **Stage boundary:** the last completed stage was CPU nonlinear qualification; GPU/browser and
      performance arms were intentionally not run after its decisive failure. CPU authority,
      checkpoint, numerical-health, Q27, pressure, and complete unit regressions passed.
- [x] 7.3 Run `openspec validate qualify-velocity-stable-near-floor-collision --strict`, validate the
      main specs, and resolve every structural or delta-spec error.
- [x] 7.4 Audit the final diff for accidental acceptance-band, health-limit, outlet, boundary,
      historical-artifact, storage-layout, or default-selection changes and run `git diff --check`.
- [x] 7.5 Update `VALIDATION.md`, `PHYSICS.md`, the validation index, relevant decision addenda, and
      machine-readable defect ledger with the bounded result and its explicit non-claim about V11-V15
      benchmark accuracy.
- [x] 7.6 Record the next benchmark sequence as separate evidence work—V12, V13, V11, then V14—only
      if a joint collision/closure configuration was promoted.
      **Not applicable:** no joint configuration was promoted, so no benchmark rerun was authorized.
