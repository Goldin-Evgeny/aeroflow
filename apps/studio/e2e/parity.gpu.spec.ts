import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * Real-GPU acceptance runs of the ?dev panel (H6 parity matrix + M4 force parity).
 * The attached parity-summary line is the one CLAUDE.md rule 0 requires in commits
 * touching WGSL. Long validation cases (cylinder Re=100/200, V6, stability envelope)
 * are tagged @long and excluded from the default run: `--grep-invert @long`.
 */
test('H6 parity matrix on real GPU', async ({ gpuPage: page }, testInfo) => {
  await page.goto(`${BASE_URL}/?dev`);
  await page.getByTestId('parity-run').click();
  await expect
    .poll(async () => (await readHooks(page)).parityReport, { timeout: 600_000 })
    .toBeTruthy();
  const report = (await readHooks(page)).parityReport!;
  await testInfo.attach('parity-summary', { body: report.summary, contentType: 'text/plain' });
  console.log(`\n${report.summary}\n`);
  expect(report.pass).toBe(true);
});

test('M4 force parity on real GPU', async ({ gpuPage: page }, testInfo) => {
  await page.goto(`${BASE_URL}/?dev`);
  await page.getByTestId('force-parity').click();
  await expect.poll(async () => (await readHooks(page)).m4, { timeout: 600_000 }).toBeTruthy();
  const m4 = (await readHooks(page)).m4!;
  await testInfo.attach('force-parity-summary', { body: m4.summary, contentType: 'text/plain' });
  expect(m4.pass).toBe(true);
});

for (const [label, testid] of [
  ['cylinder Re=100', 'cyl-re100'],
  ['cylinder Re=200', 'cyl-re200'],
  ['V6 Re=100 ±LES', 'v6-les'],
  ['stability envelope', 'stability-envelope'],
] as const) {
  test(`@long ${label}`, async ({ gpuPage: page }, testInfo) => {
    test.setTimeout(4 * 60 * 60_000);
    await page.goto(`${BASE_URL}/?dev`);
    await page.getByTestId(testid).click();
    await expect
      .poll(async () => (await readHooks(page)).m4, { timeout: 4 * 60 * 60_000 })
      .toBeTruthy();
    const m4 = (await readHooks(page)).m4!;
    await testInfo.attach(`${testid}-summary`, { body: m4.summary, contentType: 'text/plain' });
    expect(m4.pass).toBe(true);
  });
}

test('@long H10 high-Re retry records the M5 verdict', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(4 * 60 * 60_000);
  await page.goto(`${BASE_URL}/?dev`);
  await page.getByTestId('h10-high-re').click();
  await expect
    .poll(async () => (await readHooks(page)).m4, { timeout: 4 * 60 * 60_000 })
    .toBeTruthy();
  const result = (await readHooks(page)).m4!;
  await testInfo.attach('h10-high-re-summary', {
    body: result.summary,
    contentType: 'text/plain',
  });
  expect(result.summary).toContain('H10 retry (LES + regularization)');
  expect(result.summary).toMatch(/Re=10000.*Re=100000/s);
  expect(result.pass).toBe(true);
});
