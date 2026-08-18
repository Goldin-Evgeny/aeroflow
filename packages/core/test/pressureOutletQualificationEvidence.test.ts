import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPressureOutletQualification } from './harness/pressureOutletQualification.js';

const enabled = process.env.AEROFLOW_PRESSURE_QUALIFICATION === '1';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
}

describe.skipIf(!enabled)('pressure-outlet qualification evidence run', () => {
  it('writes complete machine and append-only human evidence', async () => {
    const started = performance.now();
    const execution = await runPressureOutletQualification();
    const durationMs = performance.now() - started;
    const runId = process.env.AEROFLOW_RUN_ID ?? '2026-08-18-pressure-outlet-qualification';
    const revision = git(['rev-parse', '--short', 'HEAD']).trim();
    const status = git(['status', '--short']);
    const diff = `${status}\n${git(['diff', 'HEAD', '--'])}`;
    const provenance = {
      revision,
      dirty: status.length > 0,
      ...(status.length > 0
        ? {
            diffSha256: createHash('sha256').update(diff).digest('hex'),
            files: status
              .split(/\r?\n/)
              .filter(Boolean)
              .map((line) => line.slice(3)),
          }
        : {}),
    };
    const artifact = {
      schemaVersion: 1,
      runId,
      generatedAt: execution.generatedAt,
      command:
        'AEROFLOW_PRESSURE_QUALIFICATION=1 AEROFLOW_RUN_ID=' +
        runId +
        ' npx vitest run packages/core/test/pressureOutletQualificationEvidence.test.ts',
      durationMs,
      hardware: { backend: 'CPU Float64; GPU arms require browser opt-in runner' },
      provenance,
      manifest: execution.manifest,
      evidence: execution.evidence,
      result: execution.result,
    };
    const runDir = resolve('docs', 'validation', 'runs');
    const artifactDir = resolve(runDir, 'artifacts', runId);
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = resolve(artifactDir, 'pressure-qualification.json');
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });

    const cpuArms = execution.evidence.filter((entry) => entry.armId.includes('-cpu-'));
    const gpuArms = execution.evidence.filter((entry) => !entry.armId.includes('-cpu-'));
    const markdown = [
      `# ${runId}`,
      '',
      '**Schema v2.** Bounded pressure-outlet qualification matrix. This run records plumbing,',
      'numerical-health, conservation, repeatability, and availability evidence only; bounded',
      'measurements are not V11-V15 physics verdicts.',
      '',
      '## Identity',
      '',
      `- UTC: ${execution.generatedAt}`,
      `- Revision: \`${revision}${provenance.dirty ? '+dirty' : ''}\``,
      `- Dirty diff SHA-256: ${provenance.dirty ? `\`${provenance.diffSha256}\`` : 'N/A'}`,
      `- Manifest: \`${execution.manifest.id}\``,
      `- Duration: ${(durationMs / 1000).toFixed(3)} s`,
      `- Command: \`${artifact.command}\``,
      '- Hardware: CPU Float64; browser GPU arms were unavailable in this execution.',
      '',
      '## Configuration',
      '',
      `- Outlet: \`${execution.manifest.outlet}\``,
      `- Empty-tunnel exposure: ${execution.manifest.arms.find((arm) => arm.id === 'empty-legacy-cpu-a')!.exposureSteps} steps`,
      `- Closure conventions: legacy and spec`,
      `- Predeclared thresholds: \`${JSON.stringify(execution.manifest.thresholds)}\``,
      '- Every arm retains its grid/boundary/relaxation configuration and fingerprint in the JSON artifact.',
      '',
      '## Result',
      '',
      `- Qualification classifier: **${execution.result.status.toUpperCase()}**`,
      `- CPU arms recorded: ${cpuArms.length}`,
      `- Browser/GPU arms unavailable: ${gpuArms.length}`,
      `- Reasons: ${execution.result.reasons.map((reason) => `${reason.code}:${reason.armId}${reason.axis ? `/${reason.axis}` : ''}`).join(', ') || 'none'}`,
      '- Bounded physics verdict: **NOT EVALUATED**.',
      '',
      '## Verdict axes',
      '',
      '- **EXECUTION — AMBER.** CPU empty-tunnel arms executed; required browser/GPU scene, parity, and checkpoint arms were unavailable.',
      `- **NUMERICAL_HEALTH — ${cpuArms.every((entry) => entry.axes['numerical-health']?.state === 'pass') ? 'GREEN' : 'RED'}.** CPU arm raw density, mass-drift, and complete-shell values are retained in the artifact.`,
      '- **STATISTICAL_CONVERGENCE — N/A.** This bounded qualification does not estimate a production statistic.',
      '- **PHYSICS_TARGET — N/A.** Smoke measurements are deliberately not compared with V11-V15 acceptance bands.',
      '- **PHYSICS_STRUCTURE — RECORDED.** No full-resolution topology claim is made.',
      '',
      '## Anomalies and limits',
      '',
      'The result is inconclusive unless every frozen manifest arm is present and passing. Missing',
      'browser/GPU arms do not authorize promotion. The open zero-gradient causal defect remains open;',
      'this run evaluates a candidate validation configuration and does not identify an internal cause.',
      '',
      `Machine-readable evidence: [pressure-qualification.json](artifacts/${runId}/pressure-qualification.json)`,
      '',
    ].join('\n');
    const markdownPath = resolve(runDir, `${runId}.md`);
    await writeFile(markdownPath, markdown, { flag: 'wx' });
    await appendFile(
      resolve('docs', 'validation', 'INDEX.md'),
      `\n| [${runId}](runs/${runId}.md) | ${execution.generatedAt} | Bounded pressure-outlet qualification | 560 x 4 CPU arms; GPU unavailable | \`${revision}\`${provenance.dirty ? '+dirty' : ''} | ${provenance.dirty ? 'yes' : 'no'} | ${execution.result.status.toUpperCase()} | AMBER | ${cpuArms.every((entry) => entry.axes['numerical-health']?.state === 'pass') ? 'GREEN' : 'RED'} | N/A | N/A | RECORDED | ${execution.result.status.toUpperCase()} |\n`,
    );
    expect(['failed', 'inconclusive']).toContain(execution.result.status);
    expect(execution.result.boundedPhysicsVerdict).toBe('not-evaluated');
  }, 120_000);
});
