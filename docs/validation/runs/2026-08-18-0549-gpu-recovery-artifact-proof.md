# 2026-08-18-0549 — bounded GPU recovery artifact proof

First recovery proof with the shared durable validation artifact integrated into the test.

## Identity

| Field            | Value                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| UTC start        | 2026-08-18T05:49:00Z                                                                                                                   |
| Wall clock       | 11.9 s command; 6.1 s test body                                                                                                        |
| Commit           | `8466ae8` + dirty                                                                                                                      |
| Case             | AIJ Case C 270°, bounded recovery smoke                                                                                                |
| Grid / precision | 35×12×28 = 11,760 cells / FP16                                                                                                         |
| Hardware         | NVIDIA Ampere through Chromium 149 on Windows                                                                                          |
| Command          | `npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban-recovery.gpu.spec.ts --reporter=list` |
| Durable runs     | primary `20260818T054900Z-urban-C-270-66b3bcac`; fresh-identity negative `20260818T054905Z-urban-C-270-a5494443`                       |
| Artifact         | 80,884 bytes; SHA-256 `f6d5a43a406ef422e6a81c16fc1fbf11ebf7b8f37fe7654d6368dd8e6282c9a9`                                               |

## Result

One test passed. The completed artifact retained three checkpoints (steps 1512, 2576, 3864), two
recovery boundaries (1512 and fallback to 2576 after tearing 3864), three numerical-health
snapshots with zero non-finite cells, all 120 detailed point rows, an unobserved device-loss state,
and explicit suppressed/unevaluated verdicts.

This run exposed one audit-only omission: disk usage was not refreshed on fixture disposal. The
lifecycle helper was updated and the final proof below reran the same scenario.

## Verdicts

- **EXECUTION — GREEN.** Recovery, fallback, rejections, artifact completion, and inspection passed.
- **NUMERICAL_HEALTH — AMBER.** Zero non-finite cells were observed, but this recording-only V14
  smoke configuration declares no density, mass-drift, or closure pass limits.
- **STATISTICAL_CONVERGENCE — N/A.** The bounded run did not reach the declared averaging target.
- **PHYSICS_TARGET — N/A.** Under-resolved scoring was explicitly suppressed.
- **PHYSICS_STRUCTURE — N/A.** No structure claim.
