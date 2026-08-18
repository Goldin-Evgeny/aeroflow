import type { OperationClassification } from '@aeroflow/core';

const RECOVERABLE = new Set<OperationClassification>([
  'device-lost',
  'queue-timeout',
  'readback-timeout',
]);

export interface AttemptRecoveryOptions {
  logicalRunId: string;
  maximumReplacementAttempts?: number;
  maximumSameCheckpointRetries?: number;
  attemptId?: (ordinal: number) => string;
}

export interface AttemptHistoryEntry {
  attemptId: string;
  ordinal: number;
  restoredStep: number | null;
  firstCompletedStepAfterRestore?: number;
  status: 'active' | 'quarantined' | 'completed' | 'terminal';
  classification?: OperationClassification;
}

export type RecoveryDecision =
  | {
      kind: 'recover';
      logicalRunId: string;
      previousAttemptId: string;
      attemptId: string;
      checkpointStep: number;
    }
  | {
      kind: 'terminal';
      reason: 'no-checkpoint' | 'retry-exhausted' | 'non-recoverable';
      attemptId: string;
      classification: OperationClassification;
    };

/** Pure retry state machine shared by persistent-browser tests and orchestration. */
export class AttemptRecoveryPolicy {
  private readonly maximumReplacementAttempts: number;
  private readonly maximumSameCheckpointRetries: number;
  private readonly makeAttemptId: (ordinal: number) => string;
  private readonly entries: AttemptHistoryEntry[];
  private replacements = 0;
  private sameCheckpointRetries = 0;
  private lastCheckpointStep: number | null = null;

  constructor(private readonly options: AttemptRecoveryOptions) {
    this.maximumReplacementAttempts = options.maximumReplacementAttempts ?? 2;
    this.maximumSameCheckpointRetries = options.maximumSameCheckpointRetries ?? 1;
    this.makeAttemptId =
      options.attemptId ?? ((ordinal) => `${options.logicalRunId}-attempt-${ordinal}`);
    if (this.maximumReplacementAttempts < 0 || this.maximumSameCheckpointRetries < 0) {
      throw new Error('attempt recovery budgets must be non-negative');
    }
    this.entries = [
      {
        attemptId: this.makeAttemptId(1),
        ordinal: 1,
        restoredStep: null,
        status: 'active',
      },
    ];
  }

  get logicalRunId(): string {
    return this.options.logicalRunId;
  }

  get activeAttempt(): AttemptHistoryEntry {
    return this.entries.at(-1)!;
  }

  history(): AttemptHistoryEntry[] {
    return structuredClone(this.entries);
  }

  observeCompleted(step: number): void {
    const active = this.activeAttempt;
    if (active.restoredStep !== null && step > active.restoredStep) {
      active.firstCompletedStepAfterRestore ??= step;
      this.sameCheckpointRetries = 0;
    }
  }

  confirmRestoredStep(step: number): void {
    const active = this.activeAttempt;
    if (active.restoredStep === null || !Number.isInteger(step) || step < 0) {
      throw new Error('restore confirmation requires an active recovery and valid step');
    }
    active.restoredStep = step;
    this.lastCheckpointStep = step;
  }

  complete(): void {
    this.activeAttempt.status = 'completed';
  }

  fail(input: {
    classification: OperationClassification;
    latestCompleteCheckpointStep: number | null;
    completedStep: number;
  }): RecoveryDecision {
    const active = this.activeAttempt;
    active.classification = input.classification;
    if (!RECOVERABLE.has(input.classification)) {
      active.status = 'terminal';
      return {
        kind: 'terminal',
        reason: 'non-recoverable',
        attemptId: active.attemptId,
        classification: input.classification,
      };
    }
    active.status = 'quarantined';
    if (input.latestCompleteCheckpointStep === null) {
      return {
        kind: 'terminal',
        reason: 'no-checkpoint',
        attemptId: active.attemptId,
        classification: input.classification,
      };
    }
    if (this.replacements >= this.maximumReplacementAttempts) {
      return {
        kind: 'terminal',
        reason: 'retry-exhausted',
        attemptId: active.attemptId,
        classification: input.classification,
      };
    }
    const checkpointStep = input.latestCompleteCheckpointStep;
    const advancedBeyondRestore =
      active.restoredStep !== null && input.completedStep > active.restoredStep;
    if (advancedBeyondRestore) this.sameCheckpointRetries = 0;
    if (this.lastCheckpointStep === checkpointStep && !advancedBeyondRestore) {
      if (this.sameCheckpointRetries >= this.maximumSameCheckpointRetries) {
        return {
          kind: 'terminal',
          reason: 'retry-exhausted',
          attemptId: active.attemptId,
          classification: input.classification,
        };
      }
    } else {
      this.sameCheckpointRetries = 0;
    }

    this.replacements++;
    this.sameCheckpointRetries++;
    this.lastCheckpointStep = checkpointStep;
    const next: AttemptHistoryEntry = {
      attemptId: this.makeAttemptId(this.entries.length + 1),
      ordinal: this.entries.length + 1,
      restoredStep: checkpointStep,
      status: 'active',
    };
    this.entries.push(next);
    return {
      kind: 'recover',
      logicalRunId: this.logicalRunId,
      previousAttemptId: active.attemptId,
      attemptId: next.attemptId,
      checkpointStep,
    };
  }
}
