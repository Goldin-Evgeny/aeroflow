import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

test('bounded D3Q27 central-moment WGSL authority parity', async ({ gpuPage: page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  await page.goto(`${BASE_URL}/?q27gpu`);
  await expect
    .poll(
      async () => {
        const state = await readHooks(page);
        if (state.q27GpuAuthorityError) throw new Error(state.q27GpuAuthorityError);
        return state.q27GpuAuthority;
      },
      { timeout: 25 * 60_000 },
    )
    .toBeTruthy();
  const artifact = (await readHooks(page)).q27GpuAuthority!;
  const directory = resolve('test-results', 'strain-calibration');
  mkdirSync(directory, { recursive: true });
  const artifactPath = resolve(directory, 'central-moment-d3q27-gpu-authority.json');
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach('q27-gpu-authority', {
    body: JSON.stringify(artifact, null, 2),
    contentType: 'application/json',
  });
  console.log(
    `\n[${artifact.operator.version}] ` +
      `collisionAbs=${artifact.collisionMaxima.populationAbs.toExponential(3)} ` +
      artifact.periodicCases
        .map(
          (entry) =>
            `λ${entry.wavelength}:gain=${entry.gpuGain.toFixed(9)} Δ=${entry.gainDelta.toExponential(3)}`,
        )
        .join(' ') +
      ` pass=${artifact.passed}\n`,
  );
  expect(artifact.passed, JSON.stringify(artifact, null, 2)).toBe(true);
});
