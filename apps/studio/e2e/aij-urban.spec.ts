import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * Tier A M11 smoke: official bytes, production glTF loader, wind alignment, GPU
 * voxelization/LBM, sparse probe readback, suppressed report rendering, JSON export,
 * and DDF + averaging-state checkpoint/resume. The 12k-cell override is deliberately
 * under-resolved and can never publish a physics verdict.
 */
test('M11 Case C workbench runs, suppresses, exports, and resumes', async ({ page }, testInfo) => {
  test.setTimeout(12 * 60_000);
  const url = '/?urban&case=C&direction=270&cells=12000';
  await page.goto(url);
  await expect.poll(async () => (await readHooks(page)).urban?.ready).toBe(true);

  const directions = page.getByTestId('urban-direction').locator('option');
  await expect(directions).toHaveCount(3);
  await page.getByTestId('urban-case-e').click();
  await expect(directions).toHaveCount(16);
  await page.getByTestId('urban-case-c').click();
  await expect(directions).toHaveCount(3);

  await page.getByTestId('urban-run').click();
  await expect
    .poll(
      async () => {
        const urban = (await readHooks(page)).urban;
        if (urban?.error) throw new Error(urban.error);
        return urban?.totalSteps ?? 0;
      },
      { timeout: 5 * 60_000 },
    )
    .toBeGreaterThan(0);
  const started = (await readHooks(page)).urban!;
  expect(started.caseId).toBe('C');
  expect(started.direction).toBe(270);
  expect(started.underResolved).toBe(true);
  expect(started.requiredCells).toBeGreaterThan(12_000);
  await expect(page.getByTestId('urban-resolution')).toContainText('VERDICT SUPPRESSED');

  await expect
    .poll(async () => (await readHooks(page)).urban?.reportRows ?? 0, { timeout: 8 * 60_000 })
    .toBe(120);
  const reported = (await readHooks(page)).urban!;
  expect(reported.verdict).toBe('suppressed');
  expect(reported.q).toBeGreaterThanOrEqual(0);
  expect(reported.q).toBeLessThanOrEqual(1);
  expect(reported.averagingFlowThroughs).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('urban-verdict')).toHaveText('SUPPRESSED');
  await expect(page.getByTestId('urban-table').locator('tbody tr')).toHaveCount(120);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('urban-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('aeroflow-aij-case-C-270deg.json');

  await page.getByTestId('urban-stop').click();
  await expect(page.getByTestId('urban-status')).toHaveText('Stopped', { timeout: 60_000 });
  const savedSteps = (await readHooks(page)).urban!.totalSteps!;
  await page.getByTestId('urban-checkpoint').click();
  await expect(page.getByTestId('urban-status')).toHaveText('Checkpoint saved', {
    timeout: 3 * 60_000,
  });

  await page.reload();
  await expect.poll(async () => (await readHooks(page)).urban?.ready).toBe(true);
  await page.getByTestId('urban-resume').click();
  await expect
    .poll(
      async () => {
        const urban = (await readHooks(page)).urban;
        return urban?.resumed && (urban.totalSteps ?? 0) >= savedSteps;
      },
      { timeout: 5 * 60_000 },
    )
    .toBe(true);
  await page.getByTestId('urban-stop').click();
  await expect(page.getByTestId('urban-status')).toHaveText('Stopped', { timeout: 60_000 });

  await testInfo.attach('m11-workbench', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
