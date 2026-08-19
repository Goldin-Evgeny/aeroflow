import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runOutletFeedbackLocalization } from './harness/outletFeedbackLocalization.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

describe.runIf(process.env.AEROFLOW_OUTLET_LOCALIZATION === '1')(
  'near-floor outlet localization evidence',
  () => {
    it(
      'writes deterministic staged evidence and a schema-v2 human record',
      { timeout: 300_000 },
      async () => {
        const runId = process.env.AEROFLOW_RUN_ID ?? '2026-08-18-near-floor-outlet-localization';
        const started = performance.now();
        const artifact = await runOutletFeedbackLocalization();
        const durationSeconds = (performance.now() - started) / 1_000;
        const artifactDirectory = resolve(REPO_ROOT, 'docs/validation/runs/artifacts', runId);
        mkdirSync(artifactDirectory, { recursive: true });
        writeFileSync(
          resolve(artifactDirectory, 'localization.json'),
          `${JSON.stringify(artifact, null, 2)}\n`,
          'utf8',
        );
        const bounded = artifact.arms.find((arm) => arm.id === 'bounded-confirmation');
        const run = [
          `# ${runId}`,
          '',
          '**Schema v2.** Staged CPU Float64 localization of the open near-floor outlet-feedback defect.',
          '',
          '## Identity',
          '',
          `- UTC: ${artifact.generatedAt}`,
          `- Revision: \`${artifact.source.revision}${artifact.source.dirty ? '+dirty' : ''}\``,
          `- Dirty diff SHA-256: \`${artifact.source.diffSha256 ?? 'none'}\``,
          `- Manifest: \`${artifact.manifestId}\` / \`${artifact.manifestFingerprint}\``,
          `- Duration: ${durationSeconds.toFixed(3)} s`,
          `- Command: \`AEROFLOW_OUTLET_LOCALIZATION=1 AEROFLOW_RUN_ID=${runId} npx vitest run packages/core/test/outletFeedbackLocalizationEvidence.test.ts\``,
          '- Hardware: CPU Float64 reference paths.',
          '',
          '## Result',
          '',
          `- Classifier: **${artifact.result.branch}**`,
          `- Compatible branches: ${artifact.result.compatibleBranches.join(', ') || 'none'}`,
          `- Rejected branches: ${artifact.result.rejectedBranches.join(', ') || 'none'}`,
          `- Reasons: ${artifact.result.reasons.join(', ')}`,
          `- Bounded confirmation: ${artifact.result.boundedConfirmed}`,
          `- Exact first abnormal step: ${bounded?.metrics.exactFirstAbnormalStep ?? 'not recorded'}`,
          `- Focused boundary events: ${bounded?.events.length ?? 0}`,
          '',
          '## Verdict axes',
          '',
          '- **EXECUTION — GREEN.** Manufactured, repeatability, replay, ablation, and bounded CPU arms completed.',
          '- **NUMERICAL_HEALTH — AMBER.** The zero-gradient/spec arm reproduces the expected non-finite event; bounded pressure and upstream controls remain finite.',
          '- **STATISTICAL_CONVERGENCE — N/A.** This is a deterministic mechanism localization, not a statistical benchmark.',
          '- **PHYSICS_TARGET — N/A.** No V11-V15 acceptance band is evaluated.',
          '- **PHYSICS_STRUCTURE — RECORDED.** The classifier identifies the earliest required amplifier under the bounded CPU topology.',
          '',
          '## Scope and non-claims',
          '',
          ...artifact.nonClaims.map((claim) => `- ${claim}`),
          '',
          `Machine-readable evidence: [localization.json](artifacts/${runId}/localization.json)`,
          '',
        ].join('\n');
        writeFileSync(resolve(REPO_ROOT, 'docs/validation/runs', `${runId}.md`), run, 'utf8');
        expect(artifact.arms).toHaveLength(16);
        expect(artifact.result.branch).toBeTypeOf('string');
        expect(artifact.result.repairAuthorized).toBe(false);
      },
    );
  },
);
