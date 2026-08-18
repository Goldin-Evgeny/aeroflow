import type { PhaseWindow, RunPhase } from './runArtifact.js';

export interface StepSample {
  step: number;
}

export interface VerdictWindow extends PhaseWindow {
  phase: 'evaluation';
  endStep: number;
  minimumSamples: number;
}

export function phaseAtStep(windows: readonly PhaseWindow[], step: number): RunPhase {
  if (!Number.isInteger(step) || step < 0)
    throw new Error('phaseAtStep: step must be non-negative');
  const matches = windows.filter(
    (window) => step >= window.startStep && (window.endStep === null || step <= window.endStep),
  );
  if (matches.length !== 1) {
    throw new Error(`phaseAtStep: step ${step} belongs to ${matches.length} phase windows`);
  }
  return matches[0].phase;
}

/** Select the inclusive, explicitly declared sample interval used by a verdict. */
export function selectVerdictSamples<T extends StepSample>(
  samples: readonly T[],
  window: VerdictWindow,
): T[] {
  if (
    !Number.isInteger(window.startStep) ||
    !Number.isInteger(window.endStep) ||
    window.startStep < 0 ||
    window.endStep < window.startStep ||
    !Number.isInteger(window.minimumSamples) ||
    window.minimumSamples <= 0 ||
    window.selectionRule.length === 0
  ) {
    throw new Error('selectVerdictSamples: invalid evaluation window');
  }
  const selected = samples.filter(
    (sample) => sample.step >= window.startStep && sample.step <= window.endStep,
  );
  if (selected.length < window.minimumSamples) {
    throw new Error(
      `selectVerdictSamples: evaluation window has ${selected.length} samples; ` +
        `requires ${window.minimumSamples}`,
    );
  }
  return selected;
}
