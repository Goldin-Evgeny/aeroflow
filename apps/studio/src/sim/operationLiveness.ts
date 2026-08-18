import type {
  GpuBatchPolicyRecord,
  GpuOperationRecord,
  OperationClassification,
  OperationPhase,
  StepRange,
  WebGpuErrorRecord,
} from '@aeroflow/core';

export interface OperationDeadlineOptions {
  initialMs: number;
  maximumMs?: number;
  activityExtends?: boolean;
}

export interface SupervisedOperation<T> {
  phase: OperationPhase;
  execute: (activity: (detail?: string) => void) => Promise<T>;
  deadline: OperationDeadlineOptions;
  submittedRange?: StepRange;
  completedRange?: (value: T) => StepRange | undefined;
  deviceLost?: Promise<{ reason?: string; message?: string }>;
  gpuMs?: (value: T) => number | undefined;
}

export interface OperationSupervisorOptions {
  logicalRunId: string;
  attemptId: string;
  onTransition?: (record: GpuOperationRecord) => void;
  now?: () => number;
  timestamp?: () => string;
  operationId?: () => string;
}

export class OperationFailure extends Error {
  constructor(
    readonly classification: OperationClassification,
    readonly operation: GpuOperationRecord,
    message = `${operation.phase} failed: ${classification}`,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OperationFailure';
  }
}

export class WebGpuValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGpuValidationError';
  }
}

function timeoutClassification(phase: OperationPhase): OperationClassification {
  switch (phase) {
    case 'queue-completion':
      return 'queue-timeout';
    case 'probe-readback':
    case 'health-readback':
      return 'readback-timeout';
    case 'checkpoint-transfer':
    case 'checkpoint-persistence':
      return 'checkpoint-io-timeout';
    case 'scoring':
      return 'scoring-timeout';
  }
}

export function classifyOperationEvidence(input: {
  phase: OperationPhase;
  deviceLost?: boolean;
  webgpuError?: boolean;
  deadlineExpired?: boolean;
}): OperationClassification {
  if (input.deviceLost) return 'device-lost';
  if (input.webgpuError) return 'webgpu-error';
  if (input.deadlineExpired) return timeoutClassification(input.phase);
  return 'application-error';
}

/** Owns one awaited phase from start through an immutable terminal outcome. */
export class OperationSupervisor {
  private readonly records: GpuOperationRecord[] = [];
  private readonly now: () => number;
  private readonly timestamp: () => string;
  private readonly operationId: () => string;
  private active: GpuOperationRecord | null = null;
  private activeWebGpuFailure: ((error: WebGpuValidationError) => void) | null = null;
  private nextOperationOrdinal = 1;

  constructor(private readonly options: OperationSupervisorOptions) {
    this.now = options.now ?? (() => performance.now());
    this.timestamp = options.timestamp ?? (() => new Date().toISOString());
    this.operationId =
      options.operationId ?? (() => `${options.attemptId}:op-${this.nextOperationOrdinal++}`);
  }

  snapshot(): GpuOperationRecord[] {
    return structuredClone(this.records);
  }

  activeContext(): { operationId?: string; phase?: OperationPhase } {
    return this.active ? { operationId: this.active.operationId, phase: this.active.phase } : {};
  }

  reportWebGpuError(error: WebGpuValidationError): void {
    this.activeWebGpuFailure?.(error);
  }

  private emit(record: GpuOperationRecord): void {
    this.options.onTransition?.(structuredClone(record));
  }

