import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * The 2D cylinder playground boots and its sim loop actually advances. It moved off the
 * default route on 2026-07-25 (the 3D tunnel is the front door now), so this navigates to
 * `?playground2d` explicitly — keeping the cheap 2D path as the Tier A boot check.
 *
 * The `deviceLost` assertion is the point of the last block. `totalSteps` is a **CPU-side**
 * counter that keeps incrementing after the GPU device dies, so on its own it proved almost
 * nothing: under SwiftShader this route lost its device ~230 ms into boot and this spec was
 * green anyway (diagnosed 2026-07-27 — see `parity.spec.ts`). Adding the check was deferred
 * only because it would have turned Tier A red for a known environment fault. Tier A moved
 * to the real adapter on 2026-07-28, so it is now a live regression check.
 */
test('2D playground sim loop advances', async ({ page }) => {
  await page.goto('/?playground2d');
  await expect.poll(async () => (await readHooks(page)).ready, { timeout: 60_000 }).toBe(true);
  await expect
    .poll(async () => (await readHooks(page)).sim2d?.totalSteps ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  const first = (await readHooks(page)).sim2d!.totalSteps;
  await expect
    .poll(async () => (await readHooks(page)).sim2d!.totalSteps, { timeout: 60_000 })
    .toBeGreaterThan(first);

  // The steps above are CPU-side and cannot distinguish a live device from a dead one.
  const { deviceLost } = await readHooks(page);
  expect(deviceLost, `GPU device was lost during boot: ${deviceLost}`).toBeUndefined();
});
