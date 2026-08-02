import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';

type Cavity = NonNullable<AeroflowHooks['cavity']>;

const CHECKPOINTS = [20_000, 200_000, 1_000_000, 4_000_000];
const MASS_DRIFT_GATE = 1e-4;
const U_MIN_DRIFT_GATE = 0.005;

function report(label: string, result: Cavity): string {
  const rows = (result.diagnostics ?? []).map(
    (sample) =>
      `${sample.steps.toString().padStart(7)}  u_min=${sample.uMin.toFixed(8)}  ` +
      `mass=${sample.mass.toFixed(8)}  drift=${sample.massDriftRel.toExponential(3)}  ` +
      `wallΔ/step=${sample.movingWallRoundoffDelta.toExponential(3)}  ` +
      `R=${sample.residual.toExponential(3)}`,
  );
  return `${label}\n${rows.join('\n')}`;
}

test('@long H=64 cavity isolates and gates long-run FP32 drift with H13', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);

  const run = async (regularize: boolean, conserveMass: boolean): Promise<Cavity> => {
    const query =
      `?cavity&H=64&minSteps=4000000&maxSteps=4000000&diagnostic=1` +
      `&regularize=${regularize ? 1 : 0}&conserveMass=${conserveMass ? 1 : 0}`;
    await page.goto(`${BASE_URL}/${query}`);
    await page.getByTestId('cavity-run-Re100').click();
    await expect
      .poll(async () => (await readHooks(page)).cavity?.done, { timeout: 25 * 60_000 })
      .toBe(true);

    const result = (await readHooks(page)).cavity!;
    expect(result.error).toBeUndefined();
    expect(result.diverged).toBe(false);
    expect(result.totalSteps).toBe(4_000_000);
    expect(result.regularize).toBe(regularize);
    expect(result.conserveMass).toBe(conserveMass);
    expect(result.diagnostics?.map((sample) => sample.steps)).toEqual(CHECKPOINTS);
    return result;
  };

  const plain = await run(false, false);
  const regularized = await run(true, false);
  const conservative = await run(true, true);
  const summary =
    `${report('TRT plain', plain)}\n\n${report('TRT + H10', regularized)}\n\n` +
    report('TRT + H10 + H13', conservative);
  await testInfo.attach('cavity-long-run-drift', { body: summary, contentType: 'text/plain' });
  console.log(`\n${summary}\n`);

  const first = conservative.diagnostics![0];
  const last = conservative.diagnostics!.at(-1)!;
  expect(Math.abs(last.massDriftRel), 'H13 4M-step absolute mass drift').toBeLessThan(
    MASS_DRIFT_GATE,
  );
  expect(
    Math.abs(last.uMin - first.uMin) / Math.abs(first.uMin),
    'H13 u_min drift from 20k to 4M steps',
  ).toBeLessThan(U_MIN_DRIFT_GATE);
});
