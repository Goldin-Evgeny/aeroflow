import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/** M9 acceptance 3, GPU half: exact raw-FP16 restore and deterministic continuation. */
test('64^3 FP16 checkpoint resumes bit-identically', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await page.goto(`${BASE_URL}/?checkpointparity`);

  await expect
    .poll(
      async () => {
        const hooks = await readHooks(page);
        if (hooks.checkpointParityError) throw new Error(hooks.checkpointParityError);
        return hooks.checkpointParity;
      },
      { timeout: 10 * 60_000 },
    )
    .toBeTruthy();

  const result = (await readHooks(page)).checkpointParity!;
  await testInfo.attach('checkpoint-parity-summary', {
    body: result.summary,
    contentType: 'text/plain',
  });
  console.log(`\n${result.summary}\n`);

  expect(result.grid).toBe(64);
  expect(result.precision).toBe('fp16');
  expect(result.conserveMass).toBe(true);
  expect(result.checkpointStep % 2).toBe(1);
  expect(result.continuationSteps).toBe(100);
  expect(result.checkpointBytes).toBeGreaterThan(0);
  expect(result.nonRestFluidCells).toBeGreaterThan(0);
  expect(result.rawDdfMismatches).toBe(0);
  expect(result.densityMismatches).toBe(0);
  expect(result.pass).toBe(true);
});
