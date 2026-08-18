import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoundaryMassBudget } from '../src/analysis/boundaryMassBudget.js';
import {
  classifyOutletFeedback,
  deriveRepeatabilityThresholds,
  flattenOutletDiagnostics,
  runOutletFeedbackDiscriminator,
  uninstrumentedNearFloorDivergence,
  type OutletArmRecord,
  type OutletDiagnosticSample,
} from './harness/outletFeedbackDiscriminator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

function boundary(total = 0): BoundaryMassBudget {
  return {
    velocityInlet: total,
    inlet: 0,
    outlet: 0,
    solid: 0,
    freeSlipFace: 0,
    freeSlipEdge: 0,
    freeSlipInletRing: 0,
    freeSlipOutletRing: 0,
    total,
  };
}

function sample(step: number, mass = 100): OutletDiagnosticSample {
  return {
    step,
    finite: true,
    firstNonFinite: null,
    mass,
    momentum: { x: 1, y: 0, z: 0 },
    density: { min: 0.99, mean: 1, max: 1.01 },
    boundary: boundary(),
    streamwiseProfile: [
      { x: 0, cells: 1, rho: 1, ux: 0.05 },
      { x: 1, cells: 1, rho: 1, ux: 0.05 },
    ],
    subgrid: { tauEffMean: 0.51, tauEffMax: 0.52, strainRatio: 1 },
    wavelengthEnergy: { cells2To4: 0, cells4To8: 0, cellsAbove8: 0 },
  };
}

function arm(label: string, samples: OutletDiagnosticSample[]): OutletArmRecord {
  return {
    label,
    outlet: label.includes('zero') ? 'zero-gradient' : 'pressure',
    materialFingerprint: 'material',
    configurationFingerprint: label,
    initialStateFingerprint: 'initial',
    samples,
    divergenceStep: null,
    completedSteps: samples.at(-1)?.step ?? 0,
    error: null,
  };
}

describe('outlet-feedback result classifier', () => {
  const controls = [sample(25), sample(50)];
  const thresholds = deriveRepeatabilityThresholds(
    arm('control-left', controls),
    arm('control-right', controls),
  );

  it('freezes same-outlet repeatability thresholds before interpreting the pair', () => {
    expect(thresholds.length).toBe(Object.keys(flattenOutletDiagnostics(sample(25))).length);
    expect(thresholds.every((threshold) => threshold.maximumControlDifference === 0)).toBe(true);
    expect(thresholds.every((threshold) => threshold.threshold > 0)).toBe(true);
  });

  it('returns outlet-feedback-observed with earliest separation and last-common evidence', () => {
    const result = classifyOutletFeedback({
      zeroGradient: arm('zero-gradient', [sample(25), sample(50, 101)]),
      pressure: arm('pressure', [sample(25), sample(50)]),
      thresholds,
      exposureSteps: 50,
      cadence: 25,
    });
    expect(result.branch).toBe('outlet-feedback-observed');
    expect(result.earliestSeparation).toMatchObject({ step: 50, metric: 'mass' });
    expect(result.lastCommonInterval).toEqual({ startStep: 0, endStep: 25 });
  });

  it('returns no-separation-in-exposure for an indistinguishable healthy pair', () => {
    const result = classifyOutletFeedback({
      zeroGradient: arm('zero-gradient', controls),
      pressure: arm('pressure', controls),
      thresholds,
      exposureSteps: 50,
      cadence: 25,
    });
    expect(result.branch).toBe('no-separation-in-exposure');
    expect(result.earliestSeparation).toBeNull();
  });

  it('returns inconclusive for configuration mismatch or diagnostic omission', () => {
    const mismatch = arm('pressure', controls);
    mismatch.materialFingerprint = 'different';
    expect(
      classifyOutletFeedback({
        zeroGradient: arm('zero-gradient', controls),
        pressure: mismatch,
        thresholds,
        exposureSteps: 50,
        cadence: 25,
      }),
    ).toMatchObject({ branch: 'inconclusive', reason: 'material-configuration-mismatch' });

    const omitted = arm('pressure', [sample(25)]);
    expect(
      classifyOutletFeedback({
        zeroGradient: arm('zero-gradient', controls),
        pressure: omitted,
        thresholds,
        exposureSteps: 50,
        cadence: 25,
      }),
    ).toMatchObject({ branch: 'inconclusive', reason: 'missing-synchronized-diagnostic-at-50' });
  });
});

