# 2026-08-18-0553 — AIJ Tier-A regression

Final-code small-scene regression demonstrating unchanged AIJ page behavior and override scoring.

## Identity

| Field      | Value                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTC start  | 2026-08-18T05:53:47.3135735Z                                                                                                                               |
| UTC end    | 2026-08-18T05:53:59.1591065Z                                                                                                                               |
| Wall clock | 10.4 s Playwright result; 12.1 s command                                                                                                                   |
| Commit     | `8466ae8` + dirty                                                                                                                                          |
| Hardware   | NVIDIA Ampere through Chromium 149 on Windows                                                                                                              |
| Command    | `npx playwright test -c apps/studio/playwright.config.ts --project=chromium apps/studio/e2e/aij.spec.ts apps/studio/e2e/aij-urban.spec.ts --reporter=list` |

## Result and verdicts

All four tests passed: Case C workbench run/suppression/export/resume; Case A score mode; ABL fetch
mode; and the editable-alpha demo.

- **EXECUTION — GREEN.** Four of four browser checks passed.
- **NUMERICAL_HEALTH — N/A.** Small UI correctness checks, not a health acceptance run.
- **STATISTICAL_CONVERGENCE — N/A.** Overrides do not establish production convergence.
- **PHYSICS_TARGET — N/A.** Existing small-scene suppression semantics remain unchanged.
- **PHYSICS_STRUCTURE — N/A.** No structure claim.
