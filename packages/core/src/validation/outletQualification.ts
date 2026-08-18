import type { JsonValue } from './runArtifact.js';
import type { NearFloorValidationCaseId } from './outletPolicy.js';
import { materialConfigurationFingerprint } from './outletPolicy.js';

export type QualificationBackend = 'cpu-f64' | 'gpu-f32';
export type QualificationClosure = 'legacy' | 'spec';
export type QualificationSceneFamily =
  'empty-tunnel' | 'ahmed-body' | 'abl-fetch' | 'aij-case-a' | 'urban-case-c' | 'near-floor-parity';
export type QualificationAxis = 'execution' | 'numerical-health' | 'conservation' | 'parity';
export type QualificationAxisState = 'pass' | 'fail' | 'unavailable';
export type PressureQualificationStatus = 'qualified' | 'failed' | 'inconclusive';

export interface PressureQualificationArm {
  readonly id: string;
  readonly caseIds: readonly NearFloorValidationCaseId[];
  readonly sceneFamily: QualificationSceneFamily;
  readonly backend: QualificationBackend;
  readonly closure: QualificationClosure;
  readonly boundaryLayout: string;
  readonly relaxation: { readonly tau0: number; readonly lesCs: number };
  readonly exposureSteps: number;
  readonly requiredAxes: readonly QualificationAxis[];
  readonly healthPolicyCaseId: NearFloorValidationCaseId;
  readonly checkpointResume: boolean;
  readonly boundedPhysicsOnly: true;
  readonly configurationFingerprint: string;
}

export interface PressureQualificationManifest {
  readonly id: 'near-floor-pressure-qualification/v1';
  readonly outlet: 'pressure';
  readonly frozenBeforeEvidence: true;
  readonly thresholds: {
    readonly cpuGpuRelativeMax: number;
    readonly sameConfigurationRepeatabilityMax: number;
    readonly boundaryFluxClosureAbsMax: number;
  };
  readonly arms: readonly PressureQualificationArm[];
}

const ALL_AXES = ['execution', 'numerical-health', 'conservation', 'parity'] as const;
const NO_PARITY = ['execution', 'numerical-health', 'conservation'] as const;
const TAU0 = 0.5000005;
const LES_CS = 0.1;

function arm(
  input: Omit<PressureQualificationArm, 'configurationFingerprint' | 'boundedPhysicsOnly'>,
): PressureQualificationArm {
  const material = {
    manifestId: 'near-floor-pressure-qualification/v1',
    outlet: 'pressure',
    caseIds: input.caseIds,
    sceneFamily: input.sceneFamily,
    backend: input.backend,
    closure: input.closure,
    boundaryLayout: input.boundaryLayout,
    relaxation: input.relaxation,
    exposureSteps: input.exposureSteps,
    checkpointResume: input.checkpointResume,
  };
  return {
    ...input,
    boundedPhysicsOnly: true,
    configurationFingerprint: materialConfigurationFingerprint(material),
  };
}

/** Frozen before the opt-in evidence run. Bounded measurements never use V11-V15 bands. */
export const PRESSURE_QUALIFICATION_MANIFEST: PressureQualificationManifest = {
  id: 'near-floor-pressure-qualification/v1',
  outlet: 'pressure',
  frozenBeforeEvidence: true,
  thresholds: {
    cpuGpuRelativeMax: 1e-6,
    sameConfigurationRepeatabilityMax: 1e-12,
    boundaryFluxClosureAbsMax: 1e-3,
  },
  arms: [
    arm({
      id: 'empty-legacy-cpu-a',
      caseIds: ['V11', 'V12', 'V13', 'V14', 'V15'],
      sceneFamily: 'empty-tunnel',
      backend: 'cpu-f64',
      closure: 'legacy',
      boundaryLayout: 'near-floor-free-slip-complete-shell',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 3_600,
      requiredAxes: NO_PARITY,
      healthPolicyCaseId: 'V12',
      checkpointResume: false,
    }),
    arm({
      id: 'empty-legacy-cpu-repeat',
      caseIds: ['V11', 'V12', 'V13', 'V14', 'V15'],
      sceneFamily: 'empty-tunnel',
      backend: 'cpu-f64',
      closure: 'legacy',
      boundaryLayout: 'near-floor-free-slip-complete-shell',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 3_600,
      requiredAxes: ALL_AXES,
      healthPolicyCaseId: 'V12',
      checkpointResume: false,
    }),
    arm({
      id: 'empty-spec-cpu-a',
      caseIds: ['V11', 'V12', 'V13', 'V14', 'V15'],
      sceneFamily: 'empty-tunnel',
      backend: 'cpu-f64',
      closure: 'spec',
      boundaryLayout: 'near-floor-free-slip-complete-shell',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 3_600,
      requiredAxes: NO_PARITY,
      healthPolicyCaseId: 'V12',
      checkpointResume: false,
    }),
    arm({
      id: 'empty-spec-cpu-repeat',
      caseIds: ['V11', 'V12', 'V13', 'V14', 'V15'],
      sceneFamily: 'empty-tunnel',
      backend: 'cpu-f64',
      closure: 'spec',
      boundaryLayout: 'near-floor-free-slip-complete-shell',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 3_600,
      requiredAxes: ALL_AXES,
      healthPolicyCaseId: 'V12',
      checkpointResume: false,
    }),
    arm({
      id: 'ahmed-body-gpu',
      caseIds: ['V11'],
      sceneFamily: 'ahmed-body',
      backend: 'gpu-f32',
      closure: 'legacy',
      boundaryLayout: 'freestream-lateral-velocity-inlet-no-slip-ground',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 400,
      requiredAxes: NO_PARITY,
      healthPolicyCaseId: 'V12',
      checkpointResume: false,
    }),
    arm({
      id: 'abl-fetch-gpu',
      caseIds: ['V12'],
      sceneFamily: 'abl-fetch',
      backend: 'gpu-f32',
      closure: 'legacy',
      boundaryLayout: 'abl-velocity-inlet-free-slip-lateral-no-slip-ground',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 400,
      requiredAxes: NO_PARITY,
      healthPolicyCaseId: 'V12',
      checkpointResume: false,
    }),
    arm({
      id: 'aij-case-a-gpu',
      caseIds: ['V13'],
      sceneFamily: 'aij-case-a',
      backend: 'gpu-f32',
      closure: 'legacy',
      boundaryLayout: 'case-a-acceptance-tier-shell',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 400,
      requiredAxes: NO_PARITY,
      healthPolicyCaseId: 'V13',
      checkpointResume: false,
    }),
    arm({
      id: 'urban-case-c-gpu-resume',
      caseIds: ['V14'],
      sceneFamily: 'urban-case-c',
      backend: 'gpu-f32',
      closure: 'legacy',
      boundaryLayout: 'case-c-acceptance-tier-shell',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 400,
      requiredAxes: NO_PARITY,
      healthPolicyCaseId: 'V14',
      checkpointResume: true,
    }),
    arm({
      id: 'near-floor-pressure-cpu-gpu-parity',
      caseIds: ['V11', 'V12', 'V13', 'V14', 'V15'],
      sceneFamily: 'near-floor-parity',
      backend: 'gpu-f32',
      closure: 'legacy',
      boundaryLayout: 'near-floor-free-slip-complete-shell',
      relaxation: { tau0: TAU0, lesCs: LES_CS },
      exposureSteps: 100,
      requiredAxes: ALL_AXES,
      healthPolicyCaseId: 'V12',
      checkpointResume: false,
    }),
  ],
} as const;

