import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * M9 force audit, phase 3 stage B1 — the Ahmed body in both far fields, cheaply.
 *
 * Stage A showed what the empty tunnel does under each boundary condition. This puts the body
 * back in at the 30k-cell tier that phase 1 established CPU/GPU agreement on (rel ~8e-5), so a
 * screening answer costs ~1 minute instead of the ladder's half hour.
 *
 * ## Two things this test refuses to let happen
 *
 * 1. **A screening Cd being read as a converged one.** The window is 20 fixed samples with a
 *    measured sem of ±0.016. Convergence is a block-agreement stop and lives in the ladder;
 *    every field here is named `…Windowed` and every line says so. M7's struck Cd 0.509 is
 *    what reading a non-converged mean as a result looks like.
 *
 * 2. **Proceeding past a moved Reynolds number.** Free-slip removes the hard-Dirichlet cells
 *    that clamp the flow to u_in. If the core velocity moves, Re_eff moves with it (ν and τ₀
 *    are fixed by the scene) and the two arms are no longer the same flow — at which point the
 *    Cd delta is not attributable to the boundary condition and the expensive ladder must not
 *    be run on it. `reConfound` is asserted below, so this fails LOUDLY rather than producing
 *    an attractive, meaningless Cd shift.
 *
 * Not a convergence campaign, and no Cd band is asserted at any point.
 */
test('Ahmed lateral-BC A/B: both far fields run, and the effective Re holds', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(900_000);
  await page.goto(`${BASE_URL}/?ahmedlateral`);
  await expect
    .poll(
      async () => {
        const h = await readHooks(page);
        return h.ahmedLateralAB ?? h.ahmedLateralAbError;
      },
      { timeout: 780_000 },
    )
    .toBeTruthy();

  const h = await readHooks(page);
  expect(h.ahmedLateralAbError, `harness threw: ${h.ahmedLateralAbError}`).toBeUndefined();
  const r = h.ahmedLateralAB!;

  const summary = [
    ...r.lines,
    '',
    '--- freestream arm: full configuration ---',
    ...Object.entries(r.freestream.solver).map(([k, v]) => `${k.padEnd(28)} ${v}`),
    '',
    '--- freestream arm ---',
    ...r.freestream.lines,
    '',
    '--- free-slip arm: full configuration ---',
    ...Object.entries(r.freeslip.solver).map(([k, v]) => `${k.padEnd(28)} ${v}`),
    '',
    '--- free-slip arm ---',
    ...r.freeslip.lines,
    '',
    `wall time ${(r.ms / 1000).toFixed(1)} s`,
  ].join('\n');

  await testInfo.attach('ahmed-lateral-ab', { body: summary, contentType: 'text/plain' });
  console.log(`\n${summary}\n`);

  expect(r.freestream.gpuErrors).toEqual([]);
  expect(r.freeslip.gpuErrors).toEqual([]);
  expect(r.freestream.lateralBC).toBe('freestream');
  expect(r.freeslip.lateralBC).toBe('freeslip');

  // The two arms must be the same case. If the scene builder ever lets the far field perturb
  // the grid or the Cd normalization, the comparison is meaningless and every number above is
  // a comparison of two different problems.
  expect(r.freeslip.scene.cells).toBe(r.freestream.scene.cells);
  expect(r.freeslip.scene.frontalCells).toBe(r.freestream.scene.frontalCells);
  expect(r.freeslip.scene.bodyVoxels).toBe(r.freestream.scene.bodyVoxels);
  expect(r.freeslip.scene.tau0).toBeCloseTo(r.freestream.scene.tau0, 12);

  // Health, on both arms, by the same standard.
  for (const arm of [r.freestream, r.freeslip]) {
    expect(arm.diagnostics.field.nonFiniteCells, `${arm.lateralBC} went non-finite`).toBe(0);
  }

  // CPU/GPU agreement must survive the free-slip path too. Phase 1 closed this question for
  // the hard-Dirichlet far field; free-slip exercises a different gather in both solvers
  // (`freeSlipRead` / `resolveFreeSlipPull`), so it is a genuinely new claim.
  expect(r.freeslip.trajectoryPass, 'CPU↔GPU trajectory parity under free-slip').toBe(true);
  expect(r.freestream.trajectoryPass).toBe(true);

  // GATE 2. Not a quality bar — a stop condition. See the module docstring.
  expect(
    r.reConfound,
    'free-slip moved the effective Reynolds number: the arms are not the same flow, so the ' +
      'Cd delta is not attributable to the boundary condition. Do NOT run the converged ' +
      'ladder on this; the remedy is the H12 VelocityInlet as a separate variable.',
  ).toBe(false);
});
