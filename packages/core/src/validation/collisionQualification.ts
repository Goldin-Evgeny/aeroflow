import type { JsonValue } from './runArtifact.js';
import { materialConfigurationFingerprint } from './outletPolicy.js';
import {
  collisionOperatorDescriptor,
  type CollisionOperatorId,
  type ResearchCollisionCandidateId,
} from './collisionPolicy.js';

export type CollisionQualificationPhase = 'cpu' | 'gpu' | 'les';
export type CollisionQualificationState = 'qualified' | 'failed' | 'inconclusive';
export type CollisionArmState = 'pass' | 'fail' | 'unavailable' | 'not-run-upstream-failed';

export interface CollisionQualificationArm {
  readonly id: string;
  readonly phase: CollisionQualificationPhase;
  readonly gate: string;
  readonly configuration: Readonly<Record<string, JsonValue>>;
  readonly configurationFingerprint: string;
}

export interface CollisionQualificationManifest {
  readonly id: 'near-floor-collision-qualification/v1';
  readonly frozenBeforeEvidence: true;
  readonly baseline: {
    readonly revision: string;
    readonly pressureWorkspaceSnapshotSha256: string;
  };
  readonly productionOperatorId: CollisionOperatorId;
  readonly candidateOperatorId: ResearchCollisionCandidateId;
  readonly candidate: ReturnType<typeof collisionOperatorDescriptor>;
  readonly rates: {
    readonly shear: '1/tauEff';
    readonly bulk: 1;
    readonly nonHydrodynamic: 1;
  };
  readonly thresholds: {
    readonly cpuLocalInvariantAbsMax: 2e-15;
    readonly linearGainMax: 1;
    readonly nonlinearGainExclusiveMax: 1;
    readonly targetConstitutiveExclusiveMax: 1.2;
    readonly resolvedRelativeDeviationMax: 0.02;
    readonly cpuPeriodicNormalizedDriftMax: 1e-12;
    readonly boundaryFluxClosureAbsMax: 1e-3;
    readonly gpuLocalInvariantAbsMax: 5e-6;
    readonly gpuFp32ParityRelativeMax: 5e-5;
    readonly gpuFp16ParityRelativeMax: 2e-3;
    readonly throughputLossMax: 0.1;
  };
  readonly matrix: {
    readonly tau: readonly [0.5000005, 0.5000042, 0.500989, 0.8];
    readonly backgroundVelocity: readonly [0, 0.05, 0.1];
    readonly wavelengths: readonly [3.2, 8];
    readonly waveAxes: readonly [0, 1, 2];
    readonly transversePolarizations: 'both-per-axis';
    readonly lesCs: readonly [0, 0.1];
    readonly lesNorms: readonly ['legacy', 'spec'];
    readonly precisions: readonly ['float64-cpu', 'fp32', 'fp16-shifted'];
  };
  readonly arms: readonly CollisionQualificationArm[];
}

const MANIFEST_ID = 'near-floor-collision-qualification/v1' as const;

function arm(
  phase: CollisionQualificationPhase,
  id: string,
  gate: string,
  configuration: Readonly<Record<string, JsonValue>>,
): CollisionQualificationArm {
  return {
    id,
    phase,
    gate,
    configuration,
    configurationFingerprint: materialConfigurationFingerprint({
      manifestId: MANIFEST_ID,
      phase,
      id,
      gate,
      configuration,
    }),
  };
}

const CPU_ARMS = [
  arm('cpu', 'cpu-local-invariants', 'local-invariants', {
    manufacturedStates: [
      'equilibrium',
      'symmetric-stress',
      'off-diagonal-stress',
      'random-positive',
    ],
  }),
  arm('cpu', 'cpu-linear-spectrum', 'linear-spectrum', {
    tau: [0.5000005, 0.5000042, 0.500989, 0.8],
    backgroundVelocity: [0, 0.05, 0.1],
    wavelengths: [3.2, 8],
    waveAxes: [0, 1, 2],
    transversePolarizations: 'both-per-axis',
  }),
  arm('cpu', 'cpu-nonlinear-spectrum', 'nonlinear-spectrum', {
    tau: [0.5000005, 0.5000042, 0.500989, 0.8],
    backgroundVelocity: [0, 0.05, 0.1],
    wavelengths: [3.2, 8],
    waveAxes: [0, 1, 2],
    transversePolarizations: 'both-per-axis',
  }),
  arm('cpu', 'cpu-periodic-conservation', 'periodic-conservation', {
    steps: [60, 120, 240],
    wavelengths: [3.2, 8, 16],
    normalized: true,
  }),
  arm('cpu', 'cpu-analytic-zero', 'analytic-zero', {
    periodicUniform: true,
    seededResponse: true,
  }),
  arm('cpu', 'cpu-established-controls', 'negative-controls', {
    operators: [
      'd3q19-regularized-trt/v1',
      'plain-trt',
      'rr3-negative',
      'd3q27-central-moment-research',
    ],
  }),
  ...(['empty-tunnel', 'abl-fetch', 'ahmed-body', 'aij-case-a', 'urban-case-c'] as const).map(
    (scene) =>
      arm('cpu', `cpu-scene-${scene}`, 'bounded-scene', {
        scene,
        physicsVerdict: 'not-evaluated',
        completeShellConservation: true,
      }),
  ),
] as const;

