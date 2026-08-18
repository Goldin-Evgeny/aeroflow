# 2026-08-18-0543 — bounded GPU recovery assertion attempt

First browser execution of the bounded persistent-context recovery proof.

## Identity

| Field            | Value                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| UTC start        | 2026-08-18T05:43:31Z                                                                                                                   |
| Wall clock       | approximately 2.1 min                                                                                                                  |
| Commit           | `8466ae8` + dirty                                                                                                                      |
| Case             | AIJ Case C 270°, bounded recovery smoke                                                                                                |
| Grid / precision | 35×12×28 = 11,760 cells / FP16                                                                                                         |
| Hardware         | NVIDIA Ampere through Chromium 149 on Windows                                                                                          |
| Command          | `npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban-recovery.gpu.spec.ts --reporter=list` |
| Durable run      | `20260818T054331Z-urban-C-270-ede2c390`                                                                                                |

## Result

The replacement-context restore and forward-progress checks completed. The negative incompatible
resume correctly rejected the requested 35×12×28 grid against a 33×11×33 checkpoint before
mutation, but the test expected only a scene-mismatch phrase. The command therefore failed on an
overly narrow error-message assertion, not on recovery behavior. The assertion was broadened to
accept any compatible pre-mutation configuration rejection.

## Verdicts

- **EXECUTION — AMBER.** Recovery mechanics ran, but the test command exited non-zero.
- **NUMERICAL_HEALTH — N/A.** This attempt did not claim a numerical-health verdict.
- **STATISTICAL_CONVERGENCE — N/A.** Bounded smoke test only.
- **PHYSICS_TARGET — N/A.** Acceptance scoring was suppressed by design.
- **PHYSICS_STRUCTURE — N/A.** No structure claim.

No production-duration Case C run was attempted, and no naturally occurring stall was observed.
