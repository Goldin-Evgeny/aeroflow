import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AeroflowHooks } from '../src/dev/testHooks';
import { createFreshRun, readArtifact } from '../e2e/helpers/validationRun';
import {
  initialUrbanArtifact,
  syncUrbanArtifact,
  urbanArtifactCoordinator,
} from '../e2e/helpers/urbanArtifact';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'aeroflow-urban-artifact-'));
  roots.push(path);
  return path;
}

function hook(): NonNullable<AeroflowHooks['urban']> {
  const at = '2026-08-18T12:00:00.000Z';
  return {
    ready: true,
    caseId: 'C',
    direction: 270,
    resumed: false,
    underResolved: false,
    grid: { nx: 4, ny: 3, nz: 2 },
    totalSteps: 100,
    averagingFlowThroughs: 10,
    phase: 'terminal',
    progress: { step: 100, observedAt: at, wallMs: 1000 },
    windows: [
      { phase: 'transient', startStep: 1, endStep: 20, selectionRule: 'discard startup' },
      { phase: 'averaging', startStep: 21, endStep: 100, selectionRule: 'cumulative mean' },
      { phase: 'evaluation', startStep: 100, endStep: 100, selectionRule: 'score all points' },
    ],
    materialConfiguration: {
      precision: 'fp16',
      collision: 'trt',
      les: { cs: 0.1 },
      outlet: 'zero-gradient',
      freeSlip: { yMax: true, zMin: true, zMax: true },
    },
    checkpointHistory: [
      {
        step: 80,
        samples: 20,
        savedAt: at,
        bytes: 2048,
        writeMs: 4,
        location: 'IndexedDB/aeroflow/checkpoints',
        complete: true,
      },
    ],
    health: [
      {
        boundary: 'terminal',
        sampledAt: at,
        step: 100,
        phase: 'terminal',
        readbackMs: 5,
        field: {
          fluidCells: 20,
          totalMass: 20,
          massDriftRel: 0,
          rhoMin: 0.99,
          rhoMax: 1.01,
          rhoMean: 1,
          uMax: 0.05,
          machMax: 0.0866,
          nonFiniteCells: 0,
        },
        boundaryMassNet: 0,
        boundaryMassCumulative: 0,
        boundaryFluxClosureRel: 0,
      },
    ],
    deviceLoss: { observed: false },
    complete: true,
    q: 0.5,
    r: 0.8,
    verdict: 'fail',
    reportRows: 2,
    report: {
      schemaVersion: 1,
      generatedAt: at,
      caseId: 'C',
      windFromDegrees: 270,
      provenance: {
        measurements: {
          url: 'https://example.com',
          file: 'm',
          sha256: 'a'.repeat(64),
          retrieved: '2026-01-01',
        },
        geometry: {
          url: 'https://example.com',
          file: 'g',
          sha256: 'b'.repeat(64),
          retrieved: '2026-01-01',
          convertedFile: 'g.glb',
          coordinateTransform: 'none',
        },
        attribution: {
          dataPaper: 'paper',
          caseSources: ['case'],
          processing: 'test',
          disclaimer: 'none',
        },
      },
      method: {
        measurementStatistic: 'time-mean-of-instantaneous-scalar-speed',
        inflow: { kind: 'power', alpha: 0.25, note: 'test' },
        collision: 'trt',
        lesCs: 0.1,
      },
      simulation: {
        grid: { nx: 4, ny: 3, nz: 2 },
        totalCells: 24,
        dx: 1,
        precision: 'fp16',
        totalSteps: 100,
        transientSteps: 20,
        averagingSteps: 80,
        flowThroughSteps: 8,
        averagingFlowThroughs: 10,
        elapsedMs: 900,
        voxelizationMs: 100,
        gpu: 'test',
        browser: 'test',
        probeSampling: 'published-coordinates',
      },
      resolution: { acceptanceReady: true, requiredCells: 24, requiredDx: 1, checks: [] },
      metrics: { q: 0.5, qGate: 0.66, r: 0.8, rGate: null },
      verdict: 'fail',
      suppressionReasons: [],
      rows: [
        {
          id: 'p1',
          east: 0,
          north: 0,
          up: 1,
          measured: 1,
          simulated: 0.5,
          delta: -0.5,
          hit: false,
        },
        { id: 'p2', east: 1, north: 0, up: 1, measured: 1, simulated: 1, delta: 0, hit: true },
      ],
    },
  };
}

describe('urban durable artifact', () => {
  it('keeps a completed verdict auditable without Playwright reporter output', async () => {
    const run = await createFreshRun(await root(), 'urban-C', 'cfg', { runId: 'complete' });
    const state = hook();
    const coordinator = urbanArtifactCoordinator(
      run.layout,
      initialUrbanArtifact({ runId: run.layout.runId, hook: state, timeoutMs: 1000, stallMs: 100 }),
    );
    await syncUrbanArtifact(coordinator, state, 'verdict');
    await coordinator.terminate('completed');
    const saved = await readArtifact(run.layout.artifactPath);
    expect(saved.evidence.aggregate).toMatchObject({ q: 0.5, reportRows: 2 });
    expect(saved.evidence.detailed).toMatchObject({
      rows: [
        { id: 'p1', measured: 1, simulated: 0.5, hit: false },
        { id: 'p2', measured: 1, simulated: 1, hit: true },
      ],
    });
    expect(saved.verdicts.physicsTarget.state).toBe('fail');
  });

  it('keeps an interrupted result classifiable without a page snapshot', async () => {
    const run = await createFreshRun(await root(), 'urban-C', 'cfg', { runId: 'partial' });
    const state = hook();
    state.complete = false;
    state.phase = 'averaging';
    state.totalSteps = 80;
    state.report = null;
    state.q = undefined;
    state.verdict = undefined;
    state.deviceLoss = {
      observed: true,
      reason: 'unknown',
      message: 'device removed',
      observedAt: state.progress!.observedAt,
    };
    const coordinator = urbanArtifactCoordinator(
      run.layout,
      initialUrbanArtifact({ runId: run.layout.runId, hook: state, timeoutMs: 1000, stallMs: 100 }),
    );
    await syncUrbanArtifact(coordinator, state, 'device-loss');
    await coordinator.terminate('device-lost', new Error('device removed'));
    const saved = await readArtifact(run.layout.artifactPath);
    expect(saved.complete).toBe(false);
    expect(saved.termination?.reason).toBe('device-lost');
    expect(saved.lifecycle.progress.step).toBe(80);
    expect(saved.lifecycle.checkpoints.at(-1)?.step).toBe(80);
    expect(saved.lifecycle.deviceLoss).toMatchObject({ observed: true, message: 'device removed' });
  });
});
