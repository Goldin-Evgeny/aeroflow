import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

async function waitForRun(page: Parameters<typeof readHooks>[0]) {
  await expect
    .poll(
      async () => {
        const hooks = await readHooks(page);
        return hooks.emptyTunnel ?? hooks.emptyTunnelError;
      },
      { timeout: 12 * 60_000 },
    )
    .toBeTruthy();
  const hooks = await readHooks(page);
  expect(hooks.emptyTunnelError).toBeUndefined();
  return hooks.emptyTunnel!;
}

test('H14 pressure outlet staged empty-tunnel validation', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const stage = (process.env.PHASE3C_STAGE ?? 'all').toUpperCase();
  expect(['A', 'ALL']).toContain(stage);

  await page.goto(`${BASE_URL}/?emptytunnel&phase3c&tiers=250000`);
  const stageA = await waitForRun(page);
  console.log(`\n${stageA.lines.join('\n')}\n`);
  await testInfo.attach('pressure-outlet-250k-ab', {
    body: stageA.lines.join('\n'),
    contentType: 'text/plain',
  });

  expect(stageA.gpuErrors).toEqual([]);
  expect(stageA.runs.map((run) => run.outlet).sort()).toEqual(['pressure', 'zero-gradient']);
  const control = stageA.runs.find((run) => run.outlet === 'zero-gradient')!;
  const pressure = stageA.runs.find((run) => run.outlet === 'pressure')!;
  const pressureVerdict = stageA.verdicts.find((verdict) => verdict.outlet === 'pressure')!;
  expect(pressure.worst.nonFiniteCells).toBe(0);
  expect(pressure.worst.massLedgerClosureRel).toBeLessThanOrEqual(5e-5);
  expect(Math.abs(pressure.transient.massDriftSlopePerTConv)).toBeLessThan(
    Math.abs(control.transient.massDriftSlopePerTConv),
  );

  const canEscalate = pressureVerdict.ok && pressure.transient.massDriftSlopePerTConv <= 0;
  if (stage === 'A' || !canEscalate) {
    if (!canEscalate) {
      console.log(`Stage B skipped: ${pressureVerdict.why.join('; ')}`);
    }
    return;
  }

  await page.goto(`${BASE_URL}/?emptytunnel&phase3c&outlet=pressure&tiers=2000000`);
  const stageB = await waitForRun(page);
  console.log(`\n${stageB.lines.join('\n')}\n`);
  await testInfo.attach('pressure-outlet-2m', {
    body: stageB.lines.join('\n'),
    contentType: 'text/plain',
  });

  expect(stageB.gpuErrors).toEqual([]);
  expect(stageB.runs).toHaveLength(1);
  expect(stageB.runs[0].outlet).toBe('pressure');
  expect(stageB.verdicts[0].ok, stageB.verdicts[0].why.join('; ')).toBe(true);
  expect(stageB.runs[0].worst.massLedgerClosureRel).toBeLessThanOrEqual(5e-5);
});
