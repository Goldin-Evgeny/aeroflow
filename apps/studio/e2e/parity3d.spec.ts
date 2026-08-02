import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * 3D GPU↔CPU parity panel (?parity3d) on SwiftShader: the real WGSL kernels (incl. the
 * M10 ABL config — free-slip H11 + VelocityInlet H12) against the Float64 CPU oracle.
 * Same bars as the panel; SwiftShader is CPU-slow, so allow the long poll. A red run
 * means a WGSL kernel diverged from the CPU reference — follow docs/DEBUGGING.md.
 */
test('3D parity panel passes (all configs incl. M10 ABL)', async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  await page.goto('/?parity3d');
  await expect
    .poll(async () => (await readHooks(page)).parity3d, { timeout: 15 * 60_000 })
    .toBeTruthy();
  const r = (await readHooks(page)).parity3d!;
  await testInfo.attach('parity3d-summary', {
    body: `[${r.version}]\n${r.lines.join('\n')}`,
    contentType: 'text/plain',
  });
  expect(r.allPass).toBe(true);
});
