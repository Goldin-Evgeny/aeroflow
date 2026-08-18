import type { NumericalHealthMetricPolicy, NumericalHealthPolicy } from './bands.js';
import type { JsonValue, VerdictAxis, VerdictState } from './runArtifact.js';

export type HealthEvaluationReasonCode = 'missing-metric' | 'missing-limit' | 'non-finite-metric';

export interface HealthEvaluationReason {
  readonly code: HealthEvaluationReasonCode;
  readonly metricId: string;
  readonly detail: string;
}

export interface HealthMetricEvaluation {
  readonly id: NumericalHealthMetricPolicy['id'];
  readonly state: 'pass' | 'fail' | 'unevaluated';
  readonly value?: number;
  readonly limit?: number;
  readonly direction: NumericalHealthMetricPolicy['direction'];
  readonly unit: string;
  readonly provenance: string;
  readonly reason?: HealthEvaluationReason;
}

export interface NumericalHealthEvaluation {
  readonly caseId: string;
  readonly state: VerdictState;
  readonly metrics: Readonly<Record<string, HealthMetricEvaluation>>;
  readonly reasons: readonly HealthEvaluationReason[];
}

export type NumericalHealthMeasurements = Partial<
  Record<NumericalHealthMetricPolicy['id'], number | null | undefined>
>;

function metricPass(value: number, policy: NumericalHealthMetricPolicy): boolean {
  switch (policy.direction) {
    case 'max':
      return value <= policy.limit;
    case 'min':
      return value >= policy.limit;
    case 'abs-max':
      return Math.abs(value) <= policy.limit;
  }
}

/** Pure, deterministic scoring of a health snapshot against its predeclared policy. */
export function evaluateNumericalHealth(
  policy: NumericalHealthPolicy,
  measurements: NumericalHealthMeasurements,
): NumericalHealthEvaluation {
  const metrics: Record<string, HealthMetricEvaluation> = {};
  const reasons: HealthEvaluationReason[] = [];
  for (const metric of policy.metrics) {
    const value = measurements[metric.id];
    if (value === undefined || value === null) {
      const reason: HealthEvaluationReason = {
        code: 'missing-metric',
        metricId: metric.id,
        detail: `required metric ${metric.id} was not supplied`,
      };
      reasons.push(reason);
      metrics[metric.id] = {
        id: metric.id,
        state: 'unevaluated',
        limit: metric.limit,
        direction: metric.direction,
        unit: metric.unit,
        provenance: metric.provenance,
        reason,
      };
      continue;
    }
    if (!Number.isFinite(metric.limit)) {
      const reason: HealthEvaluationReason = {
        code: 'missing-limit',
        metricId: metric.id,
        detail: `required metric ${metric.id} has no finite policy limit`,
      };
      reasons.push(reason);
      metrics[metric.id] = {
        id: metric.id,
        state: 'unevaluated',
        value,
        direction: metric.direction,
        unit: metric.unit,
        provenance: metric.provenance,
        reason,
      };
      continue;
    }
    if (!Number.isFinite(value)) {
      const reason: HealthEvaluationReason = {
        code: 'non-finite-metric',
        metricId: metric.id,
        detail: `required metric ${metric.id} is non-finite`,
      };
      reasons.push(reason);
      metrics[metric.id] = {
        id: metric.id,
        state: 'fail',
        value,
        limit: metric.limit,
        direction: metric.direction,
        unit: metric.unit,
        provenance: metric.provenance,
        reason,
      };
      continue;
    }
    metrics[metric.id] = {
      id: metric.id,
      state: metricPass(value, metric) ? 'pass' : 'fail',
      value,
      limit: metric.limit,
      direction: metric.direction,
      unit: metric.unit,
      provenance: metric.provenance,
    };
  }
  const evaluated = Object.values(metrics);
  const state: VerdictState = evaluated.some((metric) => metric.state === 'fail')
    ? 'fail'
    : evaluated.some((metric) => metric.state === 'unevaluated')
      ? 'unevaluated'
      : 'pass';
  return { caseId: policy.caseId, state, metrics, reasons };
}

export function numericalHealthVerdict(evaluation: NumericalHealthEvaluation): VerdictAxis {
  return {
    state: evaluation.state,
    reason:
      evaluation.state === 'pass'
        ? undefined
        : evaluation.state === 'fail'
          ? 'numerical-health-policy-failed'
          : 'numerical-health-policy-unevaluated',
    metrics: Object.fromEntries(
      Object.entries(evaluation.metrics).map(([id, metric]) => [
        id,
        {
          state: metric.state,
          value: metric.value ?? null,
          limit: metric.limit ?? null,
          direction: metric.direction,
          unit: metric.unit,
          reasonCode: metric.reason?.code ?? null,
        } satisfies JsonValue,
      ]),
    ),
  };
}

/** Retain measured target evidence, but publish it as a verdict only after health passes. */
export function gatePhysicsVerdict(
  measured: VerdictAxis,
  health: NumericalHealthEvaluation,
): VerdictAxis {
  if (health.state === 'pass' || measured.state === 'unevaluated') return measured;
  return {
    state: 'unevaluated',
    reason: health.state === 'fail' ? 'numerical-health-failed' : 'numerical-health-unevaluated',
    metrics: {
      ...measured.metrics,
      measuredState: measured.state,
      healthState: health.state,
      healthReasonCodes: health.reasons.map((reason) => reason.code),
    },
  };
}