export interface QualificationAxisEvidence {
  readonly state: QualificationAxisState;
  readonly reason?: string;
  readonly metrics: Readonly<Record<string, JsonValue>>;
}

export interface PressureQualificationArmEvidence {
  readonly armId: string;
  readonly configurationFingerprint: string;
  readonly axes: Readonly<Partial<Record<QualificationAxis, QualificationAxisEvidence>>>;
  /** Recorded only; never interpreted against a V11-V15 physics band. */
  readonly boundedMeasurements: Readonly<Record<string, JsonValue>>;
}

export interface PressureQualificationReason {
  readonly code:
    | 'missing-arm'
    | 'unexpected-arm'
    | 'configuration-mismatch'
    | 'missing-axis'
    | 'axis-failed'
    | 'axis-unavailable';
  readonly armId: string;
  readonly axis?: QualificationAxis;
  readonly detail: string;
}

export interface PressureQualificationResult {
  readonly manifestId: PressureQualificationManifest['id'];
  readonly status: PressureQualificationStatus;
  readonly reasons: readonly PressureQualificationReason[];
  readonly arms: readonly PressureQualificationArmEvidence[];
  readonly boundedPhysicsVerdict: 'not-evaluated';
}

/** Pure classifier. Thresholds are read only from the frozen manifest, never from evidence. */
export function classifyPressureQualification(
  evidence: readonly PressureQualificationArmEvidence[],
  manifest: PressureQualificationManifest = PRESSURE_QUALIFICATION_MANIFEST,
): PressureQualificationResult {
  const reasons: PressureQualificationReason[] = [];
  const byId = new Map(evidence.map((entry) => [entry.armId, entry]));
  const manifestIds = new Set(manifest.arms.map((entry) => entry.id));
  for (const candidate of evidence) {
    if (!manifestIds.has(candidate.armId)) {
      reasons.push({
        code: 'unexpected-arm',
        armId: candidate.armId,
        detail: `arm ${candidate.armId} is not declared by ${manifest.id}`,
      });
    }
  }
  for (const expected of manifest.arms) {
    const actual = byId.get(expected.id);
    if (!actual) {
      reasons.push({
        code: 'missing-arm',
        armId: expected.id,
        detail: `required arm ${expected.id} is missing`,
      });
      continue;
    }
    if (actual.configurationFingerprint !== expected.configurationFingerprint) {
      reasons.push({
        code: 'configuration-mismatch',
        armId: expected.id,
        detail: `configuration fingerprint ${actual.configurationFingerprint} does not match ${expected.configurationFingerprint}`,
      });
    }
    for (const axis of expected.requiredAxes) {
      const result = actual.axes[axis];
      if (!result) {
        reasons.push({
          code: 'missing-axis',
          armId: expected.id,
          axis,
          detail: `required ${axis} evidence is missing`,
        });
      } else if (result.state === 'fail') {
        reasons.push({
          code: 'axis-failed',
          armId: expected.id,
          axis,
          detail: result.reason ?? `${axis} gate failed`,
        });
      } else if (result.state === 'unavailable') {
        reasons.push({
          code: 'axis-unavailable',
          armId: expected.id,
          axis,
          detail: result.reason ?? `${axis} evidence is unavailable`,
        });
      }
    }
  }
  const status: PressureQualificationStatus = reasons.some(
    (reason) => reason.code === 'axis-failed',
  )
    ? 'failed'
    : reasons.length > 0
      ? 'inconclusive'
      : 'qualified';
  return {
    manifestId: manifest.id,
    status,
    reasons,
    arms: evidence.map((entry) => ({ ...entry })),
    boundedPhysicsVerdict: 'not-evaluated',
  };
}
