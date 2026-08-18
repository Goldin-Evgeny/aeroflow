import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  ACCEPTANCE_BANDS,
  VALIDATION_ARTIFACT_SCHEMA_VERSION,
  type JsonValue,
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
  return {
    schemaVersion: VALIDATION_ARTIFACT_SCHEMA_VERSION,
    complete: false,
    identity: {
      runId: input.runId,
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
        qMin: 0.66,
        ...(hook.caseId === 'E' ? { rMin: 0.7 } : {}),
      },
    },
    lifecycle: {
      phase: hook.phase ?? 'initialization',
      progress: {
        step: hook.totalSteps ?? 0,
        observedAt: hook.progress?.observedAt ?? createdAt,
        phase: hook.phase ?? 'initialization',
        wallMs: hook.progress?.wallMs ?? 0,
      },
      windows: hook.windows ?? [],
      checkpoints: [],
      recovery:
        hook.resumed && hook.restoredStep !== null && hook.restoredStep !== undefined
          ? [{ restoredStep: hook.restoredStep, resumedAt: createdAt, previousRunId: input.runId }]
          : [],
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

function healthRecords(hook: UrbanHook): NumericalHealthRecord[] {
  return (hook.health ?? []).map((sample) => ({
    sampledAt: sample.sampledAt,
    step: sample.step,
    phase: sample.phase,
    readbackMs: sample.readbackMs,
    nonFiniteCells: {
      state: 'evaluated',
      value: sample.field.nonFiniteCells,
      limit: 0,
      pass: sample.field.nonFiniteCells === 0,
      unit: 'cells',
    },
    densityMin: { state: 'evaluated', value: sample.field.rhoMin },
    densityMax: { state: 'evaluated', value: sample.field.rhoMax },
    relativeMassDrift: { state: 'evaluated', value: sample.field.massDriftRel },
    boundaryFluxClosure: { state: 'evaluated', value: sample.boundaryFluxClosureRel },
  }));
}

export async function syncUrbanArtifact(
  coordinator: ArtifactSnapshotCoordinator,
  hook: UrbanHook,
  event: string,
): Promise<void> {
  await coordinator.update(event, (draft) => {
    const observedAt = hook.progress?.observedAt ?? new Date().toISOString();
    draft.lifecycle.phase = hook.phase ?? draft.lifecycle.phase;
    draft.lifecycle.progress = {
      step: hook.totalSteps ?? draft.lifecycle.progress.step,
      observedAt,
      phase: hook.phase ?? draft.lifecycle.progress.phase,
      wallMs: hook.progress?.wallMs ?? hook.wallMs ?? draft.lifecycle.progress.wallMs,
    };
    draft.lifecycle.heartbeatAt = observedAt;
    draft.lifecycle.windows = hook.windows ?? draft.lifecycle.windows;
    draft.lifecycle.deviceLoss = hook.deviceLoss ?? draft.lifecycle.deviceLoss;
    for (const checkpoint of hook.checkpointHistory ?? []) {
      if (
        !draft.lifecycle.checkpoints.some(
          (known) => known.step === checkpoint.step && known.savedAt === checkpoint.savedAt,
        )
      ) {
        draft.lifecycle.checkpoints.push({
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
      !draft.lifecycle.recovery.some((entry) => entry.restoredStep === hook.restoredStep)
    ) {
      draft.lifecycle.recovery.push({
        restoredStep: hook.restoredStep,
        resumedAt: observedAt,
        previousRunId: draft.identity.runId,
      });
    }
    if (hook.lastCheckpointAt) draft.lifecycle.checkpointActivityAt = hook.lastCheckpointAt;
    for (const sample of healthRecords(hook)) {
      if (
        !draft.health.some(
          (known) => known.step === sample.step && known.sampledAt === sample.sampledAt,
        )
      ) {
        draft.health.push(sample);
      }
    }
    const latestHealth = draft.health.at(-1);
    if (latestHealth) {
      const nonFinite = latestHealth.nonFiniteCells;
      draft.verdicts.numericalHealth =
        nonFinite.state === 'evaluated' && nonFinite.value > 0
          ? {
              state: 'fail',
              reason: 'whole-field readback contains non-finite cells',
              metrics: { nonFiniteCells: nonFinite.value },
            }
          : {
              state: 'unevaluated',
              reason:
                'diagnostics were sampled, but V14/V15 declare no density, mass-drift, or closure pass limits',
              metrics: {
                nonFiniteCells: nonFinite.state === 'evaluated' ? nonFinite.value : null,
                densityMin:
                  latestHealth.densityMin.state === 'evaluated'
                    ? latestHealth.densityMin.value
                    : null,
                densityMax:
                  latestHealth.densityMax.state === 'evaluated'
                    ? latestHealth.densityMax.value
                    : null,
                relativeMassDrift:
                  latestHealth.relativeMassDrift.state === 'evaluated'
                    ? latestHealth.relativeMassDrift.value
                    : null,
                boundaryFluxClosure:
                  latestHealth.boundaryFluxClosure.state === 'evaluated'
                    ? latestHealth.boundaryFluxClosure.value
                    : null,
              },
            };
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
    if (hook.verdict) {
      draft.verdicts.physicsTarget = {
        state: hook.verdict === 'pass' ? 'pass' : hook.verdict === 'fail' ? 'fail' : 'unevaluated',
        reason:
          hook.verdict === 'suppressed'
            ? 'under-resolved configuration suppressed scoring'
            : undefined,
        metrics: { q: hook.q ?? null, r: hook.r ?? null, rows: hook.reportRows ?? 0 },
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
