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

/**
 * Attach the summary AND the raw per-sample series.
 *
 * The first Stage A run attached only `lines`. Everything the harness measures per sample —
 * the drift trace, signed in/out flux, the lateral budget, cumulative boundary mass, station
 * densities — was computed, summarised into a handful of scalars, and then discarded with the
 * browser context, so when the recorded slope turned out to be a two-endpoint chord there was
 * nothing left to refit and the run had to be repeated. A GPU run is minutes; the JSON is
 * kilobytes. Attach it.
 */
async function attachRun(
  testInfo: {
    attach: (name: string, opts: { body: string; contentType: string }) => Promise<void>;
  },
  name: string,
  report: Awaited<ReturnType<typeof waitForRun>>,
): Promise<void> {
  await testInfo.attach(name, {
    body: report.lines.join('\n'),
    contentType: 'text/plain',
  });
  await testInfo.attach(`${name}-samples`, {
    body: JSON.stringify(
      { verdicts: report.verdicts, runs: report.runs },
      (_key, value) =>
        ArrayBuffer.isView(value) ? Array.from(value as unknown as number[]) : value,
      1,
    ),
    contentType: 'application/json',
  });
}

test('H14 pressure outlet staged empty-tunnel validation', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  // Stage A only unless Stage B is asked for BY NAME. It used to default to 'all', which left
  // the 2M escalation one passing verdict away from firing on its own; M9 phase 3c is scoped
  // to the 250k tier, so the grid increase has to be a deliberate act, not a fall-through.
  const stage = (process.env.PHASE3C_STAGE ?? 'A').toUpperCase();
  expect(['A', 'ALL']).toContain(stage);

  await page.goto(`${BASE_URL}/?emptytunnel&phase3c&tiers=250000`);
  const stageA = await waitForRun(page);
  console.log(`\n${stageA.lines.join('\n')}\n`);
  await attachRun(testInfo, 'pressure-outlet-250k-ab', stageA);

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

  // Escalation needs the LATE-WINDOW fits, not the two-endpoint chord. A chord stays positive
  // on a saturating trajectory long after its trend has died, so `chord <= 0` both blocks a
  // converged run and would clear one that is merely settling from above. "Not trending" means
  // no late window has a slope resolved from zero at |t| > 2.
  const stillTrending = pressure.transient.lateWindowSlopes.some((w) => w.tStatistic > 2);
  const canEscalate = pressureVerdict.ok && !stillTrending;
  if (stage === 'A' || !canEscalate) {
    if (!canEscalate) {
      console.log(`Stage B skipped: ${pressureVerdict.why.join('; ')}`);
    }
    return;
  }

  await page.goto(`${BASE_URL}/?emptytunnel&phase3c&outlet=pressure&tiers=2000000`);
  const stageB = await waitForRun(page);
  console.log(`\n${stageB.lines.join('\n')}\n`);
  await attachRun(testInfo, 'pressure-outlet-2m', stageB);

  expect(stageB.gpuErrors).toEqual([]);
  expect(stageB.runs).toHaveLength(1);
  expect(stageB.runs[0].outlet).toBe('pressure');
  expect(stageB.verdicts[0].ok, stageB.verdicts[0].why.join('; ')).toBe(true);
  expect(stageB.runs[0].worst.massLedgerClosureRel).toBeLessThanOrEqual(5e-5);
});
