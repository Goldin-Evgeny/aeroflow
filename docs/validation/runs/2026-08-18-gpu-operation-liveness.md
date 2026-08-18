# GPU operation liveness and automatic recovery completion evidence

**Date:** 2026-08-18
**Change:** `diagnose-intermittent-gpu-stall`
**Scope:** deterministic operation supervision, bounded urban submission, schema-2 auditability,
persistent-context retry policy, and bounded equivalence/performance checks.

## Completion claim

Every harness-owned queue, probe map, health map, checkpoint chunk, persistence write, and scoring
wait now has a typed operation identity and deadline. A deadline returns control with an observed
boundary classification; late resolve/reject is consumed and cannot overwrite the terminal record.
Submitted work is not checkpointed, sampled, scored, or published until its queue completion
advances the completed watermark.

Automatic recovery is established through deterministic injection, not through a naturally
occurring stall. Only device loss, queue timeout, and readback timeout are recoverable. A replacement
persistent context restores one complete compatible checkpoint under the same logical run and a new
attempt identity. Missing checkpoints, same-checkpoint exhaustion, total-attempt exhaustion,
validation errors, checkpoint I/O errors, scoring errors, numerical failures, and application errors
remain terminal.

No test in this record identifies a vendor, operating-system, TDR, browser, driver, or hardware root
cause. The 2026-07-28 and 2026-08-15 stalls remain root-cause unknown.

## Required verification commands

```powershell
npm run typecheck
npm run lint
npx vitest run
npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/bounded-submission.gpu.spec.ts
npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban-liveness.gpu.spec.ts
npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban-recovery.gpu.spec.ts apps/studio/e2e/checkpoint-parity.gpu.spec.ts
```

## Recorded outcomes

| Command/gate                         | Outcome                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Prettier check on changed files      | pass                                                                                          |
| `npm run lint`                       | pass                                                                                          |
| `npm run typecheck`                  | pass across core, studio, and Playwright projects                                             |
| `npm run build`                      | pass; 126 modules transformed                                                                 |
| `npx vitest run --reporter=dot`      | 89 files passed; 619 tests passed; 1 unrelated existing test skipped                          |
| bounded-submission GPU proof         | 1/1 passed in 7.0 s; fp32 and fp16 populations/macros/parity all bit-identical                |
| injected urban-liveness GPU proof    | 5/5 passed in 24.3 s; queue/map/loss/checkpoint/scoring/delayed-success boundaries classified |
| persistent urban checkpoint recovery | 1/1 passed in 13.6 s; exact restore, forward progress, torn-newest fallback, rejection checks |
| raw FP16 checkpoint parity           | 1/1 passed in 7.2 s; zero raw-DDF and density-bit mismatches after save@51 + 100 steps        |

The 32³ performance fixture measured monolithic samples of 17.018880, 17.544192, and
16.729088 ms and bounded 256-step samples of 17.361920, 16.745472, and 16.795648 ms for 512
steps. Medians were 17.018880 ms and 16.795648 ms, respectively: bounded throughput loss
−1.31%, below the allowed +10% ceiling. Verbose diagnostics were disabled.

The first injected-browser development run exposed operation-ID collision across replacement
contexts and deadlines that armed before the intended injected boundary. A second compatibility run
exposed an over-strict checkpoint validator after intentional fallback to an older checkpoint. Those
harness defects were corrected; the final outcomes above are clean reruns after the corrections.

## Optional production soak

The soak is deliberately outside the completion gate. It uses the same persistent run directory and
schema-2 artifact as an acceptance run:

```powershell
$env:AEROFLOW_M11_CELLS='190000000'
$env:AEROFLOW_RUN_OPERATION='fresh'
$env:AEROFLOW_RUN_ROOT='<durable evidence directory>'
npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban.gpu.spec.ts -g 'V14 Case C'
```

Record adapter and browser versions, wall exposure, completed steps, batch-policy history, operation
counts by phase/outcome, recovery attempts, and any direct device-loss/WebGPU evidence. If no stall
occurs, report “zero stalls observed during this exposure”; do not report that an intermittent cause
was fixed or disproved.
