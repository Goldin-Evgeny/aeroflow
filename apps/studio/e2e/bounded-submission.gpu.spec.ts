import { expect, test } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

test('bounded submissions preserve fp32/fp16 state and stay within the overhead budget', async ({
  gpuPage: page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/?boundedsubmission');
  const result = await expect
    .poll(
      async () => {
        const state = await readHooks(page);
        if (state.boundedSubmissionError) throw new Error(state.boundedSubmissionError);
        return state.boundedSubmission;
      },
      { timeout: 110_000 },
    )
    .toBeTruthy()
    .then(async () => (await readHooks(page)).boundedSubmission!);
  console.log(`bounded submission proof: ${JSON.stringify(result)}`);
  expect(result.equivalence.every((entry) => entry.pass)).toBe(true);
  expect(result.equivalence.map((entry) => entry.precision)).toContain('fp32');
  expect(result.performance.monolithicMs).toHaveLength(3);
  expect(result.performance.boundedMs).toHaveLength(3);
  expect(result.performance.throughputLoss).toBeLessThanOrEqual(0.1);
  expect(result.pass).toBe(true);
});