  supervise<T>(input: SupervisedOperation<T>): Promise<T> {
    if (!(input.deadline.initialMs > 0)) throw new Error('operation deadline must be positive');
    const maximumMs = input.deadline.maximumMs ?? input.deadline.initialMs;
    if (maximumMs < input.deadline.initialMs) {
      throw new Error('operation maximum deadline cannot be below its initial deadline');
    }
    const startedMs = this.now();
    const record: GpuOperationRecord = {
      operationId: this.operationId(),
      logicalRunId: this.options.logicalRunId,
      attemptId: this.options.attemptId,
      phase: input.phase,
      startedAt: this.timestamp(),
      lastActivityAt: this.timestamp(),
      deadline: {
        initialMs: input.deadline.initialMs,
        effectiveMs: Math.min(input.deadline.initialMs, maximumMs),
        maximumMs,
        activityExtends: input.deadline.activityExtends ?? false,
      },
      directObservations: [],
      ...(input.submittedRange ? { submittedRange: { ...input.submittedRange } } : {}),
    };
    this.records.push(record);
    this.active = record;
    this.emit(record);

    return new Promise<T>((resolve, reject) => {
      let terminal = false;
      let timer: ReturnType<typeof setTimeout>;

      const close = (
        terminalState: NonNullable<GpuOperationRecord['terminalState']>,
        classification?: OperationClassification,
        error?: unknown,
      ): boolean => {
        if (terminal) return false;
        terminal = true;
        clearTimeout(timer);
        record.terminalState = terminalState;
        if (classification) record.classification = classification;
        record.wallMs = Math.max(0, this.now() - startedMs);
        if (error !== undefined) {
          record.error = {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          };
        }
        if (this.active === record) {
          this.active = null;
          this.activeWebGpuFailure = null;
        }
        this.emit(record);
        return true;
      };

      const arm = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          record.directObservations.push({
            kind: 'deadline-expired',
            observedAt: this.timestamp(),
          });
          const classification = timeoutClassification(input.phase);
          if (close('timed-out', classification)) {
            reject(new OperationFailure(classification, structuredClone(record)));
          }
        }, record.deadline.effectiveMs);
      };

      const activity = (detail?: string): void => {
        if (terminal) return;
        record.lastActivityAt = this.timestamp();
        record.directObservations.push({
          kind: 'activity',
          observedAt: record.lastActivityAt,
          ...(detail ? { detail } : {}),
        });
        this.emit(record);
        if (record.deadline.activityExtends) arm();
      };

      this.activeWebGpuFailure = (error) => {
        if (terminal) return;
        record.directObservations.push({
          kind: 'webgpu-error',
          observedAt: this.timestamp(),
          detail: error.message,
        });
        if (close('webgpu-error', 'webgpu-error', error)) {
          reject(
            new OperationFailure('webgpu-error', structuredClone(record), undefined, {
              cause: error,
            }),
          );
        }
      };

      arm();
      let owned: Promise<T>;
      try {
        owned = input.execute(activity);
      } catch (error) {
        owned = Promise.reject(error);
      }
      void owned.then(
        (value) => {
          if (terminal) return;
          record.directObservations.push({
            kind: 'promise-resolved',
            observedAt: this.timestamp(),
          });
          const completedRange = input.completedRange?.(value);
          if (completedRange) record.completedRange = { ...completedRange };
          const gpuMs = input.gpuMs?.(value);
          if (gpuMs !== undefined) record.gpuMs = gpuMs;
          if (close('completed')) resolve(value);
        },
        (error) => {
          if (terminal) return;
          const webgpu = error instanceof WebGpuValidationError;
          record.directObservations.push({
            kind: webgpu ? 'webgpu-error' : 'promise-rejected',
            observedAt: this.timestamp(),
            detail: error instanceof Error ? error.message : String(error),
          });
          const classification: OperationClassification = webgpu
            ? 'webgpu-error'
            : 'application-error';
          if (close(webgpu ? 'webgpu-error' : 'application-error', classification, error)) {
            reject(
              new OperationFailure(classification, structuredClone(record), undefined, {
                cause: error,
              }),
            );
          }
        },
      );

      void input.deviceLost?.then((info) => {
        if (terminal) return;
        const detail = [info.reason, info.message].filter(Boolean).join(': ');
        record.directObservations.push({
          kind: 'device-lost',
          observedAt: this.timestamp(),
          ...(detail ? { detail } : {}),
        });
        if (close('device-lost', 'device-lost')) {
          reject(
            new OperationFailure(
              'device-lost',
              structuredClone(record),
              `device lost during ${input.phase}${detail ? `: ${detail}` : ''}`,
            ),
          );
        }
      });
    });
  }
}

export interface AdaptiveBatchOptions {
  initialSteps?: number;
  targetMs?: number;
  minimumSteps?: number;
  maximumSteps?: number;
  maximumGrowthFactor?: number;
  maximumShrinkFactor?: number;
}

/** Conservative controller driven only by successfully completed batch durations. */
export class AdaptiveStepBatchController {
  private readonly targetMs: number;
  private readonly minimumSteps: number;
  private readonly maximumSteps: number;
  private readonly maximumGrowthFactor: number;
  private readonly maximumShrinkFactor: number;
  private readonly initialSteps: number;
  private currentSteps: number;
  private readonly durations: number[] = [];

