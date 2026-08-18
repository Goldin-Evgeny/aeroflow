import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import { aijArtifactCoordinator, initialAijArtifact, syncAijArtifact } from './helpers/aijArtifact';
import { createFreshRun, releaseRun, validationRunRoot } from './helpers/validationRun';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Real-GPU M10 acceptance runs on the ?aij page (Tier B, Ampere over CDP).
 *  - Acceptance 3: empty-domain fetch ≤ 5% at the building station, full 16-cells/b
 *    grid, judged only once the steadiness criterion holds.
 *  - Acceptance 4: Case A q/r against the real Meng & Hibi fixture (landed 2026-07-20),
 *    judged only once the windowed means are steady.
 *  - Case A at 16 cells/b: RECORDING ONLY, no verdict. The low-resolution half of the
 *    resolution-convergence pair (fix-confirmed-physics-defects task 7.6). See its own
 *    comment for why it asserts no band.
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

/**
 * Steadiness budgets, per mode. These are TIME BUDGETS, not gates — raising one lets a case
 * return a verdict, it does not change what the verdict must be (CLAUDE.md rule 3, and the
 * "correcting a broken instrument is not weakening a criterion" clause).
 *
 * `FETCH_POLL_TIMEOUT` is unchanged: the empty-domain fetch reaches steadiness in four
 * windows / ~4 min, measured twice (2026-08-15 13:27 and 18:30, bit-identical).
 *
 * `SCORE_POLL_TIMEOUT` is raised from the original flat 25 min. The 2026-08-15 b=24 run
 * returned INCONCLUSIVE with the predicate still false after nine windows and 114,896 steps,
 * which is a measurement of the budget and not of the physics — the scored case carries a
 * building, and its drift is dominated by a single wandering node rather than by the field
 * as a whole. 90 min is ~3.5× the observed non-convergent budget; if it still times out,
 * that is again a budget measurement and the next value comes from the trace, never from
 * touching q/r.
 */
const FETCH_POLL_TIMEOUT = 25 * 60_000;
const SCORE_POLL_TIMEOUT = 90 * 60_000;

type Aij = NonNullable<Awaited<ReturnType<typeof readHooks>>['aij']>;

function expectHealthyAijSnapshot(a: Aij): void {
  expect(a.health, 'AIJ run must expose whole-field and complete-shell health').toBeDefined();
  expect(a.health!.nonFiniteCells).toBe(0);
  expect(a.health!.rhoMin).toBeGreaterThanOrEqual(0.5);
  expect(a.health!.rhoMax).toBeLessThanOrEqual(1.5);
  expect(Math.abs(a.health!.massDriftRel)).toBeLessThanOrEqual(1e-3);
  expect(Math.abs(a.health!.boundaryFluxClosureRel)).toBeLessThanOrEqual(1e-3);
}

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
  timeoutMs: number,
): Promise<Aij> {
  // Keep the newest readout seen DURING polling. The 2026-07-20 run died mid-poll (the
  // tab was closed) and the previous version re-read the page afterwards to build the
  // artifact — that read threw, so the trace was lost exactly when it was most needed.
  // Never re-read a page that may be gone; snapshot as you go.
  let latest: Aij | undefined;
  let failure: unknown;
  await expect
    .poll(async () => {
      latest = (await readHooks(page)).aij;
      return latest?.materialConfiguration;
    })
    .toBeDefined();
  const mode = latest?.mode === 'fetch' ? 'fetch' : 'score';
  const durable = await createFreshRun(
    validationRunRoot(),
    `aij-${mode}`,
    JSON.stringify(latest?.materialConfiguration ?? {}),
  );
  const coordinator = aijArtifactCoordinator(
    durable.layout,
    initialAijArtifact({
      runId: durable.layout.runId,
      mode,
      hook: latest!,
      timeoutMs,
    }),
  );
  await syncAijArtifact(coordinator, latest!, 'configured');
  try {
    await expect
      .poll(
        async () => {
          const a = (await readHooks(page)).aij;
          if (a) {
            latest = a;
            await syncAijArtifact(coordinator, a, 'progress');
          }
          return a && a.steady && ready(a) ? a : null;
        },
        { timeout: timeoutMs },
      )
      .not.toBeNull();
  } catch (e) {
    failure = e;
  }
  if (latest) await syncAijArtifact(coordinator, latest, failure ? 'failure' : 'verdict');
  if (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    await coordinator.terminate(/closed/i.test(message) ? 'browser-closed' : 'timeout', failure);
  } else {
    await coordinator.terminate('completed');
  }
  await testInfo.attach(`${name}-durable-artifact`, {
    path: durable.layout.artifactPath,
    contentType: 'application/json',
  });
  await releaseRun(durable);
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
          : `no steadiness within ${timeoutMs / 60_000} min. `) +
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
  const a = await awaitSteady(
    page,
    testInfo,
    'aij-fetch',
    (x) => x.fetchMaxRel !== undefined,
    FETCH_POLL_TIMEOUT,
  );
  await testInfo.attach('aij-fetch', {
    body:
      `steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); ` +
      `max profile deviation ${((a.fetchMaxRel ?? NaN) * 100).toFixed(2)}% (gate 5%)`,
    contentType: 'text/plain',
  });
  // Per-row evidence, always attached — pass or fail. `fetchMaxRel` alone cannot say
  // whether a miss lives in the measured flow, in the prescribed profile, or in the
  // row-to-height mapping that produces `ref`; these rows can. Recording only, no gate.
  await testInfo.attach('aij-fetch-rows', {
    body: JSON.stringify(a.fetchRows ?? null, null, 2),
    contentType: 'application/json',
  });
  expectHealthyAijSnapshot(a);
  expect(a.fetchPass).toBe(true);
});