const GPU_ARMS = [
  arm('gpu', 'gpu-parity-fp32', 'parity', { precision: 'fp32', boundaryLayouts: 'shipped' }),
  arm('gpu', 'gpu-parity-fp16', 'parity', {
    precision: 'fp16-shifted',
    boundaryLayouts: 'shipped',
  }),
  arm('gpu', 'gpu-bounded-scenes', 'bounded-scenes', {
    scenes: ['empty-tunnel', 'abl-fetch', 'ahmed-body', 'aij-case-a', 'urban-case-c'],
  }),
  arm('gpu', 'gpu-checkpoint-restore', 'checkpoint', { exactIdentity: true, urbanResume: true }),
  arm('gpu', 'gpu-memory-throughput', 'performance', {
    populations: 19,
    steadySamples: 3,
    comparison: 'same-adapter-scene-precision-schedule',
  }),
] as const;

const LES_ARMS = [
  arm('les', 'les-spectral-constitutive', 'spectral-constitutive', {
    lesCs: 0.1,
    lesNorm: 'spec',
    fullCpuGpuMatrix: true,
  }),
  arm('les', 'les-analytic-zero', 'analytic-zero', {
    lesCs: 0.1,
    lesNorm: 'spec',
    seededResponse: true,
  }),
  arm('les', 'les-bounded-scenes', 'bounded-scenes', {
    scenes: ['empty-tunnel', 'abl-fetch', 'ahmed-body', 'aij-case-a', 'urban-case-c'],
  }),
  arm('les', 'les-parity-checkpoint', 'parity-checkpoint', {
    precisions: ['fp32', 'fp16-shifted'],
    exactIdentity: true,
  }),
  arm('les', 'les-memory-throughput', 'performance', {
    populations: 19,
    steadySamples: 3,
  }),
] as const;

export const COLLISION_QUALIFICATION_MANIFEST: CollisionQualificationManifest = {
  id: MANIFEST_ID,
  frozenBeforeEvidence: true,
  baseline: {
    revision: 'c6e2c2d207278c962307c1967567f14118e8068c',
    pressureWorkspaceSnapshotSha256:
      'd9fa2269b6496e917567b15c0f3d0aea9c50ba9c1f7af1b829382a33d32ee437',
  },
  productionOperatorId: 'd3q19-regularized-trt/v1',
  candidateOperatorId: 'd3q19-central-moment-mrt/v1',
  candidate: collisionOperatorDescriptor('d3q19-central-moment-mrt/v1'),
  rates: { shear: '1/tauEff', bulk: 1, nonHydrodynamic: 1 },
  thresholds: {
    cpuLocalInvariantAbsMax: 2e-15,
    linearGainMax: 1,
    nonlinearGainExclusiveMax: 1,
    targetConstitutiveExclusiveMax: 1.2,
    resolvedRelativeDeviationMax: 0.02,
    cpuPeriodicNormalizedDriftMax: 1e-12,
    boundaryFluxClosureAbsMax: 1e-3,
    gpuLocalInvariantAbsMax: 5e-6,
    gpuFp32ParityRelativeMax: 5e-5,
    gpuFp16ParityRelativeMax: 2e-3,
    throughputLossMax: 0.1,
  },
  matrix: {
    tau: [0.5000005, 0.5000042, 0.500989, 0.8],
    backgroundVelocity: [0, 0.05, 0.1],
    wavelengths: [3.2, 8],
    waveAxes: [0, 1, 2],
    transversePolarizations: 'both-per-axis',
    lesCs: [0, 0.1],
    lesNorms: ['legacy', 'spec'],
    precisions: ['float64-cpu', 'fp32', 'fp16-shifted'],
  },
  arms: [...CPU_ARMS, ...GPU_ARMS, ...LES_ARMS],
} as const;

