import { test as base, chromium, type Page } from '@playwright/test';
import { BASE_URL } from '../helpers/hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DurableBrowserRun, type DurableBrowserRunOptions } from '../helpers/durableBrowserRun';

export interface DurableGpuRunFactory {
  create(
    options: Omit<DurableBrowserRunOptions, 'root'> & { root?: string },
  ): Promise<DurableBrowserRun>;
}

const DEFAULT_RUN_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
  '.aeroflow',
  'runs',
);

/**
 * Tier B fixture: a page on a **real GPU**.
 *
 * Default (since 2026-07-28): the browser Playwright launched for the `gpu` project —
 * full Chromium via `channel: 'chromium'`, which exposes the host adapter directly. On
 * native Windows this needs no CDP bridge and no hand-started Chrome.
 *
 * Escape hatch: set `AEROFLOW_CDP_URL` to attach to an already-running Chrome over CDP
 * instead. That is how this ran from WSL (scripts/e2e-gpu-chrome.sh printed the URL), and
 * it is still the way to drive a browser this process cannot launch — a different machine,
 * a different GPU for the M6 #6 three-GPU benchmark, or a hand-configured profile.
 *
 * Playwright's `baseURL` does not apply to CDP-attached contexts, so specs compose URLs
 * from BASE_URL in both modes. `browser.close()` on a CDP connection only disconnects;
 * the external Chrome stays up.
 */
export const test = base.extend<{ gpuPage: Page; durableGpuRun: DurableGpuRunFactory }>({
  gpuPage: async ({ page }, use) => {
    const cdp = process.env.AEROFLOW_CDP_URL;
    if (!cdp) {
      await use(page);
      return;
    }
    const browser = await chromium.connectOverCDP(cdp);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const cdpPage = await ctx.newPage();
    await use(cdpPage);
    await cdpPage.close();
    await browser.close();
  },
  durableGpuRun: async ({}, use) => {
    const opened: DurableBrowserRun[] = [];
    await use({
      async create(options) {
        const run = await DurableBrowserRun.create({
          ...options,
          root: options.root ?? process.env.AEROFLOW_RUN_ROOT ?? DEFAULT_RUN_ROOT,
        });
        opened.push(run);
        return run;
      },
    });
    await Promise.all(opened.map((run) => run.dispose()));
  },
});

export { expect } from '@playwright/test';
export { BASE_URL };
