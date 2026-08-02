import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';

/**
 * M9 checkpoint durability, end-to-end against real IndexedDB and the worker-owned
 * GPUDevice (src/sim/ahmedWorker.ts): start a tiny run, checkpoint on demand, kill the
 * page, resume from the checkpoint after a full reload. The emulation tests
 * (apps/studio/test/checkpointEmu.test.ts) cover orchestration with fakes; this covers
 * what they explicitly leave unproven. `?cells=200000` keeps SwiftShader viable.
 */
const URL_ = '/?ahmed&cells=200000';

const eventTypes = (h: AeroflowHooks): string[] => (h.ahmedEvents ?? []).map((e) => e.type);

test('checkpoint survives a page reload and resumes', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto(URL_);

  await page.getByTestId('ahmed-start').click();
  await expect
    .poll(async () => eventTypes(await readHooks(page)), { timeout: 300_000 })
    .toContain('ready');
  await expect
    .poll(async () => eventTypes(await readHooks(page)), { timeout: 300_000 })
    .toContain('sample');

  await page.getByTestId('ahmed-ckpt').click();
  await expect
    .poll(async () => eventTypes(await readHooks(page)), { timeout: 120_000 })
    .toContain('checkpoint-saved');

  await page.getByTestId('ahmed-stop').click();
  await expect
    .poll(async () => eventTypes(await readHooks(page)), { timeout: 120_000 })
    .toContain('stopped');

  await page.reload();
  await page.getByTestId('ahmed-resume').click();
  await expect
    .poll(async () => eventTypes(await readHooks(page)), { timeout: 300_000 })
    .toContain('resumed');
  const resumed = (await readHooks(page)).ahmedEvents!.find((e) => e.type === 'resumed');
  expect(resumed && 'totalSteps' in resumed && resumed.totalSteps).toBeGreaterThan(0);

  await page.getByTestId('ahmed-stop').click();
});
