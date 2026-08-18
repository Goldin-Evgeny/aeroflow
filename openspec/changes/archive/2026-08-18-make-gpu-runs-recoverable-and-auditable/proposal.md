## Why

Multi-hour browser GPU validations can currently lose their checkpoint and result when the
Playwright context exits, while the surviving aggregate output omits the per-point and
numerical-health evidence needed to distinguish a physics miss from a broken run. Before
spending more GPU-hours on acceptance cases, the harness must make interrupted work resumable
and every completed or interrupted run independently auditable.

## What Changes

- Make browser-run checkpoints survive Playwright context replacement and add a harness path
  that resumes the saved run rather than always starting fresh.
- Prove checkpoint continuity with small deterministic scenes and controlled interruption; a
  multi-hour acceptance run is explicitly not required to validate this capability.
- Write a versioned, durable JSON artifact directly from each validation run, independent of
  Playwright attachment retention, and retain a partial artifact on timeout, stall, device
  loss, or operator abort.
- Record the material run configuration, progress and checkpoint history, phase-aware failure
  classification, aggregate verdicts, and available per-point or per-row evidence.
- Include numerical-health evidence in GPU validation results so a finite set of probes cannot
  hide a non-finite or non-conservative field.
- Make transient and evaluation windows explicit so startup extrema are not reported as a
  steady-state failure.
- Repair the stale acceptance-ledger descriptions using the already-recorded V10, V12, V13,
  and V14 evidence. Acceptance bands and physics gates do not change.
- Add stall telemetry for future diagnosis, but do not require reproducing or fixing the
  intermittent long-GPU hang in this change.

## Capabilities

### New Capabilities

- `browser-run-recovery`: Durable checkpoint ownership, cross-context resume, continuity
  validation, and explicit interrupted-run recovery behaviour for browser GPU validations.
- `validation-run-auditability`: Durable complete and partial run artifacts containing the
  configuration, evidence, numerical health, evaluation window, and failure classification
  required to audit a validation verdict without reconstructing it from console output.

### Modified Capabilities

None. The existing `acceptance-band-ledger` and `solver-failure-visibility` requirements remain
unchanged; this change brings the affected harnesses and ledger descriptions into conformance
with them.

## Impact

- Affects Playwright GPU fixtures and the M10/M11 AIJ harnesses, plus shared validation artifact
  and health-reporting utilities used by other long GPU cases.
- Affects browser checkpoint storage/lifecycle integration, but not the checkpoint payload's
  numerical representation unless implementation discovers a versioning requirement.
- Adds durable files under the validation run-artifact workflow and may add a persistent
  Playwright profile or explicit checkpoint import/export channel.
- Updates `packages/core/src/validation/bands.ts` descriptions to match existing evidence; no
  band values or `recording`/`gated` states change.
- Does not modify collision, boundary, LES, scoring, or acceptance-band physics.
