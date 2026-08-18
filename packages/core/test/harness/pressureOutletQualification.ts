import { CellType } from '../../src/lattice.js';
import { evaluateNumericalHealth } from '../../src/validation/numericalHealth.js';
import { numericalHealthPolicy } from '../../src/validation/bands.js';
import {
  PRESSURE_QUALIFICATION_MANIFEST,
  classifyPressureQualification,
  type PressureQualificationArm,
  type PressureQualificationArmEvidence,
  type PressureQualificationResult,
} from '../../src/validation/outletQualification.js';
import { LEDGER_SCENE, factorialFlags } from './nearFloorFactorial.js';
import { runOutletArm, type OutletArmRecord } from './outletFeedbackDiscriminator.js';

export interface PressureQualificationExecution {
  readonly generatedAt: string;
  readonly manifest: typeof PRESSURE_QUALIFICATION_MANIFEST;
  readonly evidence: readonly PressureQualificationArmEvidence[];
  readonly result: PressureQualificationResult;
}

function unavailable(
  arm: PressureQualificationArm,
  reason: string,
): PressureQualificationArmEvidence {
  return {
    armId: arm.id,
    configurationFingerprint: arm.configurationFingerprint,
    axes: Object.fromEntries(
      arm.requiredAxes.map((axis) => [axis, { state: 'unavailable', reason, metrics: {} }]),
    ),
    boundedMeasurements: {},
  };
}

function fluidCells(): number {
  return factorialFlags(LEDGER_SCENE).reduce(
    (count, flag) => count + (flag === CellType.Fluid ? 1 : 0),
    0,
  );
}

function cpuEvidence(
  arm: PressureQualificationArm,
  record: OutletArmRecord,
): PressureQualificationArmEvidence {
  const last = record.samples.at(-1);
  if (!last) return unavailable(arm, record.error ?? 'CPU arm produced no diagnostics');
  const initialMass = fluidCells();
  const relativeMassDrift = (last.mass - initialMass) / Math.max(initialMass, 1);
  const boundaryFluxClosure =
    (last.mass - initialMass - last.boundary.total) / Math.max(initialMass, 1);
  const health = evaluateNumericalHealth(numericalHealthPolicy(arm.healthPolicyCaseId), {
    nonFiniteCells: last.finite ? 0 : 1,
    densityMin: last.density.min,
    densityMax: last.density.max,
    relativeMassDrift,
    boundaryFluxClosure,
  });
  const executionPass =
    !record.error && record.divergenceStep === null && record.completedSteps === arm.exposureSteps;
  const conservationPass =
    Number.isFinite(boundaryFluxClosure) &&
    Math.abs(boundaryFluxClosure) <=
      PRESSURE_QUALIFICATION_MANIFEST.thresholds.boundaryFluxClosureAbsMax;
  return {
    armId: arm.id,
    configurationFingerprint: arm.configurationFingerprint,
    axes: {
      execution: {
        state: executionPass ? 'pass' : 'fail',
        reason: executionPass
          ? undefined
          : (record.error ?? `diverged at ${String(record.divergenceStep)}`),
        metrics: {
          completedSteps: record.completedSteps,
          requiredSteps: arm.exposureSteps,
          divergenceStep: record.divergenceStep,
          rawConfigurationFingerprint: record.configurationFingerprint,
        },
      },
      'numerical-health': {
        state: health.state === 'pass' ? 'pass' : health.state === 'fail' ? 'fail' : 'unavailable',
        reason: health.reasons.map((reason) => reason.code).join(',') || undefined,
        metrics: {
          densityMin: last.density.min,
          densityMax: last.density.max,
          relativeMassDrift,
          boundaryFluxClosure,
        },
      },
      conservation: {
        state: conservationPass ? 'pass' : 'fail',
        reason: conservationPass ? undefined : 'complete-shell-closure-limit',
        metrics: {
          value: boundaryFluxClosure,
          limit: PRESSURE_QUALIFICATION_MANIFEST.thresholds.boundaryFluxClosureAbsMax,
        },
      },
    },
    boundedMeasurements: {
      finalMass: last.mass,
      densityMean: last.density.mean,
      tauEffMean: last.subgrid.tauEffMean,
      tauEffMax: last.subgrid.tauEffMax,
    },
  };
}

function addRepeatability(
  evidence: PressureQualificationArmEvidence[],
  leftId: string,
  rightId: string,
): void {
  const left = evidence.find((entry) => entry.armId === leftId)!;
  const rightIndex = evidence.findIndex((entry) => entry.armId === rightId);
  const right = evidence[rightIndex];
  const metrics = ['finalMass', 'densityMean', 'tauEffMean', 'tauEffMax'] as const;
  let maximumRelative = 0;
  for (const metric of metrics) {
    const a = Number(left.boundedMeasurements[metric]);
    const b = Number(right.boundedMeasurements[metric]);
    maximumRelative = Math.max(
      maximumRelative,
      Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1),
    );
  }
  const limit = PRESSURE_QUALIFICATION_MANIFEST.thresholds.sameConfigurationRepeatabilityMax;
  evidence[rightIndex] = {
    ...right,
    axes: {
      ...right.axes,
      parity: {
        state: maximumRelative <= limit ? 'pass' : 'fail',
        reason: maximumRelative <= limit ? undefined : 'same-configuration-repeatability-limit',
        metrics: { maximumRelative, limit, comparedWith: leftId },
      },
    },
  };
}

/** Runs CPU arms; browser/GPU arms remain explicit unavailable evidence, never silent omissions. */
export async function runPressureOutletQualification(): Promise<PressureQualificationExecution> {
  const evidence: PressureQualificationArmEvidence[] = [];
  for (const arm of PRESSURE_QUALIFICATION_MANIFEST.arms) {
    if (arm.backend !== 'cpu-f64') {
      evidence.push(unavailable(arm, 'GPU qualification arm requires the opt-in browser runner'));
      continue;
    }
    const record = await runOutletArm({
      label: arm.id,
      outlet: 'pressure',
      exposureSteps: arm.exposureSteps,
      cadence: 25,
      lesNorm: arm.closure,
    });
    evidence.push(cpuEvidence(arm, record));
  }
  addRepeatability(evidence, 'empty-legacy-cpu-a', 'empty-legacy-cpu-repeat');
  addRepeatability(evidence, 'empty-spec-cpu-a', 'empty-spec-cpu-repeat');
  const result = classifyPressureQualification(evidence);
  return {
    generatedAt: new Date().toISOString(),
    manifest: PRESSURE_QUALIFICATION_MANIFEST,
    evidence,
    result,
  };
}
