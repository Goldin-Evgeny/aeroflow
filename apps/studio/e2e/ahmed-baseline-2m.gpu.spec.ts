import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';
import type {
  AhmedDiagnostics,
  AhmedSceneSummary,
  AhmedTauReport,
  AhmedWorkerEvent,
} from '../src/sim/ahmedRun';
import { blocksAgree, relSpread } from '@aeroflow/core';

/**
 * M9/V11, Stage 1 primary experiment — the H11+H12+H14 boundary configuration, body present,
 * at the ~2M tier and the nominal experimental Re = 4.29e6.
 *
 * This is the first time this exact combination has ever run at this scale. It does NOT
 * decide V11 by itself:
 *
 *  - It is judged by evidence, not by "is Cd inside [0.242, 0.328]" — see the two things this
 *    test reports separately and asserts neither of: (A) what Cd the solver produces, and
 *    (B) whether τ ≈ 0.5 / LES dominance makes comparing that Cd to the Re=4.29e6 experiment
 *    scientifically defensible in the first place (the Re-credibility question).
 *  - It does not escalate to 8M/15.7M itself. That is a separate, evidence-gated decision.
 *
 * Convergence uses the SAME rolling-block-agreement stop rule as `ahmed-ladder.gpu.spec.ts`
 * (`blocksAgree`/`relSpread` from `@aeroflow/core`, the tested primitives that rule lives in) —
 * not the worker's own live `isConverged(20, 3%)` flag, which only opens the observation
 * window and is known to fire on noise (see that file's module docstring).
 */
const RUN_BUDGET_MS = Number(process.env.AHMED_2M_BUDGET_MS ?? 30 * 60_000);
const BLOCK_TCONV = Number(process.env.AHMED_2M_BLOCK_TCONV ?? 20);
const MIN_BLOCKS = Number(process.env.AHMED_2M_MIN_BLOCKS ?? 4);
const BLOCK_GATE = 0.03;

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test-results',
  'phase3c',
);

type Sample = Extract<AhmedWorkerEvent, { type: 'sample' }>;
type Ready = Extract<AhmedWorkerEvent, { type: 'ready' }>;

const events = (h: AeroflowHooks): AhmedWorkerEvent[] =>
  (h.ahmedEvents ?? []) as AhmedWorkerEvent[];
const samples = (h: AeroflowHooks): Sample[] =>
  events(h).filter((e): e is Sample => e.type === 'sample');

const agrees = (blockVals: number[]): boolean =>
  blocksAgree(blockVals, { minBlocks: MIN_BLOCKS, gate: BLOCK_GATE });

/** Independent (non-overlapping) block means of the instantaneous Cd, same shape as the
 *  ladder's `blockMeans` — the trailing partial block is dropped, not compared as if full. */
function blockMeans(
  post: Sample[],
  blockTConv: number,
): { blocks: { t0: number; t1: number; mean: number; n: number }[]; droppedSamples: number } {
  if (post.length === 0) return { blocks: [], droppedSamples: 0 };
  const blocks: { t0: number; t1: number; mean: number; n: number }[] = [];
  let start = post[0].convectiveTimes;
  let sum = 0;
  let n = 0;
  let last = start;
  for (const s of post) {
    if (s.convectiveTimes - start >= blockTConv && n > 0) {
      blocks.push({ t0: start, t1: last, mean: sum / n, n });
      start = s.convectiveTimes;
      sum = 0;
      n = 0;
    }
    sum += s.cd;
    n++;
    last = s.convectiveTimes;
  }
  return { blocks, droppedSamples: n };
}

