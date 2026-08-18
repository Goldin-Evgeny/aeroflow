/** Durable, JSON-safe evidence written by long-running validation harnesses. */

export const VALIDATION_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type RunPhase = 'initialization' | 'transient' | 'averaging' | 'evaluation' | 'terminal';
export type TerminationReason =
  | 'completed'
  | 'timeout'
  | 'stalled'
  | 'device-lost'
  | 'aborted'
  | 'browser-closed'
  | 'unexpected-error';

export interface RunIdentity {
  runId: string;
  caseId: string;
  createdAt: string;
}

export interface SourceProvenance {
  revision: string;
  dirty: boolean;
  diffSha256?: string;
}

export interface PhaseWindow {
  phase: RunPhase;
  startStep: number;
  endStep: number | null;
  selectionRule: string;
  startFlowThrough?: number;
  endFlowThrough?: number | null;
}

export interface ProgressRecord {
  step: number;
  observedAt: string;
  phase: RunPhase;
  wallMs: number;
}

export interface CheckpointRecord {
  step: number;
  savedAt: string;
  location: string;
  bytes: number;
  writeMs: number;
  complete: boolean;
}

export interface DeviceLossRecord {
  observed: boolean;
  reason?: string;
  message?: string;
  observedAt?: string;
}

export type HealthMetric =
  | { state: 'evaluated'; value: number; limit?: number; pass?: boolean; unit?: string }
  | { state: 'not-applicable'; reason: string }
  | { state: 'unevaluated'; reason: string };

export interface NumericalHealthRecord {
  sampledAt: string;
  step: number;
  phase: RunPhase;
  readbackMs: number;
  nonFiniteCells: HealthMetric;
  densityMin: HealthMetric;
  densityMax: HealthMetric;
  relativeMassDrift: HealthMetric;
  boundaryFluxClosure: HealthMetric;
}

export type VerdictState = 'pass' | 'fail' | 'unevaluated';

export interface VerdictAxis {
  state: VerdictState;
  reason?: string;
  metrics: Record<string, JsonValue>;
}

export interface RunTermination {
  reason: TerminationReason;
  at: string;
  error?: { name: string; message: string; stack?: string };
  noProgressMs?: number;
}

export interface ValidationRunArtifact<TEvidence extends JsonValue = JsonValue> {
  schemaVersion: typeof VALIDATION_ARTIFACT_SCHEMA_VERSION;
  complete: boolean;
  identity: RunIdentity;
  provenance: SourceProvenance;
  configuration: {
    scene: string;
    grid: { nx: number; ny: number; nz: number; cells: number };
    solver: Record<string, JsonValue>;
    precision: string;
    boundaries: Record<string, JsonValue>;
    closures: Record<string, JsonValue>;
    budgets: Record<string, JsonValue>;
    acceptance: Record<string, JsonValue>;
  };
  lifecycle: {
    phase: RunPhase;
    progress: ProgressRecord;
    windows: PhaseWindow[];
    checkpoints: CheckpointRecord[];
    recovery: Array<{ restoredStep: number; resumedAt: string; previousRunId: string }>;
    heartbeatAt: string;
    checkpointActivityAt?: string;
    artifactWriteActivityAt?: string;
    deviceLoss: DeviceLossRecord;
  };
  verdicts: {
    execution: VerdictAxis;
    numericalHealth: VerdictAxis;
    physicsTarget: VerdictAxis;
  };
  health: NumericalHealthRecord[];
  evidence: {
    aggregate: Record<string, JsonValue>;
    detailed: TEvidence;
  };
  termination: RunTermination | null;
  lastArtifactUpdateAt: string;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a string`);
  return value;
}

function timestamp(value: unknown, path: string): string {
  const result = string(value, path);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${path} must be an ISO timestamp`);
  return result;
}

function finite(value: unknown, path: string, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${path} must be a finite${integer ? ' integer' : ''} number`);
  }
  return value;
}

function nonNegative(value: unknown, path: string, integer = false): number {
  const result = finite(value, path, integer);
  if (result < 0) throw new Error(`${path} must be non-negative`);
  return result;
}

function json(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => json(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      json(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} is not JSON-safe`);
}

function healthMetric(value: unknown, path: string): void {
  const metric = object(value, path);
  if (metric.state === 'evaluated') {
    finite(metric.value, `${path}.value`);
    if (metric.limit !== undefined) finite(metric.limit, `${path}.limit`);
    if (metric.pass !== undefined && typeof metric.pass !== 'boolean') {
      throw new Error(`${path}.pass must be boolean`);
    }
    return;
  }
  if (metric.state === 'not-applicable' || metric.state === 'unevaluated') {
    string(metric.reason, `${path}.reason`);
    return;
  }
  throw new Error(`${path}.state is unsupported`);
}

const PHASES = new Set<RunPhase>([
  'initialization',
  'transient',
  'averaging',
  'evaluation',
  'terminal',
]);
const TERMINATIONS = new Set<TerminationReason>([
  'completed',
  'timeout',
  'stalled',
  'device-lost',
  'aborted',
  'browser-closed',
  'unexpected-error',
]);

