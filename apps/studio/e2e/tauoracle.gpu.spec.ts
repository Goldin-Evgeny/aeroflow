import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * M9 step 6 gate: the τ_eff oracle must be validated before any τ_eff number is quoted.
 *
 * The oracle reconstructs the kernel's per-cell relaxation time from the raw DDF image, so it
 * can be silently wrong in three ways — the −w_i FP16 storage shift, the Esoteric Pull step
 * parity, and the plane→split-buffer routing. Each produces a field that looks like turbulence
 * rather than an error. This runs both checks on the real GPU:
 *
 *   A. moment identity against the kernel's own `write_macro` (exact up to summation order),
 *   B. τ_eff against the Float64 CPU reference's recorded value.
 */
test('τ_eff oracle reconstructs the kernel field', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await page.goto(`${BASE_URL}/?tauoracle`);

  await expect
    .poll(
      async () => {
        const hooks = await readHooks(page);
        if (hooks.tauOracleCheckError) throw new Error(hooks.tauOracleCheckError);
        return hooks.tauOracleCheck;
      },
      { timeout: 10 * 60_000 },
    )
    .toBeTruthy();

  const result = (await readHooks(page)).tauOracleCheck!;
  await testInfo.attach('tau-oracle-summary', {
    body: result.summary,
    contentType: 'text/plain',
  });
  console.log(`\n${result.summary}\n${result.worstMomentCell}\n`);

  // The scene must actually be exercised — a rest field would pass every tolerance below.
  expect(result.fluidCells).toBeGreaterThan(0);
  expect(result.nonFinite).toBe(0);
  expect(result.lesK).toBeGreaterThan(0);
  // No FreeSlip faces in this scene, so the oracle must have skipped nothing.
  expect(result.freeSlipAdjacentSkipped).toBe(0);

  // Check A — the decisive one. A wrong shift/parity/routing breaks this by O(1).
  expect(result.maxRhoRelError).toBeLessThan(1e-4);
  expect(result.momentPass).toBe(true);

  // Check B — the LES formula itself, against Float64.
  expect(result.tauPass).toBe(true);

  // τ_eff must be non-uniform, or the checks above are vacuous.
  expect(result.gpuTauMax).toBeGreaterThan(result.tau0 * 1.001);

  expect(result.pass).toBe(true);
});
