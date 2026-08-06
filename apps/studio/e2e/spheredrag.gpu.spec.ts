import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Real-GPU M7 sphere-drag characterization on ?spheredrag (Tier B, Ampere over CDP).
 *
 * POLICY — record, don't assert, the resolution/precision-dependent numbers. Like
 * bench.gpu.spec.ts (which records MLUPs rather than asserting the M6 gate), these runs
 * RECORD the drag coefficient, its literature band, and the fp16/fp32 relΔ as artifacts,
 * and hard-assert only the MECHANICAL invariants that must hold regardless of resolution:
 * the run did not diverge, the running mean converged, and lateral force ≪ drag (a free
 * opp[]/direction-table check). The acceptance bands themselves are screening-grade on a
 * uniform grid — the honest verdict (which cases land in band) is transcribed to
 * the M7 status log, not gated here (docs/VALIDATION.md rule 3;
 * CLAUDE.md hard rule 3 — never weaken a tolerance, and never fake a green either).
 *
 * The 2026-07-24 first run established the honest numbers this suite records:
 *   - Re=100 (steady wake): Cd 1.153 (in band); fp16 A/B 2.25% — a real, converged
 *     shifted-fp16 storage bias sitting just over the 2% acceptance-4 bar.
 *   - Re=1000: converged (drift 0.5%, tc=120) Cd 0.569 — ~21% over literature 0.47, OUT
 *     of band. The earlier recorded "PASS (0.509)" was premature: read off a running mean
 *     at 4.8% drift while still climbing. This suite's tc=120 run is what caught it.
 *   - Re=10⁴: freestream Cd 0.55 (over band); H11 free-slip Cd 0.263 (UNDER band). Neither
 *     lateral BC brackets [0.38, 0.5] — the error is unresolved boundary layer (uniform
 *     grid), not confinement. Free-slip is a tried-and-rejected far-field, not a fix.
 *
 * Each run is tens of thousands of steps (A/B doubles it); the gpu project timeout is 30m.
 */

const POLL = 28 * 60_000;

type Sphere = NonNullable<Awaited<ReturnType<typeof readHooks>>['sphereDrag']>;

function fmt(s: Sphere | undefined): string {
  if (!s) return 'no sphereDrag hook was ever populated — the run never started.';
  const pct = (x: number | undefined) => (x === undefined ? '—' : `${x.toFixed(3)}%`);
  const num = (x: number | undefined) => (x === undefined ? '—' : x.toFixed(4));
  const lines = [
    `case ${s.case}  kind ${s.kind}  lateralBC ${s.lateralBC ?? 'default'}  ` +
      `tcOverride ${s.totalConvectiveTimes ?? '—'}  steps ${s.totalSteps ?? '—'}`,
    `done ${s.done}  diverged ${s.diverged}`,
  ];
  if (s.kind === 'run') {
    lines.push(
      `mean Cd ${num(s.meanCd)}  band [${s.band?.[0]}, ${s.band?.[1]}]  inBand ${s.inBand}  ` +
        `drift ${pct(s.driftPct)}`,
      `symmetry |Fy| ${s.meanAbsFy?.toExponential(2) ?? '—'}  |Fz| ${s.meanAbsFz?.toExponential(2) ?? '—'} (≪ Fx)`,
    );
  } else {
    lines.push(
      `Cd A ${num(s.cdA)}  Cd B ${num(s.cdB)}  relΔ ${pct(s.relDiff ? s.relDiff * 100 : undefined)}  ` +
        `abPass ${s.abPass} (2% bar — recorded, see Status)`,
    );
  }
  return lines.join('\n');
}

