import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  type NumericalHealthPolicy,
  type NumericalHealthRecord,
  type ValidationRunArtifact,
} from '@aeroflow/core';
import type { AeroflowHooks } from '../../src/dev/testHooks';
import { ArtifactSnapshotCoordinator, type RunDirectoryLayout } from './validationRun';

type UrbanHook = NonNullable<AeroflowHooks['urban']>;

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export function repositoryProvenance(cwd = process.cwd()): {
  revision: string;
  dirty: boolean;
  diffSha256?: string;
} {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
  const revision = git(['rev-parse', '--short', 'HEAD']).trim();
  const status = git(['status', '--short']);
  if (status.length === 0) return { revision, dirty: false };
  const diff = `${status}\n${git(['diff', 'HEAD', '--'])}`;
  return { revision, dirty: true, diffSha256: createHash('sha256').update(diff).digest('hex') };
}

export function initialUrbanArtifact(input: {
  runId: string;
  hook: UrbanHook;
  timeoutMs: number;
  stallMs: number;
  createdAt?: string;
}): ValidationRunArtifact {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const hook = input.hook;
  const grid = hook.grid ?? { nx: 0, ny: 0, nz: 0 };
  const material = (json(hook.materialConfiguration ?? {}) ?? {}) as Record<string, JsonValue>;
  const ledgerId = hook.caseId === 'C' ? 'V14' : 'V15';
  const ledger = ACCEPTANCE_BANDS.find((entry) => entry.id === ledgerId)!;
  const healthPolicy = numericalHealthPolicy(ledgerId);
  const logicalRunId = hook.logicalRunId ?? input.runId;
  const attemptId = hook.attemptId ?? `${input.runId}-attempt-1`;
  return {
    schemaVersion: VALIDATION_ARTIFACT_SCHEMA_VERSION,
    complete: false,
    identity: {
      runId: input.runId,
      logicalRunId,
      activeAttemptId: attemptId,
      caseId: `${ledgerId}-case-${hook.caseId}-${hook.direction}`,
      createdAt,
    },
    provenance: repositoryProvenance(),
    configuration: {
      scene: `aij-urban-${hook.caseId}-${hook.direction}`,
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
      budgets: { timeoutMs: input.timeoutMs, stallMs: input.stallMs },
      acceptance: {
        ledgerId,
        status: ledger.status,
        gateDescription: ledger.gateDescription,
        numericalHealthPolicy: json(healthPolicy.metrics),
        qMin: 0.66,
        ...(hook.caseId === 'E' ? { rMin: 0.7 } : {}),
      },
    },
    lifecycle: {
      phase: hook.phase ?? 'initialization',
      progress: {
        step: hook.totalSteps ?? 0,
        submittedStep: hook.submittedSteps ?? hook.totalSteps ?? 0,
        completedStep: hook.completedSteps ?? hook.totalSteps ?? 0,
        observedAt: hook.progress?.observedAt ?? createdAt,
        phase: hook.phase ?? 'initialization',
        wallMs: hook.progress?.wallMs ?? 0,
      },
      windows: hook.windows ?? [],
      checkpoints: [],
      recovery:
        hook.resumed && hook.restoredStep !== null && hook.restoredStep !== undefined
          ? [
              {
                restoredStep: hook.restoredStep,
                resumedAt: createdAt,
                previousAttemptId: 'prior-attempt',
                attemptId,
              },
            ]
          : [],
      attempts: [
        {
          attemptId,
          startedAt: createdAt,
          restoredStep: hook.restoredStep ?? null,
          status: hook.quarantined ? 'quarantined' : 'active',
        },
      ],
      operations: hook.operations ?? [],
      batchPolicy: hook.batchPolicy ?? {
        initialSteps: 8,
        targetMs: 2_000,
        minimumSteps: 2,
        maximumSteps: 256,
        currentSteps: 8,
        completedDurationsMs: [],
      },
      webgpuErrors: hook.webgpuErrors ?? [],
      diagnosticConfidence: {
        directObservations: [],
        derivedClassifications: [],
        unconfirmedHypotheses: ['operating-system TDR', 'driver reset', 'silent device loss'],
      },
      heartbeatAt: hook.progress?.observedAt ?? createdAt,
      deviceLoss: hook.deviceLoss ?? { observed: false },
    },
    verdicts: {
      execution: { state: 'unevaluated', reason: 'run in progress', metrics: {} },
      numericalHealth: { state: 'unevaluated', reason: 'no health snapshot yet', metrics: {} },
      physicsTarget: { state: 'unevaluated', reason: 'score not available', metrics: {} },
    },
    health: [],
    evidence: { aggregate: {}, detailed: { rows: [] } },
    termination: null,
    lastArtifactUpdateAt: createdAt,
  };
}

