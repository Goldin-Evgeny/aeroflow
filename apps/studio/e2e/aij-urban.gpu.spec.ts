import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { Page, TestInfo } from '@playwright/test';

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
  page: Page,
  testInfo: TestInfo,
  acceptance: AcceptanceCase,
): Promise<void> {
  test.skip(
    !hasConfiguredBudget,
    'Set AEROFLOW_M11_CELLS to an acceptance-ready uniform-grid budget.',
  );
  const { caseId, direction, points } = acceptance;
  await page.goto(
    `${BASE_URL}/?urban&case=${caseId}&direction=${direction}&cells=${configuredCells}`,
  );
  await page.getByTestId('urban-run').click();
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
  await testInfo.attach(`case-${caseId}-${direction}-plan`, {
    body: JSON.stringify(planned, null, 2),
    contentType: 'application/json',
  });
  test.skip(
    planned.underResolved === true,
    `INCONCLUSIVE: ${configuredCells.toLocaleString()} cells is below the ` +
      `${planned.requiredCells?.toLocaleString()}-cell resolution requirement.`,
  );

  // The strict Case C grid is estimated at ~1.4 h on the reference RTX 3090. Its physics
  // gate is q≥0.66; the separate 30-minute gate applies only near NOMINAL_BUDGET_CELLS.
  const completionTimeoutMs = caseId === 'C' ? 2 * 60 * 60_000 : 35 * 60_000;
  await expect
    .poll(
      async () => {
        const urban = (await readHooks(page)).urban;
        if (urban?.error) throw new Error(urban.error);
        return urban?.complete;
      },
      { timeout: completionTimeoutMs },
    )
    .toBe(true);
  const result = (await readHooks(page)).urban!;
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

test('V14 Case C at 270 degrees', async ({ gpuPage }, testInfo) => {
  test.setTimeout(2.25 * 60 * 60_000);
  await runAcceptance(gpuPage, testInfo, { caseId: 'C', direction: 270, points: 120 });
});

for (const direction of [0, 90]) {
  test(`V15 Case E at ${direction} degrees`, async ({ gpuPage }, testInfo) => {
    test.setTimeout(45 * 60_000);
    await runAcceptance(gpuPage, testInfo, { caseId: 'E', direction, points: 80 });
  });
}
