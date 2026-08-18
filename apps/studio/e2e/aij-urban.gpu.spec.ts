import { test, expect, BASE_URL, type DurableGpuRunFactory } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import {
  initialUrbanArtifact,
  syncUrbanArtifact,
  urbanArtifactCoordinator,
} from './helpers/urbanArtifact';
import type { TestInfo } from '@playwright/test';
import type { AeroflowHooks } from '../src/dev/testHooks';
import { readArtifact } from './helpers/validationRun';

/**
 * Tier B M11 acceptance. The uniform grid required by the official third-node rule is
 * substantially larger than the old 384x384x128 estimate, so these runs are opt-in:
 * set AEROFLOW_M11_CELLS to an acceptance-ready budget supported by the attached GPU.
 * A coarse value is skipped as INCONCLUSIVE before q/r can be judged.
 *
 * Real-fixture feasibility (computed from the ingested geometry, see M11):
 *   - Case C V14: ~183M cells at the third-node rule (~13 GB fp16 — runnable on the 24 GB
 *     3090). Run with e.g. AEROFLOW_M11_CELLS=190000000. At that resolution the run is
 *     checkpointed/resumable and exceeds the nominal ≤30-min target (which was written for
 *     ~18.9M cells); q≥0.66 is the physics acceptance and is what gates here.
 *   - Case E V15: ~2.7B cells — infeasible on a 24 GB card at the strict rule. It self-skips
 *     as INCONCLUSIVE at any runnable budget until a benchmark-faithful domain crop lands.
 */
const NOMINAL_BUDGET_CELLS = 384 * 384 * 128; // the M11.md wall-time gate's reference grid
const configuredCells = Number(process.env.AEROFLOW_M11_CELLS);
const hasConfiguredBudget = Number.isFinite(configuredCells) && configuredCells >= 512;

interface AcceptanceCase {
  caseId: 'C' | 'E';
  direction: number;
  points: number;
}

