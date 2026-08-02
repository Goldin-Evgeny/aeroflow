import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';

/**
 * M9 acceptance-4 chaos path on the real GPU, at the 2M-cell smoke budget: run →
 * checkpoint → forced device loss (`device.destroy()` in the worker) → auto-recovery
 * with monotonically increasing step count. The full 4-hour unattended variant stays a
 * milestone-spec activity; this automates the on-demand chaos check.
 */
const types = (h: AeroflowHooks): string[] => (h.ahmedEvents ?? []).map((e) => e.type);
const lastStep = (h: AeroflowHooks, t: string): number => {
  const ev = [...(h.ahmedEvents ?? [])].reverse().find((e) => e.type === t);
  return ev && 'totalSteps' in ev ? (ev.totalSteps as number) : -1;
};

test('device-loss chaos: checkpoint → destroy → recover', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  await page.goto(`${BASE_URL}/?ahmed&cells=2000000`);

  await page.getByTestId('ahmed-start').click();
  await expect
    .poll(async () => types(await readHooks(page)), { timeout: 300_000 })
    .toContain('ready');
  await expect
    .poll(
      async () => (await readHooks(page)).ahmedEvents!.filter((e) => e.type === 'sample').length,
      {
        timeout: 300_000,
      },
    )
    .toBeGreaterThanOrEqual(2);

  await page.getByTestId('ahmed-ckpt').click();
  await expect
    .poll(async () => types(await readHooks(page)), { timeout: 300_000 })
    .toContain('checkpoint-saved');

  await page.getByTestId('ahmed-chaos').click();
  await expect
    .poll(async () => types(await readHooks(page)), { timeout: 300_000 })
    .toContain('device-lost');
  await expect
    .poll(async () => types(await readHooks(page)), { timeout: 600_000 })
    .toContain('recovered');

  const h = await readHooks(page);
  const recoveredStep = lastStep(h, 'recovered');
  expect(recoveredStep).toBeGreaterThan(0);
  await expect
    .poll(async () => lastStep(await readHooks(page), 'sample'), { timeout: 300_000 })
    .toBeGreaterThan(recoveredStep);

  await testInfo.attach('ahmed-panel.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByTestId('ahmed-stop').click();
});
