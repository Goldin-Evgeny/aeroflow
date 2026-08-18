import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AeroflowHooks } from '../src/dev/testHooks';
import {
  aijArtifactCoordinator,
  initialAijArtifact,
  syncAijArtifact,
} from '../e2e/helpers/aijArtifact';
import { createFreshRun, readArtifact } from '../e2e/helpers/validationRun';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aeroflow-aij-artifact-'));
  roots.push(root);
  return root;
}

function hook(): NonNullable<AeroflowHooks['aij']> {
  return {
    mode: 'fetch',
    totalSteps: 100,
    grid: { nx: 4, ny: 3, nz: 2 },
    materialConfiguration: {
      precision: 'fp32',
      collision: 'trt',
      outlet: 'zero-gradient',
      boundaryMassLedger: true,
    },
    phase: 'evaluation',
    observedAt: '2026-08-18T12:00:00.000Z',
    health: {
      fluidCells: 20,
      totalMass: 20,
      massDriftRel: 0,
      rhoMin: 0.99,
      rhoMax: 1.01,
      rhoMean: 1,
      uMax: 0.05,
      machMax: 0.0866,
      nonFiniteCells: 0,
      boundaryMassNet: 0,
      boundaryMassCumulative: 0,
      boundaryFluxClosureRel: 0,
    },
    steady: true,
    fetchMaxRel: 0.04,
    fetchPass: true,
    fetchRows: [{ y: 2, sim: 0.96, ref: 1 }],
  };
}

async function write(state: NonNullable<AeroflowHooks['aij']>) {
  const run = await createFreshRun(await temporaryRoot(), 'aij-fetch', 'cfg', {
    runId: crypto.randomUUID(),
  });
  const coordinator = aijArtifactCoordinator(
    run.layout,
    initialAijArtifact({ runId: run.layout.runId, mode: 'fetch', hook: state, timeoutMs: 1000 }),
  );
  await syncAijArtifact(coordinator, state, 'verdict');
  return readArtifact(run.layout.artifactPath);
}

describe('Case A/fetch health-gated artifacts', () => {
  it('publishes a healthy target verdict with concrete complete-shell policy values', async () => {
    const saved = await write(hook());
    expect(saved.verdicts.numericalHealth.state).toBe('pass');
    expect(saved.verdicts.physicsTarget.state).toBe('pass');
    expect(saved.health[0].boundaryFluxClosure).toEqual({
      state: 'evaluated',
      value: 0,
      limit: 0.001,
      pass: true,
      unit: 'fraction of initial mass',
    });
  });

  it('retains row evidence but suppresses promotion when numerical health fails', async () => {
    const state = hook();
    state.health!.nonFiniteCells = 1;
    const saved = await write(state);
    expect(saved.verdicts.numericalHealth.state).toBe('fail');
    expect(saved.verdicts.physicsTarget).toMatchObject({
      state: 'unevaluated',
      reason: 'numerical-health-failed',
      metrics: { maximumRelativeError: 0.04, measuredState: 'pass' },
    });
    expect(saved.evidence.detailed).toMatchObject({ rows: [{ y: 2, sim: 0.96, ref: 1 }] });
  });

  it('retains measurements without promotion when the health snapshot is missing', async () => {
    const state = hook();
    state.health = undefined;
    const saved = await write(state);
    expect(saved.verdicts.numericalHealth.state).toBe('unevaluated');
    expect(saved.verdicts.physicsTarget).toMatchObject({
      state: 'unevaluated',
      reason: 'numerical-health-unevaluated',
      metrics: { maximumRelativeError: 0.04, measuredState: 'pass' },
    });
  });
});
