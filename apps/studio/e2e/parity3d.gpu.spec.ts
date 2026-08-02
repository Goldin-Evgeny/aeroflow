import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * Real-GPU run of the ?parity3d panel (M6 criterion #3 + M7 forces + M10 ABL BCs).
 * The attached lines are the parity-panel result lines CLAUDE.md rule 0 requires in
 * commits touching stream_collide_3d.wgsl.
 */
test('3D GPU↔CPU parity panel on real GPU', async ({ gpuPage: page }, testInfo) => {
  await page.goto(`${BASE_URL}/?parity3d`);
  await expect
    .poll(async () => (await readHooks(page)).parity3d, { timeout: 600_000 })
    .toBeTruthy();
  const r = (await readHooks(page)).parity3d!;
  const summary = `[${r.version}]\n${r.lines.join('\n')}`;
  await testInfo.attach('parity3d-summary', { body: summary, contentType: 'text/plain' });
  // Print it too: CLAUDE.md rule 0 requires these lines in the commit message of any change
  // touching a .wgsl file, and an HTML-report attachment is not reachable from a terminal.
  console.log(`\n${summary}\n`);
  expect(r.allPass).toBe(true);
});
