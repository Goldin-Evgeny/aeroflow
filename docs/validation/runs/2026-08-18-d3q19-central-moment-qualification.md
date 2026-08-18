# D3Q19 central-moment collision qualification

UTC start: 2026-08-18T13:35:40Z

Source baseline: `c6e2c2d207278c962307c1967567f14118e8068c` plus the isolated pressure-workspace
snapshot `d9fa2269b6496e917567b15c0f3d0aea9c50ba9c1f7af1b829382a33d32ee437`

Manifest: `near-floor-collision-qualification/v1`

Candidate: `d3q19-central-moment-mrt/v1`

Classifier: **FAILED**; physics verdict **not evaluated**

## Decision

Candidate v1 is not eligible for a GPU port, Phase-B LES qualification, or production promotion.
It damps the nonlinear 3.2-cell transverse target, but its constitutive response is
`Pi/Pi_hydro = 1.5050040875`, above the frozen exclusive limit of `1.2`. This is a decisive CPU
failure. Production remains `d3q19-regularized-trt/v1`; no collision, closure, boundary,
pressure-outlet, health, or acceptance-band default changed.

## Measured gates

| Stage                        |                                                   Measurement |                     Limit | Result   |
| ---------------------------- | ------------------------------------------------------------: | ------------------------: | -------- |
| Float64 local authority      |    6 manufactured tests; equilibrium and invariant assertions |                 `< 2e-15` | pass     |
| Frozen linear matrix         | maximum amplification `0.9999998918` over 144 wavelength arms |                    `<= 1` | pass     |
| Nonlinear target, lambda 3.2 |                                     modal gain `0.9977233178` |                     `< 1` | pass     |
| Nonlinear target, lambda 3.2 |                                  `Pi/Pi_hydro = 1.5050040875` |                   `< 1.2` | **fail** |
| Resolved control, lambda 8   |                gain `0.9999944913` vs baseline `1.0000825999` | relative deviation `< 2%` | pass     |
| Resolved control, lambda 8   |               ratio `1.0542536088` vs baseline `1.0482029028` | relative deviation `< 2%` | pass     |

The linear matrix covers all frozen `tau = {0.5000005, 0.5000042, 0.500989, 0.8}`,
background velocities `{0, 0.05, 0.10}`, three wave axes, both transverse polarizations, and
wavelengths `{3.2, 8}`. The nonlinear stage stopped after the first predeclared near-floor
representative produced a decisive failure. Periodic conservation scaling, analytic-zero,
established-control reruns, bounded CPU scenes, all GPU arms, and all joint LES arms are recorded
as `not-run-upstream-failed`; their absence is not a failure cause.

## Evidence and commands

- Machine decision and every arm state:
  `docs/validation/runs/artifacts/2026-08-18-d3q19-central-moment-qualification/qualification.json`
- Raw guarded eigen/Jacobian matrix:
  `docs/validation/runs/artifacts/2026-08-18-d3q19-central-moment-qualification/linear-spectrum.json`
- Raw nonlinear samples and resolved control:
  `docs/validation/runs/artifacts/2026-08-18-d3q19-central-moment-qualification/nonlinear-spectrum.json`
- `npx vitest run packages/core/test/centralMomentD3Q19.test.ts packages/core/test/centralMomentEigenProof.test.ts packages/core/test/shearModeTargeted.test.ts --reporter=dot`
  — 3 files, 12 tests passed.
- `$env:AEROFLOW_WRITE_COLLISION_QUALIFICATION='1'; npx vitest run packages/core/test/collisionQualificationRecord.test.ts --reporter=dot`
  — 1 file, 1 test passed and wrote the durable record.

## Non-claims and next candidate

This bounded collision result does not rescore or relabel V11-V15 and does not establish benchmark
accuracy. It also does not diagnose the zero-gradient outlet feedback or close the pressure-outlet
qualification defect. A next collision candidate must change the D3Q19 constitutive response—not
merely add high-k damping—and pass `Pi/Pi_hydro < 1.2` at lambda 3.2 before GPU or scene work.

## Final verification

- `npm run lint` — passed with zero errors.
- `npm run typecheck` — all three TypeScript projects passed.
- `npm test -- --reporter=dot` — 98 files passed, 2 opt-in files skipped; 680 tests passed,
  4 opt-in tests skipped.
- `npx openspec validate qualify-velocity-stable-near-floor-collision --strict` — valid.
- `npx openspec validate --specs --strict` — 10 main specs passed, 0 failed.
- Focused protected-state regression — 8 files passed, 1 opt-in file skipped; 58 tests passed,
  1 opt-in test skipped (Q27, pressure, checkpoint, report, health, bands, and outcome ledgers).
- Changed implementation and change-record files passed `prettier --check`; `git diff --check`
  passed.
- No WGSL file changed. The production collision policy still selects
  `d3q19-regularized-trt/v1` exactly once.
- Source revision remains `c6e2c2d207278c962307c1967567f14118e8068c`; the pre-final-record
  dirty-state content
  fingerprint: `sha256:08f614324c734870095814a55d13b7e61765a107b7ed5473b34e3add7d206893`
  over 51 sorted modified/untracked paths.
