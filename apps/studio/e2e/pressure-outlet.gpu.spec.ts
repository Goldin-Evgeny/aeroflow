import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** `apps/studio/test-results/phase3c` — already git-ignored, and outside the per-test dirs
 *  Playwright prunes for passing tests. Override with `PHASE3C_OUT`. */
const OUT_DIR =
  process.env.PHASE3C_OUT ??
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'phase3c');

/**
 * Persist the summary AND the raw per-sample series, to a FILE.
 *
 * The first Stage A run attached only `lines`. Everything the harness measures per sample —
 * the drift trace, signed in/out flux, the lateral budget, cumulative boundary mass, station
 * densities — was computed, summarised into a handful of scalars, and then discarded with the
 * browser context, so when the recorded slope turned out to be a two-endpoint chord there was
 * nothing left to refit and the run had to be repeated.
 *
 * `testInfo.attach` alone did NOT fix that: Playwright prunes the output directory of a
 * PASSING test, and this spec passes whenever Stage A merely declines to escalate — which is
 * the normal outcome. So the series goes to an explicit path as well. A GPU run is seconds
 * and the JSON is kilobytes; there is no reason to be clever about it.
 */
async function attachRun(
  testInfo: {
    attach: (name: string, opts: { body: string; contentType: string }) => Promise<void>;
  },
  name: string,
  report: Awaited<ReturnType<typeof waitForRun>>,
): Promise<void> {
  const summary = report.lines.join('\n');
  const series = JSON.stringify(
    { verdicts: report.verdicts, runs: report.runs },
    (_key, value) => (ArrayBuffer.isView(value) ? Array.from(value as unknown as number[]) : value),
    1,
  );
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, `${name}.txt`), summary);
  writeFileSync(resolve(OUT_DIR, `${name}-samples.json`), series);
  console.log(`phase3c artifacts written to ${OUT_DIR}`);
  await testInfo.attach(name, { body: summary, contentType: 'text/plain' });
  await testInfo.attach(`${name}-samples`, { body: series, contentType: 'application/json' });
}

/**
 * E2 — does the oscillation ring down, or is it sustained?
 *
 * Stage A's residual mass "slope" turned out to be a two-endpoint chord over a trajectory
 * that oscillates about zero (E1: four late-window fits, all |t| < 1, alternating sign). What
 * it left open is the oscillation itself, which decayed only 2.9x about its level over 41
 * convective times. Tripling the window separates a slowly-damped acoustic mode from a
 * sustained standing one — the distinction matters because resolved viscosity here is
 * ~3.3e-7, so there is almost nothing to damp it.
 *
 * Same 250k grid, pressure arm only. No grid increase, no precision change, no body.
 */
test('H14 pressure outlet long-window ring-down (E2)', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  test.skip(process.env.PHASE3C_E2 !== '1', 'set PHASE3C_E2=1 to run the long-window arm');

  await page.goto(`${BASE_URL}/?emptytunnel&phase3c&outlet=pressure&tiers=250000&tconv=120`);
  const long = await waitForRun(page);
  console.log(`\n${long.lines.join('\n')}\n`);
  await attachRun(testInfo, 'pressure-outlet-250k-tconv120', long);

  expect(long.gpuErrors).toEqual([]);
  expect(long.runs).toHaveLength(1);
  expect(long.runs[0].outlet).toBe('pressure');
  expect(long.runs[0].worst.nonFiniteCells).toBe(0);
  expect(long.runs[0].worst.massLedgerClosureRel).toBeLessThanOrEqual(5e-5);
});

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
