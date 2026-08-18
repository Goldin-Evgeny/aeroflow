import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  validateValidationRunArtifact,
  type JsonValue,
  type TerminationReason,
  type ValidationRunArtifact,
} from '@aeroflow/core';

export interface RunDirectoryLayout {
  root: string;
  runId: string;
  runDirectory: string;
  profilePath: string;
  checkpointPath: string;
  artifactPath: string;
  artifactTemporaryPath: string;
  ownerPath: string;
  lifecyclePath: string;
}

export interface RunOwner {
  runId: string;
  caseId: string;
  configHash: string;
  pid: number;
  host: string;
  acquiredAt: string;
  status: 'active' | 'released';
  takeover?: { previous: Omit<RunOwner, 'takeover'>; at: string };
}

export interface RunLifecycleMetadata {
  version: 1;
  runId: string;
  caseId: string;
  configHash: string;
  createdAt: string;
  profilePath: string;
  checkpointPath: string;
  artifactPath: string;
  diskUsageBytes: number;
  takeovers: Array<{ previousPid: number; previousHost: string; at: string }>;
}

export interface AcquiredRun {
  layout: RunDirectoryLayout;
  lifecycle: RunLifecycleMetadata;
  owner: RunOwner;
}

export interface AcquireOptions {
  takeOverStale?: boolean;
  pid?: number;
  host?: string;
  now?: string;
  isProcessActive?: (pid: number) => boolean;
}

export function validationRunRoot(cwd = process.cwd()): string {
  return resolve(process.env.AEROFLOW_RUN_ROOT ?? resolve(cwd, '.aeroflow', 'runs'));
}

function assertRunId(runId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(runId)) {
    throw new Error(`invalid run identity ${JSON.stringify(runId)}`);
  }
}

