# Validation-blockers decidability verification

- Recorded: 2026-08-18T10:13:58.238Z
- Source: `862a762` + dirty implementation diff
- Change: `make-validation-blockers-decidable`
- Scope: bounded/unit verification only; no production-scale V11 or V14 run was started

## Results

| Check | Exact command | Result |
| --- | --- | --- |
| Repository formatting baseline | `npx prettier --check .` | Exit 1: 88 pre-existing/unrelated files, including archived OpenSpec material and immutable run artifacts, are not Prettier-clean. |
| Changed TypeScript formatting | PowerShell loop over `git ls-files --modified --others --exclude-standard -- '*.ts'`, running `npx prettier --write -- $taskFile` then `npx prettier --check -- $taskFile` | Exit 0: all 24 changed/new TypeScript files pass. |
| Lint | `npm run lint` | Exit 0. |
| Typecheck | `npm run typecheck` | Exit 0 across core, studio, and e2e TypeScript projects. |
| Full unit suite | `npm test` | Exit 0: 93 files passed; 648 tests passed; 2 opt-in tests skipped; 186.08 s. |
| Bounded AIJ browser regression | `npx playwright test -c apps/studio/playwright.config.ts --project=chromium aij.spec.ts aij-urban.spec.ts` | Exit 0: 4 tests passed in 11.2 s. |
| Bounded CPU/GPU parity | `npx playwright test -c apps/studio/playwright.config.ts --project=chromium parity3d.spec.ts` | Exit 0: 1 test passed in 19.4 s. |
| OpenSpec | `openspec validate make-validation-blockers-decidable --strict` | Exit 0: change is valid. |
| Patch hygiene | `git diff --check` | Exit 0. |

The opt-in outlet discriminator was run separately with
`$env:AEROFLOW_OUTLET_DISCRIMINATOR='1'; $env:AEROFLOW_RUN_ID='2026-08-18-outlet-feedback-discriminator'; npx vitest run packages/core/test/outletFeedbackDiscriminator.test.ts`.
It passed 7/7 and wrote the linked machine-readable evidence and run record.

## Scope audit

- The pre-change `ACCEPTANCE_BANDS` block is byte-identical after line-ending normalization.
- No changed path matches WGSL, shader, central-moment, collision, or relaxation-rate operator
  sources. The D3Q27 operator was not edited.
- No production collision, boundary, or LES default changed. Case A only enables the existing
  complete-shell boundary ledger as instrumentation; diagnostic selection and artifact/UI
  gating are the other runtime changes.
- The numerical-health limits are a new, predeclared validity policy and do not change a
  physics acceptance tolerance.
- The historical 20,000-step near-floor values remain present; an append-only addendum narrows
  their interpretation to boundary-contaminated diagnostics.

## Next proposed solver change

Propose a separate change to make the already-implemented pressure outlet the explicit outlet
for the affected near-floor Ahmed/AIJ validation scenes, gated by matching CPU/GPU conservation
and bounded stability evidence before any configuration promotion. The discriminator supports
that direction because pressure remained finite through step 3600 while zero-gradient diverged
at 3346 from the same initialized state. It does not justify claiming an internal zero-gradient
root cause, changing the global outlet default, or implementing a repair in this change.

Machine-readable discriminator evidence:
[outlet-feedback.json](artifacts/2026-08-18-outlet-feedback-discriminator/outlet-feedback.json).
