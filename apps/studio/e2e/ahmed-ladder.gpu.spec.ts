import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';
import type { AhmedDiagnostics, AhmedSceneSummary, AhmedWorkerEvent } from '../src/sim/ahmedRun';

/**
 * M9 acceptance-1 harness: the resolution / effective-Re ladder, plus the two diagnostics
 * that decide what its numbers mean.
 *
 * The ladder itself exists because the only Ahmed Cd on record was ≈7.6 at the 2M smoke
 * tier, attributed to under-resolution — an argument, not a measurement. Running the SAME
 * geometry and force pipeline at Reynolds numbers the grid resolves turned it into one, and
 * falsified the attribution: Cd got *worse* with resolution, and the real cause was the
 * force accounting fixed by `CellType.BodySolid`.
 *
 * Two things are measured alongside Cd now:
 *
 * 1. **Approach flow.** Cd is normalized by the COMMANDED lattice velocity, which only
 *    means something if the flow reaches it — and this scene still uses the plain
 *    equilibrium `Inlet` that M10 measured settling at 0.660·u_in. Each rung reports
 *    whole-section mass-flux and boundary-layer-excluded core velocities at three upstream
 *    stations. `cdCommanded` stays the acceptance coefficient; `cdBulk`/`cdCore` are
 *    diagnostics. Cd ∝ 1/U², so picking the flattering denominator would be exactly the
 *    tolerance-shopping hard rule 3 forbids.
 *
 * 2. **Whether "converged" means anything.** `isConverged(20, 3%)` fires on a running-mean
 *    drift, and the first ladder saw every rung stop at 1.73–2.97% — clustered just under
 *    the gate, with σ≈1.0 against a mean of 4.0. That is how M7's Cd 0.509 was recorded and
 *    later struck ("premature: read off a running mean still climbing"). So each rung now
 *    continues past the first trigger and compares INDEPENDENT block means: if consecutive
 *    blocks disagree by more than the gate claims, the trigger was noise.
 *
 * Nothing here asserts a Cd band — at any Re but the experimental one there is none, and
 * the page suppresses its verdict for that reason.
 */

const RUNGS = (process.env.AHMED_RUNGS ?? '8000000@1000')
  .split(',')
  .map((spec) => spec.trim())
  .filter(Boolean)
  .map((spec) => {
    const [cells, Re] = spec.split('@').map(Number);
    if (!Number.isFinite(cells) || !Number.isFinite(Re) || cells <= 0 || Re <= 0) {
      throw new Error(`AHMED_RUNGS entry "${spec}" is not <cells>@<Re>`);
    }
    return { cells, Re };
  });

const RUNG_BUDGET_MS = Number(process.env.AHMED_RUNG_BUDGET_MS ?? 30 * 60_000);
/** Convective times to keep running AFTER the first 3% trigger (spec asks for 20–40). */
const EXTRA_TCONV = Number(process.env.AHMED_EXTRA_TCONV ?? 40);
/** Width of each independent block mean, in convective times. */
const BLOCK_TCONV = Number(process.env.AHMED_BLOCK_TCONV ?? 20);

type Sample = Extract<AhmedWorkerEvent, { type: 'sample' }>;
type Ready = Extract<AhmedWorkerEvent, { type: 'ready' }>;

const events = (h: AeroflowHooks): AhmedWorkerEvent[] =>
  (h.ahmedEvents ?? []) as AhmedWorkerEvent[];
const samples = (h: AeroflowHooks): Sample[] =>
  events(h).filter((e): e is Sample => e.type === 'sample');

function sceneLine(scene: AhmedSceneSummary): string {
  return (
    `grid ${scene.nx}×${scene.ny}×${scene.nz} = ${(scene.totalCells / 1e6).toFixed(2)}M   ` +
    `dx ${scene.dxMm.toFixed(2)} mm   body ${scene.lengthCells.toFixed(0)} cells   ` +
    `blockage ${(scene.blockage * 100).toFixed(2)}%   frontal ${scene.frontalCells} cells²   ` +
    `Re ${scene.Re.toExponential(2)}   τ ${scene.tau.toFixed(6)}   ` +
    `T_conv ${scene.convectiveTimeSteps} steps   noseX ${scene.noseX}   U ${scene.physU.toFixed(1)} m/s`
  );
}

