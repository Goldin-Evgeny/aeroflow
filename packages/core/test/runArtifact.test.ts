import { describe, expect, it } from 'vitest';
import {
  VALIDATION_ARTIFACT_SCHEMA_VERSION,
  selectVerdictSamples,
  validateValidationRunArtifact,
  type ValidationRunArtifact,
  type VerdictWindow,
} from '../src/index.js';

function fixture(complete: boolean): ValidationRunArtifact {
  const now = '2026-08-18T12:00:00.000Z';
  return {
    schemaVersion: VALIDATION_ARTIFACT_SCHEMA_VERSION,
    complete,
    identity: {
      runId: 'run-1',
      logicalRunId: 'logical-1',
      activeAttemptId: 'attempt-1',
      caseId: 'V14-C-270',
      createdAt: now,
    },
    provenance: { revision: 'abc1234', dirty: true, diffSha256: 'f'.repeat(64) },
    configuration: {
      scene: 'aij-urban-C-270',
      grid: { nx: 4, ny: 3, nz: 2, cells: 24 },
      solver: { collision: 'trt', lesCs: 0.1 },
      precision: 'fp16',
      boundaries: { inlet: 'velocity', outlet: 'pressure' },
      closures: { lesNorm: 'spec' },
      budgets: { timeoutMs: 120000, stallMs: 30000 },
      acceptance: { ledgerId: 'V14', qMin: 0.66 },
    },
    lifecycle: {
      phase: complete ? 'terminal' : 'averaging',
      progress: {
        step: 120,
        submittedStep: 120,
        completedStep: 120,
        observedAt: now,
        phase: complete ? 'terminal' : 'averaging',
        wallMs: 42,
      },
      windows: [
        { phase: 'initialization', startStep: 0, endStep: 0, selectionRule: 'uniform reset' },
        { phase: 'transient', startStep: 1, endStep: 40, selectionRule: 'discard startup' },
        { phase: 'averaging', startStep: 41, endStep: 100, selectionRule: 'accumulate samples' },
        { phase: 'evaluation', startStep: 81, endStep: 100, selectionRule: 'final 20 steps' },
      ],
      checkpoints: [
        {
          attemptId: 'attempt-1',
          step: 80,
          savedAt: now,
          location: 'profile/IndexedDB',
          bytes: 1024,
          writeMs: 4,
          complete: true,
        },
      ],
      recovery: [],
      attempts: [{ attemptId: 'attempt-1', startedAt: now, restoredStep: null, status: 'active' }],
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
        unconfirmedHypotheses: ['driver reset'],
      },
      heartbeatAt: now,
      checkpointActivityAt: now,
      artifactWriteActivityAt: now,
      deviceLoss: { observed: false },
    },
    verdicts: {
      execution: { state: complete ? 'pass' : 'unevaluated', metrics: {} },
      numericalHealth: { state: 'pass', metrics: { nonFiniteCells: 0 } },
      physicsTarget: { state: complete ? 'fail' : 'unevaluated', metrics: { q: 0.4583 } },
    },
    health: [
      {
        sampledAt: now,
        step: 80,
        phase: 'averaging',
        readbackMs: 3,
        nonFiniteCells: { state: 'evaluated', value: 0, limit: 0, pass: true },
        densityMin: { state: 'evaluated', value: 0.99 },
        densityMax: { state: 'evaluated', value: 1.01 },
        relativeMassDrift: { state: 'evaluated', value: 1e-5 },
        boundaryFluxClosure: { state: 'not-applicable', reason: 'closed test scene' },
      },
      {
        sampledAt: now,
        step: 120,
        phase: complete ? 'terminal' : 'averaging',
        readbackMs: 0,
        nonFiniteCells: { state: 'unevaluated', reason: 'browser closed before readback' },
        densityMin: { state: 'unevaluated', reason: 'browser closed before readback' },
        densityMax: { state: 'unevaluated', reason: 'browser closed before readback' },
        relativeMassDrift: { state: 'unevaluated', reason: 'browser closed before readback' },
        boundaryFluxClosure: { state: 'not-applicable', reason: 'closed test scene' },
      },
    ],
    evidence: {
      aggregate: { q: 0.4583, points: 120 },
      detailed: { rows: [{ id: 'p1', measured: 1, simulated: 0.5, error: 0.5, hit: false }] },
    },
    termination: complete
      ? { reason: 'completed', at: now }
      : { reason: 'browser-closed', at: now, error: { name: 'Error', message: 'page closed' } },
    lastArtifactUpdateAt: now,
  };
}

