# 2026-08-18-0553 — final bounded GPU recovery and audit proof

Final enabled verification for `make-gpu-runs-recoverable-and-auditable`.

## Identity

| Field                            | Value                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| UTC start                        | 2026-08-18T05:53:01Z                                                                                                                   |
| UTC end                          | 2026-08-18T05:53:13Z                                                                                                                   |
| Wall clock                       | 11.9 s command; 6.3 s test body                                                                                                        |
| Commit                           | `8466ae8` + dirty                                                                                                                      |
| Tracked diff SHA-256 at closeout | `648fad4cc670c12802e9a82eb4e16f81f14decfb7709f44a957d3c66208fb783`                                                                     |
| Artifact provenance diff SHA-256 | `64f3f944e3e8a80f36b2f50bdb9a56de2411f45ec1be6fd4489d503d60c09ac5`                                                                     |
| Case                             | AIJ Case C 270°, bounded recovery smoke                                                                                                |
| Grid / precision                 | 35×12×28 = 11,760 cells / FP16                                                                                                         |
| Solver                           | TRT, regularized, Cs=0.1; velocity inlet, zero-gradient outlet, free-slip top/sides, no-slip ground                                    |
| Hardware                         | NVIDIA Ampere through Chromium 149 on Windows                                                                                          |
| Command                          | `npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban-recovery.gpu.spec.ts --reporter=list` |
| Durable runs                     | primary `20260818T055301Z-urban-C-270-0bcc6522`; fresh-identity negative `20260818T055306Z-urban-C-270-7e4ed914`                       |
| Raw artifacts                    | [`artifacts/2026-08-18-0553-gpu-recovery-proof/`](artifacts/2026-08-18-0553-gpu-recovery-proof/)                                       |

The complete artifact is 80,895 bytes with SHA-256
`9a94511e34b4233dd6d4fd0a6af7b304d4d220164f3db728feb64ba75f6344a5`. The preserved profile,
checkpoint database, artifact, and lifecycle metadata occupy 20,828,328 bytes.

## Recovery result

- One test passed.
- The first replacement context restored exact step 1568 and its accumulated averaging state,
  then made forward progress.
- Complete checkpoints were recorded at steps 1568, 2688, and 3976.
- After the newest slot at 3976 was deliberately torn, a second replacement context restored the
  previous complete slot at exact step 2688 and advanced to step 3136.
- A fresh run identity did not discover the primary run's checkpoint. An incompatible grid was
  rejected before state mutation.
- The artifact ended `complete: true`, execution `pass`, termination `completed`, owner released,
  no device loss observed, three health snapshots, and all 120 point rows retained.
- Initialization, averaging, and evaluation windows are explicit and non-overlapping
  (`0`, `1–11159`, `11160`).

## Completion verification

| Command                                                                                                                                                                                                       | Result                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npx prettier --write <change files>`                                                                                                                                                                         | all supported files formatted; `.gitignore` has no inferred Prettier parser and was checked manually |
| `npm run lint`                                                                                                                                                                                                | exit 0                                                                                               |
| `npm run typecheck`                                                                                                                                                                                           | exit 0 across core, studio, and e2e projects                                                         |
| `npm test`                                                                                                                                                                                                    | exit 0; 87 files, 594 passed, 1 intentionally skipped; 179.78 s                                      |
| `npx vitest run packages/core/test/runArtifact.test.ts packages/core/test/bands.test.ts apps/studio/test/validationRun.test.ts apps/studio/test/urbanArtifact.test.ts apps/studio/test/checkpointEmu.test.ts` | exit 0; 5 files, 29 tests                                                                            |
| `npx vitest run packages/core/test/pressureOutlet3d.test.ts apps/studio/test/kernel3dEmu.test.ts packages/core/test/abl-fetch.test.ts`                                                                        | exit 0; 3 files, 15 tests                                                                            |
| `npx playwright test -c apps/studio/playwright.config.ts --project=chromium apps/studio/e2e/aij.spec.ts apps/studio/e2e/aij-urban.spec.ts --reporter=list`                                                    | exit 0; 4 tests                                                                                      |
| `node scripts/validation-runs.mjs inspect 20260818T055301Z-urban-C-270-0bcc6522`                                                                                                                              | exit 0; complete artifact and released owner readable                                                |
| `git diff --check`                                                                                                                                                                                            | exit 0                                                                                               |

One mistaken closeout invocation selected `--project=chromium`, whose configuration intentionally
ignores `*.gpu.spec.ts`; Playwright reported “No tests found.” It created no validation run. The
listed `--project=gpu` command is the corrected execution and passed.

## Scope audit

The final diff contains no WGSL, collision operator, LES model, boundary-rule, acceptance-band
value, or gate-status modification. V10/V12/V13/V14 edits update stale recorded-outcome prose only,
and automated tests pin those descriptions. The pressure-outlet harness changes only which declared
final sample window supplies the verdict while retaining transient extrema as evidence.

## Verdicts

- **EXECUTION — GREEN.** Persistent-context restore, fallback, rejection, artifact completion,
  inspection, ownership release, and disk accounting passed.
- **NUMERICAL_HEALTH — AMBER.** All three snapshots contain zero non-finite cells. Density, relative
  mass drift, and boundary closure are recorded, but V14/V15 declare no pass limits for them, so the
  artifact correctly marks the axis unevaluated rather than manufacturing a pass.
- **STATISTICAL_CONVERGENCE — N/A.** The bounded run intentionally stopped before the full averaging
  target.
- **PHYSICS_TARGET — N/A.** The 11,760-cell smoke configuration is under-resolved and scoring is
  explicitly suppressed.
- **PHYSICS_STRUCTURE — N/A.** No structure claim.

## Limitation

The intermittent production-duration long-run GPU stall is now instrumented with heartbeat, phase,
checkpoint activity, artifact activity, and `device.lost` evidence. It was **not reproduced by this
bounded test, was not diagnosed, and is not claimed fixed**. No production-duration Case C/M9 run
was required or attempted.
