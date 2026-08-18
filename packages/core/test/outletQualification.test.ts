import { describe, expect, it } from 'vitest';
import {
  PRESSURE_QUALIFICATION_MANIFEST,
  classifyPressureQualification,
  type PressureQualificationArmEvidence,
} from '../src/validation/outletQualification.js';

const passAxis = { state: 'pass' as const, metrics: {} };

function passingEvidence(): PressureQualificationArmEvidence[] {
  return PRESSURE_QUALIFICATION_MANIFEST.arms.map((arm) => ({
    armId: arm.id,
    configurationFingerprint: arm.configurationFingerprint,
    axes: Object.fromEntries(arm.requiredAxes.map((axis) => [axis, passAxis])),
    boundedMeasurements: { smokeOnly: true },
  }));
}

describe('frozen pressure-outlet qualification manifest', () => {
  it('covers both closures, every affected scene, parity, and checkpoint/resume', () => {
    expect(new Set(PRESSURE_QUALIFICATION_MANIFEST.arms.map((arm) => arm.closure))).toEqual(
      new Set(['legacy', 'spec']),
    );
    expect(new Set(PRESSURE_QUALIFICATION_MANIFEST.arms.flatMap((arm) => arm.caseIds))).toEqual(
      new Set(['V11', 'V12', 'V13', 'V14', 'V15']),
    );
    expect(
      PRESSURE_QUALIFICATION_MANIFEST.arms.filter(
        (arm) => arm.sceneFamily === 'empty-tunnel' && arm.exposureSteps >= 3_600,
      ),
    ).toHaveLength(4);
    expect(PRESSURE_QUALIFICATION_MANIFEST.arms.some((arm) => arm.checkpointResume)).toBe(true);
    expect(
      PRESSURE_QUALIFICATION_MANIFEST.arms.some((arm) => arm.requiredAxes.includes('parity')),
    ).toBe(true);
  });

  it('requires every arm and every declared axis before qualification', () => {
    const complete = passingEvidence();
    expect(classifyPressureQualification(complete)).toMatchObject({
      status: 'qualified',
      reasons: [],
      boundedPhysicsVerdict: 'not-evaluated',
    });
    const missingArm = classifyPressureQualification(complete.slice(1));
    expect(missingArm.status).toBe('inconclusive');
    expect(missingArm.reasons[0]).toMatchObject({ code: 'missing-arm' });
    const missingAxis = structuredClone(complete);
    missingAxis[0] = {
      ...missingAxis[0],
      axes: Object.fromEntries(
        Object.entries(missingAxis[0].axes).filter(([axis]) => axis !== 'execution'),
      ),
    };
    expect(classifyPressureQualification(missingAxis)).toMatchObject({
      status: 'inconclusive',
      reasons: [expect.objectContaining({ code: 'missing-axis', axis: 'execution' })],
    });
  });

  it.each(['execution', 'numerical-health', 'conservation', 'parity'] as const)(
    'reports an independent %s failure with a machine-readable reason',
    (axis) => {
      const evidence = passingEvidence();
      const index = evidence.findIndex((entry) => entry.axes[axis]);
      const arm = evidence[index];
      evidence[index] = {
        ...arm,
        axes: {
          ...arm.axes,
          [axis]: {
            state: 'fail',
            reason: axis + '-gate',
            metrics: { observed: 2, limit: 1 },
          },
        },
      };
      expect(classifyPressureQualification(evidence)).toMatchObject({
        status: 'failed',
        reasons: [
          expect.objectContaining({
            code: 'axis-failed',
            armId: arm.armId,
            axis,
            detail: axis + '-gate',
          }),
        ],
      });
    },
  );

  it('treats unavailable execution and configuration mismatch as inconclusive', () => {
    const evidence = passingEvidence();
    evidence[0] = {
      ...evidence[0],
      axes: {
        ...evidence[0].axes,
        execution: { state: 'unavailable', reason: 'adapter unavailable', metrics: {} },
      },
    };
    evidence[1] = { ...evidence[1], configurationFingerprint: 'fnv1a32:wrong' };
    const result = classifyPressureQualification(evidence);
    expect(result.status).toBe('inconclusive');
    expect(result.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(['axis-unavailable', 'configuration-mismatch']),
    );
  });

  it('never promotes bounded smoke measurements to a physics verdict', () => {
    const evidence = passingEvidence().map((entry) => ({
      ...entry,
      boundedMeasurements: { q: 1, r: 1, cd: 0.285 },
    }));
    const result = classifyPressureQualification(evidence);
    expect(result.status).toBe('qualified');
    expect(result.boundedPhysicsVerdict).toBe('not-evaluated');
    expect(result.arms[0].boundedMeasurements).toHaveProperty('q', 1);
  });
});
