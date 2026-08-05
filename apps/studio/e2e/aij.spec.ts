import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * M10 ?aij page on SwiftShader (Tier A): pipeline correctness only — a tiny grid
 * (?b=4 → cells-per-b override) proves the scene builds, the run advances, the
 * averager reaches windowed means, and each mode produces its structured readout.
 * Physics acceptance (real grid, gates) runs on real GPUs via the Tier B suite.
 */

test.describe('?aij Case A page', () => {
  test('score mode: run advances, windows accumulate, q/r reported', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await page.goto('/?aij&b=4');
    // The real Meng & Hibi fixture ships again as of 2026-08-05, so the synthetic banner
    // must be GONE — if it returns, the fixture was replaced by a placeholder.
    await expect(page.getByTestId('aij-synthetic-warning')).toHaveCount(0);
    await page.getByTestId('aij-score').click();
    await expect
      .poll(async () => (await readHooks(page)).aij?.windows ?? 0, { timeout: 8 * 60_000 })
      .toBeGreaterThanOrEqual(2);
    const aij = (await readHooks(page)).aij!;
    expect(aij.mode).toBe('score');
    expect(aij.synthetic).toBe(false);
    // ?b=4 is far below the spec's 16 cells/b — real data, but still no verdict.
    expect(aij.underResolved).toBe(true);
    expect(aij.q).toBeGreaterThanOrEqual(0);
    expect(aij.q).toBeLessThanOrEqual(1);
    expect(aij.r).toBeGreaterThanOrEqual(-1);
    expect(aij.r).toBeLessThanOrEqual(1);
    expect(Number.isFinite(aij.drift)).toBe(true);
    // Convergence trace: one entry per completed window, step count strictly increasing.
    // Tier B reads this to set its poll budget from data, so it must actually populate.
    expect(aij.trace!.length).toBe(aij.windows);
    expect(aij.trace!.map((s) => s.steps)).toEqual(
      [...aij.trace!.map((s) => s.steps)].sort((x, y) => x - y),
    );
    // An under-resolved run must never produce a PASS/FAIL verdict (Hard rule 5).
    await expect(page.getByTestId('aij-verdict')).toContainText('UNDER-RESOLVED');
  });

  test('fetch mode reports the profile-deviation readout', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await page.goto('/?aij&b=4');
    await page.getByTestId('aij-fetch').click();
    await expect
      .poll(async () => (await readHooks(page)).aij?.fetchMaxRel, { timeout: 8 * 60_000 })
      .toBeDefined();
    const aij = (await readHooks(page)).aij!;
    expect(aij.mode).toBe('fetch');
    expect(aij.fetchMaxRel).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(aij.fetchMaxRel!)).toBe(true);
  });

  test('demo: editing α redraws the preview and the dial restarts the run', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await page.goto('/?aij&b=4');
    await expect
      .poll(async () => (await readHooks(page)).aij?.previewUMax ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(0);
    const u0 = (await readHooks(page)).aij!.previewUMax!;
    // α 0.25 → 0.15 flattens the power law: preview max over 3·zRef must DROP.
    await page.getByTestId('aij-alpha').fill('0.15');
    await expect
      .poll(async () => (await readHooks(page)).aij?.previewUMax ?? Infinity)
      .toBeLessThan(u0);
    await page.getByTestId('aij-demo').click();
    await expect
      .poll(async () => (await readHooks(page)).aij?.totalSteps ?? 0, { timeout: 8 * 60_000 })
      .toBeGreaterThan(0);
    const beforeId = (await readHooks(page)).aij!.runId!;
    // Dragging the dial restarts the run (geometry rotates; runId increments — fill()
    // itself fires `input`, possibly more than once).
    await page.getByTestId('aij-dial').fill('45');
    await expect
      .poll(async () => (await readHooks(page)).aij?.runId ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(beforeId);
    // ...and the latest restarted run advances on the rotated geometry.
    const afterId = (await readHooks(page)).aij!.runId!;
    await expect
      .poll(
        async () => {
          const a = (await readHooks(page)).aij;
          return (a?.runId ?? 0) >= afterId ? (a?.totalSteps ?? 0) : 0;
        },
        { timeout: 8 * 60_000 },
      )
      .toBeGreaterThan(0);
  });
});
