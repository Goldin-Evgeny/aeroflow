## Why

The validation harness is now durable enough to preserve expensive failures, but the next acceptance blockers still cannot produce decisive evidence: the near-floor instability depends on the outlet for an unknown reason, the analytic-zero LES probe becomes boundary-layer contaminated on long runs, and AIJ health measurements lack declared limits. Before another production-scale acceptance run, these gaps must be converted into bounded, auditable experiments whose outcomes select the next solver change.

## What Changes

- Add a controlled zero-gradient-versus-pressure outlet discriminator at the acceptance-tier near-floor operating point, with predeclared hypotheses, identical initial state, boundary-local diagnostics, and a machine-readable outcome.
- Require analytic-zero subgrid measurements to prove that their sampled region remains outside boundary influence for the entire measurement window; use a boundary-free manufactured oracle when a wall-bounded scene cannot satisfy that condition.
- Complete the AIJ numerical-health contract by declaring case-specific limits, enabling applicable open-boundary conservation evidence, and preventing a physics verdict when required health evidence is missing or failing.
- Extend the acceptance ledger so recorded outcomes, unresolved defects, superseded explanations, and closure evidence have one machine-readable status and cannot drift from validation documentation.
- Correct the unsupported Q27 rounding explanation as part of the ledger reconciliation; no Q27 production migration or momentum-drift repair is included.
- Keep every acceptance band, physics tolerance, and production solver default unchanged while the discriminating evidence is gathered.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `near-floor-collision-diagnostics`: Require a controlled outlet-feedback discriminator that localizes the first divergence between otherwise identical near-floor runs.
- `les-subgrid-closure`: Require time-valid analytic-zero sampling and a boundary-free fallback oracle for long-run subgrid-activity claims.
- `validation-run-auditability`: Require declared AIJ health limits, applicable conservation closure, and health-gated publication of physics verdicts.
- `acceptance-band-ledger`: Extend the authoritative ledger to track current measured outcomes and defect/explanation status with durable evidence references.

## Impact

- Affects CPU near-floor experiment harnesses and analysis utilities under `packages/core`, plus their tests and committed run artifacts.
- Affects AIJ Case A/fetch and urban health collection, durable validation artifacts, and Playwright assertions under `apps/studio`.
- Extends the machine-readable validation ledger and updates `docs/VALIDATION.md`, `docs/PHYSICS.md`, the validation index, and relevant decision records from that source.
- Adds no external dependency, changes no public runtime API, and does not alter collision, boundary, LES, or acceptance constants in production.