/** Navigate, click the run button, poll the sphereDrag hook to done, always attach it. */
async function runAndAwait(
  page: Page,
  testInfo: TestInfo,
  name: string,
  path: string,
  testId: string,
): Promise<Sphere> {
  await page.goto(`${BASE_URL}${path}`);
  await page.getByTestId(testId).click();
  let latest: Sphere | undefined;
  let failure: unknown;
  try {
    await expect
      .poll(
        async () => {
          const s = (await readHooks(page)).sphereDrag;
          if (s) latest = s;
          return s?.done === true ? s : null;
        },
        { timeout: POLL },
      )
      .not.toBeNull();
  } catch (e) {
    failure = e;
  }
  // Attach AND print. These numbers are the milestone's evidence (M7 acceptance 1–4 are
  // "recorded, not asserted"), and an attachment alone is only retrievable by unpacking the
  // HTML report's zip — which makes a regression check needlessly archaeological. Every
  // other GPU spec here prints its result line; this one now does too.
  const report = fmt(latest);
  await testInfo.attach(name, { body: report, contentType: 'text/plain' });
  console.log(`\n=== ${name} ===\n${report}\n`);
  if (failure) {
    throw new Error(
      `INCONCLUSIVE: ${name} produced no completed run within ${POLL / 60_000} min. ` +
        `Last seen: done ${latest?.done}, steps ${latest?.totalSteps ?? 0}. Read the attached ` +
        `state; the fix is the timeout/budget, never the gate.`,
    );
  }
  return latest!;
}

/** A/B legs must both be finite (a diverged leg makes the relΔ meaningless). */
async function recordAb(
  page: Page,
  testInfo: TestInfo,
  name: string,
  path: string,
  testId: string,
): Promise<Sphere> {
  const s = await runAndAwait(page, testInfo, name, path, testId);
  expect(s.diverged, `${name}: a storage leg diverged — relΔ is meaningless`).toBe(false);
  // relΔ vs the 2% bar is RECORDED (attached above), not asserted — see the file header.
  return s;
}

/** A single run must be finite, converged, and lateral-symmetric — the mechanical gates. */
async function recordRun(
  page: Page,
  testInfo: TestInfo,
  name: string,
  path: string,
  testId: string,
): Promise<Sphere> {
  const s = await runAndAwait(page, testInfo, name, path, testId);
  expect(s.diverged, `${name}: solver diverged`).toBe(false);
  expect(
    s.driftPct,
    `${name}: running mean not converged (drift ${s.driftPct?.toFixed(2)}%)`,
  ).toBeLessThan(3);
  // Cd vs the literature band is RECORDED (attached above), not asserted — see the header.
  return s;
}

test('Re=1000 FP16 vs FP32 A/B (converged, tc=120) — relΔ recorded', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  // tc=120: both legs must converge before the A/B is meaningful. The default tc=40 A/B
  // compared two still-climbing means (fp32 0.509, fp16 0.570) and spuriously read 11.8%.
  await recordAb(page, testInfo, 'sphere-re1000-ab', '/?spheredrag&tc=120', 'sphere-ab-Re1000');
});

test('Re=100 FP16 A/B (tc=100) — relΔ recorded (steady wake, converged)', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  await recordAb(page, testInfo, 'sphere-re100-ab', '/?spheredrag&tc=100', 'sphere-ab-Re100');
});

test('Re=1000 converged run (tc=120) — Cd + drift recorded', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  await recordRun(page, testInfo, 'sphere-re1000-run', '/?spheredrag&tc=120', 'sphere-run-Re1000');
});

test('Re=10⁴ with H11 free-slip far field — Cd/band verdict recorded', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  const s = await recordRun(
    page,
    testInfo,
    'sphere-re10000-freeslip',
    '/?spheredrag&lateral=freeslip',
    'sphere-run-Re10000',
  );
  await testInfo.attach('sphere-re10000-freeslip-verdict', {
    body:
      `Re=10⁴ free-slip: mean Cd ${s.meanCd?.toFixed(4)}, band [${s.band?.[0]}, ${s.band?.[1]}], ` +
      `inBand ${s.inBand}. Freestream baseline is Cd≈0.55 (over the top); free-slip lands ` +
      `${s.inBand ? 'in band' : 'under the bottom'} — the two lateral BCs bracket the band ` +
      `from opposite sides, so the residual error is unresolved boundary layer (uniform ` +
      `grid), not confinement. Free-slip is a tried-and-rejected far field, not a fix.`,
    contentType: 'text/plain',
  });
});
