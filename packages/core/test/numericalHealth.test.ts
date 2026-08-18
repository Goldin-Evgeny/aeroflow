import { describe, expect, it } from 'vitest';
import { numericalHealthPolicy } from '../src/validation/bands.js';
import {
  evaluateNumericalHealth,
  gatePhysicsVerdict,
  numericalHealthVerdict,
} from '../src/validation/numericalHealth.js';

const healthy = {
  nonFiniteCells: 0,
  densityMin: 0.99,
  densityMax: 1.01,
  relativeMassDrift: -1e-5,
  boundaryFluxClosure: 2e-6,
} as const;

describe('AIJ numerical-health policy', () => {
  const policy = numericalHealthPolicy('V13');

  it('passes only when every required metric is present and within its declared limit', () => {
    const result = evaluateNumericalHealth(policy, healthy);
    expect(result.state).toBe('pass');
    expect(result.reasons).toEqual([]);
    expect(numericalHealthVerdict(result).metrics.boundaryFluxClosure).toMatchObject({
      state: 'pass',
      limit: 0.001,
      direction: 'abs-max',
    });
  });

  it('fails unhealthy fields and suppresses a measured physics verdict without deleting it', () => {
    const result = evaluateNumericalHealth(policy, { ...healthy, nonFiniteCells: 1 });
    expect(result.state).toBe('fail');
    expect(
      gatePhysicsVerdict({ state: 'pass', metrics: { q: 0.8, r: 0.9, points: 126 } }, result),
    ).toEqual({
      state: 'unevaluated',
      reason: 'numerical-health-failed',
      metrics: {
        q: 0.8,
        r: 0.9,
        points: 126,
        measuredState: 'pass',
        healthState: 'fail',
        healthReasonCodes: [],
      },
    });
  });

  it('retains a machine-readable reason for every missing metric or limit', () => {
    const missing = evaluateNumericalHealth(policy, {
      nonFiniteCells: 0,
      densityMin: 0.99,
    });
    expect(missing.state).toBe('unevaluated');
    expect(missing.reasons.map((reason) => [reason.metricId, reason.code])).toEqual([
      ['densityMax', 'missing-metric'],
      ['relativeMassDrift', 'missing-metric'],
      ['boundaryFluxClosure', 'missing-metric'],
    ]);

    const noLimit = structuredClone(policy);
    (noLimit.metrics[0] as { limit: number }).limit = Number.NaN;
    const result = evaluateNumericalHealth(noLimit, healthy);
    expect(result.reasons[0]).toMatchObject({
      metricId: 'nonFiniteCells',
      code: 'missing-limit',
    });
  });
});