export interface CollisionQualificationEvidence {
  readonly manifestId: string;
  readonly armId: string;
  readonly configurationFingerprint: string;
  readonly state: CollisionArmState;
  readonly reason?: string;
  readonly metrics: Readonly<Record<string, JsonValue>>;
}

export interface CollisionQualificationReason {
  readonly code:
    | 'manifest-mismatch'
    | 'unexpected-arm'
    | 'missing-arm'
    | 'configuration-mismatch'
    | 'axis-failed'
    | 'axis-unavailable'
    | 'invalid-skip';
  readonly armId: string;
  readonly detail: string;
}

export interface CollisionQualificationResult {
  readonly manifestId: CollisionQualificationManifest['id'];
  readonly status: CollisionQualificationState;
  readonly completedPhase: 'none' | CollisionQualificationPhase;
  readonly reasons: readonly CollisionQualificationReason[];
  readonly physicsVerdict: 'not-evaluated';
}

/** Pure staged classifier: a decisive earlier-arm failure makes later not-run arms valid. */
export function classifyCollisionQualification(
  evidence: readonly CollisionQualificationEvidence[],
  manifest: CollisionQualificationManifest = COLLISION_QUALIFICATION_MANIFEST,
): CollisionQualificationResult {
  const reasons: CollisionQualificationReason[] = [];
  const expectedById = new Map(manifest.arms.map((entry) => [entry.id, entry]));
  const actualById = new Map(evidence.map((entry) => [entry.armId, entry]));
  for (const actual of evidence) {
    const expected = expectedById.get(actual.armId);
    if (!expected) {
      reasons.push({
        code: 'unexpected-arm',
        armId: actual.armId,
        detail: `arm ${actual.armId} is not declared by ${manifest.id}`,
      });
      continue;
    }
    if (actual.manifestId !== manifest.id) {
      reasons.push({
        code: 'manifest-mismatch',
        armId: actual.armId,
        detail: `manifest ${actual.manifestId} does not match ${manifest.id}`,
      });
    }
    if (actual.configurationFingerprint !== expected.configurationFingerprint) {
      reasons.push({
        code: 'configuration-mismatch',
        armId: actual.armId,
        detail: `configuration ${actual.configurationFingerprint} does not match ${expected.configurationFingerprint}`,
      });
    }
  }

  let completedPhase: CollisionQualificationResult['completedPhase'] = 'none';
  let decisiveFailure = false;
  for (const phase of ['cpu', 'gpu', 'les'] as const) {
    const arms = manifest.arms.filter((entry) => entry.phase === phase);
    const phaseEvidence = arms.map((entry) => ({
      expected: entry,
      actual: actualById.get(entry.id),
    }));
    for (const { expected, actual } of phaseEvidence) {
      if (!actual) {
        reasons.push({
          code: 'missing-arm',
          armId: expected.id,
          detail: `required ${phase} arm ${expected.id} is missing`,
        });
      } else if (actual.state === 'fail') {
        reasons.push({
          code: 'axis-failed',
          armId: expected.id,
          detail: actual.reason ?? `${expected.gate} gate failed`,
        });
        decisiveFailure = true;
      } else if (actual.state === 'unavailable') {
        reasons.push({
          code: 'axis-unavailable',
          armId: expected.id,
          detail: actual.reason ?? `${expected.gate} evidence is unavailable`,
        });
      } else if (actual.state === 'not-run-upstream-failed') {
        if (!decisiveFailure) {
          reasons.push({
            code: 'invalid-skip',
            armId: expected.id,
            detail: `${phase} arm cannot be skipped before an earlier decisive failure`,
          });
        }
      }
    }
    if (
      !decisiveFailure &&
      !reasons.some((reason) => expectedById.get(reason.armId)?.phase === phase)
    ) {
      completedPhase = phase;
    }
  }
  const structuralProblem = reasons.some((reason) => reason.code !== 'axis-failed');
  return {
    manifestId: manifest.id,
    status:
      decisiveFailure && !structuralProblem
        ? 'failed'
        : reasons.length === 0
          ? 'qualified'
          : 'inconclusive',
    completedPhase,
    reasons,
    physicsVerdict: 'not-evaluated',
  };
}
