import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * M9 force audit, phase 2 — the empty-tunnel control.
 *
 * Phase 1 showed the residual Cd ≈ 1.2 is shared by both solver implementations, so it is
 * not a kernel defect. This asks the next cheapest question: is the acceptance tunnel itself
 * clean at τ₀ ≈ 0.5000 with no body in it? A Cd is normalized by a commanded velocity and a
 * frontal area, so a tunnel that does not conserve mass, does not hold ρ ≈ 1, or does not
 * deliver u ≈ u_in invalidates every Cd on record regardless of resolution.
 *
 * Diagnostic, not a convergence campaign — it fails only on O(1)-class pathology.
 */
test('Ahmed empty-tunnel control is clean at the acceptance τ₀', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(900_000);
  await page.goto(`${BASE_URL}/?emptytunnel`);
  await expect
    .poll(
      async () => {
        const h = await readHooks(page);
        return h.emptyTunnel ?? h.emptyTunnelError;
      },
      { timeout: 780_000 },
    )
    .toBeTruthy();

  const h = await readHooks(page);
  expect(h.emptyTunnelError, `harness threw: ${h.emptyTunnelError}`).toBeUndefined();
  const r = h.emptyTunnel!;

  const parts: string[] = [...r.lines, ''];
  for (const run of r.runs) {
    parts.push(
      `--- ${run.nx}×${run.ny}×${run.nz} (${run.cells} cells), dx=${(run.dx * 1e3).toFixed(2)} mm, ` +
        `Re=${run.Re.toExponential(3)}, u=${run.uLattice}, Ma=${run.mach.toFixed(4)}, ` +
        `τ₀=${run.tau0.toFixed(9)}, ν=${run.nu.toExponential(4)}, ` +
        `L=${run.lengthCells.toFixed(1)} cells, T_conv=${run.convectiveTimeSteps}, ` +
        `body=${run.bodyVoxels} voxels / frontal=${run.frontalCells} ---`,
    );
    parts.push('streamwise:  x  meanRho  bulkUx  coreUx  massFlux  nonUnif  d99');
    for (const s of run.streamwise) {
      parts.push(
        `  ${String(s.x).padStart(4)}  ${s.meanRho.toFixed(6)}  ${s.bulkUx.toFixed(6)}  ` +
          `${s.coreMeanUx.toFixed(6)}  ${s.massFlux.toExponential(4)}  ` +
          `${s.nonUniformity.toFixed(4)}  ${s.blThicknessCells}`,
      );
    }
    parts.push('time:  T_conv  massDrift  rhoMin  rhoMax  uMax  Ma  fluxMismatch  NaN');
    for (const s of run.samples) {
      parts.push(
        `  ${s.tConv.toFixed(2).padStart(7)}  ${s.field.massDriftRel.toExponential(2)}  ` +
          `${s.field.rhoMin.toFixed(6)}  ${s.field.rhoMax.toFixed(6)}  ` +
          `${s.field.uMax.toFixed(6)}  ${s.field.machMax.toFixed(4)}  ` +
          `${s.fluxMismatch.toExponential(2)}  ${s.field.nonFiniteCells}`,
      );
    }
    parts.push(
      `period-2 probe (16 consecutive steps): ` +
        `mass stagger=${run.stagger.staggerTotalMass.toExponential(2)} cv=${run.stagger.cvTotalMass.toExponential(2)}; ` +
        `rhoMean stagger=${run.stagger.staggerRhoMean.toExponential(2)} cv=${run.stagger.cvRhoMean.toExponential(2)}; ` +
        `uMax stagger=${run.stagger.staggerUMax.toExponential(2)} cv=${run.stagger.cvUMax.toExponential(2)}`,
    );
    parts.push('');
  }
  const summary = parts.join('\n');
  await testInfo.attach('ahmed-empty-tunnel', { body: summary, contentType: 'text/plain' });
  console.log(`\n${summary}\n`);

  expect(r.gpuErrors).toEqual([]);
  for (const run of r.runs) expect(run.worst.nonFiniteCells).toBe(0);
  expect(r.pass).toBe(true);
});