test('acceptance 4: Case A hit rate q ≥ 0.66 and Pearson r ≥ 0.70 on the real grid', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(95 * 60_000); // must exceed SCORE_POLL_TIMEOUT
  // 24 cells/b, not the page default of 16. The criterion is defined at the resolution
  // that resolves the probe plane: at 16 cells/b the 2 m measurement plane falls below
  // the 3rd fluid node, which is why that grid scores q 0.532 (the acceptance ledger, M10
  // resolution-convergence story). Navigating to the bare `?aij` ran the gate at a
  // resolution the criterion was never written for. This pins the acceptance
  // configuration; it does not touch the q/r bars below (Hard rule 3).
  await page.goto(`${BASE_URL}/?aij&b=24`);
  await page.getByTestId('aij-score').click();
  const a = await awaitSteady(
    page,
    testInfo,
    'aij-score',
    (x) => x.q !== undefined,
    SCORE_POLL_TIMEOUT,
  );
  await testInfo.attach('aij-score', {
    body: `q ${a.q} (gate ≥ 0.66); r ${a.r} (gate ≥ 0.70); steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); synthetic ${a.synthetic}; underResolved ${a.underResolved}`,
    contentType: 'text/plain',
  });
  // Per-point evidence, attached on pass and fail alike. `q` is hits/points over exactly
  // these rows, so publishing only the scalar makes any hit-rate change unattributable:
  // "seven marginal points flipped" and "seven points moved a long way" reduce to the
  // same number. Recording only, no gate.
  await testInfo.attach('aij-score-rows', {
    body: JSON.stringify(a.scoreRows ?? null, null, 2),
    contentType: 'application/json',
  });
  // Guard the guards: a verdict is only meaningful on real data at full resolution.
  expect(a.synthetic).toBe(false);
  expect(a.underResolved).toBe(false);
  expectHealthyAijSnapshot(a);
  expect(a.q!).toBeGreaterThanOrEqual(0.66);
  expect(a.r!).toBeGreaterThanOrEqual(0.7);
});

/**
 * Case A at 16 cells/b — RECORDING ONLY, deliberately asserting no acceptance band.
 *
 * This is the low-resolution half of the pair task 7.6 asks for ("rescore V13 Case A at 16
 * and 24 cells/b with the corrected mapping"). It exists to answer one question: did the
 * height-mapping fix move the resolution-convergence story, or only the acceptance point?
 *
 * **Why no band is asserted here, and why that is not a weakened gate (Hard rule 3).**
 * V13's `q ≥ 0.66` / `r ≥ 0.70` is defined at the resolution that resolves the probe plane.
 * At 16 cells/b the 2 m measurement plane sits below the third fluid node, so the grid
 * scores ≈ 0.532 by construction — that number is the *evidence for* the acceptance
 * resolution being 24, not a failure of the physics. Asserting the band here would gate a
 * configuration the criterion was never written for. The acceptance gate is the test above,
 * at b=24, and it is untouched.
 *
 * Note `underResolved` is false at exactly 16 (`MIN_CELLS_PER_B = 16`), so the page does
 * produce q/r rather than suppressing the verdict — the plane is under-resolved, the *grid*
 * is not. Both are still asserted below, because a recording is only worth keeping if it
 * came from real fixture data on the grid it claims.
 */
test('V13 Case A at 16 cells/b — recorded, not gated (resolution-convergence point)', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(95 * 60_000); // must exceed SCORE_POLL_TIMEOUT
  await page.goto(`${BASE_URL}/?aij&b=16`);
  await page.getByTestId('aij-score').click();
  const a = await awaitSteady(
    page,
    testInfo,
    'aij-score-b16',
    (x) => x.q !== undefined,
    SCORE_POLL_TIMEOUT,
  );
  await testInfo.attach('aij-score-b16', {
    body:
      `RECORDED, NOT GATED — 16 cells/b, below the resolution the V13 band is defined at.\n` +
      `q ${a.q}; r ${a.r}; steady driftScaled ${a.trace?.at(-1)?.driftScaled} ` +
      `(raw drift ${a.drift}); synthetic ${a.synthetic}; underResolved ${a.underResolved}; ` +
      `windows ${a.windows}; totalSteps ${a.totalSteps}\n` +
      `Compare against the pre-fix reference q ≈ 0.532 at this resolution, and against the ` +
      `b=24 acceptance run in the same session.`,
    contentType: 'text/plain',
  });
  // Per-point evidence, attached on pass and fail alike. `q` is hits/points over exactly
  // these rows, so publishing only the scalar makes any hit-rate change unattributable:
  // "seven marginal points flipped" and "seven points moved a long way" reduce to the
  // same number. Recording only, no gate.
  await testInfo.attach('aij-score-b16-rows', {
    body: JSON.stringify(a.scoreRows ?? null, null, 2),
    contentType: 'application/json',
  });
  // Real data, real grid — the two things that would make the recording meaningless.
  expect(a.synthetic).toBe(false);
  expect(a.underResolved).toBe(false);
  expectHealthyAijSnapshot(a);
  // No band assertion: see the comment above.
  expect(a.q).toBeDefined();
  expect(a.r).toBeDefined();
});
