import type { BrowserContext } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttemptRecoveryPolicy } from '../e2e/helpers/attemptRecovery';
import { closeBrowserContextBounded } from '../e2e/helpers/durableBrowserRun';

afterEach(() => vi.useRealTimers());

const policy = () =>
  new AttemptRecoveryPolicy({
    logicalRunId: 'logical-1',
    attemptId: (ordinal) => `attempt-${ordinal}`,
  });

describe('automatic attempt recovery policy', () => {
  it('keeps one logical identity while assigning distinct attempt identities', () => {
    const run = policy();
    const decision = run.fail({
      classification: 'queue-timeout',
      latestCompleteCheckpointStep: 100,
      completedStep: 120,
    });
    expect(decision).toEqual({
      kind: 'recover',
      logicalRunId: 'logical-1',
      previousAttemptId: 'attempt-1',
      attemptId: 'attempt-2',
      checkpointStep: 100,
    });
    expect(run.history().map((entry) => entry.attemptId)).toEqual(['attempt-1', 'attempt-2']);
  });

  it('records the checkpoint actually restored when compatibility fallback selects an older slot', () => {
    const run = policy();
    run.fail({
      classification: 'queue-timeout',
      latestCompleteCheckpointStep: 100,
      completedStep: 120,
    });
    run.confirmRestoredStep(80);
    expect(run.activeAttempt.restoredStep).toBe(80);
  });

  it('stops a repeated failure at the same checkpoint', () => {
    const run = policy();
    expect(
      run.fail({
        classification: 'readback-timeout',
        latestCompleteCheckpointStep: 100,
        completedStep: 100,
      }).kind,
    ).toBe('recover');
    expect(
      run.fail({
        classification: 'readback-timeout',
        latestCompleteCheckpointStep: 100,
        completedStep: 100,
      }),
    ).toMatchObject({ kind: 'terminal', reason: 'retry-exhausted' });
  });

  it('resets only the same-checkpoint counter after forward completed progress', () => {
    const run = policy();
    run.fail({
      classification: 'queue-timeout',
      latestCompleteCheckpointStep: 100,
      completedStep: 100,
    });
    run.observeCompleted(101);
    expect(
      run.fail({
        classification: 'device-lost',
        latestCompleteCheckpointStep: 100,
        completedStep: 101,
      }).kind,
    ).toBe('recover');
    expect(
      run.fail({
        classification: 'queue-timeout',
        latestCompleteCheckpointStep: 100,
        completedStep: 100,
      }),
    ).toMatchObject({ kind: 'terminal', reason: 'retry-exhausted' });
  });

  it('terminates recoverable failures without a complete checkpoint', () => {
    expect(
      policy().fail({
        classification: 'device-lost',
        latestCompleteCheckpointStep: null,
        completedStep: 0,
      }),
    ).toMatchObject({ kind: 'terminal', reason: 'no-checkpoint' });
  });

  it.each([
    'checkpoint-io-timeout',
    'scoring-timeout',
    'webgpu-error',
    'application-error',
  ] as const)('does not retry terminal class %s', (classification) => {
    expect(
      policy().fail({ classification, latestCompleteCheckpointStep: 100, completedStep: 100 }),
    ).toMatchObject({ kind: 'terminal', reason: 'non-recoverable' });
  });
});

describe('bounded persistent-context teardown', () => {
  it('falls back to closing the owning browser when graceful close stops responding', async () => {
    vi.useFakeTimers();
    const browserClose = vi.fn().mockResolvedValue(undefined);
    const context = {
      close: vi.fn(() => new Promise<void>(() => {})),
      browser: vi.fn(() => ({ close: browserClose })),
    } as unknown as BrowserContext;
    const closing = closeBrowserContextBounded(context, 25);
    await vi.advanceTimersByTimeAsync(25);
    await closing;
    expect(browserClose).toHaveBeenCalledOnce();
  });
});