function evaluateUrbanHealth(
  policy: NumericalHealthPolicy,
  sample: NonNullable<UrbanHook['health']>[number],
): NumericalHealthEvaluation {
  return evaluateNumericalHealth(policy, {
    nonFiniteCells: sample.field.nonFiniteCells,
    densityMin: sample.field.rhoMin,
    densityMax: sample.field.rhoMax,
    relativeMassDrift: sample.field.massDriftRel,
    boundaryFluxClosure: sample.boundaryFluxClosureRel,
  });
}

function artifactMetric(
  evaluation: NumericalHealthEvaluation,
  id: NumericalHealthMetricPolicy['id'],
): HealthMetric {
  const metric = evaluation.metrics[id];
  return metric.state === 'unevaluated'
    ? { state: 'unevaluated', reason: `${metric.reason!.code}:${metric.reason!.detail}` }
    : {
        state: 'evaluated',
        value: metric.value!,
        limit: metric.limit,
        pass: metric.state === 'pass',
        unit: metric.unit,
      };
}

function healthRecords(hook: UrbanHook, policy: NumericalHealthPolicy): NumericalHealthRecord[] {
  return (hook.health ?? []).map((sample) => {
    const evaluation = evaluateUrbanHealth(policy, sample);
    return {
      sampledAt: sample.sampledAt,
      step: sample.step,
      phase: sample.phase,
      readbackMs: sample.readbackMs,
      nonFiniteCells: artifactMetric(evaluation, 'nonFiniteCells'),
      densityMin: artifactMetric(evaluation, 'densityMin'),
      densityMax: artifactMetric(evaluation, 'densityMax'),
      relativeMassDrift: artifactMetric(evaluation, 'relativeMassDrift'),
      boundaryFluxClosure: artifactMetric(evaluation, 'boundaryFluxClosure'),
    };
  });
}