/** Validate an artifact read from disk and return it with the shared typed contract. */
export function validateValidationRunArtifact(value: unknown): ValidationRunArtifact {
  const root = object(value, 'artifact');
  if (root.schemaVersion !== VALIDATION_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `unsupported validation artifact schema version ${String(root.schemaVersion)}; ` +
        `expected ${VALIDATION_ARTIFACT_SCHEMA_VERSION}`,
    );
  }
  if (typeof root.complete !== 'boolean') throw new Error('artifact.complete must be boolean');

  const identity = object(root.identity, 'artifact.identity');
  string(identity.runId, 'artifact.identity.runId');
  string(identity.caseId, 'artifact.identity.caseId');
  timestamp(identity.createdAt, 'artifact.identity.createdAt');

  const provenance = object(root.provenance, 'artifact.provenance');
  string(provenance.revision, 'artifact.provenance.revision');
  if (typeof provenance.dirty !== 'boolean')
    throw new Error('artifact.provenance.dirty must be boolean');

  const configuration = object(root.configuration, 'artifact.configuration');
  string(configuration.scene, 'artifact.configuration.scene');
  const grid = object(configuration.grid, 'artifact.configuration.grid');
  const nx = nonNegative(grid.nx, 'artifact.configuration.grid.nx', true);
  const ny = nonNegative(grid.ny, 'artifact.configuration.grid.ny', true);
  const nz = nonNegative(grid.nz, 'artifact.configuration.grid.nz', true);
  if (nonNegative(grid.cells, 'artifact.configuration.grid.cells', true) !== nx * ny * nz) {
    throw new Error('artifact.configuration.grid.cells does not match dimensions');
  }
  for (const key of ['solver', 'boundaries', 'closures', 'budgets', 'acceptance'] as const) {
    const candidate = object(configuration[key], `artifact.configuration.${key}`);
    json(candidate, `artifact.configuration.${key}`);
  }
  string(configuration.precision, 'artifact.configuration.precision');

  const lifecycle = object(root.lifecycle, 'artifact.lifecycle');
  if (!PHASES.has(lifecycle.phase as RunPhase))
    throw new Error('artifact.lifecycle.phase is unsupported');
  timestamp(lifecycle.heartbeatAt, 'artifact.lifecycle.heartbeatAt');
  const progress = object(lifecycle.progress, 'artifact.lifecycle.progress');
  nonNegative(progress.step, 'artifact.lifecycle.progress.step', true);
  nonNegative(progress.wallMs, 'artifact.lifecycle.progress.wallMs');
  timestamp(progress.observedAt, 'artifact.lifecycle.progress.observedAt');
  if (!PHASES.has(progress.phase as RunPhase))
    throw new Error('artifact.lifecycle.progress.phase is unsupported');
  if (
    !Array.isArray(lifecycle.windows) ||
    !Array.isArray(lifecycle.checkpoints) ||
    !Array.isArray(lifecycle.recovery)
  ) {
    throw new Error('artifact lifecycle arrays are malformed');
  }
  json(lifecycle.windows, 'artifact.lifecycle.windows');
  json(lifecycle.checkpoints, 'artifact.lifecycle.checkpoints');
  json(lifecycle.recovery, 'artifact.lifecycle.recovery');
  const deviceLoss = object(lifecycle.deviceLoss, 'artifact.lifecycle.deviceLoss');
  if (typeof deviceLoss.observed !== 'boolean')
    throw new Error('artifact.lifecycle.deviceLoss.observed must be boolean');

  const verdicts = object(root.verdicts, 'artifact.verdicts');
  for (const key of ['execution', 'numericalHealth', 'physicsTarget'] as const) {
    const axis = object(verdicts[key], `artifact.verdicts.${key}`);
    if (!['pass', 'fail', 'unevaluated'].includes(String(axis.state))) {
      throw new Error(`artifact.verdicts.${key}.state is unsupported`);
    }
    json(
      object(axis.metrics, `artifact.verdicts.${key}.metrics`),
      `artifact.verdicts.${key}.metrics`,
    );
  }

  if (!Array.isArray(root.health)) throw new Error('artifact.health must be an array');
  root.health.forEach((candidate, index) => {
    const sample = object(candidate, `artifact.health[${index}]`);
    timestamp(sample.sampledAt, `artifact.health[${index}].sampledAt`);
    nonNegative(sample.step, `artifact.health[${index}].step`, true);
    nonNegative(sample.readbackMs, `artifact.health[${index}].readbackMs`);
    for (const key of [
      'nonFiniteCells',
      'densityMin',
      'densityMax',
      'relativeMassDrift',
      'boundaryFluxClosure',
    ] as const)
      healthMetric(sample[key], `artifact.health[${index}].${key}`);
  });

  const evidence = object(root.evidence, 'artifact.evidence');
  json(object(evidence.aggregate, 'artifact.evidence.aggregate'), 'artifact.evidence.aggregate');
  json(evidence.detailed, 'artifact.evidence.detailed');

  if (root.termination !== null) {
    const termination = object(root.termination, 'artifact.termination');
    if (!TERMINATIONS.has(termination.reason as TerminationReason)) {
      throw new Error('artifact.termination.reason is unsupported');
    }
    timestamp(termination.at, 'artifact.termination.at');
  }
  if (root.complete && object(root.termination, 'artifact.termination').reason !== 'completed') {
    throw new Error('a complete artifact requires completed termination');
  }
  if (
    !root.complete &&
    root.termination !== null &&
    object(root.termination, 'artifact.termination').reason === 'completed'
  ) {
    throw new Error('an incomplete artifact cannot have completed termination');
  }
  timestamp(root.lastArtifactUpdateAt, 'artifact.lastArtifactUpdateAt');
  return value as ValidationRunArtifact;
}
