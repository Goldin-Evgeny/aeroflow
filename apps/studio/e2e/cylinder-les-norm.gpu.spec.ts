import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { Page, TestInfo } from '@playwright/test';

/**
 * fix-confirmed-physics-defects, task 6.7: the Smagorinsky closure A/B on V5/V6 — design.md's
 * D6 names V5 (cylinder Re=200, LES) the stability canary, because the closure fix REMOVES
 * 19-41% of the eddy viscosity at an operating point where the subgrid model supplies
 * essentially all of it. No GPU e2e automation existed for the cylinder cases before this —
 * they were dev-panel-only (`?dev`, buttons `cyl-re200`/`v6-les`). This spec drives that same
 * panel headlessly so the canary can actually run under both `lesNorm` conventions.
 *
 * POLICY — record, don't gate: same discipline as spheredrag.gpu.spec.ts. The M4/M5
 * acceptance verdicts (`hooks().m4.pass`) are attached and printed for the human read, but
 * this spec only hard-asserts that neither leg diverged (a NaN/Inf force series makes the
 * comparison meaningless) — CLAUDE.md rule 3, never weaken a tolerance, and never fake a
 * green either. Task 6.8/6.9 (flip the default, or record a destabilization finding) reads
 * these results and decides; this spec does not decide for them.
 */

type M4 = NonNullable<Awaited<ReturnType<typeof readHooks>>['m4']>;

async function runM4Case(
  page: Page,
  testInfo: TestInfo,
  name: string,
  lesNorm: 'spec' | 'legacy',
  testId: 'cyl-re200' | 'v6-les',
  pollMinutes: number,
): Promise<M4> {
  await page.goto(`${BASE_URL}/?dev&lesNorm=${lesNorm}`);
  await page.evaluate(() => {
    delete (window as unknown as { __aeroflow?: { m4?: unknown } }).__aeroflow?.m4;
  });
  await page.getByTestId(testId).click();
  await expect
    .poll(async () => (await readHooks(page)).m4, { timeout: pollMinutes * 60_000 })
    .toBeTruthy();
  const m4 = (await readHooks(page)).m4!;
  await testInfo.attach(name, { body: m4.summary, contentType: 'text/plain' });
  console.log(`\n=== ${name} (lesNorm=${lesNorm}) ===\n${m4.summary}\n`);
  return m4;
}

test('V5 cylinder Re=200 (LES) — lesNorm=legacy', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(45 * 60_000);
  const m4 = await runM4Case(page, testInfo, 'v5-re200-legacy', 'legacy', 'cyl-re200', 40);
  expect(m4.summary, 'V5 legacy: force series must stay finite').not.toContain('NaN');
});

test('V5 cylinder Re=200 (LES) — lesNorm=spec', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(45 * 60_000);
  const m4 = await runM4Case(page, testInfo, 'v5-re200-spec', 'spec', 'cyl-re200', 40);
  expect(
    m4.summary,
    'V5 spec: force series must stay finite — the closure fix removes 19-41% of eddy ' +
      'viscosity at this operating point, so a divergence here is a real destabilization ' +
      'finding (design.md risk), not a harness bug. Record it, do not raise Cs to compensate.',
  ).not.toContain('NaN');
});

test('V6 Re=100 ±LES non-interference — lesNorm=legacy', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(45 * 60_000);
  const m4 = await runM4Case(page, testInfo, 'v6-les-legacy', 'legacy', 'v6-les', 40);
  expect(m4.summary, 'V6 legacy: force series must stay finite').not.toContain('NaN');
});

test('V6 Re=100 ±LES non-interference — lesNorm=spec', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(45 * 60_000);
  const m4 = await runM4Case(page, testInfo, 'v6-les-spec', 'spec', 'v6-les', 40);
  expect(m4.summary, 'V6 spec: force series must stay finite').not.toContain('NaN');
});