/**
 * Independent (non-overlapping) block means of the INSTANTANEOUS Cd, over samples taken
 * after the first convergence trigger. Independent blocks are the point: a running mean
 * cannot disagree with itself, but consecutive block means can, and that disagreement is
 * the honest statistical error bar.
 */
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
  // The trailing remainder is NOT a block: it spans less than blockTConv, so its mean has
  // a different (larger) sampling error and comparing it against full blocks manufactures
  // spread. Measured: a 2-T_conv / n=13 tail turned a genuine 2.43% into a reported
  // 14.52%, i.e. it inverted the verdict. Dropped, and its size is reported so the drop is
  // visible rather than silent.
  return { blocks, droppedSamples: n };
}

function diagnosticsLines(d: AhmedDiagnostics): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `  approach flow (u_commanded ${d.uCommanded}):`,
    ...d.stations.map(
      (s) =>
        `    x=${String(s.x).padStart(4)}  (+${s.cellsFromInlet} from inlet, −${s.cellsToNose} to nose)  ` +
        `bulk ${s.bulkUx.toFixed(5)} (${pct(s.bulkUx / d.uCommanded)} of cmd)  ` +
        `core ${s.coreMeanUx.toFixed(5)} (${pct(s.coreMeanUx / d.uCommanded)})  ` +
        `area ${s.areaMeanUx.toFixed(5)}  ρ̄ ${s.meanRho.toFixed(5)}  ` +
        `flux ${s.massFlux.toExponential(3)}  nonunif ${s.nonUniformity.toFixed(3)}  ` +
        `δ99 y=${s.yCore} (${s.blThicknessCells} cells)`,
    ),
    `  Cd_commanded ${d.cdCommanded.toFixed(4)}  [ACCEPTANCE]   ` +
      `Cd_bulk ${d.cdBulk.toFixed(4)}   Cd_core ${d.cdCore.toFixed(4)}   (diagnostic only)`,
    `  Re_nominal ${d.reNominal.toExponential(2)}   Re_bulk ${d.reBulk.toExponential(2)}   ` +
      `Re_core ${d.reCore.toExponential(2)}   ref station x=${d.referenceStationX}`,
  ];
  return lines.join('\n');
}

