/**
 * The resilience check a long unattended run stops on: did the solver keep making forward
 * progress across every checkpoint/restore cycle, and did any restore lose work?
 *
 * Lives here, beside the other reductions, rather than inside an e2e harness for the same
 * reason `blockConvergence.ts` does — and because of a specific, expensive mistake this
 * predicate exists to prevent.
 *
 * **The mistake.** The M9 closure harness asserted that the reported step counter increases
 * strictly across every sample emitted after the first recovery. That harness *deliberately
 * induces two device-loss/restore cycles*, and restoring a checkpoint rewinds the step counter
 * by construction — that is what restoring is. Any steps taken between the checkpoint and the
 * induced loss are replayed, so those step values are emitted twice. The assertion therefore
 * demanded the negation of the behaviour under test.
 *
 * It also failed *flakily*, which is worse than failing always: a duplicate is only observable
 * if a sample happens to land in the sub-second window between the checkpoint being saved and
 * the loss being induced. The 2026-08-11 run passed and the 2026-08-14 run failed on identical
 * code, and the 2026-08-14 failure was recorded as `INFRA=AMBER` against a run whose physics
 * result was sound — a harness defect presented as a doubt about the measurement.
 *
 * **What is actually being claimed.** Three things, and global monotonicity is none of them:
 *
 *  1. Within any stretch of uninterrupted running, progress is strictly forward.
 *  2. Each restore is lossless — it resumes from the checkpoint, not from before it.
 *  3. Each restore is followed by real forward progress, rather than a stalled run.
 *
 * Stated this way the check is strictly STRONGER than the one it replaces: (2) is an invariant
 * the old assertion never expressed at all, and (1) still catches a genuine counter regression
 * inside a segment, which is the failure the old assertion was presumably reaching for.
 */

/**
 * One entry in an ordered run-progress stream. Field names are deliberately generic — `step`
 * rather than `totalSteps` — so this module can back any checkpointed long-run harness, not
 * only the Ahmed closure run it was extracted from.
 *
 * `restore` carries both numbers because losslessness is exactly their comparison: a restore
 * that resumes below its own checkpoint dropped committed work.
 */
export type RunProgressEvent =
  | { kind: 'progress'; step: number }
  | { kind: 'restore'; restoredStep: number; checkpointStep: number };

/** A stretch of uninterrupted running, bounded by a restore (or by either end of the run). */
export interface RunProgressSegment {
  /** Step the segment resumes from: the restored step, or the first observed step. */
  fromStep: number;
  /** Progress events observed inside this segment. */
  count: number;
  /** Every step in this segment strictly exceeded the one before it. */
  monotonic: boolean;
}

/** A restore, and whether it behaved. */
export interface RunRestoreBoundary {
  restoredStep: number;
  checkpointStep: number;
  /** The restore resumed from its checkpoint rather than from before it. */
  lossless: boolean;
  /** First step observed after the restore; `undefined` if the run never resumed. */
  firstStepAfter: number | undefined;
  /** The run made forward progress past the restored step. */
  advanced: boolean;
}

export interface RunProgressAudit {
  segments: RunProgressSegment[];
  boundaries: RunRestoreBoundary[];
  /** Every segment was internally strictly increasing. */
  segmentsMonotonic: boolean;
  /** No restore resumed below its checkpoint. */
  allLossless: boolean;
  /** Every restore was followed by forward progress. */
  allAdvanced: boolean;
  /** All three conditions hold. */
  ok: boolean;
}

/**
 * Audit an ordered run-progress stream.
 *
 * The stream must be in EMISSION order. Partitioning is positional, not by step value: a
 * sample emitted before a restore belongs to the segment before it even when its step value
 * exceeds the restored step, which is precisely the confusion that made the original check
 * mis-scope its window.
 *
 * An empty stream is vacuously `ok` — a harness that also needs "the run produced samples at
 * all" should assert that separately, where the count is meaningful.
 */
export function auditRunProgress(events: readonly RunProgressEvent[]): RunProgressAudit {
  const segments: RunProgressSegment[] = [];
  const boundaries: RunRestoreBoundary[] = [];

  let fromStep = Number.NaN;
  let count = 0;
  let monotonic = true;
  let previous: number | undefined;
  /** Boundary awaiting its first post-restore step, so `advanced` is filled positionally. */
  let pending: RunRestoreBoundary | undefined;

  const closeSegment = (): void => {
    if (count > 0 || segments.length > 0 || boundaries.length > 0) {
      segments.push({ fromStep, count, monotonic });
    }
  };

  for (const event of events) {
    if (event.kind === 'restore') {
      closeSegment();
      pending = {
        restoredStep: event.restoredStep,
        checkpointStep: event.checkpointStep,
        lossless: event.restoredStep >= event.checkpointStep,
        firstStepAfter: undefined,
        advanced: false,
      };
      boundaries.push(pending);
      fromStep = event.restoredStep;
      count = 0;
      monotonic = true;
      previous = event.restoredStep;
      continue;
    }
    if (pending) {
      pending.firstStepAfter = event.step;
      pending.advanced = event.step > pending.restoredStep;
      pending = undefined;
    }
    if (count === 0 && boundaries.length === 0) fromStep = event.step;
    if (previous !== undefined && event.step <= previous) monotonic = false;
    previous = event.step;
    count++;
  }
  closeSegment();

  const segmentsMonotonic = segments.every((s) => s.monotonic);
  const allLossless = boundaries.every((b) => b.lossless);
  const allAdvanced = boundaries.every((b) => b.advanced);
  return {
    segments,
    boundaries,
    segmentsMonotonic,
    allLossless,
    allAdvanced,
    ok: segmentsMonotonic && allLossless && allAdvanced,
  };
}
