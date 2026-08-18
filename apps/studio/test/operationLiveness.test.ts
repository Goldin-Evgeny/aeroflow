import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdaptiveStepBatchController,
  OperationFailure,
  OperationSupervisor,
  WebGpuValidationError,
  classifyOperationEvidence,
  withWebGpuErrorScope,
} from '../src/sim/operationLiveness';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function supervisor() {
  let id = 0;
  return new OperationSupervisor({
    logicalRunId: 'logical-1',
    attemptId: 'attempt-1',
    operationId: () => `test-op-${++id}`,
  });
}

describe('operation supervisor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records healthy delayed completion below its deadline', async () => {
    const run = supervisor();
    const pending = run.supervise({
      phase: 'queue-completion',
      deadline: { initialMs: 50 },
      execute: () => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 20)),
    });
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toBe('ok');
    expect(run.snapshot()[0]).toMatchObject({ terminalState: 'completed' });
  });

  it('preserves ordinary rejection as an application error', async () => {
    const run = supervisor();
    const pending = run.supervise({
      phase: 'scoring',
      deadline: { initialMs: 50 },
      execute: () => Promise.reject(new Error('score exploded')),
    });
    await expect(pending).rejects.toMatchObject({ classification: 'application-error' });
    expect(run.snapshot()[0].directObservations.at(-1)?.kind).toBe('promise-rejected');
  });

  it('returns control for a never-settling promise and ignores late resolve or reject', async () => {
    for (const settle of ['resolve', 'reject'] as const) {
      const run = supervisor();
      const owned = deferred<void>();
      const pending = run.supervise({
        phase: 'queue-completion',
        deadline: { initialMs: 30 },
        execute: () => owned.promise,
      });
      const assertion = expect(pending).rejects.toMatchObject({ classification: 'queue-timeout' });
      await vi.advanceTimersByTimeAsync(30);
      await assertion;
      if (settle === 'resolve') owned.resolve();
      else owned.reject(new Error('late'));
      await Promise.resolve();
      expect(run.snapshot()[0]).toMatchObject({
        terminalState: 'timed-out',
        classification: 'queue-timeout',
      });
    }
  });

  it('lets device loss win before rejection, but not overwrite an earlier rejection', async () => {
    const loss = deferred<{ reason: string; message: string }>();
    const owned = deferred<void>();
    const first = supervisor();
    const pending = first.supervise({
      phase: 'queue-completion',
      deadline: { initialMs: 50 },
      deviceLost: loss.promise,
      execute: () => owned.promise,
    });
    loss.resolve({ reason: 'unknown', message: 'injected' });
    await expect(pending).rejects.toMatchObject({ classification: 'device-lost' });
    owned.reject(new Error('late rejection is consumed'));
    await Promise.resolve();
    expect(first.snapshot()[0].classification).toBe('device-lost');

    const lateLoss = deferred<{ reason: string; message: string }>();
    const second = supervisor();
    const rejected = second.supervise({
      phase: 'queue-completion',
      deadline: { initialMs: 50 },
      deviceLost: lateLoss.promise,
      execute: () => Promise.reject(new Error('first')),
    });
    await expect(rejected).rejects.toMatchObject({ classification: 'application-error' });
    lateLoss.resolve({ reason: 'unknown', message: 'too late' });
    await Promise.resolve();
    expect(second.snapshot()[0].classification).toBe('application-error');
  });

  it('extends a multipart operation only when qualifying activity arrives', async () => {
    const run = supervisor();
    const done = deferred<string>();
    const pending = run.supervise({
      phase: 'checkpoint-persistence',
      deadline: { initialMs: 30, activityExtends: true },
      execute: async (activity) => {
        setTimeout(() => activity('chunk 1'), 20);
        setTimeout(() => activity('chunk 2'), 45);
        setTimeout(() => done.resolve('saved'), 60);
        return done.promise;
      },
    });
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toBe('saved');
    expect(
      run.snapshot()[0].directObservations.filter((entry) => entry.kind === 'activity'),
    ).toHaveLength(2);
  });

  it('keeps validation errors distinct from timeouts', async () => {
    const run = supervisor();
    const pending = run.supervise({
      phase: 'queue-completion',
      deadline: { initialMs: 50 },
      execute: () => Promise.reject(new WebGpuValidationError('bad binding')),
    });
    await expect(pending).rejects.toMatchObject({ classification: 'webgpu-error' });
  });

  it('lets an asynchronous uncaptured WebGPU error terminate the active wait', async () => {
    const run = supervisor();
    const pending = run.supervise({
      phase: 'queue-completion',
      deadline: { initialMs: 50 },
      execute: () => new Promise<void>(() => {}),
    });
    run.reportWebGpuError(new WebGpuValidationError('uncaptured validation error'));
    await expect(pending).rejects.toMatchObject({ classification: 'webgpu-error' });
    await vi.advanceTimersByTimeAsync(50);
    expect(run.snapshot()[0].classification).toBe('webgpu-error');
  });
});

