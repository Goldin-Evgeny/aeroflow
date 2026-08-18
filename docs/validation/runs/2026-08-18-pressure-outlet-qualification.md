# 2026-08-18-pressure-outlet-qualification

**Schema v2.** Bounded pressure-outlet qualification matrix. This run records plumbing,
numerical-health, conservation, repeatability, and availability evidence only; bounded
measurements are not V11-V15 physics verdicts.

## Identity

- UTC: 2026-08-18T11:04:25.960Z
- Revision: `c63d503+dirty`
- Dirty diff SHA-256: `8de3b43fefde11f66a1920055989ed1ca5998d7e607965514fc95f231df957f7`
- Manifest: `near-floor-pressure-qualification/v1`
- Duration: 5.356 s
- Command: `AEROFLOW_PRESSURE_QUALIFICATION=1 AEROFLOW_RUN_ID=2026-08-18-pressure-outlet-qualification npx vitest run packages/core/test/pressureOutletQualificationEvidence.test.ts`
- Hardware: CPU Float64; browser GPU arms were unavailable in this execution.

## Configuration

- Outlet: `pressure`
- Empty-tunnel exposure: 3600 steps
- Closure conventions: legacy and spec
- Predeclared thresholds: `{"cpuGpuRelativeMax":0.000001,"sameConfigurationRepeatabilityMax":1e-12,"boundaryFluxClosureAbsMax":0.001}`
- Every arm retains its grid/boundary/relaxation configuration and fingerprint in the JSON artifact.

## Result

- Qualification classifier: **FAILED**
- CPU arms recorded: 5
- Browser/GPU arms unavailable: 4
- Reasons: axis-failed:empty-legacy-cpu-a/numerical-health, axis-failed:empty-legacy-cpu-repeat/numerical-health, axis-failed:empty-spec-cpu-a/numerical-health, axis-failed:empty-spec-cpu-repeat/numerical-health, axis-unavailable:ahmed-body-gpu/execution, axis-unavailable:ahmed-body-gpu/numerical-health, axis-unavailable:ahmed-body-gpu/conservation, axis-unavailable:abl-fetch-gpu/execution, axis-unavailable:abl-fetch-gpu/numerical-health, axis-unavailable:abl-fetch-gpu/conservation, axis-unavailable:aij-case-a-gpu/execution, axis-unavailable:aij-case-a-gpu/numerical-health, axis-unavailable:aij-case-a-gpu/conservation, axis-unavailable:urban-case-c-gpu-resume/execution, axis-unavailable:urban-case-c-gpu-resume/numerical-health, axis-unavailable:urban-case-c-gpu-resume/conservation, axis-unavailable:near-floor-pressure-cpu-gpu-parity/execution, axis-unavailable:near-floor-pressure-cpu-gpu-parity/numerical-health, axis-unavailable:near-floor-pressure-cpu-gpu-parity/conservation, axis-unavailable:near-floor-pressure-cpu-gpu-parity/parity
- Bounded physics verdict: **NOT EVALUATED**.

## Verdict axes

- **EXECUTION — AMBER.** CPU empty-tunnel arms executed; required browser/GPU scene, parity, and checkpoint arms were unavailable.
- **NUMERICAL_HEALTH — RED.** CPU arm raw density, mass-drift, and complete-shell values are retained in the artifact.
- **STATISTICAL_CONVERGENCE — N/A.** This bounded qualification does not estimate a production statistic.
- **PHYSICS_TARGET — N/A.** Smoke measurements are deliberately not compared with V11-V15 acceptance bands.
- **PHYSICS_STRUCTURE — RECORDED.** No full-resolution topology claim is made.

## Anomalies and limits

The result is inconclusive unless every frozen manifest arm is present and passing. Missing
browser/GPU arms do not authorize promotion. The open zero-gradient causal defect remains open;
this run evaluates a candidate validation configuration and does not identify an internal cause.

Machine-readable evidence: [pressure-qualification.json](artifacts/2026-08-18-pressure-outlet-qualification/pressure-qualification.json)

## Interpretation addendum

The explicit failed gate is relative mass drift: **0.121810867%** for each legacy repeat and
**0.197741042%** for each spec repeat, above the predeclared **0.1%** limit. Complete-shell
closure remained approximately 1e-14 in all four CPU arms, so the run records a health-policy
failure rather than a conservation-accounting failure. The unavailable GPU arms add missing
evidence but do not weaken or replace the observed CPU failure.
