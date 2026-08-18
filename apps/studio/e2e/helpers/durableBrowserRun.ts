import { chromium, type BrowserContext, type Page } from '@playwright/test';
import {
  acquireExistingRun,
  createFreshRun,
  releaseRun,
  updateRecordedDiskUsage,
  type AcquiredRun,
} from './validationRun';

export interface DurableBrowserRunOptions {
  root: string;
  caseId: string;
  configHash: string;
  runId?: string;
  resume?: boolean;
  takeOverStale?: boolean;
}

/** One harness-owned persistent Chromium profile, replaceable without losing IndexedDB. */
export class DurableBrowserRun {
  private context: BrowserContext | null = null;
  private currentPage: Page | null = null;

  private constructor(readonly run: AcquiredRun) {}

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
    const durable = new DurableBrowserRun(acquired);
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

  async closeContext(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.currentPage = null;
    await context?.close();
  }

  async dispose(): Promise<void> {
    await this.closeContext();
    await updateRecordedDiskUsage(this.run);
    await releaseRun(this.run);
  }
}