  constructor(options: AdaptiveBatchOptions = {}) {
    this.targetMs = options.targetMs ?? 2_000;
    this.minimumSteps = options.minimumSteps ?? 2;
    this.maximumSteps = options.maximumSteps ?? 256;
    this.maximumGrowthFactor = options.maximumGrowthFactor ?? 1.5;
    this.maximumShrinkFactor = options.maximumShrinkFactor ?? 0.5;
    this.initialSteps = options.initialSteps ?? 8;
    this.currentSteps = this.initialSteps;
    if (
      this.minimumSteps < 1 ||
      this.maximumSteps < this.minimumSteps ||
      this.currentSteps < this.minimumSteps ||
      this.currentSteps > this.maximumSteps ||
      this.targetMs <= 0
    ) {
      throw new Error('invalid adaptive step-batch policy');
    }
  }

  next(remainingSteps: number): number {
    if (!Number.isInteger(remainingSteps) || remainingSteps <= 0) {
      throw new Error('remaining batch steps must be a positive integer');
    }
    if (remainingSteps < this.minimumSteps) {
      throw new Error('remaining batch cannot satisfy the minimum step bound');
    }
    let steps = Math.min(this.currentSteps, remainingSteps);
    if (remainingSteps - steps === 1) {
      if (steps < this.maximumSteps) steps++;
      else steps--;
    }
    return steps;
  }

  observeCompleted(steps: number, durationMs: number): void {
    if (!Number.isInteger(steps) || steps <= 0 || !(durationMs > 0)) {
      throw new Error('completed batch timing must be positive');
    }
    this.durations.push(durationMs);
    const ideal = Math.round((steps * this.targetMs) / durationMs);
    const lower = Math.max(
      this.minimumSteps,
      Math.floor(this.currentSteps * this.maximumShrinkFactor),
    );
    const upper = Math.min(
      this.maximumSteps,
      Math.ceil(this.currentSteps * this.maximumGrowthFactor),
    );
    this.currentSteps = Math.max(lower, Math.min(upper, ideal));
  }

  snapshot(): GpuBatchPolicyRecord {
    return {
      initialSteps: this.initialSteps,
      targetMs: this.targetMs,
      minimumSteps: this.minimumSteps,
      maximumSteps: this.maximumSteps,
      currentSteps: this.currentSteps,
      completedDurationsMs: [...this.durations],
    };
  }
}

/** Attach device-wide asynchronous error evidence and preserve active operation context. */
export function captureWebGpuErrors(
  device: GPUDevice,
  sink: (record: WebGpuErrorRecord) => void,
  active: () => { operationId?: string; phase?: OperationPhase },
): () => void {
  const uncaptured = (event: GPUUncapturedErrorEvent): void => {
    const context = active();
    sink({
      observedAt: new Date().toISOString(),
      ...context,
      source: 'uncaptured-error',
      name: event.error.constructor.name,
      message: event.error.message,
    });
  };
  device.addEventListener('uncapturederror', uncaptured);
  void device.lost.then((info) => {
    const context = active();
    sink({
      observedAt: new Date().toISOString(),
      ...context,
      source: 'device-lost',
      name: 'GPUDeviceLostInfo',
      message: `${info.reason}: ${info.message}`,
    });
  });
  return () => device.removeEventListener('uncapturederror', uncaptured);
}

/** Keep owned validation scopes short and turn their result into typed evidence. */
export async function withWebGpuErrorScope<T>(
  device: GPUDevice,
  filter: GPUErrorFilter,
  execute: () => T | Promise<T>,
  sink: (record: WebGpuErrorRecord) => void,
  context: { operationId?: string; phase?: OperationPhase } = {},
): Promise<T> {
  device.pushErrorScope(filter);
  let result: T;
  try {
    result = await execute();
  } catch (error) {
    await device.popErrorScope();
    throw error;
  }
  const error = await device.popErrorScope();
  if (error) {
    sink({
      observedAt: new Date().toISOString(),
      ...context,
      source: 'error-scope',
      name: error.constructor.name,
      message: error.message,
    });
    throw new WebGpuValidationError(error.message);
  }
  return result;
}
