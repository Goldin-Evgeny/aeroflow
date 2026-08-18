# 2026-08-18-0553 — pressure-outlet and ABL regression

Final-code CPU regression for unchanged pressure-outlet arithmetic, boundary accounting, and ABL
acceptance bands after moving the empty-tunnel verdict to its declared final window.

## Identity

| Field      | Value                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| UTC start  | 2026-08-18T05:53:47.3139788Z                                                                                                           |
| UTC end    | 2026-08-18T05:54:08.9578917Z                                                                                                           |
| Wall clock | 20.48 s Vitest result; 21.9 s command                                                                                                  |
| Commit     | `8466ae8` + dirty                                                                                                                      |
| Precision  | Float64 CPU references and WGSL kernel emulation                                                                                       |
| Command    | `npx vitest run packages/core/test/pressureOutlet3d.test.ts apps/studio/test/kernel3dEmu.test.ts packages/core/test/abl-fetch.test.ts` |

## Result and verdicts

All 15 tests in three files passed. The D3Q19 pressure-outlet ledger closed in the existing tests,
CPU/WGSL kernel emulation parity passed for zero-gradient and pressure outlets, and all existing ABL
fetch assertions passed. No band value or gate status changed.

- **EXECUTION — GREEN.** The command exited 0.
- **NUMERICAL_HEALTH — GREEN.** Existing finite-state and signed-ledger assertions passed.
- **STATISTICAL_CONVERGENCE — N/A.** This command verifies established regression assertions.
- **PHYSICS_TARGET — N/A.** It introduces no new acceptance result.
- **PHYSICS_STRUCTURE — N/A.** No structure claim.
