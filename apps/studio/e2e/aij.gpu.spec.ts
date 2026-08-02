import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Real-GPU M10 acceptance runs on the ?aij page (Tier B, Ampere over CDP).
 *  - Acceptance 3: empty-domain fetch ≤ 5% at the building station, full 16-cells/b
 *    grid, judged only once the steadiness criterion holds.
 *  - Acceptance 4: Case A q/r against the real Meng & Hibi fixture (landed 2026-07-20),
 *    judged only once the windowed means are steady.
 *
 * Both gates are judged on TIME MEANS, so both wait for steadiness first. The
 * 2026-07-20 attempt at acceptance 3 timed out with the predicate still false: the gate
 * was never evaluated, and the run produced no information about how much longer it
 * needed. Every wait here therefore attaches the convergence trace (drift vs step count,
 * one entry per completed window) whether it converges or not, so a timeout is a
 * MEASUREMENT that sets the next budget. A timeout is reported as INCONCLUSIVE, never as
 * a physics failure — and the fix is the budget, never the gate (Hard rule 3).
 *
 * Record the printed numbers in the M10 status log after a green run.
 */

const POLL_TIMEOUT = 25 * 60_000;

type Aij = NonNullable<Awaited<ReturnType<typeof readHooks>>['aij']>;

/** Format the convergence trace as a readable table for the run artifact. */
function formatTrace(a: Aij | undefined): string {
  const t = a?.trace ?? [];
  if (t.length === 0) return 'no completed averaging windows — run never reached one.';
  const head = 'window   steps        drift        driftScaled  driftIdx  fetchMaxRel   q';
  const fmt = (x: number | undefined) =>
    x === undefined || !Number.isFinite(x) ? '—' : x.toExponential(3);
  const rows = t.map(
    (s) =>
      `${String(s.windows).padEnd(8)} ${String(s.steps).padEnd(12)} ` +
      `${fmt(s.drift)}`.padEnd(13) +
      `${fmt(s.driftScaled)}`.padEnd(13) +
      `${String(s.driftIndex ?? -1)}`.padEnd(10) +
      `${s.fetchMaxRel !== undefined ? (s.fetchMaxRel * 100).toFixed(2) + '%' : '—'}`.padEnd(14) +
      `${s.q !== undefined ? s.q.toFixed(3) : '—'}`,
  );
  return [head, ...rows].join('\n');
}

/**
 * Wait for steadiness, ALWAYS attaching the convergence trace. Returns the final
 * readout; throws with an explicit INCONCLUSIVE message on timeout.
 */
async function awaitSteady(
  page: Page,
  testInfo: TestInfo,
  name: string,
  ready: (a: Aij) => boolean,
): Promise<Aij> {
  // Keep the newest readout seen DURING polling. The 2026-07-20 run died mid-poll (the
  // tab was closed) and the previous version re-read the page afterwards to build the
  // artifact — that read threw, so the trace was lost exactly when it was most needed.
  // Never re-read a page that may be gone; snapshot as you go.
  let latest: Aij | undefined;
  let failure: unknown;
  try {
    await expect
      .poll(
        async () => {
          const a = (await readHooks(page)).aij;
          if (a) latest = a;
          return a && a.steady && ready(a) ? a : null;
        },
        { timeout: POLL_TIMEOUT },
      )
      .not.toBeNull();
  } catch (e) {
    failure = e;
  }
  await testInfo.attach(`${name}-convergence`, {
    body: formatTrace(latest),
    contentType: 'text/plain',
  });
  if (failure) {
    const dead = String(failure).includes('has been closed');
    throw new Error(
      `INCONCLUSIVE: ${name} produced no verdict — ` +
        (dead
          ? 'the page was closed mid-run (browser gone, not a physics result). '
          : `no steadiness within ${POLL_TIMEOUT / 60_000} min. `) +
        `Last seen: drift ${latest?.drift}, driftScaled ${latest?.trace?.at(-1)?.driftScaled}, ` +
        `${latest?.windows ?? 0} windows, ${latest?.totalSteps ?? 0} steps. ` +
        `The gate was NOT evaluated — read the attached trace. Fix the budget or the ` +
        `steadiness predicate; never the gate.`,
    );
  }
  return latest!;
}

test('acceptance 3: empty-domain fetch gate ≤ 5% on the real grid', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  await page.goto(`${BASE_URL}/?aij`);
  await page.getByTestId('aij-fetch').click();
  const a = await awaitSteady(page, testInfo, 'aij-fetch', (x) => x.fetchMaxRel !== undefined);
  await testInfo.attach('aij-fetch', {
    body:
      `steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); ` +
      `max profile deviation ${((a.fetchMaxRel ?? NaN) * 100).toFixed(2)}% (gate 5%)`,
    contentType: 'text/plain',
  });
  expect(a.fetchPass).toBe(true);
});

test('acceptance 4: Case A hit rate q ≥ 0.66 and Pearson r ≥ 0.70 on the real grid', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  // 24 cells/b, not the page default of 16. The criterion is defined at the resolution
  // that resolves the probe plane: at 16 cells/b the 2 m measurement plane falls below
  // the 3rd fluid node, which is why that grid scores q 0.532 (the acceptance ledger, M10
  // resolution-convergence story). Navigating to the bare `?aij` ran the gate at a
  // resolution the criterion was never written for. This pins the acceptance
  // configuration; it does not touch the q/r bars below (Hard rule 3).
  await page.goto(`${BASE_URL}/?aij&b=24`);
  await page.getByTestId('aij-score').click();
  const a = await awaitSteady(page, testInfo, 'aij-score', (x) => x.q !== undefined);
  await testInfo.attach('aij-score', {
    body: `q ${a.q} (gate ≥ 0.66); r ${a.r} (gate ≥ 0.70); steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); synthetic ${a.synthetic}; underResolved ${a.underResolved}`,
    contentType: 'text/plain',
  });
  // Guard the guards: a verdict is only meaningful on real data at full resolution.
  expect(a.synthetic).toBe(false);
  expect(a.underResolved).toBe(false);
  expect(a.q!).toBeGreaterThanOrEqual(0.66);
  expect(a.r!).toBeGreaterThanOrEqual(0.7);
});
