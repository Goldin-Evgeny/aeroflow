import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

/**
 * M9 force audit, phases 2–3 — the empty-tunnel control, now run as a far-field A/B.
 *
 * Phase 1 showed the residual Cd ≈ 1.2 is shared by both solver implementations, so it is
 * not a kernel defect. Phase 2 asked the next cheapest question — is the acceptance tunnel
 * itself clean at τ₀ ≈ 0.5000 with no body in it? — and answered "numerically yes, physically
 * not neutral": a grid-independent ~1.3% inlet→outlet flux mismatch that global mass
 * conservation nonetheless absorbed, which is only possible if the hard-Dirichlet `Inlet`
 * top/side cells are sourcing it.
 *
 * Phase 3 runs the same tunnel twice, changing ONLY the top/side boundary condition:
 * hard-Dirichlet (every Ahmed number on record) against the H11 free-slip the M9 spec actually
 * calls for. Both arms are judged by the IDENTICAL bounds — no arm-specific thresholds, no
 * weakened gate (hard rule 3).
 *
 * Diagnostic, not a convergence campaign — it fails only on O(1)-class pathology.
 */
test('Ahmed empty-tunnel control is clean at the acceptance τ₀, both far fields', async ({
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
      `--- [${run.lateralBC}] ${run.nx}×${run.ny}×${run.nz} (${run.cells} cells), dx=${(run.dx * 1e3).toFixed(2)} mm, ` +
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
    parts.push(
      'time:  T_conv  massDrift  rhoMin  rhoMax  uMax  Ma  fluxMismatch  latNet/in  NaN',
    );
    for (const s of run.samples) {
      parts.push(
        `  ${s.tConv.toFixed(2).padStart(7)}  ${s.field.massDriftRel.toExponential(2)}  ` +
          `${s.field.rhoMin.toFixed(6)}  ${s.field.rhoMax.toFixed(6)}  ` +
          `${s.field.uMax.toFixed(6)}  ${s.field.machMax.toFixed(4)}  ` +
          `${s.fluxMismatch.toExponential(2)}  ${s.lateralNetOverInflow.toExponential(2)}  ` +
          `${s.field.nonFiniteCells}`,
      );
    }
    const last = run.samples.at(-1);
    if (last) {
      parts.push(
        `lateral flux (outward, last sample): top=${last.lateral.top.toExponential(3)} ` +
          `zMin=${last.lateral.zMin.toExponential(3)} zMax=${last.lateral.zMax.toExponential(3)} ` +
          `net=${last.lateral.net.toExponential(3)}  ` +
          `[ground layer u_y=${last.lateral.groundLayerUy.toExponential(3)}, EXCLUDED — a ` +
          `bounce-back wall passes no mass] ` +
          `(cells: top=${last.lateral.cells.top} zMin=${last.lateral.cells.zMin} ` +
          `zMax=${last.lateral.cells.zMax} groundLayer=${last.lateral.cells.groundLayer})`,
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

  // Both arms must actually have run. Without this, a harness that silently fell back to one
  // far field would still print a PASS and an "A/B" section with nothing in it — and the
  // deliverable of phase 3 is the comparison, not either arm on its own.
  const arms = new Set(r.runs.map((run) => run.lateralBC));
  expect([...arms].sort(), 'both far fields must be exercised').toEqual([
    'freeslip',
    'freestream',
  ]);
  for (const cells of new Set(r.runs.map((run) => run.cells))) {
    expect(
      r.runs.filter((run) => run.cells === cells).length,
      `tier ${cells} must contribute a matched pair`,
    ).toBe(2);
  }

  expect(r.pass).toBe(true);
});
