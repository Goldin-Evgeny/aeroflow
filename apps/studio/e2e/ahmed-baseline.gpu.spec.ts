import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * M9/V11 — cheap smoke test for the H11+H12+H14 boundary configuration with the Ahmed body
 * present, before the expensive 2M real-GPU experiment.
 *
 * **This does not decide which configuration V11 uses.** H11 (free-slip), H12 (velocity
 * inlet) and H14 (pressure outlet) are independently validated already (empty tunnel + small
 * A/Bs); what has never run is all three together with a body. This test exists only to catch
 * a construction mistake (crash, non-finite population, an H4 §10.9 violation, a CPU/GPU
 * trajectory mismatch specific to this combination) at 30k cells before spending the 2M tier —
 * never to select a "winning" BC by which arm's Cd sits closer to 0.285
 * (`ahmedRun.ts:372-388` documents exactly this trap on the analogous sphere case).
 *
 * Both arms change three BCs at once, so unlike `ahmed-lateral.gpu.spec.ts`'s isolated
 * lateral-only A/B, a moved effective Reynolds number (`reConfound`) is not asserted false
 * here — it is expected and reported, not a stop condition, since H12 specifically exists to
 * remove the inlet-sag confound the lateral-only A/B found.
 */
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'phase3c');

test('Ahmed BC-baseline A/B: historical vs H11+H12+H14, body present (smoke test)', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(900_000);
  await page.goto(`${BASE_URL}/?ahmedbaseline`);
  await expect
    .poll(
      async () => {
        const h = await readHooks(page);
        return h.ahmedBaselineAB ?? h.ahmedBaselineAbError;
      },
      { timeout: 780_000 },
    )
    .toBeTruthy();

  const h = await readHooks(page);
  expect(h.ahmedBaselineAbError, `harness threw: ${h.ahmedBaselineAbError}`).toBeUndefined();
  const r = h.ahmedBaselineAB!;

  const summary = [
    ...r.lines,
    '',
    '--- historical arm: full configuration ---',
    ...Object.entries(r.historical.solver).map(([k, v]) => `${k.padEnd(28)} ${v}`),
    '',
    '--- historical arm ---',
    ...r.historical.lines,
    '',
    '--- H11+H12+H14 arm: full configuration ---',
    ...Object.entries(r.validated.solver).map(([k, v]) => `${k.padEnd(28)} ${v}`),
    '',
    '--- H11+H12+H14 arm ---',
    ...r.validated.lines,
    '',
    `wall time ${(r.ms / 1000).toFixed(1)} s`,
  ].join('\n');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'ahmed-baseline-ab.txt'), summary);
  await testInfo.attach('ahmed-baseline-ab', { body: summary, contentType: 'text/plain' });
  console.log(`\n${summary}\n`);

  expect(r.historical.gpuErrors).toEqual([]);
  expect(r.validated.gpuErrors).toEqual([]);
  expect(r.historical.lateralBC).toBe('freestream');
  expect(r.historical.inletBC).toBe('equilibrium');
  expect(r.historical.outlet).toBe('zero-gradient');
  expect(r.validated.lateralBC).toBe('freeslip');
  expect(r.validated.inletBC).toBe('velocity');
  expect(r.validated.outlet).toBe('pressure');

  // The two arms must be the same case apart from the BCs under test — otherwise the
  // comparison is between two different problems, not one configuration change.
  expect(r.validated.scene.cells).toBe(r.historical.scene.cells);
  expect(r.validated.scene.frontalCells).toBe(r.historical.scene.frontalCells);
  expect(r.validated.scene.bodyVoxels).toBe(r.historical.scene.bodyVoxels);
  expect(r.validated.scene.tau0).toBeCloseTo(r.historical.scene.tau0, 12);

  // Mechanical health, both arms, by the same standard — construction-mistake guards only.
  for (const arm of [r.historical, r.validated]) {
    expect(arm.diagnostics.field.nonFiniteCells, `${arm.lateralBC} went non-finite`).toBe(0);
  }

  // CPU/GPU trajectory parity must hold for the never-before-run H11+H12+H14+body
  // combination, same as it already does for the historical configuration.
  expect(r.historical.trajectoryPass).toBe(true);
  expect(r.validated.trajectoryPass, 'CPU<->GPU trajectory parity under H11+H12+H14').toBe(true);

  // Deliberately NOT asserted: r.reConfound, or any Cd value against any band. See the module
  // docstring — this is a construction smoke test, not a BC-selection or accuracy gate.
});
