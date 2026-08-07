import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * M9 force-audit phase 1: is the corrected CPU-vs-GPU Ahmed Cd gap (~1.32–1.42 vs
 * ~1.03–1.19) a genuine solver discrepancy, or were the two simply never the same run?
 *
 * The gate is the SHORT-horizon trajectory comparison. A structural CPU/GPU difference is
 * O(1) at the first checkpoint; fp32-vs-fp64 roundoff is ~1e-6 and grows smoothly from
 * there. The windowed Cd is reported but NOT gated — a separated wake is chaotic, so two
 * correct implementations at different precision agree there only statistically, and
 * holding that number to the parity bar would be gating chaos.
 */
test('Ahmed CPU↔GPU matched-config reconciliation', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(900_000);
  await page.goto(`${BASE_URL}/?ahmedmatch`);
  await expect
    .poll(
      async () => {
        const h = await readHooks(page);
        return h.ahmedMatch ?? h.ahmedMatchError;
      },
      { timeout: 780_000 },
    )
    .toBeTruthy();

  const h = await readHooks(page);
  expect(h.ahmedMatchError, `harness threw: ${h.ahmedMatchError}`).toBeUndefined();
  const r = h.ahmedMatch!;

  const summary = [
    '--- configuration (identical unless stated) ---',
    ...Object.entries(r.solver).map(([k, v]) => `${k.padEnd(28)} ${v}`),
    '',
    '--- A: trajectory parity (gated at the shortest horizon) ---',
    ...r.lines,
    '',
    '--- B: raw consecutive forces ---',
    ...r.trajectory.map(
      (t) =>
        `@${String(t.steps).padStart(4)}  cpu f1=${t.cpuRaw[0].toExponential(4)} f2=${t.cpuRaw[1].toExponential(4)} pair=${t.cpuPairFx.toExponential(4)}  ` +
        `gpu f1=${t.gpuRaw[0].toExponential(4)} f2=${t.gpuRaw[1].toExponential(4)} pair=${t.gpuPairFx.toExponential(4)}  rel=${t.relPairFx.toExponential(2)}`,
    ),
    '',
    `windowed Cd over ${r.windowed.samples} samples: ` +
      `cpu=${r.windowed.cpuCd.toFixed(4)} (sd ${r.windowed.cpuStd.toFixed(4)}, sem ${r.windowed.cpuSem.toFixed(4)})  ` +
      `gpu=${r.windowed.gpuCd.toFixed(4)} (sd ${r.windowed.gpuStd.toFixed(4)}, sem ${r.windowed.gpuSem.toFixed(4)})  ` +
      `rel=${(r.windowed.relCd * 100).toFixed(1)}%`,
    `wall time ${(r.ms / 1000).toFixed(1)} s`,
  ].join('\n');

  await testInfo.attach('ahmed-match', { body: summary, contentType: 'text/plain' });
  console.log(`\n${summary}\n`);

  expect(r.gpuErrors).toEqual([]);
  expect(r.trajectoryPass).toBe(true);
});
