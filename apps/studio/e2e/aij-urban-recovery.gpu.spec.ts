import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import {
  initialUrbanArtifact,
  syncUrbanArtifact,
  urbanArtifactCoordinator,
} from './helpers/urbanArtifact';
import type { Page } from '@playwright/test';
import type { AeroflowHooks } from '../src/dev/testHooks';

const CELLS = 12_000;
const CONFIG_HASH = `urban-C-270-cells-${CELLS}-fp16-or-fp32`;

async function waitForProgress(page: Page, after = 0): Promise<number> {
  await expect
    .poll(async () => (await readHooks(page)).urban?.totalSteps ?? 0, { timeout: 120_000 })
    .toBeGreaterThan(after);
  return (await readHooks(page)).urban!.totalSteps!;
}

async function saveCheckpoint(page: Page, count: number) {
  await page.getByTestId('urban-checkpoint').click();
  await expect
    .poll(async () => (await readHooks(page)).urban?.checkpointHistory?.length ?? 0, {
      timeout: 120_000,
    })
    .toBe(count);
  return (await readHooks(page)).urban!.checkpointHistory!.at(-1)!;
}

async function tearLatestCheckpoint(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('aeroflow', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('checkpoints', 'readwrite');
      const store = transaction.objectStore('checkpoints');
      const latestRequest = store.get('latest');
      latestRequest.onsuccess = () => {
        const latest = String(latestRequest.result);
        const keysRequest = store.getAllKeys();
        keysRequest.onsuccess = () => {
          const key = keysRequest.result.find((candidate) =>
            String(candidate).startsWith(`${latest}/ddf/`),
          );
          if (key === undefined) {
            reject(new Error(`no chunk found for latest slot ${latest}`));
            return;
          }
          store.delete(key);
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
}

test('bounded urban recovery survives context replacement and rejects contaminated resumes', async ({
  durableGpuRun,
}) => {
  test.setTimeout(10 * 60_000);
  const durable = await durableGpuRun.create({ caseId: 'urban-C-270', configHash: CONFIG_HASH });
  let page = durable.page;
  await page.goto(`${BASE_URL}/?urban&case=C&direction=270&cells=${CELLS}`);
  await page.getByTestId('urban-run').click();
  await waitForProgress(page);
  const configured = (await readHooks(page)).urban!;
  const coordinator = urbanArtifactCoordinator(
    durable.run.layout,
    initialUrbanArtifact({
      runId: durable.run.layout.runId,
      hook: configured,
      timeoutMs: 10 * 60_000,
      stallMs: 2 * 60_000,
    }),
  );
  await syncUrbanArtifact(coordinator, configured, 'configured');
  try {
    const first = await saveCheckpoint(page, 1);
    await syncUrbanArtifact(coordinator, (await readHooks(page)).urban!, 'checkpoint');

    page = await durable.replaceContext();
    await page.goto(`${BASE_URL}/?urban&case=C&direction=270&cells=${CELLS}`);
    await page.getByTestId('urban-resume').click();
    await expect.poll(async () => (await readHooks(page)).urban?.resumed).toBe(true);
    let resumed = (await readHooks(page)).urban!;
    expect(resumed.restoredStep).toBe(first.step);
    expect(resumed.restoredSamples).toBe(first.samples);
    await syncUrbanArtifact(coordinator, resumed, 'resumed');
    await waitForProgress(page, first.step);

    const second = await saveCheckpoint(page, 1);
    await waitForProgress(page, second.step);
    const third = await saveCheckpoint(page, 2);
    expect(third.step).toBeGreaterThan(second.step);
    await syncUrbanArtifact(coordinator, (await readHooks(page)).urban!, 'checkpoint');
    await tearLatestCheckpoint(page);

    page = await durable.replaceContext();
    await page.goto(`${BASE_URL}/?urban&case=C&direction=270&cells=${CELLS}`);
    await page.getByTestId('urban-resume').click();
    await expect.poll(async () => (await readHooks(page)).urban?.resumed).toBe(true);
    resumed = (await readHooks(page)).urban!;
    expect(resumed.restoredStep).toBe(second.step);
    expect(resumed.restoredSamples).toBe(second.samples);
    await syncUrbanArtifact(coordinator, resumed, 'fallback-resumed');
    await waitForProgress(page, second.step);

    page = await durable.replaceContext();
    await page.goto(`${BASE_URL}/?urban&case=C&direction=247.5&cells=${CELLS}`);
    await page.getByTestId('urban-resume').click();
    await expect
      .poll(async () => (await readHooks(page)).urban?.error, { timeout: 120_000 })
      .toMatch(/checkpoint (?:grid|scene|precision|DDF layout) .* (?:expected|≠ sim)/);
    expect((await readHooks(page)).urban?.totalSteps).toBeUndefined();

    const fresh = await durableGpuRun.create({ caseId: 'urban-C-270', configHash: CONFIG_HASH });
    const freshPage = fresh.page;
    await freshPage.goto(`${BASE_URL}/?urban&case=C&direction=270&cells=${CELLS}`);
    await freshPage.getByTestId('urban-resume').click();
    await expect
      .poll(async () => (await readHooks(freshPage)).urban?.error, { timeout: 120_000 })
      .toMatch(/no complete compatible checkpoint/);
    expect((await readHooks(freshPage)).urban?.totalSteps).toBeUndefined();
    await coordinator.terminate('completed');
  } catch (error) {
    const latest = await readHooks(page).catch((): AeroflowHooks => ({}));
    if (latest.urban) await syncUrbanArtifact(coordinator, latest.urban, 'failure');
    await coordinator.terminate('unexpected-error', error);
    throw error;
  }
});
