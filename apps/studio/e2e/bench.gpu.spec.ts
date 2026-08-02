import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * ?bench3d MLUPs ladder on the real GPU. Captures the copyable markdown + JSON rows as
 * artifacts for milestone Status sections. Sanity-asserts throughput exists; the actual
 * M6 gates (≥800 FP32 / ≥1500 FP16 MLUPs) are recorded, not asserted — see
 * docs/VALIDATION.md rule 3 about hardware-dependent numbers.
 */
test('benchmark ladder completes and reports MLUPs', async ({ gpuPage: page }, testInfo) => {
  await page.goto(`${BASE_URL}/?bench3d`);
  await page.locator('#run-bench').click();
  await expect
    .poll(async () => (await readHooks(page)).benchDone, { timeout: 25 * 60_000 })
    .toBe(true);
  const h = await readHooks(page);
  await testInfo.attach('bench.md', { body: h.benchMarkdown!, contentType: 'text/markdown' });
  // Also print it: this table is a milestone deliverable (it goes into M6's Status section
  // and onto the public benchmark page), and an attachment buried in the HTML report is not
  // reachable from a terminal run.
  console.log(`\n${h.benchMarkdown}\n`);
  await testInfo.attach('bench.json', {
    body: JSON.stringify(h.benchRows, null, 2),
    contentType: 'application/json',
  });
  const timed = h.benchRows!.filter((r) => !r.skipped);
  expect(timed.length).toBeGreaterThan(0);
  for (const r of timed) expect(r.mlups, `${r.grid}³ ${r.precision}`).toBeGreaterThan(0);
});
