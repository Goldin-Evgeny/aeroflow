import {
  ACCEPTANCE_BANDS,
  VALIDATION_ARTIFACT_SCHEMA_VERSION,
  evaluateNumericalHealth,
  gatePhysicsVerdict,
  numericalHealthPolicy,
  numericalHealthVerdict,
  type HealthMetric,
  type JsonValue,
  type NumericalHealthEvaluation,
  type NumericalHealthMetricPolicy,
  type ValidationRunArtifact,
} from '@aeroflow/core';
import type { AeroflowHooks } from '../../src/dev/testHooks';
import { ArtifactSnapshotCoordinator, type RunDirectoryLayout } from './validationRun';
import { repositoryProvenance } from './urbanArtifact';

type AijHook = NonNullable<AeroflowHooks['aij']>;

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export function initialAijArtifact(input: {
  runId: string;
  mode: 'fetch' | 'score';
  hook: AijHook;
  timeoutMs: number;
  createdAt?: string;
}): ValidationRunArtifact {
  const at = input.createdAt ?? new Date().toISOString();
  const grid = input.hook.grid ?? { nx: 0, ny: 0, nz: 0 };
  const material = json(input.hook.materialConfiguration ?? {}) as Record<string, JsonValue>;
  const ledgerId = input.mode === 'fetch' ? 'V12' : 'V13';
  const ledger = ACCEPTANCE_BANDS.find((entry) => entry.id === ledgerId)!;
  const healthPolicy = numericalHealthPolicy(ledgerId);
  return {
    schemaVersion: VALIDATION_ARTIFACT_SCHEMA_VERSION,
    complete: false,
    identity: {
      runId: input.runId,
      logicalRunId: input.runId,
      activeAttemptId: `${input.runId}-attempt-1`,
      caseId: `${ledgerId}-aij-${input.mode}`,
      createdAt: at,
    },
    provenance: repositoryProvenance(),
    configuration: {
      scene: `aij-case-a-${input.mode}`,
      grid: { ...grid, cells: grid.nx * grid.ny * grid.nz },
      solver: material,
      precision: String(material.precision ?? 'unknown'),
      boundaries: {
        velocityInlet: true,
        outlet: material.outlet ?? 'unknown',
        freeSlip: json(material.freeSlip ?? null),
        ground: 'no-slip',
      },
      closures: { collision: material.collision ?? 'unknown', les: json(material.les ?? null) },
      budgets: { timeoutMs: input.timeoutMs },
      acceptance: {
        ledgerId,
        status: ledger.status,
        gateDescription: ledger.gateDescription,
        numericalHealthPolicy: json(healthPolicy.metrics),
        outletPolicyId: material.outletPolicyId ?? null,
        outletConfigurationKind: material.outletConfigurationKind ?? null,
        configurationFingerprint: material.configurationFingerprint ?? null,
        collisionPolicyId: material.collisionPolicyId ?? null,
        collisionOperatorId: material.collisionOperatorId ?? null,
        collisionConfigurationKind: material.collisionConfigurationKind ?? null,
      },
    },
    lifecycle: {
      phase: input.hook.phase ?? 'initialization',
      progress: {
        step: input.hook.totalSteps ?? 0,
        submittedStep: input.hook.totalSteps ?? 0,
        completedStep: input.hook.totalSteps ?? 0,
        observedAt: input.hook.observedAt ?? at,
        phase: input.hook.phase ?? 'initialization',
        wallMs: 0,
      },
      windows: input.hook.phaseWindows ?? [],
      checkpoints: [],
      recovery: [],
      attempts: [
        {
          attemptId: `${input.runId}-attempt-1`,
          startedAt: at,
          restoredStep: null,
          status: 'active',
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
      heartbeatAt: input.hook.observedAt ?? at,
      deviceLoss: { observed: false },
    },
    verdicts: {
      execution: { state: 'unevaluated', reason: 'run in progress', metrics: {} },
      numericalHealth: { state: 'unevaluated', reason: 'no health snapshot yet', metrics: {} },
      physicsTarget: { state: 'unevaluated', reason: 'steady verdict not available', metrics: {} },
    },
    health: [],
    evidence: { aggregate: {}, detailed: input.mode === 'fetch' ? { rows: [] } : { points: [] } },
    termination: null,
    lastArtifactUpdateAt: at,
  };
}

export async function syncAijArtifact(
  coordinator: ArtifactSnapshotCoordinator,
  hook: AijHook,
  event: string,
): Promise<void> {
  await coordinator.update(event, (draft) => {
    const at = hook.observedAt ?? new Date().toISOString();
    draft.lifecycle.phase = hook.phase ?? draft.lifecycle.phase;
    draft.lifecycle.progress = {
      step: hook.totalSteps ?? draft.lifecycle.progress.step,
      submittedStep: hook.totalSteps ?? draft.lifecycle.progress.submittedStep,
      completedStep: hook.totalSteps ?? draft.lifecycle.progress.completedStep,
      observedAt: at,
      phase: hook.phase ?? draft.lifecycle.progress.phase,
      wallMs: draft.lifecycle.progress.wallMs,
    };
    draft.lifecycle.heartbeatAt = at;
    draft.lifecycle.windows = hook.phaseWindows ?? draft.lifecycle.windows;
    const ledgerId = hook.mode === 'fetch' ? 'V12' : 'V13';
    const policy = numericalHealthPolicy(ledgerId);
    let healthEvaluation: NumericalHealthEvaluation | undefined;
    if (hook.health) {
      healthEvaluation = evaluateNumericalHealth(policy, {
        nonFiniteCells: hook.health.nonFiniteCells,
        densityMin: hook.health.rhoMin,
        densityMax: hook.health.rhoMax,
        relativeMassDrift: hook.health.massDriftRel,
        boundaryFluxClosure: hook.health.boundaryFluxClosureRel,
      });
    }
    const artifactMetric = (id: NumericalHealthMetricPolicy['id']): HealthMetric => {
      const metric = healthEvaluation!.metrics[id];
      return metric.state === 'unevaluated'
        ? {
            state: 'unevaluated',
            reason: `${metric.reason!.code}:${metric.reason!.detail}`,
          }
        : {
            state: 'evaluated',
            value: metric.value!,
            limit: metric.limit,
            pass: metric.state === 'pass',
            unit: metric.unit,
          };
    };
    if (
      hook.health &&
      healthEvaluation &&
      !draft.health.some((sample) => sample.step === (hook.totalSteps ?? 0))
    ) {
      draft.health.push({
        sampledAt: at,
        step: hook.totalSteps ?? 0,
        phase: hook.phase ?? 'averaging',
        readbackMs: 0,
        nonFiniteCells: artifactMetric('nonFiniteCells'),
        densityMin: artifactMetric('densityMin'),
        densityMax: artifactMetric('densityMax'),
        relativeMassDrift: artifactMetric('relativeMassDrift'),
        boundaryFluxClosure: artifactMetric('boundaryFluxClosure'),
      });
      draft.verdicts.numericalHealth = numericalHealthVerdict(healthEvaluation);
    }
    draft.evidence.aggregate = {
      totalSteps: hook.totalSteps ?? 0,
      windows: hook.windows ?? 0,
      drift: hook.drift ?? null,
      steady: hook.steady ?? false,
      q: hook.q ?? null,
      r: hook.r ?? null,
      fetchMaxRel: hook.fetchMaxRel ?? null,
      fetchPass: hook.fetchPass ?? null,
      synthetic: hook.synthetic ?? null,
      underResolved: hook.underResolved ?? null,
      trace: json(hook.trace ?? []),
    };
    if (hook.mode === 'fetch') {
      const rows = (hook.fetchRows ?? []).map((row) => {
        const relativeError = Math.abs(row.sim - row.ref) / row.ref;
        return { ...row, relativeError, hit: relativeError <= 0.05 };
      });
      draft.evidence.detailed = json({ rows });
      if (hook.steady && hook.fetchPass !== undefined) {
        const measured = {
          state: hook.fetchPass ? 'pass' : 'fail',
          metrics: { maximumRelativeError: hook.fetchMaxRel ?? null, rows: rows.length },
        } as const;
        draft.verdicts.physicsTarget =
          hook.materialConfiguration?.physicsVerdictAllowed === false
            ? {
                state: 'unevaluated',
                reason: 'diagnostic-outlet-override',
                metrics: { ...measured.metrics, measuredState: measured.state },
              }
            : healthEvaluation
              ? gatePhysicsVerdict(measured, healthEvaluation)
              : {
                  state: 'unevaluated',
                  reason: 'numerical-health-unevaluated',
                  metrics: { ...measured.metrics, measuredState: measured.state },
                };
      }
    } else {
      const points = (hook.scoreRows ?? []).map((row) => ({
        ...row,
        absoluteError: Math.abs(row.sim - row.expected),
      }));
      draft.evidence.detailed = json({ points });
      if (hook.steady && hook.q !== undefined && hook.r !== undefined) {
        const measured = {
          state: hook.q >= 0.66 && hook.r >= 0.7 ? 'pass' : 'fail',
          metrics: { q: hook.q, r: hook.r, points: points.length },
        } as const;
        draft.verdicts.physicsTarget =
          hook.materialConfiguration?.physicsVerdictAllowed === false
            ? {
                state: 'unevaluated',
                reason: 'diagnostic-outlet-override',
                metrics: { ...measured.metrics, measuredState: measured.state },
              }
            : healthEvaluation
              ? gatePhysicsVerdict(measured, healthEvaluation)
              : {
                  state: 'unevaluated',
                  reason: 'numerical-health-unevaluated',
                  metrics: { ...measured.metrics, measuredState: measured.state },
                };
      }
    }
  });
}

export function aijArtifactCoordinator(
  layout: RunDirectoryLayout,
  artifact: ValidationRunArtifact,
): ArtifactSnapshotCoordinator {
  return new ArtifactSnapshotCoordinator(layout, artifact);
}
