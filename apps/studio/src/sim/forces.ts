import { coefficient, dominantFrequency, meanPeriodFromZeroCrossings } from '@aeroflow/core';

/**
 * Force post-processing for the 2D cylinder benchmark (M4 step 7). Converts the raw
 * lattice-unit force series from `Lbm2D.sampleForce` into the dimensionless coefficients
 * and the Strouhal number, entirely in lattice units (ρ0 = 1, u_in, D in cells, time in
 * steps — no dx/dt; that belongs in M8 newton reporting, H7 §5 / M4 pitfalls).
 *
 * St is estimated two ways and cross-checked: `meanPeriodFromZeroCrossings` on Cl is the
 * PRIMARY estimator (finer than the FFT bin width at feasible run lengths), and the FFT
 * peak is the cross-check — they must agree within 1 % (M4 acceptance 3). Always drive
 * the frequency off Cl, never Cd (Cd oscillates at 2× the shedding frequency, H7 §5).
 */

export interface CylinderForceOptions {
  /** Inlet lattice velocity used to collect the series (bind to the run, not a widget). */
  u: number;
  /** Cylinder diameter in cells (normalization length). */
  D: number;
  /** Timesteps between consecutive samples (the `k` passed to sampleForce). */
  sampleInterval: number;
  /** Transient timesteps to discard before analysis. Default 80_000 (M4 step 7). */
  transientSteps?: number;
  rho0?: number;
}

export interface CylinderStats {
  /** Mean drag coefficient over the post-transient window. */
  meanCd: number;
  /** Lift amplitude as √2 × RMS of the demeaned Cl. */
  clAmplitude: number;
  /** Cross-check lift amplitude as (max − min)/2. */
  clAmplitudePeakToPeak: number;
  /** Strouhal from zero-crossing period (primary). NaN if not yet periodic. */
  stZeroCross: number;
  /** Strouhal from the FFT peak (cross-check). */
  stFft: number;
  /** True if the two St estimators agree within 1 % (M4 acceptance 3). */
  estimatorsAgree: boolean;
  /** Shedding period in timesteps (from the zero-crossing estimator). */
  shedPeriodSteps: number;
  /** Number of shedding periods in the analysis window. */
  periods: number;
  /** Number of samples analysed (post-transient). */
  samples: number;
}

/**
 * @param fx  obstacle drag force per sample (lattice units), one entry per sample.
 * @param fy  obstacle lift force per sample (lattice units).
 */
export function analyzeCylinderForces(
  fx: ArrayLike<number>,
  fy: ArrayLike<number>,
  opts: CylinderForceOptions,
): CylinderStats {
  const { u, D, sampleInterval } = opts;
  const rho0 = opts.rho0 ?? 1;
  const transientSteps = opts.transientSteps ?? 80_000;
  const nTotal = Math.min(fx.length, fy.length);
  // Sample j corresponds to timestep (j+1)·sampleInterval (sampleForce advances first).
  const firstIdx = Math.max(0, Math.ceil(transientSteps / sampleInterval) - 1);

  const cd: number[] = [];
  const cl: number[] = [];
  for (let j = firstIdx; j < nTotal; j++) {
    cd.push(coefficient(fx[j], u, D, rho0));
    cl.push(coefficient(fy[j], u, D, rho0));
  }
  const samples = cl.length;

  let meanCd = 0;
  for (const c of cd) meanCd += c;
  meanCd /= Math.max(1, samples);

  let clMean = 0;
  for (const c of cl) clMean += c;
  clMean /= Math.max(1, samples);
  let sumSq = 0;
  let clMin = Infinity;
  let clMax = -Infinity;
  for (const c of cl) {
    const d = c - clMean;
    sumSq += d * d;
    if (c < clMin) clMin = c;
    if (c > clMax) clMax = c;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, samples));
  const clAmplitude = Math.SQRT2 * rms;
  const clAmplitudePeakToPeak = (clMax - clMin) / 2;

  // Zero-crossing period (in samples → timesteps) → St = D / (T_shed · u).
  const periodSamples = meanPeriodFromZeroCrossings(cl);
  const shedPeriodSteps = periodSamples * sampleInterval;
  const stZeroCross = Number.isFinite(shedPeriodSteps) ? D / (shedPeriodSteps * u) : NaN;

  // FFT cross-check: frequency in cycles/timestep → St = f · D / u.
  let stFft = NaN;
  if (samples >= 8) {
    const { frequency } = dominantFrequency(cl, sampleInterval);
    stFft = (frequency * D) / u;
  }

  const estimatorsAgree =
    Number.isFinite(stZeroCross) &&
    Number.isFinite(stFft) &&
    Math.abs(stZeroCross - stFft) <= 0.01 * Math.abs(stZeroCross);
  const periods = Number.isFinite(shedPeriodSteps)
    ? (samples * sampleInterval) / shedPeriodSteps
    : 0;

  return {
    meanCd,
    clAmplitude,
    clAmplitudePeakToPeak,
    stZeroCross,
    stFft,
    estimatorsAgree,
    shedPeriodSteps,
    periods,
    samples,
  };
}
