import type { Page } from '@playwright/test';
import type { AeroflowHooks } from '../../src/dev/testHooks';

/** Snapshot of the app's `window.__aeroflow` observation hooks (src/dev/testHooks.ts). */
export function readHooks(page: Page): Promise<AeroflowHooks> {
  return page.evaluate(() => window.__aeroflow ?? {});
}

/** Base URL for composing absolute URLs where baseURL does not apply (CDP contexts). */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
