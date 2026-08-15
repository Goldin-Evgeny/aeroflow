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

  // TIME BUDGET, not a gate. The physics gate is q≥0.66 and is untouched; the separate
  // 30-minute wall-time gate applies only near NOMINAL_BUDGET_CELLS (asserted below).
  //
  // Corrected 2026-08-15. This was 2 h, derived from a "~1.4 h on the reference RTX 3090"
  // estimate that D1 records as FALSIFIED (D1:135 — "measurement 2026-07-28: ≥ 8.7 h").
  // The strict grid's measured cost is 5.96 h — 21,454 s for 365,560 steps, 120/120 points,
  // ~3261 scene MLUPs at 97–99% duty, on this same RTX 3090 (D1:245). A 2 h poll therefore
  // could not have returned a verdict regardless of solver behaviour, which is exactly what
  // the aborted 2026-08-15-1450 run demonstrated. 8 h is ~1.34× the measured cost.
  const completionTimeoutMs = caseId === 'C' ? 8 * 60 * 60_000 : 35 * 60_000;

  // Stall detector. D1's Wall-3 section records an INTERMITTENT Case C hang whose signature
  // is a run that does healthy work and then freezes — steps and compute duty stop together
  // — and credits a 6-minute no-progress checkpoint-resume detector for the run that did
  // complete. This harness had no equivalent, so a longer budget would have made that hang
  // more expensive rather than less. Fail fast and loudly instead of burning the budget:
  // a stall is an EXECUTION finding, never a physics result.
  const STALL_TIMEOUT_MS = 6 * 60_000;
  let lastSteps = -1;
  let lastProgressAt = Date.now();
  await expect
    .poll(
      async () => {
        const urban = (await readHooks(page)).urban;
        if (urban?.error) throw new Error(urban.error);
        const steps = urban?.totalSteps ?? -1;
        if (steps > lastSteps) {
          lastSteps = steps;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
          throw new Error(
            `STALLED: case ${caseId} made no step progress for ` +
              `${((Date.now() - lastProgressAt) / 60_000).toFixed(1)} min at step ${lastSteps}. ` +
              `This matches the intermittent hang recorded in D1 (Wall 3), whose root cause ` +
              `is unknown and which did not reproduce on the following run. Reported as an ` +
              `EXECUTION failure, NOT a physics result — q was never evaluated.`,
          );
        }
        return urban?.complete;
      },
      { timeout: completionTimeoutMs, intervals: [15_000] },
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
  test.setTimeout(8.5 * 60 * 60_000); // must exceed the 8 h completion poll
  await runAcceptance(gpuPage, testInfo, { caseId: 'C', direction: 270, points: 120 });
});

for (const direction of [0, 90]) {
  test(`V15 Case E at ${direction} degrees`, async ({ gpuPage }, testInfo) => {
    test.setTimeout(45 * 60_000);
    await runAcceptance(gpuPage, testInfo, { caseId: 'E', direction, points: 80 });
  });
}
