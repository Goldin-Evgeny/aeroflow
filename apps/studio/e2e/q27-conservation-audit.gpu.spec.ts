import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';

test('audits Q27 GPU momentum from raw populations without altering evolution', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(30 * 60_000);
  await page.goto(`${BASE_URL}/?q27gpu`);
  await expect
    .poll(
      async () => {
        const state = await readHooks(page);
        if (state.q27GpuAuthorityError) throw new Error(state.q27GpuAuthorityError);
        return state.q27GpuConservationAudit;
      },
      { timeout: 25 * 60_000 },
    )
    .toBeTruthy();
  const artifact = (await readHooks(page)).q27GpuConservationAudit!;
  const authority = (await readHooks(page)).q27GpuAuthority!;
  expect(artifact.unchangedMomentumGate).toBe(5e-5);
  expect(artifact.cases.map((entry) => entry.wavelength)).toEqual([3.2, 8, 16]);
  expect(authority.collisionCases.every((entry) => entry.pass)).toBe(true);
  for (const periodic of authority.periodicCases) {
    expect(
      Object.entries(periodic.gates)
        .filter(([gate]) => gate !== 'momentumConservation')
        .every(([, passed]) => passed),
    ).toBe(true);
  }
  for (const entry of artifact.cases) {
    expect(entry.audit.history).toHaveLength(120);
    expect(entry.audit.collisionRepresentatives.map((sample) => sample.step)).toEqual([
      1, 40, 80, 120,
    ]);
  }
  const directory = resolve('test-results', 'strain-calibration');
  mkdirSync(directory, { recursive: true });
  const artifactPath = resolve(directory, 'central-moment-d3q27-gpu-conservation-audit.json');
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach('q27-gpu-conservation-audit', {
    body: JSON.stringify(artifact, null, 2),
    contentType: 'application/json',
  });
  console.log(
    `\n[${artifact.artifactSchema}] ${artifact.classification}\n` +
      artifact.cases
        .map(
          (entry) =>
            `λ${entry.wavelength}: old=${entry.oldReportedDrift.toExponential(3)} ` +
            `rawPre=${entry.audit.reconstructedPreCollisionDriftMax.toExponential(3)} ` +
            `rawPost=${entry.audit.reconstructedPostCollisionDriftMax.toExponential(3)} ` +
            `stream=${entry.audit.streamingOnlyMaxDelta.toExponential(3)} ` +
            `collision=${entry.audit.collisionOnlyMaxDelta.toExponential(3)}`,
        )
        .join('\n') +
      '\n',
  );
});