function assertInside(root: string, candidate: string): void {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path ${candidate} is outside the run root ${root}`);
  }
}

export function runDirectoryLayout(root: string, runId: string): RunDirectoryLayout {
  assertRunId(runId);
  const absoluteRoot = resolve(root);
  const runDirectory = resolve(absoluteRoot, runId);
  assertInside(absoluteRoot, runDirectory);
  return {
    root: absoluteRoot,
    runId,
    runDirectory,
    profilePath: resolve(runDirectory, 'browser-profile'),
    checkpointPath: resolve(runDirectory, 'browser-profile', 'IndexedDB'),
    artifactPath: resolve(runDirectory, 'validation-artifact.json'),
    artifactTemporaryPath: resolve(runDirectory, '.validation-artifact.tmp.json'),
    ownerPath: resolve(runDirectory, 'owner.json'),
    lifecyclePath: resolve(runDirectory, 'lifecycle.json'),
  };
}

export function uniqueRunId(caseId: string, date = new Date()): string {
  const safeCase = caseId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
  return `${date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}-${safeCase}-${randomUUID().slice(0, 8)}`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function processActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function createFreshRun(
  root: string,
  caseId: string,
  configHash: string,
  options: AcquireOptions & { runId?: string } = {},
): Promise<AcquiredRun> {
  const now = options.now ?? new Date().toISOString();
  const runId = options.runId ?? uniqueRunId(caseId, new Date(now));
  const layout = runDirectoryLayout(root, runId);
  await mkdir(layout.profilePath, { recursive: true });
  const owner: RunOwner = {
    runId,
    caseId,
    configHash,
    pid: options.pid ?? process.pid,
    host: options.host ?? hostname(),
    acquiredAt: now,
    status: 'active',
  };
  const lifecycle: RunLifecycleMetadata = {
    version: 1,
    runId,
    caseId,
    configHash,
    createdAt: now,
    profilePath: layout.profilePath,
    checkpointPath: layout.checkpointPath,
    artifactPath: layout.artifactPath,
    diskUsageBytes: 0,
    takeovers: [],
  };
  try {
    await writeFile(layout.ownerPath, `${JSON.stringify(owner, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    throw new Error(`fresh run ${runId} already exists`, { cause: error });
  }
  await writeJson(layout.lifecyclePath, lifecycle);
  return { layout, lifecycle, owner };
}

export async function acquireExistingRun(
  root: string,
  runId: string,
  expectedCaseId: string,
  expectedConfigHash: string,
  options: AcquireOptions = {},
): Promise<AcquiredRun> {
  const layout = runDirectoryLayout(root, runId);
  const lifecycle = await readJson<RunLifecycleMetadata>(layout.lifecyclePath);
  if (lifecycle.runId !== runId) throw new Error(`run identity mismatch: ${lifecycle.runId}`);
  if (lifecycle.caseId !== expectedCaseId) {
    throw new Error(`run case mismatch: saved ${lifecycle.caseId}, requested ${expectedCaseId}`);
  }
  if (lifecycle.configHash !== expectedConfigHash) {
    throw new Error(
      `run config mismatch: saved ${lifecycle.configHash}, requested ${expectedConfigHash}`,
    );
  }
  const previous = await readJson<RunOwner>(layout.ownerPath);
  const isActive = options.isProcessActive ?? processActive;
  if (previous.status === 'active' && isActive(previous.pid)) {
    throw new Error(`run ${runId} has active owner pid ${previous.pid} on ${previous.host}`);
  }
  if (previous.status === 'active' && !options.takeOverStale) {
    throw new Error(`run ${runId} has a stale owner; explicit takeover is required`);
  }
  const now = options.now ?? new Date().toISOString();
  const previousOwner: Omit<RunOwner, 'takeover'> = {
    runId: previous.runId,
    caseId: previous.caseId,
    configHash: previous.configHash,
    pid: previous.pid,
    host: previous.host,
    acquiredAt: previous.acquiredAt,
    status: previous.status,
  };
  const owner: RunOwner = {
    runId,
    caseId: expectedCaseId,
    configHash: expectedConfigHash,
    pid: options.pid ?? process.pid,
    host: options.host ?? hostname(),
    acquiredAt: now,
    status: 'active',
    ...(previous.status === 'active' ? { takeover: { previous: previousOwner, at: now } } : {}),
  };
  if (previous.status === 'active') {
    lifecycle.takeovers.push({ previousPid: previous.pid, previousHost: previous.host, at: now });
  }
  await writeJson(layout.ownerPath, owner);
  await writeJson(layout.lifecyclePath, lifecycle);
  return { layout, lifecycle, owner };
}

export async function releaseRun(run: AcquiredRun, now = new Date().toISOString()): Promise<void> {
  const current = await readJson<RunOwner>(run.layout.ownerPath);
  if (current.pid !== run.owner.pid || current.acquiredAt !== run.owner.acquiredAt) {
    throw new Error(`cannot release run ${run.layout.runId}: ownership changed`);
  }
  await writeJson(run.layout.ownerPath, { ...current, status: 'released', releasedAt: now });
}

export async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

export async function updateRecordedDiskUsage(run: AcquiredRun): Promise<number> {
  const bytes = await directorySize(run.layout.runDirectory);
  run.lifecycle.diskUsageBytes = bytes;
  await writeJson(run.layout.lifecyclePath, run.lifecycle);
  return bytes;
}

export interface AtomicWriteHooks {
  /** Test-only fault injection after the temporary file is durable and before replacement. */
  beforeReplace?: () => void | Promise<void>;
}

export async function writeArtifactAtomic(
  layout: RunDirectoryLayout,
  artifact: ValidationRunArtifact,
  hooks: AtomicWriteHooks = {},
): Promise<void> {
  validateValidationRunArtifact(artifact);
  assertInside(layout.runDirectory, layout.artifactPath);
  assertInside(layout.runDirectory, layout.artifactTemporaryPath);
  await mkdir(dirname(layout.artifactPath), { recursive: true });
  const handle = await open(layout.artifactTemporaryPath, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await hooks.beforeReplace?.();
    await rename(layout.artifactTemporaryPath, layout.artifactPath);
  } catch (error) {
    await rm(layout.artifactTemporaryPath, { force: true });
    throw error;
  }
}

export async function readArtifact(path: string): Promise<ValidationRunArtifact> {
  return validateValidationRunArtifact(JSON.parse(await readFile(path, 'utf8')));
}

export class ArtifactSnapshotCoordinator {
  private snapshot: ValidationRunArtifact;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly layout: RunDirectoryLayout,
    initial: ValidationRunArtifact,
  ) {
    this.snapshot = structuredClone(initial);
  }

  current(): ValidationRunArtifact {
    return structuredClone(this.snapshot);
  }

  update(
    event: string,
    mutate: (draft: ValidationRunArtifact) => void,
    now = new Date().toISOString(),
  ): Promise<void> {
    const next = structuredClone(this.snapshot);
    mutate(next);
    next.lifecycle.artifactWriteActivityAt = now;
    next.lastArtifactUpdateAt = now;
    next.evidence.aggregate.lastEvent = event;
    this.snapshot = next;
    this.pending = this.pending.then(() => writeArtifactAtomic(this.layout, next));
    return this.pending;
  }

  terminate(
    reason: TerminationReason,
    error?: unknown,
    now = new Date().toISOString(),
  ): Promise<void> {
    return this.update(
      'termination',
      (draft) => {
        draft.complete = reason === 'completed';
        draft.lifecycle.phase = 'terminal';
        draft.lifecycle.progress.phase = 'terminal';
        draft.termination = {
          reason,
          at: now,
          ...(error === undefined
            ? {}
            : {
                error: {
                  name: error instanceof Error ? error.name : 'Error',
                  message: error instanceof Error ? error.message : String(error),
                  ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
                },
              }),
        };
        draft.verdicts.execution = {
          state: reason === 'completed' ? 'pass' : 'fail',
          reason,
          metrics: { lastStep: draft.lifecycle.progress.step },
        };
      },
      now,
    );
  }
}

