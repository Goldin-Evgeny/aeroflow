# 2026-08-18-near-floor-outlet-localization

**Schema v2.** Failed staged CPU Float64 localization attempt. The arm matrix executed, but the
focused naive checkpoint omitted the inactive destination buffer required by free-slip replay, so
the causal result is invalid and retained only as instrumentation-failure evidence.

## Identity

- UTC: 2026-08-18T14:22:03.089Z
- Revision: `9088524+dirty`
- Dirty diff SHA-256: `c9399db49d8b0b9f0a5af3df26c694675c34d691616b5bc9de63da3747abbb1d`
- Manifest: `near-floor-outlet-localization/v1` / `fnv1a32:3ccab219`
- Duration: 15.479 s
- Command: `AEROFLOW_OUTLET_LOCALIZATION=1 AEROFLOW_RUN_ID=2026-08-18-near-floor-outlet-localization npx vitest run packages/core/test/outletFeedbackLocalizationEvidence.test.ts`
- Hardware: CPU Float64 reference paths.

## Result

- Classifier: **inconclusive**
- Compatible branches: implementation-discrepancy, boundary-intersection-dependent, zero-gradient-formulation-feedback, collision-amplified, les-amplified
- Rejected branches: none
- Reasons: execution-or-numerical-health-invalid
- Bounded confirmation: true
- Exact first abnormal step: 3346
- Focused boundary events: 5210

## Verdict axes

- **EXECUTION — RED.** Focused checkpoint replay mismatched for both bounded outlet arms; the
  classifier correctly returned inconclusive.
- **NUMERICAL_HEALTH — AMBER.** The zero-gradient/spec arm reproduces the expected non-finite event; bounded pressure and upstream controls remain finite.
- **STATISTICAL_CONVERGENCE — N/A.** This is a deterministic mechanism localization, not a statistical benchmark.
- **PHYSICS_TARGET — N/A.** No V11-V15 acceptance band is evaluated.
- **PHYSICS_STRUCTURE — N/A.** The failed replay gate prevents causal interpretation.

## Instrumentation failure

The initial naive checkpoint serialized only the current source DDF buffer. On a free-slip layout,
the inactive destination buffer contains passive-shell slots that are part of the next exact replay.
The bounded arm therefore failed with `focused checkpoint replay mismatch`. The follow-up run
`2026-08-18-near-floor-outlet-localization-final` extends the diagnostic checkpoint with that buffer
and re-runs the entire frozen matrix; no result from this failed attempt is used as causal evidence.

## Scope and non-claims

- This CPU localization does not qualify GPU execution or production-scale V11-V15 benchmarks.
- No production outlet, collision, LES, handoff, health threshold, or acceptance-band change is authorized.
- A required LES amplifier does not by itself establish that the H4 boundary rule is universally defective.

Machine-readable evidence: [localization.json](artifacts/2026-08-18-near-floor-outlet-localization/localization.json)
