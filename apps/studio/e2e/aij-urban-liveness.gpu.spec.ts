import type { Page } from '@playwright/test';
import { BASE_URL, expect, test } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import {
  initialUrbanArtifact,
  syncUrbanArtifact,
  urbanArtifactCoordinator,
} from './helpers/urbanArtifact';

const CELLS = 12_000;
const ROUTE = `${BASE_URL}/?urban&case=C&direction=270&cells=${CELLS}`;

async function setFault(
  page: Page,
  kind:
    | 'queue-timeout'
    | 'map-timeout'
    | 'device-loss'
    | 'healthy-delay'
    | 'checkpoint-timeout'
    | 'scoring-timeout',
): Promise<void> {
  await page.evaluate((faultKind) => {
    const target = window as typeof window & {
      __aeroflowTestFaults?: {
        urban?: { kind: typeof faultKind; deadlineMs?: number; delayMs?: number };
      };
    };
    target.__aeroflowTestFaults = {
      urban: { kind: faultKind, deadlineMs: 2_000, delayMs: 25 },
    };
  }, kind);
}

async function progress(page: Page, after = 0): Promise<number> {
  await expect
    .poll(async () => (await readHooks(page)).urban?.completedSteps ?? 0, { timeout: 120_000 })
    .toBeGreaterThan(after);
  return (await readHooks(page)).urban!.completedSteps!;
}

test('injected queue timeout quarantines one attempt and resumes beyond its checkpoint', async ({
  durableGpuRun,
}) => {
  test.setTimeout(8 * 60_000);
  const durable = await durableGpuRun.create({
    caseId: 'urban-C-270',
    configHash: `liveness-${CELLS}`,
  });
  let page = durable.page;
  await page.goto(ROUTE);
  await page.getByTestId('urban-run').click();
  await progress(page);
  await page.getByTestId('urban-checkpoint').click();
  await expect
    .poll(async () => (await readHooks(page)).urban?.checkpointHistory?.length ?? 0, {
      timeout: 120_000,
    })
    .toBe(1);
  const before = (await readHooks(page)).urban!;
  const checkpoint = before.checkpointHistory!.at(-1)!;
  const coordinator = urbanArtifactCoordinator(
    durable.run.layout,
    initialUrbanArtifact({
      runId: durable.run.layout.runId,
      hook: before,
      timeoutMs: 8 * 60_000,
      stallMs: 120_000,
    }),
  );
  await syncUrbanArtifact(coordinator, before, 'checkpoint');

  await page.getByTestId('urban-stop').click();
  await expect(page.getByTestId('urban-resume')).toBeEnabled({ timeout: 120_000 });
  await setFault(page, 'queue-timeout');
  await page.getByTestId('urban-resume').click();
  await expect
    .poll(async () => (await readHooks(page)).urban?.error, { timeout: 120_000 })
    .toMatch(/queue-completion failed: queue-timeout/);
  const failed = (await readHooks(page)).urban!;
  expect(failed.quarantined).toBe(true);
  expect(failed.submittedSteps).toBeGreaterThan(failed.completedSteps!);
  expect(failed.operations?.at(-1)).toMatchObject({ classification: 'queue-timeout' });
  await syncUrbanArtifact(coordinator, failed, 'attempt-quarantined');

  const recovered = await durable.recoverAttempt({
    classification: 'queue-timeout',
    latestCompleteCheckpointStep: checkpoint.step,
    completedStep: failed.completedSteps!,
  });
  expect(recovered.decision.kind).toBe('recover');
  page = recovered.page!;
  await page.goto(ROUTE);
  await page.getByTestId('urban-resume').click();
  await expect.poll(async () => (await readHooks(page)).urban?.resumed).toBe(true);
  const restored = (await readHooks(page)).urban!;
  expect(restored.restoredStep).toBe(checkpoint.step);
  expect(restored.logicalRunId).toBe(failed.logicalRunId);
  expect(restored.attemptId).not.toBe(failed.attemptId);
  durable.confirmRestoredStep(restored.restoredStep!);
  await progress(page, checkpoint.step);
  durable.observeCompleted((await readHooks(page)).urban!.completedSteps!);
  await syncUrbanArtifact(coordinator, (await readHooks(page)).urban!, 'post-restore-progress');
  expect(durable.attemptHistory()).toHaveLength(2);
  await coordinator.terminate('completed');
});

for (const [kind, expected] of [
  ['map-timeout', 'readback-timeout'],
  ['device-loss', 'device-lost'],
] as const) {
  test(`webdriver-only ${kind} control yields exact ${expected} classification`, async ({
    gpuPage: page,
  }) => {
    test.setTimeout(180_000);
    await page.goto(ROUTE);
    await setFault(page, kind);
    await page.getByTestId('urban-run').click();
    await expect
      .poll(async () => (await readHooks(page)).urban?.operations?.at(-1)?.classification, {
        timeout: 150_000,
      })
      .toBe(expected);
    expect((await readHooks(page)).urban?.quarantined).toBe(true);
  });
}

test('a healthy delayed queue completion does not create a false stall', async ({
  gpuPage: page,
}) => {
  test.setTimeout(180_000);
  await page.goto(ROUTE);
  await setFault(page, 'healthy-delay');
  await page.getByTestId('urban-run').click();
  await progress(page);
  const hook = (await readHooks(page)).urban!;
  expect(hook.error).toBeUndefined();
  expect(hook.quarantined).toBe(false);
  expect(hook.operations?.some((operation) => operation.terminalState === 'completed')).toBe(true);
});

test('checkpoint persistence and scoring faults remain terminal non-GPU classifications', async ({
  gpuPage: page,
}) => {
  test.setTimeout(180_000);
  await page.goto(ROUTE);
  await setFault(page, 'checkpoint-timeout');
  await page.getByTestId('urban-run').click();
  await progress(page);
  await page.getByTestId('urban-checkpoint').click();
  await expect
    .poll(async () => (await readHooks(page)).urban?.operations?.at(-1)?.classification, {
      timeout: 120_000,
    })
    .toBe('checkpoint-io-timeout');
  expect((await readHooks(page)).urban?.quarantined).toBe(false);

  await page.reload();
  await setFault(page, 'scoring-timeout');
  await page.getByTestId('urban-run').click();
  await expect
    .poll(async () => (await readHooks(page)).urban?.operations?.at(-1)?.classification, {
      timeout: 120_000,
    })
    .toBe('scoring-timeout');
  expect((await readHooks(page)).urban?.quarantined).toBe(false);
});