export async function syncUrbanArtifact(
  coordinator: ArtifactSnapshotCoordinator,
  hook: UrbanHook,
  event: string,
): Promise<void> {
  await coordinator.update(event, (draft) => {
    const policy = numericalHealthPolicy(hook.caseId === 'C' ? 'V14' : 'V15');
    const observedAt = hook.progress?.observedAt ?? new Date().toISOString();
    draft.lifecycle.phase = hook.phase ?? draft.lifecycle.phase;
    draft.lifecycle.progress = {
      step: hook.totalSteps ?? draft.lifecycle.progress.step,
      submittedStep:
        hook.submittedSteps ?? hook.totalSteps ?? draft.lifecycle.progress.submittedStep,
      completedStep:
        hook.completedSteps ?? hook.totalSteps ?? draft.lifecycle.progress.completedStep,
      observedAt,
      phase: hook.phase ?? draft.lifecycle.progress.phase,
      wallMs: hook.progress?.wallMs ?? hook.wallMs ?? draft.lifecycle.progress.wallMs,
    };
    draft.lifecycle.heartbeatAt = observedAt;
    draft.lifecycle.windows = hook.windows ?? draft.lifecycle.windows;
    draft.lifecycle.deviceLoss = hook.deviceLoss ?? draft.lifecycle.deviceLoss;
    if (hook.attemptId) {
      draft.identity.activeAttemptId = hook.attemptId;
      const knownAttempt = draft.lifecycle.attempts.find(
        (attempt) => attempt.attemptId === hook.attemptId,
      );
      if (!knownAttempt) {
        draft.lifecycle.attempts.push({
          attemptId: hook.attemptId,
          startedAt: observedAt,
          restoredStep: hook.restoredStep ?? null,
          status: hook.quarantined ? 'quarantined' : hook.complete ? 'completed' : 'active',
        });
      } else {
        knownAttempt.status = hook.quarantined
          ? 'quarantined'
          : hook.complete
            ? 'completed'
            : 'active';
      }
    }
    for (const operation of hook.operations ?? []) {
      const index = draft.lifecycle.operations.findIndex(
        (known) => known.operationId === operation.operationId,
      );
      if (index >= 0) draft.lifecycle.operations[index] = structuredClone(operation);
      else draft.lifecycle.operations.push(structuredClone(operation));
    }
    draft.lifecycle.operations.sort(
      (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
    );
    draft.lifecycle.batchPolicy = hook.batchPolicy ?? draft.lifecycle.batchPolicy;
    for (const error of hook.webgpuErrors ?? []) {
      if (
        !draft.lifecycle.webgpuErrors.some(
          (known) =>
            known.observedAt === error.observedAt &&
            known.source === error.source &&
            known.message === error.message,
        )
      ) {
        draft.lifecycle.webgpuErrors.push(structuredClone(error));
      }
    }
    draft.lifecycle.diagnosticConfidence.directObservations = draft.lifecycle.operations.flatMap(
      (operation) =>
        operation.directObservations.map(
          (observation) => `${operation.operationId}:${observation.kind}`,
        ),
    );
    draft.lifecycle.diagnosticConfidence.derivedClassifications = Array.from(
      new Set(
        draft.lifecycle.operations.flatMap((operation) =>
          operation.classification ? [operation.classification] : [],
        ),
      ),
    );
    for (const checkpoint of hook.checkpointHistory ?? []) {
      if (
        !draft.lifecycle.checkpoints.some(
          (known) => known.step === checkpoint.step && known.savedAt === checkpoint.savedAt,
        )
      ) {
        draft.lifecycle.checkpoints.push({
          attemptId: hook.attemptId ?? draft.identity.activeAttemptId,
          step: checkpoint.step,
          savedAt: checkpoint.savedAt,
          location: checkpoint.location,
          bytes: checkpoint.bytes,
          writeMs: checkpoint.writeMs,
          complete: checkpoint.complete,
        });
      }
    }
    if (
      hook.resumed &&
      hook.restoredStep !== null &&
      hook.restoredStep !== undefined &&
      !draft.lifecycle.recovery.some(
        (entry) => entry.restoredStep === hook.restoredStep && entry.attemptId === hook.attemptId,
      )
    ) {
      draft.lifecycle.recovery.push({
        restoredStep: hook.restoredStep,
        resumedAt: observedAt,
        previousAttemptId: draft.lifecycle.attempts.at(-2)?.attemptId ?? 'prior-attempt',
        attemptId: hook.attemptId ?? draft.identity.activeAttemptId,
      });
    }
    if (hook.completedSteps !== undefined) {
      const activeRecovery = [...draft.lifecycle.recovery]
        .reverse()
        .find((entry) => entry.attemptId === (hook.attemptId ?? draft.identity.activeAttemptId));
      if (
        activeRecovery &&
        activeRecovery.firstCompletedStepAfterRestore === undefined &&
        hook.completedSteps > activeRecovery.restoredStep
      ) {
        activeRecovery.firstCompletedStepAfterRestore = hook.completedSteps;
      }
    }
    if (hook.lastCheckpointAt) draft.lifecycle.checkpointActivityAt = hook.lastCheckpointAt;
    for (const sample of healthRecords(hook, policy)) {
      if (
        !draft.health.some(
          (known) => known.step === sample.step && known.sampledAt === sample.sampledAt,
        )
      ) {
        draft.health.push(sample);
      }
    }
    const rawLatestHealth = hook.health?.at(-1);
    const healthEvaluation = rawLatestHealth
      ? evaluateUrbanHealth(policy, rawLatestHealth)
      : undefined;
    if (healthEvaluation) {
      draft.verdicts.numericalHealth = numericalHealthVerdict(healthEvaluation);
    }
    const report = hook.report;
    draft.evidence.aggregate = {
      totalSteps: hook.totalSteps ?? 0,
      averagingFlowThroughs: hook.averagingFlowThroughs ?? 0,
      q: hook.q ?? null,
      r: hook.r ?? null,
      verdict: hook.verdict ?? null,
      reportRows: hook.reportRows ?? 0,
      underResolved: hook.underResolved ?? null,
      elapsedMs: hook.elapsedMs ?? null,
      voxelizationMs: hook.voxelizationMs ?? null,
    };
    draft.evidence.detailed = json({ report, rows: report?.rows ?? [] });
    const measuredVerdict = report?.verdict ?? hook.verdict;
    if (measuredVerdict) {
      const measured = {
        state:
          measuredVerdict === 'pass' ? 'pass' : measuredVerdict === 'fail' ? 'fail' : 'unevaluated',
        reason:
          measuredVerdict === 'suppressed'
            ? 'under-resolved configuration suppressed scoring'
            : undefined,
        metrics: { q: hook.q ?? null, r: hook.r ?? null, rows: hook.reportRows ?? 0 },
      } as const;
      draft.verdicts.physicsTarget = healthEvaluation
        ? gatePhysicsVerdict(measured, healthEvaluation)
        : measured.state === 'unevaluated'
          ? measured
          : {
              state: 'unevaluated',
              reason: 'numerical-health-unevaluated',
              metrics: { ...measured.metrics, measuredState: measured.state },
            };
    }
  });
}

export function urbanArtifactCoordinator(
  layout: RunDirectoryLayout,
  artifact: ValidationRunArtifact,
): ArtifactSnapshotCoordinator {
  return new ArtifactSnapshotCoordinator(layout, artifact);
}