export type RunObservation =
  | { kind: 'progressing' }
  | { kind: 'timeout'; elapsedMs: number }
  | { kind: 'device-lost'; reason?: string; message?: string }
  | {
      kind: 'stalled';
      lastStep: number;
      phase: string;
      noProgressMs: number;
      latestCheckpointStep: number | null;
    };

export function classifyRunObservation(input: {
  nowMs: number;
  startedAtMs: number;
  timeoutMs: number;
  lastStep: number;
  lastStepAtMs: number;
  phase: string;
  phaseActivityAtMs: number;
  stallMs: number;
  latestCheckpointStep: number | null;
  deviceLoss?: { reason?: string; message?: string };
}): RunObservation {
  if (input.deviceLoss) return { kind: 'device-lost', ...input.deviceLoss };
  const elapsedMs = input.nowMs - input.startedAtMs;
  if (elapsedMs >= input.timeoutMs) return { kind: 'timeout', elapsedMs };
  const lastActivityAt = Math.max(input.lastStepAtMs, input.phaseActivityAtMs);
  const noProgressMs = input.nowMs - lastActivityAt;
  if (noProgressMs < input.stallMs) return { kind: 'progressing' };
  return {
    kind: 'stalled',
    lastStep: input.lastStep,
    phase: input.phase,
    noProgressMs,
    latestCheckpointStep: input.latestCheckpointStep,
  };
}

export async function cleanupRun(
  root: string,
  runId: string,
  options: { allowIncomplete?: boolean } = {},
): Promise<void> {
  const layout = runDirectoryLayout(root, runId);
  assertInside(resolve(root), layout.runDirectory);
  if (basename(layout.runDirectory) !== runId) throw new Error('cleanup target identity mismatch');
  if (!options.allowIncomplete) {
    const artifact = await readArtifact(layout.artifactPath);
    if (!artifact.complete || artifact.termination?.reason !== 'completed') {
      throw new Error(`cleanup requires a durable completed artifact for run ${runId}`);
    }
  }
  await rm(layout.runDirectory, { recursive: true });
}

export function jsonRecord(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return value;
}
