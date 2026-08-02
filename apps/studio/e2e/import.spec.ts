import path from 'node:path';
import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * M8 import flow end-to-end: STL file → wizard plan → GPU voxelization → live drag
 * sampling. `?cells=250000` keeps the grid SwiftShader-sized; the ≤3 s voxelization gate
 * is a Tier B (real GPU) concern and is deliberately NOT asserted here.
 */
test('STL import → voxelize → live drag sample', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/?import3d&cells=250000');

  // `import.meta.dirname`, not `__dirname`: these specs load as ESM, where `__dirname` is
  // undefined and the spec failed with a ReferenceError before reaching any assertion.
  await page
    .getByTestId('import-file')
    .setInputFiles(path.join(import.meta.dirname, 'fixtures', 'cube.stl'));
  await expect(page.getByTestId('import-mesh-info')).toContainText('12 triangles');

  const run = page.getByTestId('import-run');
  await expect(run).toBeEnabled();
  await run.click();

  await expect
    .poll(async () => (await readHooks(page)).import3d?.solidCells ?? 0, { timeout: 300_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await readHooks(page)).import3d?.sample?.steps ?? 0, { timeout: 300_000 })
    .toBeGreaterThan(0);
  const sample = (await readHooks(page)).import3d!.sample!;
  expect(Number.isFinite(sample.cd)).toBe(true);

  await page.getByTestId('import-stop').click();
});