test('M9 acceptance-1 ladder: Cd vs resolution and effective Re', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(RUNGS.length * (RUNG_BUDGET_MS + 120_000));

  const rows: string[] = [];

  for (const rung of RUNGS) {
    await page.goto(`${BASE_URL}/?ahmed&cells=${rung.cells}&Re=${rung.Re}`);
    const startedAt = Date.now();
    await page.getByTestId('ahmed-start').click();

    await expect
      .poll(async () => events(await readHooks(page)).map((e) => e.type), { timeout: 300_000 })
      .toContain('ready');
    const scene = (events(await readHooks(page)).find((e) => e.type === 'ready') as Ready).scene;

    // Phase 1 — run to the first isConverged(20, 3%) trigger.
    await expect
      .poll(
        async () => {
          const h = await readHooks(page);
          if (events(h).some((e) => e.type === 'error')) return 'error';
          return samples(h).some((s) => s.converged) ? 'triggered' : 'running';
        },
        { timeout: RUNG_BUDGET_MS, intervals: [5_000] },
      )
      .not.toBe('running');

    let h = await readHooks(page);
    const errored = () =>
      events(h).find((e) => e.type === 'error') as
        Extract<AhmedWorkerEvent, { type: 'error' }> | undefined;
    const trigger = samples(h).find((s) => s.converged);

    // Phase 2 — keep going EXTRA_TCONV past the trigger, so independent blocks exist.
    if (trigger && !errored()) {
      const target = trigger.convectiveTimes + EXTRA_TCONV;
      await expect
        .poll(
          async () => {
            const hh = await readHooks(page);
            if (events(hh).some((e) => e.type === 'error')) return Number.POSITIVE_INFINITY;
            return samples(hh).at(-1)?.convectiveTimes ?? 0;
          },
          { timeout: RUNG_BUDGET_MS, intervals: [5_000] },
        )
        .toBeGreaterThanOrEqual(target);
      h = await readHooks(page);
    }

    // Diagnostics last, so the approach flow is measured on the settled field.
    let diagnostics: AhmedDiagnostics | undefined;
    if (!errored()) {
      await page.getByTestId('ahmed-diag').click();
      await expect
        .poll(
          async () => {
            const hh = await readHooks(page);
            return events(hh).some((e) => e.type === 'diagnostics');
          },
          { timeout: 300_000, intervals: [2_000] },
        )
        .toBe(true);
      h = await readHooks(page);
      diagnostics = (
        [...events(h)].reverse().find((e) => e.type === 'diagnostics') as
          Extract<AhmedWorkerEvent, { type: 'diagnostics' }> | undefined
      )?.diagnostics;
    }

    const all = samples(h);
    const final = all.at(-1);
    const post = trigger ? all.filter((s) => s.convectiveTimes > trigger.convectiveTimes) : [];
    const { blocks, droppedSamples } = blockMeans(post, BLOCK_TCONV);
    const blockVals = blocks.map((b) => b.mean);
    const spread =
      blockVals.length > 1
        ? (Math.max(...blockVals) - Math.min(...blockVals)) /
          Math.abs(blockVals.reduce((a, b) => a + b, 0) / blockVals.length)
        : NaN;
    const wallMin = (Date.now() - startedAt) / 60_000;

    const err = errored();
    rows.push(
      `### ${(rung.cells / 1e6).toFixed(1)}M cells @ Re ${rung.Re.toExponential(2)}\n` +
        `${sceneLine(scene)}\n` +
        (err
          ? `ERROR: ${err.message}\n`
          : `steps ${final?.totalSteps.toLocaleString()}   ${final?.convectiveTimes.toFixed(1)} T_conv   ` +
            `${final?.mlups.toFixed(0)} MLUPs   wall ${wallMin.toFixed(1)} min\n` +
            `mean Cd ${final?.meanCd.toFixed(4)} ± ${final?.stdCd.toFixed(4)}   ` +
            `drift ${((final?.drift ?? NaN) * 100).toFixed(2)}%   drag ${final?.meanNewtons.toFixed(1)} N\n` +
            `  first 3% trigger at ${trigger?.convectiveTimes.toFixed(1)} T_conv, ` +
            `Cd ${trigger?.meanCd.toFixed(4)}; ran ${EXTRA_TCONV} T_conv further\n` +
            `  independent ${BLOCK_TCONV}-T_conv block means (${blocks.length} complete` +
            `${droppedSamples > 0 ? `, ${droppedSamples} trailing samples dropped as a partial block` : ''}): ` +
            `${blocks.map((b) => `${b.mean.toFixed(4)} [${b.t0.toFixed(0)}–${b.t1.toFixed(0)}, n=${b.n}]`).join('  ')}\n` +
            `  block spread ${(spread * 100).toFixed(2)}% — ` +
            (Number.isFinite(spread)
              ? spread > 0.03
                ? 'ABOVE the 3% gate: independent blocks disagree by more than the ' +
                  'convergence criterion claims, so the trigger was noise, not convergence'
                : 'within the 3% gate: independent blocks agree, so the trigger holds up'
              : 'not enough post-trigger blocks to judge') +
            `\n` +
            (diagnostics ? `${diagnosticsLines(diagnostics)}\n` : '')),
    );

    await testInfo.attach(`ahmed-${(rung.cells / 1e6).toFixed(1)}M-Re${rung.Re}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.getByTestId('ahmed-stop').click();

    expect(err, `rung ${rung.cells}@${rung.Re} errored`).toBeUndefined();
  }

  const summary = rows.join('\n');
  await testInfo.attach('ahmed-ladder', { body: summary, contentType: 'text/plain' });
  console.log(`\n${summary}\n`);
});
