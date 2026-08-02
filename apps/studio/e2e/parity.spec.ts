import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * CPU↔GPU parity (docs/handoff/H6-parity-panel.md) at the reduced `quick` slice: both scenes,
 * the original four H6 configs, and all four H10 regularization compositions, N=10 / gate 1e-5.
 *
 * ## Was `fixme` for a SwiftShader device loss; re-enabled 2026-07-28
 *
 * The assertions below never changed — the environment did. Under SwiftShader this threw on
 * the very first matrix cell (`bgk N=10`, ~0.5 s in) with `mapAsync: A valid external
 * Instance reference no longer exists`: the device was lost ~230 ms into boot on every route
 * that builds a 2D `Lbm2D`, with no interaction at all. (The earlier "the matrix is too slow
 * for a 300 s timeout" diagnosis was wrong; it was never slow, it was dead.) The suspected
 * trigger — the D2Q9 kernel's pipeline creation under SwiftShader — was never root-caused,
 * and is now moot for Tier A: since 2026-07-28 Tier A runs on the real adapter, where the
 * device survives and this passes.
 *
 * That fault is a property of SwiftShader, not of the kernel, so it is still expected to
 * reproduce under `npm run test:e2e:swiftshader`. **No gate was weakened** (CLAUDE.md rule 3):
 * `quick` runs a subset of the published gates at their published values.
 */
test('CPU↔GPU parity matrix passes (quick slice)', async ({ page }, testInfo) => {
  await page.goto('/?dev&parityQuick');
  await page.getByTestId('parity-run').click();
  // Poll for EITHER outcome: a crashed run must fail with its reason, not as a bare timeout.
  await expect
    .poll(
      async () => {
        const h = await readHooks(page);
        return h.parityReport ?? h.parityError;
      },
      { timeout: 100_000 },
    )
    .toBeTruthy();
  const { parityReport, parityError, parityProgress } = await readHooks(page);
  expect(parityError, `parity threw at matrix cell "${parityProgress}"`).toBeUndefined();
  const report = parityReport!;
  await testInfo.attach('parity-summary', { body: report.summary, contentType: 'text/plain' });

  // The report must say which slice ran, so a quick PASS can never be read as the H6 gate.
  expect(report.summary).toContain('[quick]');
  // Both scenes × sixteen collision configs still covered — only the step counts shrank.
  expect(report.results).toHaveLength(32);
  for (const c of report.results) {
    expect(c.runs, `${c.key} should run only the N=10 gate`).toHaveLength(1);
    for (const run of c.runs) {
      expect(run.n).toBe(10);
      expect(run.maxFErr, `${c.key} N=${run.n}`).toBeLessThanOrEqual(run.gate);
    }
  }
  expect(report.pass).toBe(true);
});
