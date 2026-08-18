import { describe, expect, it } from 'vitest';
import {
  COLLISION_OPERATOR_REGISTRY,
  PRODUCTION_COLLISION_POLICY,
  assertCollisionPolicyConsistency,
  resolveCollisionPolicy,
} from '../src/validation/collisionPolicy.js';

describe('near-floor collision policy', () => {
  it('keeps omitted selection on the production operator', () => {
    expect(resolveCollisionPolicy()).toMatchObject({
      policyId: 'near-floor-collision/v1',
      operatorId: 'd3q19-regularized-trt/v1',
      configurationKind: 'production',
      physicsVerdictAllowed: true,
    });
    expect(PRODUCTION_COLLISION_POLICY.qualificationStatus).toBe('not-qualified');
  });

  it('keeps the candidate opt-in and physics-ineligible', () => {
    const candidate = resolveCollisionPolicy('d3q19-central-moment-mrt/v1');
    expect(candidate).toMatchObject({
      operatorId: 'd3q19-central-moment-mrt/v1',
      configurationKind: 'diagnostic-candidate',
      physicsVerdictAllowed: false,
    });
    expect(
      COLLISION_OPERATOR_REGISTRY.find((entry) => entry.id === candidate.operatorId),
    ).toMatchObject({
      lattice: 'D3Q19',
      productionEligible: false,
    });
  });

  it('detects artifact and checkpoint identity drift', () => {
    const expected = resolveCollisionPolicy('d3q19-central-moment-mrt/v1');
    expect(() => assertCollisionPolicyConsistency(expected, expected, 'artifact')).not.toThrow();
    expect(() =>
      assertCollisionPolicyConsistency(
        expected,
        { ...expected, operatorId: 'd3q19-regularized-trt/v1' },
        'checkpoint',
      ),
    ).toThrow('checkpoint collision operatorId');
  });
});
