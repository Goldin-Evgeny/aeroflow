import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * Phase-0 smoke: headless Chromium must yield a WebGPU adapter + device, and the app must
 * reach its sim loop through it. If this fails, every other GPU-touching Tier A spec is
 * meaningless — check the project's browser in playwright.config.ts first. The classic
 * failure is Playwright's bundled `chromium-headless-shell`, whose `requestAdapter()`
 * returns null; the `chromium` channel is what exposes the real device.
 *
 * Deliberately adapter-agnostic: it asserts an adapter exists, not which one. The identity
 * and limits of the real device are `caps.gpu.spec.ts`'s job.
 */
test('headless Chromium exposes a WebGPU adapter', async ({ page }) => {
  await page.goto('/');
  const adapter = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return null;
    const a = await navigator.gpu.requestAdapter();
    if (!a) return null;
    await a.requestDevice();
    return { vendor: a.info.vendor, maxBufferSize: a.limits.maxBufferSize };
  });
  expect(adapter).not.toBeNull();
  expect(adapter!.maxBufferSize).toBeGreaterThan(0);
});

test('app boots to the 2D playground through WebGPU', async ({ page }) => {
  // `?playground2d` since 2026-07-25 — the default route is the 3D tunnel.
  await page.goto('/?playground2d');
  await expect.poll(async () => (await readHooks(page)).ready, { timeout: 60_000 }).toBe(true);
});
