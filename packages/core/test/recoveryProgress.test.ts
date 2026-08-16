import { describe, expect, it } from 'vitest';
import { auditRunProgress, type RunProgressEvent } from '../src/index.js';

/**
 * The invariant the M9 closure harness's resilience check is supposed to state
 * (fix-confirmed-physics-defects task 9.4, design.md D8).
 *
 * The case that matters most here is `replayed steps after a lossless restore are not a
 * failure`: that is the shape the 2026-08-14 target-tier run actually produced, and the
 * assertion this replaces reported it as `INFRA=AMBER` against a run whose physics was sound.
 * The negative controls are what keep the repair from being a weakening — a genuine counter
 * regression, a lossy restore and a stalled run all still fail.
 */

const progress = (...steps: number[]): RunProgressEvent[] =>
  steps.map((step) => ({ kind: 'progress', step }) as const);

const restore = (restoredStep: number, checkpointStep: number): RunProgressEvent => ({
  kind: 'restore',
  restoredStep,
  checkpointStep,
});

describe('auditRunProgress: uninterrupted running', () => {
  it('accepts a strictly increasing stream with no restores', () => {
    const audit = auditRunProgress(progress(242, 484, 726, 968));
    expect(audit.ok).toBe(true);
    expect(audit.segments).toHaveLength(1);
    expect(audit.segments[0]).toMatchObject({ fromStep: 242, count: 4, monotonic: true });
    expect(audit.boundaries).toHaveLength(0);
  });

  it('is vacuously ok on an empty stream', () => {
    const audit = auditRunProgress([]);
    expect(audit.ok).toBe(true);
    expect(audit.segments).toHaveLength(0);
  });

  it('REJECTS a counter regression inside a segment (no restore to excuse it)', () => {
    const audit = auditRunProgress(progress(242, 484, 484, 726));
    expect(audit.ok).toBe(false);
    expect(audit.segmentsMonotonic).toBe(false);
  });

  it('REJECTS a counter that goes backwards inside a segment', () => {
    const audit = auditRunProgress(progress(242, 484, 400));
    expect(audit.ok).toBe(false);
    expect(audit.segmentsMonotonic).toBe(false);
  });
});

describe('auditRunProgress: restore boundaries', () => {
  it('accepts replayed steps after a lossless restore — the 2026-08-14 shape', () => {
    // Ran one sample past the checkpoint, lost the device, restored to the checkpoint and
    // replayed that step. The replayed value appears twice in the stream; that is what
    // restoring MEANS, and it is not a failure.
    const audit = auditRunProgress([
      ...progress(4_009_456, 4_009_698, 4_009_940),
      restore(4_009_698, 4_009_698),
      ...progress(4_009_940, 4_010_182),
    ]);
    expect(audit.ok).toBe(true);
    expect(audit.allLossless).toBe(true);
    expect(audit.allAdvanced).toBe(true);
    expect(audit.segments).toHaveLength(2);
    expect(audit.boundaries[0]).toMatchObject({
      restoredStep: 4_009_698,
      checkpointStep: 4_009_698,
      lossless: true,
      firstStepAfter: 4_009_940,
      advanced: true,
    });
  });

  it('partitions POSITIONALLY, not by step value', () => {
    // The pre-restore sample at 4,009,940 exceeds the restored step, so a value-threshold
    // filter keeps it in the post-restore window and sees 4,009,940 -> 4,009,940. Positional
    // partitioning puts it in the segment it was actually emitted in.
    const audit = auditRunProgress([
      ...progress(4_009_698, 4_009_940),
      restore(4_009_698, 4_009_698),
      ...progress(4_009_940),
    ]);
    expect(audit.ok).toBe(true);
    expect(audit.segments[0].count).toBe(2);
    expect(audit.segments[1].count).toBe(1);
  });

  it('REJECTS a lossy restore that resumes below its checkpoint', () => {
    const audit = auditRunProgress([
      ...progress(4_009_698),
      restore(4_009_214, 4_009_698),
      ...progress(4_009_456),
    ]);
    expect(audit.ok).toBe(false);
    expect(audit.allLossless).toBe(false);
    expect(audit.boundaries[0].lossless).toBe(false);
  });

  it('REJECTS a run that never resumes after a restore', () => {
    const audit = auditRunProgress([...progress(4_009_698), restore(4_009_698, 4_009_698)]);
    expect(audit.ok).toBe(false);
    expect(audit.allAdvanced).toBe(false);
    expect(audit.boundaries[0].firstStepAfter).toBeUndefined();
  });

  it('REJECTS a restore followed only by a step that does not advance', () => {
    const audit = auditRunProgress([
      ...progress(4_009_698),
      restore(4_009_698, 4_009_698),
      ...progress(4_009_698),
    ]);
    expect(audit.ok).toBe(false);
    expect(audit.allAdvanced).toBe(false);
  });

  it('REJECTS a regression inside a segment that FOLLOWS a legitimate restore', () => {
    const audit = auditRunProgress([
      ...progress(242),
      restore(242, 242),
      ...progress(484, 726, 726),
    ]);
    expect(audit.ok).toBe(false);
    expect(audit.segmentsMonotonic).toBe(false);
    expect(audit.allLossless).toBe(true);
  });

  it('handles both induced cycles of the closure run', () => {
    const audit = auditRunProgress([
      ...progress(242, 484, 726),
      restore(726, 726),
      ...progress(968, 1210),
      restore(4_009_698, 4_009_698),
      ...progress(4_009_940, 4_010_182),
    ]);
    expect(audit.ok).toBe(true);
    expect(audit.segments).toHaveLength(3);
    expect(audit.boundaries).toHaveLength(2);
  });
});
