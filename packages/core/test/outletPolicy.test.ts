import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_OUTLET_POLICIES,
  acceptanceOutletPolicy,
  assertAcceptanceOutletConsistency,
  materialConfigurationFingerprint,
  resolveAcceptanceOutlet,
} from '../src/validation/outletPolicy.js';

describe('V11-V15 acceptance outlet policy', () => {
  it('preserves every scored runner selection at policy introduction', () => {
    expect(
      Object.fromEntries(
        ACCEPTANCE_OUTLET_POLICIES.map((policy) => [policy.caseId, policy.selectedOutlet]),
      ),
    ).toEqual({
      V11: 'pressure',
      V12: 'zero-gradient',
      V13: 'zero-gradient',
      V14: 'zero-gradient',
      V15: 'zero-gradient',
    });
    expect(new Set(ACCEPTANCE_OUTLET_POLICIES.map((policy) => policy.policyId)).size).toBe(5);
  });

  it('classifies a non-policy override as diagnostic and suppresses physics verdicts', () => {
    const resolved = resolveAcceptanceOutlet('V13', 'pressure');
    expect(resolved).toMatchObject({
      policyOutlet: 'zero-gradient',
      outlet: 'pressure',
      configurationKind: 'diagnostic-override',
      physicsVerdictAllowed: false,
    });
  });

  it('fails consistency checks for scene, report, or artifact drift', () => {
    const resolved = resolveAcceptanceOutlet('V14');
    expect(() =>
      assertAcceptanceOutletConsistency(resolved, resolved, 'urban report'),
    ).not.toThrow();
    expect(() =>
      assertAcceptanceOutletConsistency(
        resolved,
        { ...resolved, outlet: 'pressure' },
        'urban report',
      ),
    ).toThrow('urban report outlet pressure disagrees');
    expect(() =>
      assertAcceptanceOutletConsistency(
        resolved,
        { ...resolved, policyId: acceptanceOutletPolicy('V15').policyId },
        'checkpoint',
      ),
    ).toThrow('checkpoint outlet policy');
  });

  it('fingerprints material configuration canonically and includes outlet identity', () => {
    const left = materialConfigurationFingerprint({ outlet: 'pressure', grid: { nx: 4, ny: 3 } });
    const reordered = materialConfigurationFingerprint({
      grid: { ny: 3, nx: 4 },
      outlet: 'pressure',
    });
    const other = materialConfigurationFingerprint({
      grid: { ny: 3, nx: 4 },
      outlet: 'zero-gradient',
    });
    expect(left).toBe(reordered);
    expect(other).not.toBe(left);
  });
});
