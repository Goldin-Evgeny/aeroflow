# 2026-08-18-near-floor-outlet-localization-final

**Schema v2.** Staged CPU Float64 localization of the open near-floor outlet-feedback defect.

## Identity

- UTC: 2026-08-18T14:23:28.203Z
- Revision: `9088524+dirty`
- Dirty diff SHA-256: `73f40337eec904c6cae7664838b03719b7eb7cf5fd994020f64ae8dfd524186a`
- Manifest: `near-floor-outlet-localization/v1` / `fnv1a32:3ccab219`
- Duration: 15.243 s
- Command: `AEROFLOW_OUTLET_LOCALIZATION=1 AEROFLOW_RUN_ID=2026-08-18-near-floor-outlet-localization-final npx vitest run packages/core/test/outletFeedbackLocalizationEvidence.test.ts`
- Hardware: CPU Float64 reference paths.

## Result

- Classifier: **les-amplified**
- Compatible branches: les-amplified
- Rejected branches: implementation-discrepancy, boundary-intersection-dependent, zero-gradient-formulation-feedback, collision-amplified
- Reasons: evidence-satisfies:les-amplified
- Bounded confirmation: true
- Exact first abnormal step: 3346
- Focused boundary events: 5210

## Verdict axes

- **EXECUTION — GREEN.** Manufactured, repeatability, replay, ablation, and bounded CPU arms completed.
- **NUMERICAL_HEALTH — AMBER.** The zero-gradient/spec arm reproduces the expected non-finite event; bounded pressure and upstream controls remain finite.
- **STATISTICAL_CONVERGENCE — N/A.** This is a deterministic mechanism localization, not a statistical benchmark.
- **PHYSICS_TARGET — N/A.** No V11-V15 acceptance band is evaluated.
- **PHYSICS_STRUCTURE — RECORDED.** The classifier identifies the earliest required amplifier under the bounded CPU topology.

## Scope and non-claims

- This CPU localization does not qualify GPU execution or production-scale V11-V15 benchmarks.
- No production outlet, collision, LES, handoff, health threshold, or acceptance-band change is authorized.
- A required LES amplifier does not by itself establish that the H4 boundary rule is universally defective.

Machine-readable evidence: [localization.json](artifacts/2026-08-18-near-floor-outlet-localization-final/localization.json)

## Final verification (2026-08-19)

- Revision: `9088524+dirty`
- Dirty-state fingerprint: `47d8a04151375e8245f5a974e66a5daf32b4c87595f3953e2e64677e969b793a`
  (SHA-256 of `git status --short`, a newline, and `git diff HEAD --`, matching artifact
  provenance generation).
- Changed-file formatting: `$files = @(git diff --name-only --diff-filter=ACMR; git ls-files
--others --exclude-standard) | Where-Object { $_ -ne 'docs/VALIDATION.md' } | Sort-Object
-Unique; npx prettier --check @files` — passed. `docs/VALIDATION.md` is intentionally governed
  by its typed-ledger renderer; `npx vitest run packages/core/test/bands.test.ts` passed 15/15.
- Lint: `npm run lint` — passed.
- Typecheck: `npm run typecheck` — passed for core, studio, and studio e2e projects.
- Full unit suite: `npm test` — 99 test files passed, 3 test files skipped; 695 tests passed,
  5 opt-in tests skipped, 700 total. The skipped gates were the outlet-localization evidence
  writer, pressure-qualification evidence writer, collision-qualification record writer,
  outlet-feedback discriminator writer, and near-floor factorial writer.
- Focused regressions: `npx vitest run packages/core/test/outletFeedbackLocalization.test.ts
packages/core/test/pressureOutlet3d.test.ts packages/core/test/outletPolicy.test.ts
packages/core/test/outletQualification.test.ts packages/core/test/bands.test.ts
packages/core/test/outletFeedbackDiscriminator.test.ts` — 57 passed, 1 opt-in writer skipped.
- OpenSpec: `openspec validate localize-near-floor-outlet-feedback --strict` passed;
  `openspec validate --specs --strict` passed 11/11 main specs.
- Diff audit: `git diff --check` passed. No WGSL, production outlet/collision/LES implementation,
  numerical-health limit, acceptance band, or tracked historical run artifact changed.
