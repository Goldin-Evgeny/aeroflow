import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';
import type { AhmedSceneSummary, AhmedWorkerEvent } from '../src/sim/ahmedRun';

/**
 * M9 acceptance-1 harness: the resolution / effective-Re ladder.
 *
 * The only Ahmed Cd ever measured in this program was ≈7.6 at the 2M smoke tier, which
 * M9.md attributes to Re = 4.29e6 at τ = 0.500002 on a massively under-resolved grid. That
 * is an argument, not a measurement. This spec turns it into one: the SAME geometry, force
 * pipeline and normalization are run at Reynolds numbers the grid actually resolves, where
 * a bluff body's Cd is bounded and known to be O(0.3–1). If the low-Re rungs land there,
 * the pipeline is exonerated and the 7.6 is a resolution/Re artifact; if they do not, the
 * fault is upstream of resolution and `docs/DEBUGGING.md` applies before any headline run.
 *
 * Rungs are `cells@Re`, comma-separated, via AHMED_RUNGS. Each runs to
 * `isConverged(20, 3%)` — the same convergence rule the acceptance criterion names — or
 * fails loudly against AHMED_RUNG_BUDGET_MS. Nothing here asserts a Cd band: at any Re but
 * the experimental one there is no band to assert, and the page suppresses the verdict for
 * exactly that reason.
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

type Sample = Extract<AhmedWorkerEvent, { type: 'sample' }>;

const events = (h: AeroflowHooks): AhmedWorkerEvent[] => (h.ahmedEvents ?? []) as AhmedWorkerEvent[];
const lastSample = (h: AeroflowHooks): Sample | undefined =>
  [...events(h)].reverse().find((e): e is Sample => e.type === 'sample');

function sceneLine(scene: AhmedSceneSummary): string {
  return (
    `grid ${scene.nx}×${scene.ny}×${scene.nz} = ${(scene.totalCells / 1e6).toFixed(2)}M   ` +
    `dx ${scene.dxMm.toFixed(2)} mm   body ${scene.lengthCells.toFixed(0)} cells   ` +
    `blockage ${(scene.blockage * 100).toFixed(2)}%   frontal ${scene.frontalCells} cells²   ` +
    `Re ${scene.Re.toExponential(2)}   τ ${scene.tau.toFixed(6)}   ` +
    `T_conv ${scene.convectiveTimeSteps} steps   U ${scene.physU.toFixed(1)} m/s`
  );
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
    const ready = events(await readHooks(page)).find((e) => e.type === 'ready');
    const scene = (ready as Extract<AhmedWorkerEvent, { type: 'ready' }>).scene;

    // Converged, diverged, or errored — whichever comes first. A diverged/errored run is a
    // result too, so it is reported rather than retried.
    await expect
      .poll(
        async () => {
          const h = await readHooks(page);
          if (events(h).some((e) => e.type === 'error')) return 'error';
          return lastSample(h)?.converged ? 'converged' : 'running';
        },
        { timeout: RUNG_BUDGET_MS, intervals: [5_000] },
      )
      .not.toBe('running');

    const h = await readHooks(page);
    const errored = events(h).find((e) => e.type === 'error');
    const final = lastSample(h);
    const wallMin = (Date.now() - startedAt) / 60_000;

    rows.push(
      `### ${(rung.cells / 1e6).toFixed(1)}M cells @ Re ${rung.Re.toExponential(2)}\n` +
        `${sceneLine(scene)}\n` +
        (errored
          ? `ERROR: ${(errored as Extract<AhmedWorkerEvent, { type: 'error' }>).message}\n`
          : `steps ${final?.totalSteps.toLocaleString()}   ${final?.convectiveTimes.toFixed(1)} T_conv   ` +
            `${final?.mlups.toFixed(0)} MLUPs   wall ${wallMin.toFixed(1)} min\n` +
            `mean Cd ${final?.meanCd.toFixed(4)} ± ${final?.stdCd.toFixed(4)}   ` +
            `drift ${((final?.drift ?? NaN) * 100).toFixed(2)}%   ` +
            `drag ${final?.meanNewtons.toFixed(1)} N\n`),
    );

    await testInfo.attach(`ahmed-${(rung.cells / 1e6).toFixed(1)}M-Re${rung.Re}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.getByTestId('ahmed-stop').click();

    expect(errored, `rung ${rung.cells}@${rung.Re} errored`).toBeUndefined();
  }

  const summary = rows.join('\n');
  await testInfo.attach('ahmed-ladder', { body: summary, contentType: 'text/plain' });
  console.log(`\n${summary}\n`);
});
