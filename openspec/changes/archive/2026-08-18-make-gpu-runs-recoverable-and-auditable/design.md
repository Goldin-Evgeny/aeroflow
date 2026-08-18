## Context

See `proposal.md` for motivation. The simulation already double-buffers complete checkpoints in
IndexedDB, validates metadata before restore, and includes the averaging state required by the
urban workbench. The durability failure is ownership: the standard Playwright context is
ephemeral, so its IndexedDB disappears at teardown even though the application exposes a resume
button. Existing long-run harnesses also vary between direct durable JSON output and reporter
attachments, and the urban hook reduces a complete report to aggregate fields.

Several reusable diagnostics already exist (`fieldStats`, boundary mass budgets, recovery
progress auditing). The design should connect these pieces without changing solver physics or
requiring an intermittent six-hour stall to reproduce.

## Goals / Non-Goals

**Goals:**

- Give every checkpointed browser validation an isolated durable run directory and explicit
  fresh/resume lifecycle.
- Make the latest result and latest checkpoint independently survive browser and reporter
  teardown.
- Establish one versioned artifact envelope shared by long GPU validations while allowing
  case-specific evidence payloads.
- Capture enough phase and health information to distinguish execution failure, numerical
  failure, and physics-target miss.
- Validate recovery using deterministic bounded tests.

**Non-Goals:**

- Diagnose or fix the intermittent GPU stall.
- Make a stalled worker produce a newer checkpoint after it has stopped responding.
- Change acceptance bands, promote recording cases, or repair any physics target.
- Require Case C, M9, or another production-duration run for completion.
- Redesign the numerical checkpoint payload unless compatibility testing exposes a necessary
  version change.

## Decisions

### 1. Use a per-run persistent browser profile as checkpoint storage

Checkpoint-heavy cases SHALL run in a persistent browser context whose user-data directory is
inside an explicit harness-owned run directory. The run identity maps one-to-one to that
directory. A fresh run allocates a new identity; resume opens the existing profile.

This keeps multi-gigabyte checkpoint chunks in IndexedDB and avoids copying them through
Playwright or Node. It also preserves the application's existing transactional double-buffering
and metadata validation.

Alternative considered: export every checkpoint to a Node file and re-import it. That provides
strong separation from browser storage but duplicates multi-gigabyte data, adds a second
checkpoint format and transaction boundary, and makes the normal checkpoint substantially more
expensive.

Profiles are never shared concurrently. The harness writes a small ownership marker containing
the run identity, case identity, process information, and lifecycle status; an active owner or
case mismatch rejects resume. Cleanup is explicit and path-checked.

### 2. Separate fresh, resume, and cleanup operations

Fresh start, resume, and cleanup are distinct harness operations. Fresh start never falls back
to a discovered checkpoint. Resume never silently starts from zero. Failure leaves the profile
and checkpoint intact; cleanup is permitted only after a durable terminal artifact exists or by
an explicit operator command.

This prevents both expensive accidental restarts and cross-case checkpoint contamination.
Application checkpoint metadata remains the authority for scene/configuration compatibility.

### 3. Write an atomic artifact snapshot from the Node harness

The Node side owns durable artifacts because it remains able to write after a page error. Each
run directory contains a stable JSON path plus temporary write path. Updates serialize the
latest observed browser hook state, flush the temporary file, and atomically replace the stable
path. The first snapshot is written after configuration, then after meaningful progress,
checkpoint, phase, verdict, and termination events.

The schema uses a top-level version and separates:

- identity and source provenance;
- configuration and ledger comparison;
- lifecycle, phase, progress, checkpoints, and recovery boundaries;
- execution, numerical-health, and physics-target verdict axes;
- aggregate and case-specific detailed evidence;
- terminal or partial failure information.

Reporter attachments may mirror the artifact for convenience but are not authoritative.

Alternative considered: write only once in `finally`. That is simpler but loses all evidence if
the browser or test process is killed before the finalizer completes.

### 4. Preserve full scorer evidence at the browser/harness boundary

