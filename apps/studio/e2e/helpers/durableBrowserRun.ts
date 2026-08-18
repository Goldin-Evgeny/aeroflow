import { chromium, type BrowserContext, type Page } from '@playwright/test';
import {
  acquireExistingRun,
  createFreshRun,
  releaseRun,
  updateRecordedDiskUsage,
  type AcquiredRun,
} from './validationRun';
import type { OperationClassification } from '@aeroflow/core';
import {
  AttemptRecoveryPolicy,
  type AttemptHistoryEntry,
  type RecoveryDecision,
} from './attemptRecovery';

export interface DurableBrowserRunOptions {
  root: string;
  caseId: string;
  configHash: string;
  runId?: string;
  resume?: boolean;
  takeOverStale?: boolean;
  maximumReplacementAttempts?: number;
  maximumSameCheckpointRetries?: number;
}

/** Graceful persistent-context teardown with a browser-process close fallback. */
export async function closeBrowserContextBounded(
  context: BrowserContext,
  timeoutMs = 5_000,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.close(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`persistent context close exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    const browser = context.browser();
    if (!browser) throw error;
    await browser.close();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** One harness-owned persistent Chromium profile, replaceable without losing IndexedDB. */
export class DurableBrowserRun {
  private context: BrowserContext | null = null;
  private currentPage: Page | null = null;

  private readonly recovery: AttemptRecoveryPolicy;

  private constructor(
    readonly run: AcquiredRun,
    options: DurableBrowserRunOptions,
  ) {
    this.recovery = new AttemptRecoveryPolicy({
      logicalRunId: run.layout.runId,
      maximumReplacementAttempts: options.maximumReplacementAttempts,
      maximumSameCheckpointRetries: options.maximumSameCheckpointRetries,
    });
  }

  static async create(options: DurableBrowserRunOptions): Promise<DurableBrowserRun> {
    if (process.env.AEROFLOW_CDP_URL) {
      throw new Error(
        'durable browser runs require a Playwright-launched persistent profile; ' +
          'AEROFLOW_CDP_URL cannot provide isolated profile ownership',
      );
    }
    const acquired = options.resume
      ? await acquireExistingRun(
          options.root,
          options.runId ?? '',
          options.caseId,
          options.configHash,
          { takeOverStale: options.takeOverStale },
        )
      : await createFreshRun(options.root, options.caseId, options.configHash, {
          runId: options.runId,
        });
    const durable = new DurableBrowserRun(acquired, options);
    await durable.openContext();
    console.log(
      `AeroFlow durable run ${acquired.layout.runId}: ` +
        `resume profile ${acquired.layout.profilePath}; artifact ${acquired.layout.artifactPath}`,
    );
    return durable;
  }

  get page(): Page {
    if (!this.currentPage) throw new Error('durable browser context is not open');
    return this.currentPage;
  }

  get logicalRunId(): string {
    return this.recovery.logicalRunId;
  }

  get activeAttemptId(): string {
    return this.recovery.activeAttempt.attemptId;
  }

  attemptHistory(): AttemptHistoryEntry[] {
    return this.recovery.history();
  }

  private async openContext(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.run.layout.profilePath, {
      channel: 'chromium',
      headless: true,
    });
    this.currentPage = this.context.pages()[0] ?? (await this.context.newPage());
  }

  async replaceContext(): Promise<Page> {
    await this.closeContext();
    await this.openContext();
    return this.page;
  }

  async closeContext(timeoutMs = 5_000): Promise<void> {
    const context = this.context;
    this.context = null;
    this.currentPage = null;
    if (!context) return;
    await closeBrowserContextBounded(context, timeoutMs);
  }

  observeCompleted(step: number): void {
    this.recovery.observeCompleted(step);
  }

  confirmRestoredStep(step: number): void {
    this.recovery.confirmRestoredStep(step);
  }

  async recoverAttempt(input: {
    classification: OperationClassification;
    latestCompleteCheckpointStep: number | null;
    completedStep: number;
  }): Promise<{ decision: RecoveryDecision; page?: Page }> {
    const decision = this.recovery.fail(input);
    if (decision.kind === 'terminal') return { decision };
    const page = await this.replaceContext();
    return { decision, page };
  }

  completeAttempt(): void {
    this.recovery.complete();
  }

  async dispose(): Promise<void> {
    await this.closeContext();
    await updateRecordedDiskUsage(this.run);
    await releaseRun(this.run);
  }
}