async function runAcceptance(
  durableGpuRun: DurableGpuRunFactory,
  testInfo: TestInfo,
  acceptance: AcceptanceCase,
): Promise<void> {
  test.skip(
    !hasConfiguredBudget,
    'Set AEROFLOW_M11_CELLS to an acceptance-ready uniform-grid budget.',
  );
  const { caseId, direction, points } = acceptance;
  const operation = (process.env.AEROFLOW_RUN_OPERATION ?? 'fresh').toLowerCase();
  if (operation !== 'fresh' && operation !== 'resume') {
    throw new Error(`AEROFLOW_RUN_OPERATION must be fresh or resume, got ${operation}`);
  }
  if (operation === 'resume' && !process.env.AEROFLOW_RUN_ID) {
    throw new Error('AEROFLOW_RUN_ID is required when AEROFLOW_RUN_OPERATION=resume');
  }
  const durable = await durableGpuRun.create({
    caseId: `urban-${caseId}-${direction}`,
    configHash: `case=${caseId};direction=${direction};cells=${configuredCells}`,
    runId: process.env.AEROFLOW_RUN_ID,
    resume: operation === 'resume',
    takeOverStale: process.env.AEROFLOW_TAKE_OVER_STALE === '1',
  });
  const page = durable.page;
  await page.goto(
    `${BASE_URL}/?urban&case=${caseId}&direction=${direction}&cells=${configuredCells}`,
  );
  await page.getByTestId(operation === 'resume' ? 'urban-resume' : 'urban-run').click();
  await expect
    .poll(
      async () => {
        const urban = (await readHooks(page)).urban;
        if (urban?.error) throw new Error(urban.error);
        return urban?.totalSteps;
      },
      { timeout: 10 * 60_000 },
    )
    .toBeDefined();
  const planned = (await readHooks(page)).urban!;
  const completionTimeoutMs = caseId === 'C' ? 8 * 60 * 60_000 : 35 * 60_000;
  const STALL_TIMEOUT_MS = 6 * 60_000;
  let initial = initialUrbanArtifact({
    runId: durable.run.layout.runId,
    hook: planned,
    timeoutMs: completionTimeoutMs,
    stallMs: STALL_TIMEOUT_MS,
  });
  if (operation === 'resume') {
    initial = await readArtifact(durable.run.layout.artifactPath);
    initial.complete = false;
    initial.termination = null;
    initial.verdicts.execution = {
      state: 'unevaluated',
      reason: 'resume invocation in progress',
      metrics: { restoredStep: planned.restoredStep ?? null },
    };
  }
  const coordinator = urbanArtifactCoordinator(durable.run.layout, initial);
  await syncUrbanArtifact(coordinator, planned, 'configured');
  await testInfo.attach(`case-${caseId}-${direction}-plan`, {
    body: JSON.stringify(planned, null, 2),
    contentType: 'application/json',
  });
  test.skip(
    planned.underResolved === true,
    `INCONCLUSIVE: ${configuredCells.toLocaleString()} cells is below the ` +
      `${planned.requiredCells?.toLocaleString()}-cell resolution requirement.`,
  );

  // TIME BUDGET, not a gate. The physics gate is q≥0.66 and is untouched; the separate
  // 30-minute wall-time gate applies only near NOMINAL_BUDGET_CELLS (asserted below).
  //
  // Corrected 2026-08-15. This was 2 h, derived from a "~1.4 h on the reference RTX 3090"
  // estimate that D1 records as FALSIFIED (D1:135 — "measurement 2026-07-28: ≥ 8.7 h").
  // The strict grid's measured cost is 5.96 h — 21,454 s for 365,560 steps, 120/120 points,
  // ~3261 scene MLUPs at 97–99% duty, on this same RTX 3090 (D1:245). A 2 h poll therefore
  // could not have returned a verdict regardless of solver behaviour, which is exactly what
  // the aborted 2026-08-15-1450 run demonstrated. 8 h is ~1.34× the measured cost.
  // Stall detector. D1's Wall-3 section records an INTERMITTENT Case C hang whose signature
  // is a run that does healthy work and then freezes — steps and compute duty stop together
  // — and credits a 6-minute no-progress checkpoint-resume detector for the run that did
  // complete. This harness had no equivalent, so a longer budget would have made that hang
  // more expensive rather than less. Fail fast and loudly instead of burning the budget:
  // a stall is an EXECUTION finding, never a physics result.
  let lastSteps = -1;
  let lastProgressAt = Date.now();
  let terminated = false;
  let result: NonNullable<Awaited<ReturnType<typeof readHooks>>['urban']>;
  try {
    await expect
      .poll(
        async () => {
          const urban = (await readHooks(page)).urban;
          if (urban) await syncUrbanArtifact(coordinator, urban, 'progress');
          if (urban?.error) throw new Error(urban.error);
          const steps = urban?.totalSteps ?? -1;
          if (steps > lastSteps) {
            lastSteps = steps;
            lastProgressAt = Date.now();
          } else if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
            throw new Error(
              `STALLED: case ${caseId} made no step progress for ` +
                `${((Date.now() - lastProgressAt) / 60_000).toFixed(1)} min at step ${lastSteps}. ` +
                `This is a no-progress observation; no GPU, CPU, checkpoint, or scoring root ` +
                `cause was observed. Reported as an EXECUTION failure, NOT a physics result.`,
            );
          }
          return urban?.complete;
        },
        { timeout: completionTimeoutMs, intervals: [15_000] },
      )
      .toBe(true);
    result = (await readHooks(page)).urban!;
    await syncUrbanArtifact(coordinator, result, 'verdict');
    await coordinator.terminate('completed');
    terminated = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latest = await readHooks(page).catch((): AeroflowHooks => ({}));
    if (latest.urban) await syncUrbanArtifact(coordinator, latest.urban, 'failure');
    const reason =
      latest.urban?.deviceLoss?.observed === true
        ? 'device-lost'
        : /STALLED/.test(message)
          ? 'stalled'
          : /closed/i.test(message)
            ? 'browser-closed'
            : /timeout|exceeded/i.test(message)
              ? 'timeout'
              : 'unexpected-error';
    await coordinator.terminate(reason, error);
    terminated = true;
    throw error;
  } finally {
    if (!terminated) await coordinator.terminate('aborted');
    await testInfo.attach(`case-${caseId}-${direction}-durable-artifact`, {
      path: durable.run.layout.artifactPath,
      contentType: 'application/json',
    });
  }
  await testInfo.attach(`case-${caseId}-${direction}-result`, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.underResolved).toBe(false);
  expect(result.averagingFlowThroughs).toBeGreaterThanOrEqual(10);
  expect(result.reportRows).toBe(points);
  expect(result.q).toBeGreaterThanOrEqual(0.66);
  if (caseId === 'E') expect(result.r).toBeGreaterThanOrEqual(0.7);
  expect(result.verdict).toBe('pass');

  // Wall time is always recorded. The M11.md ≤30-min/direction target is defined at the
  // nominal ~18.9M-cell grid; the strict third-node rule forces far larger acceptance grids
  // for the real fixtures (Case C ≈ 183M), where the run is checkpointed/resumable instead.
  // Hard-gate the time only near the nominal budget; above it, q/r is the acceptance.
  const wallMs = (result.elapsedMs ?? Infinity) + (result.voxelizationMs ?? Infinity);
  await testInfo.attach(`case-${caseId}-${direction}-walltime`, {
    body: `${(wallMs / 60_000).toFixed(1)} min at ${configuredCells.toLocaleString()} cells`,
    contentType: 'text/plain',
  });
  if (configuredCells <= 1.5 * NOMINAL_BUDGET_CELLS) {
    expect(wallMs).toBeLessThanOrEqual(30 * 60_000);
  }
}

test('V14 Case C at 270 degrees', async ({ durableGpuRun }, testInfo) => {
  test.setTimeout(8.5 * 60 * 60_000); // must exceed the 8 h completion poll
  await runAcceptance(durableGpuRun, testInfo, { caseId: 'C', direction: 270, points: 120 });
});

for (const direction of [0, 90]) {
  test(`V15 Case E at ${direction} degrees`, async ({ durableGpuRun }, testInfo) => {
    test.setTimeout(45 * 60_000);
    await runAcceptance(durableGpuRun, testInfo, { caseId: 'E', direction, points: 80 });
  });
}