Urban hooks expose the report rows themselves rather than only `reportRows`, `q`, and `r`. Other
scorers use the same rule: if the reducer already has rows, points, planes, or blocks, the hook
and artifact preserve them. The durable writer accepts a typed case-specific evidence object so
large arrays do not become loosely typed top-level fields.

This change records existing scorer output; it does not change comparison semantics.

### 5. Reuse reduction diagnostics and sample them at phase boundaries

The urban worker exposes the same class of reduced health snapshot already used in the M9
harness: non-finite cells, density bounds, mass drift, and applicable boundary conservation.
Health readback occurs at checkpoints, before scoring, and at the terminal state rather than on
every step. This bounds overhead while still preserving the latest pre-failure snapshot.

Metrics that genuinely do not apply are represented as `not-applicable`; a metric that should
apply but could not be read is `unevaluated` with a reason. Neither state is serialized as a
passing numeric value.

### 6. Model phase windows explicitly

Shared artifact types describe initialization, transient, averaging, and evaluation intervals
in step and, where applicable, flow-through coordinates. Verdict reducers consume an explicit
evaluation slice. The pressure-outlet empty-tunnel classifier is migrated away from a fixed
post-five-flow-through maximum to its declared final evaluation window while retaining startup
extrema as evidence.

This avoids case-specific ad hoc exceptions and makes the exact judged samples reconstructable.

### 7. Instrument stalls without making diagnosis a gate

The harness records the latest step heartbeat, active application phase, checkpoint activity,
artifact-write activity, and observed `device.lost` information. The no-progress detector emits
a descriptive `stalled` observation and preserves the run profile. It does not label the cause
as TDR, queue submission, checkpointing, or scoring without direct evidence.

The future stall-diagnosis change can add lower-level telemetry or recovery policy without
changing the durability or artifact contracts defined here.

### 8. Prove lifecycle behavior with bounded tests

Pure tests cover artifact schema validation, atomic snapshot selection, lifecycle decisions,
ownership rejection, and verdict-window selection. Existing checkpoint emulation covers torn
saves and metadata rejection. One bounded browser test uses a small urban override: advance,
checkpoint, close the persistent context, open a replacement context for the same run identity,
resume, verify the exact committed step and averaging state, and observe forward progress.

No acceptance-sized grid or naturally occurring stall is part of the completion criteria.

## Risks / Trade-offs

- [Persistent profiles consume substantial disk space] → Report size and path, isolate profiles
  by run identity, and provide explicit path-validated cleanup after durable completion.
- [A killed process can leave a stale ownership marker] → Record process/lifecycle metadata and
  support an explicit takeover only after verifying no active owner and preserving the prior
  marker in the artifact.
- [Health readback can reduce GPU duty cycle] → Sample only at checkpoint and phase boundaries,
  use GPU reductions, and record diagnostic wall time.
- [Artifact schema evolves while old runs remain valuable] → Version the envelope, validate it in
  tests, and make readers reject unsupported future versions explicitly.
- [Atomic replacement behaves differently across platforms] → Keep temporary and final files on
  the same volume and test replacement semantics on the supported Windows path.
- [A hang can prevent an on-demand final checkpoint] → Recovery promises only the latest already
  committed checkpoint and reports its age; it does not promise zero lost work after the stall.

## Migration Plan

1. Introduce shared artifact and run-lifecycle types without changing existing harness output.
2. Add persistent-profile fresh/resume support and bounded recovery tests.
3. Add urban detailed evidence and numerical-health snapshots.
4. Migrate AIJ harnesses to atomic durable artifacts while retaining attachments temporarily.
5. Migrate the pressure-outlet verdict window and add regression tests.
6. Correct stale ledger descriptions from recorded evidence.
7. Remove attachment-only compatibility paths after all affected harness tests pass.

Rollback keeps the previous Playwright projects and attachments available during migration.
Persistent run directories are data, not executable state, and remain readable or explicitly
cleanable if the new fixture is rolled back.
