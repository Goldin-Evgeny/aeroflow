import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArtifactSnapshotCoordinator,
  acquireExistingRun,
  classifyRunObservation,
  cleanupRun,
  createFreshRun,
  readArtifact,
  releaseRun,
  runDirectoryLayout,
  updateRecordedDiskUsage,
  writeArtifactAtomic,
} from '../e2e/helpers/validationRun';
import { VALIDATION_ARTIFACT_SCHEMA_VERSION, type ValidationRunArtifact } from '@aeroflow/core';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aeroflow-validation-run-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function artifact(runId: string, complete = false): ValidationRunArtifact {
  const at = '2026-08-18T12:00:00.000Z';
  return {
    schemaVersion: VALIDATION_ARTIFACT_SCHEMA_VERSION,
    complete,
    identity: {
      runId,
      logicalRunId: runId,
      activeAttemptId: `${runId}-attempt-1`,
      caseId: 'case-C',
      createdAt: at,
    },
    provenance: { revision: 'abcdef0', dirty: false },
    configuration: {
      scene: 'urban-C',
      grid: { nx: 2, ny: 2, nz: 2, cells: 8 },
      solver: { collision: 'trt' },
      precision: 'fp16',
      boundaries: { outlet: 'pressure' },
      closures: { les: 'smagorinsky' },
      budgets: { timeoutMs: 1000 },
      acceptance: { ledgerId: 'V14' },
    },
    lifecycle: {
      phase: complete ? 'terminal' : 'initialization',
      progress: {
        step: complete ? 10 : 0,
        submittedStep: complete ? 10 : 0,
        completedStep: complete ? 10 : 0,
        observedAt: at,
        phase: complete ? 'terminal' : 'initialization',
        wallMs: 0,
      },
      windows: [],
      checkpoints: [],
      recovery: [],
      attempts: [
        {
          attemptId: `${runId}-attempt-1`,
          startedAt: at,
          restoredStep: null,
          status: complete ? 'completed' : 'active',
        },
      ],
      operations: [],
      batchPolicy: {
        initialSteps: 8,
        targetMs: 2_000,
        minimumSteps: 2,
        maximumSteps: 256,
        currentSteps: 8,
        completedDurationsMs: [],
      },
      webgpuErrors: [],
      diagnosticConfidence: {
        directObservations: [],
        derivedClassifications: [],
        unconfirmedHypotheses: [],
      },
      heartbeatAt: at,
      deviceLoss: { observed: false },
    },
    verdicts: {
      execution: { state: complete ? 'pass' : 'unevaluated', metrics: {} },
      numericalHealth: { state: 'unevaluated', reason: 'not sampled', metrics: {} },
      physicsTarget: { state: 'unevaluated', reason: 'not scored', metrics: {} },
    },
    health: [],
    evidence: { aggregate: {}, detailed: { rows: [] } },
    termination: complete ? { reason: 'completed', at } : null,
    lastArtifactUpdateAt: at,
  };
}

