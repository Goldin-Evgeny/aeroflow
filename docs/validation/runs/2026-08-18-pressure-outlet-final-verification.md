# Pressure-outlet qualification change: final bounded verification

- Recorded: 2026-08-18T11:22:38.348Z
- Source: `2161477` + dirty implementation diff
- Change: `qualify-pressure-outlet-for-near-floor-validation`
- Changed-file snapshot: `55e2d4bc6cc23d8a93f553a9cdc7210cb4e26f27ea2f734aaad7fe011632830f`
- Scope: unit and bounded browser/GPU verification; no production-scale V11-V15 physics run

## Results

| Check | Exact command | Result |
| --- | --- | --- |
| Changed-source formatting | `npx prettier --write apps/studio/src/ui/aij.ts apps/studio/src/ui/aijUrban.ts apps/studio/src/sim/cases/aijUrban.ts` (after the earlier full changed-file formatting pass) | Exit 0; files formatted. |
| Lint | `npm run lint` | Exit 0. |
| Typecheck | `npm run typecheck` | Exit 0 across core, studio, and e2e TypeScript projects. |
| Full unit suite | `npm test -- --reporter=dot` | Exit 0: 95 files passed, 663 tests passed, 1 file and 3 tests skipped; 182.23 s. |
| AIJ browser regression | `npx playwright test -c apps/studio/playwright.config.ts --project=chromium apps/studio/e2e/aij.spec.ts apps/studio/e2e/aij-urban.spec.ts --reporter=line` | Exit 0: 4 tests passed in 10.2 s. |
| Real-GPU near-floor and pressure parity | `npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/parity3d.gpu.spec.ts --reporter=line` | Exit 0: pressure arm rho `6.86e-7`, u `5.66e-6` against `5e-5`; mass closure `4.07e-7`; all panel checks passed. |
| Ahmed, urban recovery, checkpoint parity | `npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/ahmed-match.gpu.spec.ts apps/studio/e2e/checkpoint-parity.gpu.spec.ts apps/studio/e2e/aij-urban-recovery.gpu.spec.ts --grep "matched-config\|bounded urban recovery\|64\^3" --reporter=line` | Exit 0: 3 tests passed in 39.0 s; Ahmed rho/u parity passed, urban contamination rejection passed, FP16 restore was bit-identical. |
| OpenSpec | `openspec validate qualify-pressure-outlet-for-near-floor-validation --strict` | Exit 0: change is valid and all 32 tasks are complete. |
| Patch hygiene | `git diff --check` | Exit 0. |

## Scope audit

- The acceptance-band values and numerical-health limits are unchanged. The only
  `packages/core/src/validation/bands.ts` edit is the new open qualification-defect record.
- No WGSL, pressure-reconstruction, collision operator, relaxation-rate, or LES implementation
  file changed.
- The generic CPU, GPU, and Ahmed scene-builder outlet defaults remain `zero-gradient`.
- V11-V15 scored selections remain exactly as they were before this change: V11 pressure and
  V12-V15 zero-gradient. The literals moved behind typed policy records without promotion.
- Existing validation artifacts are unchanged. The failed qualification record and this final
  bounded-verification record are append-only additions.

## Interpretation

The implementation and bounded regression matrix pass. This does not override the separately
recorded `FAILED` pressure qualification: both 3,600-step CPU pressure arms exceeded the frozen
0.1% mass-drift guard, so V12-V15 were not promoted and bounded measurements remain ineligible
for physics acceptance verdicts.

Machine-readable verification:
[verification.json](artifacts/2026-08-18-pressure-outlet-final-verification/verification.json).