describe('bounded outlet-feedback harness', () => {
  it('forks every arm from matching material and initial-state fingerprints', async () => {
    const artifact = await runOutletFeedbackDiscriminator({ exposureSteps: 50, cadence: 25 });
    const arms = [
      artifact.controls.left,
      artifact.controls.right,
      artifact.comparison.zeroGradient,
      artifact.comparison.pressure,
    ];
    expect(new Set(arms.map((candidate) => candidate.materialFingerprint)).size).toBe(1);
    expect(new Set(arms.map((candidate) => candidate.initialStateFingerprint)).size).toBe(1);
    expect(artifact.thresholds.length).toBeGreaterThan(0);
    expect(arms.every((candidate) => candidate.samples.length === 2)).toBe(true);
  });

  it(
    'preserves the established uninstrumented zero-gradient divergence behavior',
    { timeout: 60_000 },
    () => {
      const divergence = uninstrumentedNearFloorDivergence({
        outlet: 'zero-gradient',
        exposureSteps: 3_500,
      });
      expect(divergence).toBeGreaterThanOrEqual(3_300);
      expect(divergence).toBeLessThanOrEqual(3_400);
      expect(
        uninstrumentedNearFloorDivergence({ outlet: 'pressure', exposureSteps: 3_500 }),
      ).toBeNull();
    },
  );
});

describe.runIf(process.env.AEROFLOW_OUTLET_DISCRIMINATOR === '1')(
  'outlet-feedback evidence run',
  () => {
    it(
      'writes the bounded machine-readable artifact and append-only run record',
      { timeout: 180_000 },
      async () => {
        const runId = process.env.AEROFLOW_RUN_ID ?? '2026-08-18-outlet-feedback-discriminator';
        const artifact = await runOutletFeedbackDiscriminator();
        const artifactDir = resolve(REPO_ROOT, 'docs/validation/runs/artifacts', runId);
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(
          resolve(artifactDir, 'outlet-feedback.json'),
          `${JSON.stringify(artifact, null, 2)}\n`,
          'utf8',
        );
        const run = [
          '# Outlet-feedback discriminator',
          '',
          `- Run id: \`${runId}\``,
          `- Recorded: ${artifact.generatedAt}`,
          `- Source: ${artifact.provenance.revision}${artifact.provenance.dirty ? '+dirty' : ''}`,
          `- Configuration: tau0=${artifact.configuration.tau0}, Cs=${artifact.configuration.cs}, ` +
            `closure=${artifact.configuration.lesNorm}, grid=${artifact.configuration.grid.nx}x${artifact.configuration.grid.ny}x${artifact.configuration.grid.nz}`,
          `- Exposure/cadence: ${artifact.configuration.exposureSteps} / ${artifact.configuration.cadence} steps`,
          `- Result: **${artifact.result.branch}**`,
          `- Earliest separation: ${artifact.result.earliestSeparation ? JSON.stringify(artifact.result.earliestSeparation) : 'none'}`,
          `- Last common sampled state: ${artifact.result.lastCommonInterval.endStep}`,
          `- Divergence: zero-gradient=${artifact.result.divergence.zeroGradient ?? 'none'}, pressure=${artifact.result.divergence.pressure ?? 'none'}`,
          `- Material fingerprint: \`${artifact.fingerprints.material}\``,
          `- Initial-state fingerprint: \`${artifact.fingerprints.initialState}\``,
          `- Repeatability thresholds: ${artifact.thresholds.length}; non-zero control differences: ${artifact.thresholds.filter((threshold) => threshold.maximumControlDifference !== 0).length}`,
          '',
          'The same-outlet controls were completed and their thresholds frozen before the A/B comparison.',
          'Every sample retains mass, momentum, density, complete-shell boundary exchange, streamwise profiles, subgrid/strain summaries, and wavelength-band energy.',
          'The result identifies outlet-dependent feedback only; it does not name an unmeasured internal cause or implement a repair.',
          '',
          `Machine-readable evidence: [outlet-feedback.json](artifacts/${runId}/outlet-feedback.json)`,
          '',
        ].join('\n');
        writeFileSync(resolve(REPO_ROOT, 'docs/validation/runs', `${runId}.md`), run, 'utf8');
        expect(artifact.result.branch).not.toBe('inconclusive');
      },
    );
  },
);