describe('validation run artifact', () => {
  it('accepts self-contained complete and partial records', () => {
    expect(validateValidationRunArtifact(fixture(true)).complete).toBe(true);
    expect(validateValidationRunArtifact(fixture(false)).termination?.reason).toBe(
      'browser-closed',
    );
  });

  it('rejects unsupported versions and malformed records', () => {
    expect(() => validateValidationRunArtifact({ ...fixture(true), schemaVersion: 1 })).toThrow(
      /unsupported.*version/i,
    );
    const malformed = structuredClone(fixture(true)) as ValidationRunArtifact;
    malformed.configuration.grid.cells = 25;
    expect(() => validateValidationRunArtifact(malformed)).toThrow(/does not match dimensions/);
  });

  it('requires unavailable health to be explicit rather than silently passing', () => {
    const malformed = structuredClone(fixture(false)) as unknown as {
      health: Array<Record<string, unknown>>;
    };
    malformed.health[0].relativeMassDrift = { state: 'pass' };
    expect(() => validateValidationRunArtifact(malformed)).toThrow(/state is unsupported/);
  });

  it('blocks a physics verdict when a declared numerical-health policy is not passing', () => {
    const malformed = fixture(true);
    malformed.configuration.acceptance.numericalHealthPolicy = [
      { id: 'nonFiniteCells', direction: 'max', limit: 0, unit: 'cells' },
    ];
    malformed.verdicts.numericalHealth = {
      state: 'unevaluated',
      reason: 'missing-metric',
      metrics: {},
    };
    expect(() => validateValidationRunArtifact(malformed)).toThrow(
      /physics target verdict requires a passing declared numerical-health policy/,
    );
  });

  it('keeps pre-policy schema-2 artifacts readable without silently rescoring them', () => {
    const historical = fixture(true);
    historical.verdicts.numericalHealth = {
      state: 'unevaluated',
      reason: 'limits were not declared at run time',
      metrics: {},
    };
    expect(validateValidationRunArtifact(historical).verdicts.physicsTarget.state).toBe('fail');
  });

  it('preserves incomplete operations and submitted-but-uncommitted work in partial artifacts', () => {
    const partial = fixture(false);
    partial.lifecycle.progress.submittedStep = 128;
    partial.lifecycle.operations.push({
      operationId: 'op-1',
      logicalRunId: 'logical-1',
      attemptId: 'attempt-1',
      phase: 'queue-completion',
      startedAt: partial.lastArtifactUpdateAt,
      lastActivityAt: partial.lastArtifactUpdateAt,
      deadline: {
        initialMs: 30_000,
        effectiveMs: 30_000,
        maximumMs: 300_000,
        activityExtends: false,
      },
      terminalState: 'timed-out',
      classification: 'queue-timeout',
      directObservations: [{ kind: 'deadline-expired', observedAt: partial.lastArtifactUpdateAt }],
      submittedRange: { start: 121, end: 128 },
      wallMs: 30_000,
    });
    expect(validateValidationRunArtifact(partial).lifecycle.progress).toMatchObject({
      submittedStep: 128,
      completedStep: 120,
    });
  });

  it('rejects checkpoints or published evaluations beyond completed GPU work', () => {
    const checkpoint = fixture(false);
    checkpoint.lifecycle.progress.submittedStep = 128;
    checkpoint.lifecycle.checkpoints[0].step = 124;
    expect(() => validateValidationRunArtifact(checkpoint)).toThrow(/checkpoint.*uncommitted/i);

    const evaluation = fixture(true);
    evaluation.lifecycle.progress.submittedStep = 128;
    expect(() => validateValidationRunArtifact(evaluation)).toThrow(/evaluation.*equality/i);
  });
});

describe('phase-aware verdict selection', () => {
  const window: VerdictWindow = {
    phase: 'evaluation',
    startStep: 80,
    endStep: 100,
    minimumSamples: 3,
    selectionRule: 'inclusive final declared window',
  };

  it('ignores long startup ringing when the declared final window passes', () => {
    const samples = [
      { step: 10, error: 9 },
      { step: 50, error: 3 },
      { step: 80, error: 0.1 },
      { step: 90, error: 0.08 },
      { step: 100, error: 0.09 },
    ];
    expect(Math.max(...selectVerdictSamples(samples, window).map((sample) => sample.error))).toBe(
      0.1,
    );
  });

  it('retains a genuine final-window failure', () => {
    const samples = [
      { step: 80, error: 0.1 },
      { step: 90, error: 0.7 },
      { step: 100, error: 0.2 },
    ];
    expect(Math.max(...selectVerdictSamples(samples, window).map((sample) => sample.error))).toBe(
      0.7,
    );
  });

  it('rejects an insufficient evaluation interval', () => {
    expect(() => selectVerdictSamples([{ step: 90 }, { step: 100 }], window)).toThrow(/requires 3/);
  });

  it('reconstructs the exact inclusive interval recorded in the artifact', () => {
    const selected = selectVerdictSamples(
      Array.from({ length: 12 }, (_, index) => ({ step: index * 10 })),
      window,
    );
    expect(selected.map((sample) => sample.step)).toEqual([80, 90, 100]);
  });
});