describe('durable validation-run lifecycle', () => {
  it('isolates fresh identities and confines every path to its run directory', async () => {
    const root = await temporaryRoot();
    const first = await createFreshRun(root, 'case-C', 'cfg-1', { runId: 'run-one', pid: 11 });
    const second = await createFreshRun(root, 'case-C', 'cfg-1', { runId: 'run-two', pid: 12 });
    expect(first.layout.runDirectory).not.toBe(second.layout.runDirectory);
    expect(first.layout.profilePath.startsWith(first.layout.runDirectory)).toBe(true);
    await writeFile(join(first.layout.profilePath, 'checkpoint-bytes'), 'checkpoint');
    expect(await updateRecordedDiskUsage(first)).toBeGreaterThan(0);
    expect(first.lifecycle.diskUsageBytes).toBeGreaterThan(0);
    expect(() => runDirectoryLayout(root, '../escape')).toThrow(/invalid run identity/);
  });

  it('rejects active owners and case/config mismatches, and records stale takeover', async () => {
    const root = await temporaryRoot();
    const fresh = await createFreshRun(root, 'case-C', 'cfg-1', {
      runId: 'owned-run',
      pid: 111,
      host: 'test-host',
    });
    await expect(
      acquireExistingRun(root, fresh.layout.runId, 'case-C', 'cfg-1', {
        isProcessActive: () => true,
      }),
    ).rejects.toThrow(/active owner/);
    await expect(
      acquireExistingRun(root, fresh.layout.runId, 'case-E', 'cfg-1', {
        isProcessActive: () => false,
      }),
    ).rejects.toThrow(/case mismatch/);
    await expect(
      acquireExistingRun(root, fresh.layout.runId, 'case-C', 'cfg-2', {
        isProcessActive: () => false,
      }),
    ).rejects.toThrow(/config mismatch/);
    await expect(
      acquireExistingRun(root, fresh.layout.runId, 'case-C', 'cfg-1', {
        isProcessActive: () => false,
      }),
    ).rejects.toThrow(/explicit takeover/);

    const takeover = await acquireExistingRun(root, fresh.layout.runId, 'case-C', 'cfg-1', {
      isProcessActive: () => false,
      takeOverStale: true,
      pid: 222,
      host: 'new-host',
    });
    expect(takeover.owner.takeover?.previous.pid).toBe(111);
    expect(takeover.lifecycle.takeovers).toHaveLength(1);
    await releaseRun(takeover);
    const released = JSON.parse(await readFile(takeover.layout.ownerPath, 'utf8')) as {
      status: string;
    };
    expect(released.status).toBe('released');
  });

  it('atomically preserves the last complete artifact on interrupted or rejected updates', async () => {
    const root = await temporaryRoot();
    const run = await createFreshRun(root, 'case-C', 'cfg-1', { runId: 'atomic-run' });
    await writeArtifactAtomic(run.layout, artifact(run.layout.runId));
    const previous = await readFile(run.layout.artifactPath, 'utf8');

    const newer = artifact(run.layout.runId);
    newer.lifecycle.progress.step = 10;
    newer.lifecycle.progress.submittedStep = 10;
    newer.lifecycle.progress.completedStep = 10;
    await expect(
      writeArtifactAtomic(run.layout, newer, {
        beforeReplace: () => {
          throw new Error('simulated interruption');
        },
      }),
    ).rejects.toThrow(/simulated interruption/);
    expect(await readFile(run.layout.artifactPath, 'utf8')).toBe(previous);

    const malformed = artifact(run.layout.runId);
    malformed.configuration.grid.cells = 9;
    await expect(writeArtifactAtomic(run.layout, malformed)).rejects.toThrow(/dimensions/);
    expect(await readFile(run.layout.artifactPath, 'utf8')).toBe(previous);
  });

  it('serializes meaningful snapshots and retains partial failure evidence', async () => {
    const root = await temporaryRoot();
    const run = await createFreshRun(root, 'case-C', 'cfg-1', { runId: 'snapshot-run' });
    const coordinator = new ArtifactSnapshotCoordinator(run.layout, artifact(run.layout.runId));
    await coordinator.update('progress', (draft) => {
      draft.lifecycle.progress.step = 42;
      draft.lifecycle.progress.submittedStep = 42;
      draft.lifecycle.progress.completedStep = 42;
      draft.lifecycle.progress.phase = 'averaging';
      draft.lifecycle.phase = 'averaging';
      draft.evidence.detailed = { rows: [{ id: 'p1', hit: false }] };
    });
    await coordinator.terminate('stalled', new Error('no step heartbeat'));
    const saved = await readArtifact(run.layout.artifactPath);
    expect(saved.complete).toBe(false);
    expect(saved.lifecycle.progress.step).toBe(42);
    expect(saved.termination).toMatchObject({ reason: 'stalled' });
    expect(saved.evidence.detailed).toEqual({ rows: [{ id: 'p1', hit: false }] });
  });

  it('cleans only explicit completed runs unless an operator overrides the guard', async () => {
    const root = await temporaryRoot();
    const run = await createFreshRun(root, 'case-C', 'cfg-1', { runId: 'cleanup-run' });
    await writeArtifactAtomic(run.layout, artifact(run.layout.runId));
    await expect(cleanupRun(root, run.layout.runId)).rejects.toThrow(/completed artifact/);
    await writeArtifactAtomic(run.layout, artifact(run.layout.runId, true));
    await cleanupRun(root, run.layout.runId);
    await expect(readFile(run.layout.lifecyclePath, 'utf8')).rejects.toThrow();
  });
});

describe('no-progress classification', () => {
  const base = {
    nowMs: 10_000,
    startedAtMs: 0,
    timeoutMs: 20_000,
    lastStep: 100,
    lastStepAtMs: 8_000,
    phase: 'averaging',
    phaseActivityAtMs: 8_000,
    stallMs: 5_000,
    latestCheckpointStep: 80,
  };

  it('distinguishes a stalled observation from device loss and timeout', () => {
    expect(classifyRunObservation({ ...base, nowMs: 14_000 })).toMatchObject({
      kind: 'stalled',
      lastStep: 100,
      phase: 'averaging',
      latestCheckpointStep: 80,
    });
    expect(
      classifyRunObservation({ ...base, deviceLoss: { reason: 'unknown', message: 'lost' } }),
    ).toMatchObject({ kind: 'device-lost', reason: 'unknown' });
    expect(classifyRunObservation({ ...base, nowMs: 21_000 })).toMatchObject({ kind: 'timeout' });
  });

  it('does not call a long but active checkpoint/scoring phase stalled', () => {
    expect(
      classifyRunObservation({ ...base, lastStepAtMs: 1_000, phaseActivityAtMs: 9_500 }),
    ).toEqual({ kind: 'progressing' });
  });
});
