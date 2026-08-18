import { materialConfigurationFingerprint } from './outletPolicy.js';

export type ProductionCollisionOperatorId = 'd3q19-regularized-trt/v1';
export type ResearchCollisionCandidateId = 'd3q19-central-moment-mrt/v1';
export type CollisionOperatorId = ProductionCollisionOperatorId | ResearchCollisionCandidateId;
export type CollisionConfigurationKind = 'production' | 'diagnostic-candidate';

export interface CollisionOperatorDescriptor {
  readonly id: CollisionOperatorId;
  readonly lattice: 'D3Q19';
  readonly equilibrium: 'quadratic' | 'central-moment-maxwell';
  readonly momentBasis: 'population-parity' | 'central-monomial-19';
  readonly relaxationPolicy: 'trt-lambda-3/16' | 'central-mrt-unit-ghosts';
  readonly regularizationPolicy: 'projected-second-order' | 'none-central-relaxation';
  readonly conservationPolicy: 'density-rest-correction' | 'unpatched-local-invariants';
  readonly implementationVersion: 1;
  readonly productionEligible: boolean;
}

export interface ProductionCollisionPolicy {
  readonly policyId: 'near-floor-collision/v1';
  readonly selectedOperatorId: ProductionCollisionOperatorId;
  readonly qualificationStatus: 'not-qualified';
  readonly evidence: null;
}

export interface ResolvedCollisionPolicy {
  readonly policyId: ProductionCollisionPolicy['policyId'];
  readonly policyOperatorId: ProductionCollisionOperatorId;
  readonly operatorId: CollisionOperatorId;
  readonly descriptor: CollisionOperatorDescriptor;
  readonly configurationKind: CollisionConfigurationKind;
  readonly physicsVerdictAllowed: boolean;
  readonly configurationFingerprint: string;
}

export const COLLISION_OPERATOR_REGISTRY: readonly CollisionOperatorDescriptor[] = [
  {
    id: 'd3q19-regularized-trt/v1',
    lattice: 'D3Q19',
    equilibrium: 'quadratic',
    momentBasis: 'population-parity',
    relaxationPolicy: 'trt-lambda-3/16',
    regularizationPolicy: 'projected-second-order',
    conservationPolicy: 'density-rest-correction',
    implementationVersion: 1,
    productionEligible: true,
  },
  {
    id: 'd3q19-central-moment-mrt/v1',
    lattice: 'D3Q19',
    equilibrium: 'central-moment-maxwell',
    momentBasis: 'central-monomial-19',
    relaxationPolicy: 'central-mrt-unit-ghosts',
    regularizationPolicy: 'none-central-relaxation',
    conservationPolicy: 'unpatched-local-invariants',
    implementationVersion: 1,
    productionEligible: false,
  },
] as const;

export const PRODUCTION_COLLISION_POLICY: ProductionCollisionPolicy = {
  policyId: 'near-floor-collision/v1',
  selectedOperatorId: 'd3q19-regularized-trt/v1',
  qualificationStatus: 'not-qualified',
  evidence: null,
};

export function collisionOperatorDescriptor(id: CollisionOperatorId): CollisionOperatorDescriptor {
  const descriptor = COLLISION_OPERATOR_REGISTRY.find((entry) => entry.id === id);
  if (!descriptor) throw new Error(`collisionOperatorDescriptor: unknown operator ${id}`);
  return descriptor;
}

export function resolveCollisionPolicy(
  candidateId?: ResearchCollisionCandidateId,
): ResolvedCollisionPolicy {
  const operatorId = candidateId ?? PRODUCTION_COLLISION_POLICY.selectedOperatorId;
  const descriptor = collisionOperatorDescriptor(operatorId);
  const configurationKind: CollisionConfigurationKind = candidateId
    ? 'diagnostic-candidate'
    : 'production';
  const identity = {
    policyId: PRODUCTION_COLLISION_POLICY.policyId,
    policyOperatorId: PRODUCTION_COLLISION_POLICY.selectedOperatorId,
    operatorId,
    descriptor,
    configurationKind,
  };
  return {
    ...identity,
    physicsVerdictAllowed: configurationKind === 'production',
    configurationFingerprint: materialConfigurationFingerprint(identity),
  };
}

export function assertCollisionPolicyConsistency(
  expected: Pick<
    ResolvedCollisionPolicy,
    'policyId' | 'operatorId' | 'configurationKind' | 'configurationFingerprint'
  >,
  actual: Partial<
    Pick<
      ResolvedCollisionPolicy,
      'policyId' | 'operatorId' | 'configurationKind' | 'configurationFingerprint'
    >
  >,
  surface: string,
): void {
  for (const key of [
    'policyId',
    'operatorId',
    'configurationKind',
    'configurationFingerprint',
  ] as const) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `${surface} collision ${key} ${String(actual[key])} disagrees with ${String(expected[key])}`,
      );
    }
  }
}