test('Ahmed V11 Stage 1: H11+H12+H14 body-present, 2M cells, Re=4.29e6', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(60 * 60_000);
  await page.goto(
    `${BASE_URL}/?ahmed&cells=2000000&Re=4.29e6&lesCs=0.1&precision=fp16` +
      `&lateralBC=freeslip&inletBC=velocity&outlet=pressure&fieldEvery=20`,
  );
  const startedAt = Date.now();
  await page.getByTestId('ahmed-start').click();

  await expect
    .poll(async () => events(await readHooks(page)).map((e) => e.type), { timeout: 300_000 })
    .toContain('ready');
  let h = await readHooks(page);
  const scene = (events(h).find((e) => e.type === 'ready') as Ready).scene as AhmedSceneSummary;

  // Requirement: verify the ACTUAL constructed configuration, not just what the URL asked
  // for. `ahmedWorker.ts`'s `summarize()` reads every field off the built scene, so this is
  // what the solver actually ran, not an echo of the request.
  expect(scene.lateralBC, 'scene did not build H11 free-slip').toBe('freeslip');
  expect(scene.inletBC, 'scene did not build H12 velocity inlet').toBe('velocity');
  expect(scene.outlet, 'scene did not build H14 pressure outlet').toBe('pressure');
  expect(scene.totalCells, 'grid materially off the ~2M tier').toBeGreaterThan(1_500_000);
  expect(scene.totalCells).toBeLessThan(2_500_000);
  expect(scene.Re, 'scene did not build the nominal experimental Re').toBeCloseTo(4.29e6, -3);
  expect(
    events(h).some((e) => e.type === 'resumed'),
    'run resumed from a checkpoint instead of starting fresh',
  ).toBe(false);

  // ── Run until independent blocks agree, or the budget runs out ─────────────────────────
  const errored = () =>
    events(h).find((e) => e.type === 'error') as
      | Extract<AhmedWorkerEvent, { type: 'error' }>
      | undefined;
  const triggerOf = (hh: AeroflowHooks): Sample | undefined =>
    samples(hh).find((s) => s.converged);

  const deadline = startedAt + RUN_BUDGET_MS;
  let stopReason: 'agreed' | 'budget' | 'budget-no-trigger' | 'diverged';
  for (;;) {
    h = await readHooks(page);
    if (errored()) {
      stopReason = 'diverged';
      break;
    }
    const all = samples(h);
    const trig = triggerOf(h);
    if (trig) {
      const post = all.filter((s) => s.convectiveTimes > trig.convectiveTimes);
      const { blocks } = blockMeans(post, BLOCK_TCONV);
      if (agrees(blocks.map((b) => b.mean))) {
        stopReason = 'agreed';
        break;
      }
    }
    if (Date.now() >= deadline) {
      stopReason = trig ? 'budget' : 'budget-no-trigger';
      break;
    }
    await page.waitForTimeout(5_000);
  }
  const simMs = Date.now() - startedAt;

  const stopBtn = page.getByTestId('ahmed-stop');
  if (await stopBtn.isEnabled()) {
    await stopBtn.click();
    await expect
      .poll(async () => events(await readHooks(page)).some((e) => e.type === 'stopped'), {
        timeout: 300_000,
        intervals: [1_000],
      })
      .toBe(true);
  }
  h = await readHooks(page);

  // Diagnostics (Cd normalization, approach flow, wake) and τ_eff (Re-credibility gate),
  // both on the SAME settled field — the run is stopped before either readback.
  let diagnostics: AhmedDiagnostics | undefined;
  if (!errored()) {
    await page.getByTestId('ahmed-diag').click({ timeout: 30_000 });
    await expect
      .poll(
        async () => events(await readHooks(page)).some((e) => e.type === 'diagnostics'),
        { timeout: 300_000, intervals: [2_000] },
      )
      .toBe(true);
    h = await readHooks(page);
    diagnostics = (
      [...events(h)].reverse().find((e) => e.type === 'diagnostics') as
        | Extract<AhmedWorkerEvent, { type: 'diagnostics' }>
        | undefined
    )?.diagnostics;
  }

  let tau: AhmedTauReport | undefined;
  if (!errored()) {
    await page.getByTestId('ahmed-tau').click({ timeout: 30_000 });
    await expect
      .poll(async () => events(await readHooks(page)).some((e) => e.type === 'tau'), {
        timeout: 900_000,
        intervals: [5_000],
      })
      .toBe(true);
    h = await readHooks(page);
    tau = (
      [...events(h)].reverse().find((e) => e.type === 'tau') as
        | Extract<AhmedWorkerEvent, { type: 'tau' }>
        | undefined
    )?.tau;
  }

  const all = samples(h);
  const trig = triggerOf(h);
  const post = trig ? all.filter((s) => s.convectiveTimes > trig.convectiveTimes) : [];
  const { blocks } = blockMeans(post, BLOCK_TCONV);
  const blockVals = blocks.map((b) => b.mean);
  const finalCd = blockVals.length > 0 ? blockVals.reduce((a, b) => a + b, 0) / blockVals.length : NaN;
  const spread = blockVals.length >= 2 ? relSpread(blockVals) : NaN;
  const lastTConv = all.at(-1)?.convectiveTimes ?? 0;

  const summary = {
    scene,
    stopReason,
    simMs,
    lastTConv,
    sampleCount: all.length,
    blockTConv: BLOCK_TCONV,
    blocks: blocks.map((b) => ({ t0: b.t0, t1: b.t1, mean: b.mean, n: b.n })),
    blocksAgreeAtStop: agrees(blockVals),
    finalCd,
    blockSpreadPct: spread * 100,
    diagnostics,
    tau,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'ahmed-baseline-2m.txt'), JSON.stringify(summary, null, 1));
  writeFileSync(
    resolve(OUT_DIR, 'ahmed-baseline-2m-samples.json'),
    JSON.stringify({ samples: all }, null, 1),
  );
  await testInfo.attach('ahmed-baseline-2m', {
    body: JSON.stringify(summary, null, 1),
    contentType: 'application/json',
  });

  const lines = [
    `V11 Stage 1: H11+H12+H14, body present, grid ${scene.nx}x${scene.ny}x${scene.nz} = ${scene.totalCells} cells`,
    `Re nominal ${scene.Re.toExponential(3)}   tau ${scene.tau.toFixed(9)}   precision ${scene.precision}   Cs ${scene.lesCs}`,
    `stop: ${stopReason}   sim time ${(simMs / 60000).toFixed(1)} min   last T_conv ${lastTConv.toFixed(1)}   samples ${all.length}`,
    `blocks (${BLOCK_TCONV} T_conv each): ${blockVals.map((v) => v.toFixed(4)).join(' ')}`,
    `final Cd (mean of blocks) = ${finalCd.toFixed(4)}   block spread = ${(spread * 100).toFixed(2)}%   agree@stop=${agrees(blockVals)}`,
    diagnostics
      ? `Cd_commanded ${diagnostics.cdCommanded.toFixed(4)}  Cd_bulk ${diagnostics.cdBulk.toFixed(4)}  Cd_core ${diagnostics.cdCore.toFixed(4)}`
      : 'diagnostics: none (errored before readback)',
    diagnostics
      ? `Re_nominal ${diagnostics.reNominal.toExponential(3)}  Re_bulk ${diagnostics.reBulk.toExponential(3)}  Re_core ${diagnostics.reCore.toExponential(3)}`
      : '',
    diagnostics
      ? `field: massDrift=${diagnostics.field.massDriftRel.toExponential(3)} rho=[${diagnostics.field.rhoMin.toFixed(6)},${diagnostics.field.rhoMax.toFixed(6)}] Ma=${diagnostics.field.machMax.toFixed(4)} nonFinite=${diagnostics.field.nonFiniteCells}`
      : '',
    tau
      ? `tau0 ${tau.tau0.toFixed(9)}  nu_mol ${tau.nuMolecular.toExponential(3)}  parity ${tau.parity}  nonFinite ${tau.nonFinite}`
      : 'tau: none',
    ...(tau
      ? tau.regions.map(
          (r) =>
            `  region ${r.name}: tau p50=${r.stats.tauPercentiles[3].toFixed(6)} p99=${r.stats.tauPercentiles[7].toFixed(6)} max=${r.stats.tauMax.toFixed(6)}  ` +
            `nu_LES/nu_mol p50=${r.stats.nuRatioPercentiles[3].toFixed(2)} p90=${r.stats.nuRatioPercentiles[5].toFixed(2)} max=${r.stats.nuRatioMax.toFixed(1)}  ` +
            `atFloor=${(r.stats.atFloorFraction * 100).toFixed(1)}% lesDominant=${(r.stats.lesDominantFraction * 100).toFixed(1)}%`,
        )
      : []),
  ]
    .filter(Boolean)
    .join('\n');
  console.log(`\n${lines}\n`);

  expect(events(h).map((e) => e.type)).not.toContain('error');
  if (diagnostics) expect(diagnostics.field.nonFiniteCells).toBe(0);
  if (tau) expect(tau.nonFinite).toBe(0);

  // Deliberately NOT asserted: finalCd against [0.242, 0.328], or blocksAgreeAtStop as a hard
  // requirement. This run is evidence for Stage 1 + the Re-credibility gate, not a gate itself
  // — see the module docstring. Escalation to 8M/15.7M is a separate, later decision.
});
