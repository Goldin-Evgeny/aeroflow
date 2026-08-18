import { describe, expect, it } from 'vitest';
import {
  COLLISION_QUALIFICATION_MANIFEST,
  classifyCollisionQualification,
  type CollisionQualificationEvidence,
} from '../src/validation/collisionQualification.js';

function evidence(
  state: CollisionQualificationEvidence['state'] = 'pass',
): CollisionQualificationEvidence[] {
  return COLLISION_QUALIFICATION_MANIFEST.arms.map((arm) => ({
    manifestId: COLLISION_QUALIFICATION_MANIFEST.id,
    armId: arm.id,
    configurationFingerprint: arm.configurationFingerprint,
    state,
    metrics: {},
  }));
}

describe('frozen near-floor collision qualification', () => {
  it('pins the baseline, candidate, matrix, and decisive gates', () => {
    const manifest = COLLISION_QUALIFICATION_MANIFEST;
    expect(manifest.frozenBeforeEvidence).toBe(true);
    expect(manifest.baseline.revision).toHaveLength(40);
    expect(manifest.baseline.pressureWorkspaceSnapshotSha256).toHaveLength(64);
    expect(manifest.candidateOperatorId).toBe('d3q19-central-moment-mrt/v1');
    expect(manifest.matrix).toMatchObject({
      backgroundVelocity: [0, 0.05, 0.1],
      wavelengths: [3.2, 8],
      waveAxes: [0, 1, 2],
    });
    expect(manifest.thresholds).toMatchObject({
      nonlinearGainExclusiveMax: 1,
      targetConstitutiveExclusiveMax: 1.2,
      resolvedRelativeDeviationMax: 0.02,
      throughputLossMax: 0.1,
    });
    expect(new Set(manifest.arms.map((arm) => arm.phase))).toEqual(new Set(['cpu', 'gpu', 'les']));
  });

  it('qualifies only a complete passing matrix', () => {
    expect(classifyCollisionQualification(evidence())).toMatchObject({
      status: 'qualified',
      completedPhase: 'les',
      reasons: [],
      physicsVerdict: 'not-evaluated',
    });
  });

  it('returns inconclusive for missing evidence and configuration drift', () => {
    const missing = evidence().slice(1);
    expect(classifyCollisionQualification(missing).status).toBe('inconclusive');
    const drift = evidence();
    drift[0] = { ...drift[0], configurationFingerprint: 'fnv1a32:wrong' };
    expect(classifyCollisionQualification(drift)).toMatchObject({ status: 'inconclusive' });
  });

  it('returns failed on a decisive CPU gate and accepts downstream not-run markers', () => {
    const all = evidence();
    const cpu = COLLISION_QUALIFICATION_MANIFEST.arms.filter((arm) => arm.phase === 'cpu');
    const decisive = cpu.find((arm) => arm.id === 'cpu-linear-spectrum')!;
    const failed = all.map((entry) => {
      const phase = COLLISION_QUALIFICATION_MANIFEST.arms.find(
        (arm) => arm.id === entry.armId,
      )!.phase;
      if (entry.armId === decisive.id)
        return { ...entry, state: 'fail' as const, reason: 'gain > 1' };
      const decisiveIndex = COLLISION_QUALIFICATION_MANIFEST.arms.findIndex(
        (arm) => arm.id === decisive.id,
      );
      const entryIndex = COLLISION_QUALIFICATION_MANIFEST.arms.findIndex(
        (arm) => arm.id === entry.armId,
      );
      if (entryIndex > decisiveIndex || phase !== 'cpu') {
        return { ...entry, state: 'not-run-upstream-failed' as const };
      }
      return entry;
    });
    const result = classifyCollisionQualification(failed);
    expect(result.status).toBe('failed');
    expect(result.reasons).toContainEqual(
      expect.objectContaining({ code: 'axis-failed', armId: decisive.id }),
    );
    expect(result.reasons.some((reason) => reason.code === 'missing-arm')).toBe(false);
  });

  it('rejects manifest mismatches and premature skip markers', () => {
    const wrongManifest = evidence();
    wrongManifest[0] = { ...wrongManifest[0], manifestId: 'other/v1' };
    expect(classifyCollisionQualification(wrongManifest).status).toBe('inconclusive');
    const skipped = evidence();
    skipped[0] = { ...skipped[0], state: 'not-run-upstream-failed' };
    expect(classifyCollisionQualification(skipped)).toMatchObject({ status: 'inconclusive' });
  });
});
