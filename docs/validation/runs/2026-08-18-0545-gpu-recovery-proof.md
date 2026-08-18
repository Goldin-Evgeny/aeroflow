# 2026-08-18-0545 — bounded GPU recovery proof

Corrected bounded persistent-context recovery execution.

## Identity

| Field            | Value                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| UTC start        | 2026-08-18T05:45:58Z                                                                                                                   |
| Wall clock       | 11.7 s command; 5.9 s test body                                                                                                        |
| Commit           | `8466ae8` + dirty                                                                                                                      |
| Case             | AIJ Case C 270°, bounded recovery smoke                                                                                                |
| Grid / precision | 35×12×28 = 11,760 cells / FP16                                                                                                         |
| Hardware         | NVIDIA Ampere through Chromium 149 on Windows                                                                                          |
| Command          | `npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban-recovery.gpu.spec.ts --reporter=list` |
| Durable runs     | primary `20260818T054558Z-urban-C-270-cbf4ddfc`; fresh-identity negative `20260818T054603Z-urban-C-270-205e4f33`                       |

## Result

One test passed. A newly created browser context restored the exact checkpoint step and accumulated
averaging state, advanced, and checkpointed again. A torn newest checkpoint fell back to the
previous complete slot. Fresh-identity and incompatible-config resumes were rejected.

## Verdicts

- **EXECUTION — GREEN.** All recovery and contamination assertions passed.
- **NUMERICAL_HEALTH — N/A.** This pre-artifact proof evaluated recovery semantics only.
- **STATISTICAL_CONVERGENCE — N/A.** Bounded smoke test only.
- **PHYSICS_TARGET — N/A.** Acceptance scoring was suppressed by design.
- **PHYSICS_STRUCTURE — N/A.** No structure claim.

No production-duration Case C run or naturally occurring stall was required or attempted.
