## 1. Establish the acceptance-outlet policy

- [x] 1.1 Add typed V11–V15 outlet-policy records with stable policy identity, selected outlet,
  qualification status, evidence reference, and lookup/validation helpers.
- [x] 1.2 Initialize each policy entry from the outlet currently used by its scored runner; do
  not promote any entry while defining the policy.
- [x] 1.3 Replace the studio-only Ahmed acceptance literal and AIJ runner literals with policy
  lookups while preserving their current resolved values bit-for-bit.
- [x] 1.4 Add consistency tests that fail when a scene, solver, browser readout, artifact, or
  exported report disagrees with the resolved policy outlet.
- [x] 1.5 Pin the generic CPU/GPU solver and scene-builder defaults so this change cannot alter
  the solver-wide zero-gradient default.

## 2. Make outlet identity auditable and resumable

- [x] 2.1 Extend Case A/fetch and urban artifact configuration with the resolved outlet and
  outlet-policy identity, retaining compatibility with historical artifacts.
- [x] 2.2 Include the outlet and policy identity in material configuration fingerprints used by
  bounded qualification records.
- [x] 2.3 Bind urban checkpoint metadata to the outlet and policy identity and reject a mismatch
  before restoring solver or averaging state.
- [x] 2.4 Mark explicit non-policy outlet overrides as diagnostic configurations while retaining
  their q, r, row, point, field-health, and conservation measurements.
- [x] 2.5 Suppress physics acceptance verdicts in UI, exports, and artifacts for non-policy
  overrides without changing numerical-health reporting.
- [x] 2.6 Add tests for old-artifact readability, same-policy restore, mismatched-outlet rejection,
  override suppression, and agreement across all artifact/report surfaces.

## 3. Freeze the bounded pressure qualification matrix

- [x] 3.1 Define a typed, stable qualification manifest before running evidence, covering scene
  family, backend, closure convention, boundary layout, relaxation regime, exposure, and every
  required verdict axis.
- [x] 3.2 Include reduced empty-tunnel pressure arms for both closure conventions through at
  least step 3600, using the existing near-floor relaxation point and complete-shell ledger.
- [x] 3.3 Include bounded pressure representatives for Ahmed body, ABL fetch, AIJ Case A, and
  urban Case C without applying their full-resolution physics bands.
- [x] 3.4 Include near-floor pressure-outlet CPU/GPU parity and urban checkpoint/resume arms.
- [x] 3.5 Predeclare repeatability/parity thresholds and reuse existing V11–V15 numerical-health
  policies; prohibit post-result threshold changes inside the classifier.
- [x] 3.6 Add a pure classifier that returns `qualified`, `failed`, or `inconclusive` and retains
  per-arm execution, health, conservation, parity, and bounded measurement evidence.

## 4. Verify the qualification machinery

- [x] 4.1 Test a fully passing matrix and require every manifest arm before `qualified` can be
  emitted.
- [x] 4.2 Test numerical-health, conservation, parity, and execution failures independently and
  require a `failed` or `inconclusive` result with a machine-readable reason.
- [x] 4.3 Test missing arms, missing diagnostics, configuration mismatches, and fingerprints that
  differ by more than the declared outlet variable.
- [x] 4.4 Prove bounded smoke measurements cannot be promoted to V11–V15 physics verdicts.
- [x] 4.5 Preserve the existing zero-gradient divergence reproducer and the pressure-stable
  control as regression evidence without treating either as the new matrix result.

## 5. Run evidence and conditionally promote pressure

- [x] 5.1 Run the opt-in qualification matrix and write a deterministic machine-readable artifact
  plus append-only human run record under `docs/validation/runs/`.
- [x] 5.2 Verify the artifact contains every manifest arm, source/dirty provenance, policy and
  configuration fingerprints, raw metrics, concrete limits, and classifier reasons.
- [x] 5.3 If the recorded result is `qualified`, update V11–V15 policy entries to pressure and link
  the evidence; if it is `failed` or `inconclusive`, retain the existing selections and record
  why promotion did not occur.
- [x] 5.4 After any promotion, verify Ahmed, fetch, Case A, and urban scored paths, exports, and
  checkpoint/resume all resolve pressure from the policy rather than a local literal.
- [x] 5.5 Update the validation ledger, run index, `VALIDATION.md`, `PHYSICS.md`, and relevant
  decision addenda with the bounded qualification result and its scale/causality limits.

## 6. Final verification and scope audit

- [x] 6.1 Run formatting on changed source files, lint, typecheck, and the full unit suite; record
  exact commands and results.
- [x] 6.2 Run bounded AIJ/Ahmed browser regressions, near-floor CPU/GPU parity, and bounded
  checkpoint/recovery without starting a production-scale V11 or V14 run.
- [x] 6.3 Run `openspec validate qualify-pressure-outlet-for-near-floor-validation --strict` and
  resolve every artifact or delta-spec error.
- [x] 6.4 Audit the final diff to prove no acceptance band, numerical-health limit, generic outlet
  default, pressure reconstruction, collision/LES default, or historical artifact changed.
- [x] 6.5 Record the next evidence requirement for a full-resolution pressure-outlet validation
  run without claiming that bounded qualification establishes physics accuracy.
