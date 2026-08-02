import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { Page, TestInfo } from '@playwright/test';

/**
 * M3 headline lid-driven-cavity runs on the real GPU (?cavity) — acceptance 1, 2 and 3.
 *
 * POLICY, matching spheredrag.gpu.spec.ts: hard-assert the MECHANICAL invariants that must
 * hold for the numbers to mean anything — the run finished, did not diverge, and reached the
 * documented residual criterion rather than its step budget — and RECORD the Ghia extremum
 * errors against their published bars. The band verdict is transcribed to
 * the M3 status log and the acceptance ledger, which is where this repo keeps physics
 * verdicts. No tolerance is defined, softened, or re-stated here (CLAUDE.md hard rule 3);
 * the ±1.5 % / ±2 % bars live in `validation/cavity.ts` next to the tables they score.
 *
 * A non-converged run is a hard FAIL, not a soft record: reading extrema off a field that is
 * still evolving is exactly the error that produced M7's false "PASS 0.509" at 4.8 % drift.
 */

const POLL = 28 * 60_000;

type Cavity = NonNullable<Awaited<ReturnType<typeof readHooks>>['cavity']>;

function fmt(c: Cavity | undefined): string {
  if (!c) return 'no cavity hook was ever populated — the run never started.';
  const lines = [
    `Re=${c.Re} on ${c.H}²   τ=${c.tau}`,
    `steps ${c.totalSteps?.toLocaleString() ?? '—'}  ${((c.elapsedMs ?? 0) / 1000).toFixed(1)} s  ` +
      `residual samples ${c.residualSamples ?? '—'}`,
    `converged ${c.converged} (stopped on: ${c.stoppedOn})  diverged ${c.diverged}  ` +
      `final residual ${c.residual?.toExponential(2) ?? '—'}`,
    `criterion: ${c.criterion ?? '—'}`,
    c.stoppedOn === 'plateau'
      ? 'stopped at the FP32 residual floor, NOT the 1e-7 threshold (steadyState.ts)'
      : '',
    '',
  ];
  for (const e of c.extrema ?? []) {
    const bar = e.tolerance === null ? '  —  ' : `±${(100 * e.tolerance).toFixed(1)}%`;
    const verdict = e.pass === null ? 'report' : e.pass ? 'PASS' : 'FAIL';
    lines.push(
      `  ${e.name.padEnd(7)} @${e.coord.toFixed(4)}  ref ${e.reference.toFixed(5)}  ` +
        `sim ${e.simulated.toFixed(5)}  relErr ${(100 * e.relError).toFixed(2)}%  ` +
        `bar ${bar}  ${verdict}`,
    );
  }
  lines.push(
    '',
    `max |Δ| over the 17 table points: u ${c.maxAbsErrorU?.toFixed(5)}  v ${c.maxAbsErrorV?.toFixed(5)}`,
    `all gated extrema pass: ${c.ghiaPass}`,
  );
  if (c.error) lines.push('', `ERROR: ${c.error}`);
  return lines.join('\n');
}

async function runCase(
  page: Page,
  testInfo: TestInfo,
  name: string,
  testId: string,
): Promise<Cavity> {
  await page.goto(`${BASE_URL}/?cavity`);
  await page.getByTestId(testId).click();

  let latest: Cavity | undefined;
  let failure: unknown;
  try {
    await expect
      .poll(
        async () => {
          const c = (await readHooks(page)).cavity;
          if (c) latest = c;
          return c?.done === true ? c : null;
        },
        { timeout: POLL },
      )
      .not.toBeNull();
  } catch (e) {
    failure = e;
  }
  await testInfo.attach(name, { body: fmt(latest), contentType: 'text/plain' });
  if (failure) {
    throw new Error(
      `INCONCLUSIVE: ${name} did not finish within ${POLL / 60_000} min. Last seen: ` +
        `${latest?.totalSteps?.toLocaleString() ?? 0} steps, residual ` +
        `${latest?.residual?.toExponential(2) ?? '—'}. The fix is the budget, never the bar.`,
    );
  }

  const c = latest!;
  expect(c.error, `${name}: the run threw`).toBeUndefined();
  expect(c.diverged, `${name}: solver diverged`).toBe(false);
  // A run that stopped on its step/time budget has not reached steady state, so its extrema
  // are not a measurement of anything. Fail loudly rather than record a misleading number.
  expect(
    c.converged,
    `${name}: stopped on '${c.stoppedOn}' with residual ${c.residual?.toExponential(2)} — ` +
      `the residual was still falling, so this is not a converged result`,
  ).toBe(true);
  return c;
}

test('Re=100 on 256² — Ghia extrema recorded against the ±1.5% bars', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  const c = await runCase(page, testInfo, 'cavity-re100-256', 'cavity-run-Re100');
  expect(c.H).toBe(256);
  expect(c.extrema?.length).toBeGreaterThan(0);
  await testInfo.attach('cavity-re100-verdict', {
    body:
      `M3 acceptance 1 — u_min and v_min vs Ghia Re=100, bar ±1.5 %.\n` +
      `All gated extrema pass: ${c.ghiaPass}. Converged at ${c.totalSteps?.toLocaleString()} ` +
      `steps (residual ${c.residual?.toExponential(2)}).\n` +
      `Transcribe this verdict to the M3 status log and the acceptance ledger.`,
    contentType: 'text/plain',
  });
});

test('Re=1000 on 512² — Ghia extrema recorded against the ±2% bars', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  const c = await runCase(page, testInfo, 'cavity-re1000-512', 'cavity-run-Re1000');
  expect(c.H).toBe(512);
  await testInfo.attach('cavity-re1000-verdict', {
    body:
      `M3 acceptance 2 — u_min, v_min and v_max vs Ghia Re=1000, bar ±2 %.\n` +
      `All gated extrema pass: ${c.ghiaPass}. Converged at ${c.totalSteps?.toLocaleString()} ` +
      `steps (residual ${c.residual?.toExponential(2)}).\n` +
      `Transcribe this verdict to the M3 status log and the acceptance ledger.`,
    contentType: 'text/plain',
  });
});
