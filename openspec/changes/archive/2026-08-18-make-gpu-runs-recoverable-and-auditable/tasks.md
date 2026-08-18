## 1. Shared Run Contracts

- [x] 1.1 Define a versioned validation-artifact envelope with typed identity, provenance,
      configuration, phase, progress, checkpoint, verdict-axis, detailed-evidence, health, and
      termination records; export it from the appropriate shared package.
- [x] 1.2 Add runtime validation and fixtures for complete, partial, unsupported-version, and
      malformed artifacts, including explicit `not-applicable` and `unevaluated` health states.
- [x] 1.3 Implement same-directory temporary-write plus atomic-replacement persistence and test
      that an interrupted or rejected update leaves the last complete artifact readable.
- [x] 1.4 Define the durable run-directory layout and lifecycle metadata, including run/case
      identity, owner state, profile path, checkpoint path, artifact path, and recorded disk usage.

## 2. Durable Browser Run Lifecycle

- [x] 2.1 Implement path-validated fresh, resume, and cleanup lifecycle operations with unique
      run identities; fresh SHALL never reuse discovered state and cleanup SHALL be confined to the
      resolved run directory.
- [x] 2.2 Implement ownership-marker creation, active-owner rejection, stale-owner takeover
      recording, case/config mismatch rejection, and explicit release; cover each branch with unit
      tests.
- [x] 2.3 Add a Playwright fixture/helper that launches checkpointed cases in an isolated
      persistent browser profile selected by run identity and reports the durable resume location.
- [x] 2.4 Wire the urban harness's resume operation to `urban-resume`, require an existing
      compatible checkpoint, and fail rather than silently starting from step zero.
- [x] 2.5 Preserve the run profile on timeout, stall, device loss, browser closure, and operator
      abort; permit automatic cleanup only after a durable terminal artifact has been committed.

## 3. Bounded Recovery Proof

- [x] 3.1 Extend the checkpoint test support to assert restored step and accumulated urban
      averaging state across a newly created browser context, not only within one context.
- [x] 3.2 Add a bounded small-scene browser test that advances, checkpoints, closes its persistent
      context, resumes the same run identity in a replacement context, and proves exact restore plus
      forward progress.
- [x] 3.3 Add negative browser tests showing that a fresh identity does not resume, an
      incompatible scene/config is rejected before mutation, and a torn newest checkpoint falls
      back to the previous complete slot.
- [x] 3.4 Keep all recovery acceptance tests within the ordinary end-to-end budget and document
      that no production-duration Case C/M9 run or naturally occurring stall is required.

## 4. Durable Audit Evidence

- [x] 4.1 Expand the urban browser hook to expose material configuration, phase/window state,
      progress, checkpoint history, device-loss state, numerical-health snapshots, aggregate
      verdicts, and the complete per-point report rows.
- [x] 4.2 Expose reduced urban numerical-health diagnostics at checkpoint, pre-score, and terminal
      boundaries: non-finite count, density bounds, relative mass drift, and applicable boundary
      flux/conservation closure; record readback wall time.
- [x] 4.3 Implement the Node-side snapshot coordinator that atomically writes after
      configuration, meaningful progress, phase changes, checkpoints, health samples, verdicts, and
      termination while retaining Playwright attachments only as a convenience copy.
- [x] 4.4 Ensure timeout, no-progress, device-loss, abort, and unexpected-error paths write a
      partial artifact containing the last step, active phase, checkpoint age/location, last health
      snapshot, last artifact update, observed device-loss information, and captured error.
- [x] 4.5 Migrate the Case A/fetch and Case C GPU harnesses from attachment-only authority to the
      shared durable artifact, preserving Case A row evidence and adding Case C point evidence.
- [x] 4.6 Add artifact-level tests proving a completed urban result is auditable without reporter
      output and a failed result remains classifiable without a page snapshot.

## 5. Phase-Aware Verdicts

- [x] 5.1 Implement shared explicit initialization, transient, averaging, and evaluation window
      records plus a tested selector that returns exactly the samples judged by a verdict.
- [x] 5.2 Migrate the pressure-outlet empty-tunnel verdict away from the fixed post-five-flow-
      through maximum to its declared final evaluation window while retaining transient extrema as
      evidence.
- [x] 5.3 Add regression tests for long startup ringing followed by a passing final window, a
      genuine final-window failure, an insufficient evaluation window, and reconstruction of the
      selected sample interval from the artifact.

## 6. Stall Telemetry Without Diagnosis

- [x] 6.1 Record step heartbeat, application phase, checkpoint activity, artifact-write activity,
      and `device.lost` reason/message/timestamp in the shared lifecycle evidence.
- [x] 6.2 Update the no-progress detector to emit a descriptive stalled observation and preserve
      the run profile without assigning an unsupported GPU, CPU, checkpoint, or scoring root cause.
- [x] 6.3 Test stalled classification separately from observed device loss, long-but-progressing
      checkpoint/scoring phases, and ordinary timeout.

## 7. Ledger Reconciliation

- [x] 7.1 Correct the V10 ledger description to the post-outlet evidence: V7 and V9 pass the 2%
      storage A/B bar and V8 fails it; do not alter the band or recording status.
- [x] 7.2 Correct V12 to record the completed 66.19% GPU miss localized to the near-wall rows,
      V13 to record the b=24 83/126 verdict with settled statistic semantics, and V14 to record the
      strict-grid 55/120 miss; do not alter bands or gate status.
- [x] 7.3 Add or update automated ledger/documentation consistency checks so these recorded
      outcomes cannot silently revert to the stale descriptions.

## 8. Verification and Documentation

- [x] 8.1 Document fresh, resume, inspect, and path-validated cleanup commands, including recovery
      after a failed Playwright invocation and the meaning of partial artifact fields.
- [x] 8.2 Run formatting, lint, type checking, unit tests, checkpoint emulation, artifact tests,
      and the bounded persistent-context recovery test; record exact commands and results.
- [x] 8.3 Run the existing small AIJ Tier-A/override tests and pressure-outlet regression tests to
      demonstrate unchanged scoring and acceptance bands.
- [x] 8.4 Inspect the final diff for any collision, LES, boundary, band-value, or gate-status
      change; treat any such change as out of scope and remove or split it before completion.
- [x] 8.5 Record completion evidence in the validation run history, explicitly stating that the
      intermittent long-run stall was instrumented but neither reproduced nor claimed fixed.
