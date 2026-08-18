import type { Outlet3D } from '../cpu/outlet3d.js';

export type NearFloorValidationCaseId = 'V11' | 'V12' | 'V13' | 'V14' | 'V15';
export type OutletQualificationStatus = 'qualified' | 'not-qualified' | 'failed' | 'inconclusive';
export type OutletConfigurationKind = 'acceptance' | 'diagnostic-override';

export interface AcceptanceOutletPolicy {
  readonly caseId: NearFloorValidationCaseId;
  /** Stable identity copied into artifacts and checkpoints. */
  readonly policyId: string;
  readonly selectedOutlet: Outlet3D;
  readonly qualificationStatus: OutletQualificationStatus;
  /** Durable evidence for the selected value, or null when qualification is still pending. */
  readonly evidence: string | null;
}

export interface ResolvedAcceptanceOutlet {
  readonly caseId: NearFloorValidationCaseId;
  readonly policyId: string;
  readonly policyOutlet: Outlet3D;
  readonly outlet: Outlet3D;
  readonly qualificationStatus: OutletQualificationStatus;
  readonly evidence: string | null;
  readonly configurationKind: OutletConfigurationKind;
  readonly physicsVerdictAllowed: boolean;
}

/**
 * V11-V15 acceptance outlet authority.
 *
 * These values deliberately mirror the scored runners at policy introduction. In particular,
 * V12-V15 remain zero-gradient until one complete qualification record authorizes promotion.
 */
export const ACCEPTANCE_OUTLET_POLICIES: readonly AcceptanceOutletPolicy[] = [
  {
    caseId: 'V11',
    policyId: 'near-floor-outlet/V11/v1',
    selectedOutlet: 'pressure',
    qualificationStatus: 'qualified',
    evidence:
      'docs/VALIDATION.md#outlet-legality-ab--2026-08-14-fix-confirmed-physics-defects-phase-5',
  },
  {
    caseId: 'V12',
    policyId: 'near-floor-outlet/V12/v1',
    selectedOutlet: 'zero-gradient',
    qualificationStatus: 'failed',
    evidence:
      'docs/validation/runs/artifacts/2026-08-18-pressure-outlet-qualification/pressure-qualification.json',
  },
  {
    caseId: 'V13',
    policyId: 'near-floor-outlet/V13/v1',
    selectedOutlet: 'zero-gradient',
    qualificationStatus: 'failed',
    evidence:
      'docs/validation/runs/artifacts/2026-08-18-pressure-outlet-qualification/pressure-qualification.json',
  },
  {
    caseId: 'V14',
    policyId: 'near-floor-outlet/V14/v1',
    selectedOutlet: 'zero-gradient',
    qualificationStatus: 'failed',
    evidence:
      'docs/validation/runs/artifacts/2026-08-18-pressure-outlet-qualification/pressure-qualification.json',
  },
  {
    caseId: 'V15',
    policyId: 'near-floor-outlet/V15/v1',
    selectedOutlet: 'zero-gradient',
    qualificationStatus: 'failed',
    evidence:
      'docs/validation/runs/artifacts/2026-08-18-pressure-outlet-qualification/pressure-qualification.json',
  },
] as const;

export function acceptanceOutletPolicy(caseId: NearFloorValidationCaseId): AcceptanceOutletPolicy {
  const policy = ACCEPTANCE_OUTLET_POLICIES.find((entry) => entry.caseId === caseId);
  if (!policy) throw new Error(`acceptanceOutletPolicy: unknown case id ${caseId}`);
  return policy;
}

export function resolveAcceptanceOutlet(
  caseId: NearFloorValidationCaseId,
  override?: Outlet3D,
): ResolvedAcceptanceOutlet {
  const policy = acceptanceOutletPolicy(caseId);
  const outlet = override ?? policy.selectedOutlet;
  const configurationKind: OutletConfigurationKind =
    outlet === policy.selectedOutlet ? 'acceptance' : 'diagnostic-override';
  return {
    ...policy,
    policyOutlet: policy.selectedOutlet,
    outlet,
    configurationKind,
    physicsVerdictAllowed: configurationKind === 'acceptance',
  };
}

export function assertAcceptanceOutletConsistency(
  expected: Pick<ResolvedAcceptanceOutlet, 'caseId' | 'policyId' | 'outlet' | 'configurationKind'>,
  actual: {
    readonly policyId?: string;
    readonly outlet?: Outlet3D;
    readonly configurationKind?: OutletConfigurationKind;
  },
  surface: string,
): void {
  if (actual.policyId !== expected.policyId) {
    throw new Error(
      `${surface} outlet policy ${String(actual.policyId)} disagrees with ${expected.caseId} policy ${expected.policyId}`,
    );
  }
  if (actual.outlet !== expected.outlet) {
    throw new Error(
      `${surface} outlet ${String(actual.outlet)} disagrees with resolved ${expected.caseId} outlet ${expected.outlet}`,
    );
  }
  if (actual.configurationKind !== expected.configurationKind) {
    throw new Error(
      `${surface} configuration ${String(actual.configurationKind)} disagrees with resolved ${expected.configurationKind}`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

/** Portable deterministic FNV-1a fingerprint for browser and CPU qualification records. */
export function materialConfigurationFingerprint(value: unknown): string {
  const input = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
