import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COLLISION_QUALIFICATION_MANIFEST,
  PRODUCTION_COLLISION_POLICY,
  classifyCollisionQualification,
  type CollisionQualificationEvidence,
} from '../src/index.js';

const WRITE_RECORD = process.env.AEROFLOW_WRITE_COLLISION_QUALIFICATION === '1';
const OUTPUT_ID = '2026-08-18-d3q19-central-moment-qualification';

interface EigenArtifact {
  generatedAt: string;
  guards: { equilibriumFixedPointMax: number; conservationMax: number };
  qualificationCases: Array<{
    target: { maxSpectrumAmplitude: number };
    control: { maxSpectrumAmplitude: number };
  }>;
  gates: Record<string, boolean>;
}

interface NonlinearArtifact {
  generatedAt: string;
  cases: Array<{
    wavelength: number;
    modalGainAmplitude: number;
    analyticPiOverHydroAmplitude: number;
    nonFinite: boolean;
  }>;
  baseline: { modalGainAmplitude: number; analyticPiOverHydroAmplitude: number };
  gates: Record<string, boolean>;
  failedGates: string[];
}

describe.skipIf(!WRITE_RECORD)('durable D3Q19 collision qualification record', () => {
  it('classifies the decisive CPU failure and writes append-only evidence', () => {
    const rawDirectory = resolve('test-results', 'strain-calibration');
    const eigenPath = resolve(rawDirectory, 'central-moment-eigen-proof.json');
    const nonlinearPath = resolve(
      rawDirectory,
      'd3q19-central-moment-nonlinear-qualification.json',
    );
    const eigen = JSON.parse(readFileSync(eigenPath, 'utf8')) as EigenArtifact;
    const nonlinear = JSON.parse(readFileSync(nonlinearPath, 'utf8')) as NonlinearArtifact;
    expect(eigen.gates.frozenLinearFinite).toBe(true);
    expect(eigen.gates.frozenLinearAmplification).toBe(true);
    expect(nonlinear.failedGates).toContain('targetConstitutive');

    const decisiveIndex = COLLISION_QUALIFICATION_MANIFEST.arms.findIndex(
      (arm) => arm.id === 'cpu-nonlinear-spectrum',
    );
    const evidence = COLLISION_QUALIFICATION_MANIFEST.arms.map<CollisionQualificationEvidence>(
      (arm, index): CollisionQualificationEvidence => {
        const common = {
          manifestId: COLLISION_QUALIFICATION_MANIFEST.id,
          armId: arm.id,
          configurationFingerprint: arm.configurationFingerprint,
        };
        if (arm.id === 'cpu-local-invariants') {
          return {
            ...common,
            state: 'pass',
            metrics: {
              test: 'packages/core/test/centralMomentD3Q19.test.ts',
              assertedMaximumAbsExclusive: 2e-15,
              manufacturedCases: 6,
              equilibriumFixedPointMax: eigen.guards.equilibriumFixedPointMax,
              conservationMax: eigen.guards.conservationMax,
            },
          };
        }
        if (arm.id === 'cpu-linear-spectrum') {
          return {
            ...common,
            state: 'pass',
            metrics: {
              cases: eigen.qualificationCases.length * 2,
              maximumAmplification: Math.max(
                ...eigen.qualificationCases.flatMap((entry) => [
                  entry.target.maxSpectrumAmplitude,
                  entry.control.maxSpectrumAmplitude,
                ]),
              ),
              limitInclusive: COLLISION_QUALIFICATION_MANIFEST.thresholds.linearGainMax,
              rawArtifact: 'linear-spectrum.json',
            },
          };
        }
        if (arm.id === 'cpu-nonlinear-spectrum') {
          const target = nonlinear.cases.find((entry) => entry.wavelength === 3.2)!;
          const control = nonlinear.cases.find((entry) => entry.wavelength === 8)!;
          return {
            ...common,
            state: 'fail',
            reason: `target Pi/Pi_hydro ${target.analyticPiOverHydroAmplitude} is not below 1.2`,
            metrics: {
              targetGain: target.modalGainAmplitude,
              targetGainExclusiveLimit:
                COLLISION_QUALIFICATION_MANIFEST.thresholds.nonlinearGainExclusiveMax,
              targetPiOverHydro: target.analyticPiOverHydroAmplitude,
              targetPiOverHydroExclusiveLimit:
                COLLISION_QUALIFICATION_MANIFEST.thresholds.targetConstitutiveExclusiveMax,
              controlGain: control.modalGainAmplitude,
              controlPiOverHydro: control.analyticPiOverHydroAmplitude,
              baselineGain: nonlinear.baseline.modalGainAmplitude,
              baselinePiOverHydro: nonlinear.baseline.analyticPiOverHydroAmplitude,
              rawArtifact: 'nonlinear-spectrum.json',
            },
          };
        }
        if (index > decisiveIndex) {
          return {
            ...common,
            state: 'not-run-upstream-failed',
            reason: 'not executed after decisive cpu-nonlinear-spectrum failure',
            metrics: {},
          };
        }
        throw new Error(`unexpected qualification arm ordering at ${arm.id}`);
      },
    );
    const classifier = classifyCollisionQualification(evidence);
    expect(classifier).toMatchObject({
      status: 'failed',
      completedPhase: 'none',
      physicsVerdict: 'not-evaluated',
    });
    expect(PRODUCTION_COLLISION_POLICY).toMatchObject({
      selectedOperatorId: 'd3q19-regularized-trt/v1',
      qualificationStatus: 'not-qualified',
      evidence: null,
    });

    const outputDirectory = resolve('docs', 'validation', 'runs', 'artifacts', OUTPUT_ID);
    mkdirSync(outputDirectory, { recursive: true });
    copyFileSync(eigenPath, resolve(outputDirectory, 'linear-spectrum.json'));
    copyFileSync(nonlinearPath, resolve(outputDirectory, 'nonlinear-spectrum.json'));
    writeFileSync(
      resolve(outputDirectory, 'qualification.json'),
      `${JSON.stringify(
        {
          artifactSchema: 'aeroflow-collision-qualification-record-v1',
          generatedAt: new Date().toISOString(),
          manifest: COLLISION_QUALIFICATION_MANIFEST,
          evidence,
          classifier,
          productionPolicyAfterDecision: PRODUCTION_COLLISION_POLICY,
          provenance: {
            sourceRevision: COLLISION_QUALIFICATION_MANIFEST.baseline.revision,
            pressureWorkspaceSnapshotSha256:
              COLLISION_QUALIFICATION_MANIFEST.baseline.pressureWorkspaceSnapshotSha256,
            commands: [
              'npx vitest run packages/core/test/centralMomentD3Q19.test.ts',
              'npx vitest run packages/core/test/centralMomentEigenProof.test.ts',
              'npx vitest run packages/core/test/shearModeTargeted.test.ts',
              'AEROFLOW_WRITE_COLLISION_QUALIFICATION=1 npx vitest run packages/core/test/collisionQualificationRecord.test.ts',
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  });
});