describe('evidence-based classification', () => {
  it('classifies a stuck map after queue completion as readback timeout', () => {
    expect(classifyOperationEvidence({ phase: 'probe-readback', deadlineExpired: true })).toBe(
      'readback-timeout',
    );
  });

  it('does not call scoring timeout a GPU failure or infer a driver root cause', () => {
    expect(classifyOperationEvidence({ phase: 'scoring', deadlineExpired: true })).toBe(
      'scoring-timeout',
    );
    const failure = new OperationFailure('queue-timeout', {
      operationId: 'op',
      logicalRunId: 'run',
      attemptId: 'attempt',
      phase: 'queue-completion',
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      deadline: { initialMs: 1, effectiveMs: 1, maximumMs: 1, activityExtends: false },
      terminalState: 'timed-out',
      classification: 'queue-timeout',
      directObservations: [{ kind: 'deadline-expired', observedAt: new Date().toISOString() }],
    });
    expect(failure.message).not.toMatch(/TDR|driver|reset/i);
  });
});

describe('adaptive bounded batches', () => {
  it('starts at eight, clamps to hard bounds, changes gradually, and handles remainders', () => {
    const controller = new AdaptiveStepBatchController();
    expect(controller.next(1_406)).toBe(8);
    controller.observeCompleted(8, 100);
    expect(controller.next(1_398)).toBe(12);
    controller.observeCompleted(12, 20_000);
    expect(controller.next(1_386)).toBe(6);
    expect(controller.next(3)).toBe(3);
    expect(controller.snapshot()).toMatchObject({
      initialSteps: 8,
      targetMs: 2_000,
      minimumSteps: 2,
      maximumSteps: 256,
    });
  });

  it('supports injected constants for deterministic tests', () => {
    const controller = new AdaptiveStepBatchController({
      initialSteps: 4,
      targetMs: 10,
      minimumSteps: 2,
      maximumSteps: 6,
    });
    controller.observeCompleted(4, 1);
    expect(controller.next(100)).toBe(6);
  });

  it('absorbs a one-step remainder without violating the two-step minimum', () => {
    const controller = new AdaptiveStepBatchController({ initialSteps: 2 });
    expect(controller.next(3)).toBe(3);
    expect(() => controller.next(1)).toThrow(/minimum step bound/);
  });
});

describe('owned WebGPU error scopes', () => {
  it('turns a scoped validation result into typed error evidence', async () => {
    const records: unknown[] = [];
    const device = {
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn().mockResolvedValue({
        constructor: { name: 'GPUValidationError' },
        message: 'invalid bind group',
      }),
    } as unknown as GPUDevice;
    await expect(
      withWebGpuErrorScope(
        device,
        'validation',
        () => 1,
        (record) => records.push(record),
        {
          operationId: 'op-1',
          phase: 'queue-completion',
        },
      ),
    ).rejects.toThrow(/invalid bind group/);
    expect(records).toEqual([
      expect.objectContaining({ source: 'error-scope', operationId: 'op-1' }),
    ]);
  });
});
