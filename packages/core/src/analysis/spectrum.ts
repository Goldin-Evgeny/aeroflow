/**
 * Spectral / time-series measurement utilities for unsteady validation (M4 cylinder
 * Strouhal + Cd). Pure TypeScript, no dependencies (repo rule). Spec: docs/handoff/
 * H7-measurement.md.
 *
 * `dominantFrequency` (FFT + parabolic log-magnitude refinement) and
 * `meanPeriodFromZeroCrossings` (the PRIMARY Strouhal estimator — its resolution is
 * finer than the raw FFT bin width at feasible run lengths) both operate on the lift
 * (Cl) signal. Always feed Cl, never Cd: drag oscillates at 2× the shedding frequency
 * (H7 §5 pitfall 1).
 */

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re`/`im` must have length a power of
 * two; on return they hold the transform (im all-zero on input for a real signal).
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re and im must have equal length');
  if (n === 0 || (n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  // Danielson–Lanczos butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = cr * re[b] - ci * im[b];
        const ti = cr * im[b] + ci * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Periodic (symmetric) Hann window of length n: 0.5·(1 − cos(2πk/(n−1))). */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let k = 0; k < n; k++) w[k] = 0.5 * (1 - Math.cos((2 * Math.PI * k) / (n - 1)));
  return w;
}

function mean(signal: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < signal.length; i++) s += signal[i];
  return s / signal.length;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export interface DominantFrequency {
  /** Frequency in cycles per sample (multiply by 1/sampleInterval for cycles/timestep). */
  frequency: number;
  /** Peak amplitude estimate (windowed-FFT magnitude, coherent-gain corrected). */
  amplitude: number;
}

/**
 * Dominant frequency of a real signal via mean-removal → Hann → zero-pad to a power of
 * two → FFT → peak bin → parabolic interpolation on log-magnitude (accurate for Hann,
 * H7 §1 step 6). `sampleInterval` is the spacing between samples in timesteps; the
 * returned frequency is in cycles per timestep.
 */
export function dominantFrequency(
  signal: ArrayLike<number>,
  sampleInterval = 1,
): DominantFrequency {
  const N = signal.length;
  if (N < 4) throw new Error('dominantFrequency: need at least 4 samples');
  const mu = mean(signal);
  const win = hannWindow(N);
  const M = nextPow2(N);
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  for (let k = 0; k < N; k++) re[k] = (signal[k] - mu) * win[k];
  fft(re, im);

  const half = M >> 1;
  const mag = new Float64Array(half);
  let peak = 1;
  for (let k = 1; k < half; k++) {
    mag[k] = Math.hypot(re[k], im[k]);
    if (mag[k] > mag[peak]) peak = k;
  }

  // Parabolic interpolation of log-magnitude around the peak bin.
  let delta = 0;
  if (peak > 1 && peak < half - 1) {
    const lm = Math.log(mag[peak - 1] + 1e-300);
    const l0 = Math.log(mag[peak] + 1e-300);
    const lp = Math.log(mag[peak + 1] + 1e-300);
    const denom = lm - 2 * l0 + lp;
    if (denom !== 0) delta = (0.5 * (lm - lp)) / denom;
    if (delta > 0.5) delta = 0.5;
    if (delta < -0.5) delta = -0.5;
  }

  const binFreq = (peak + delta) / M; // cycles per sample
  const frequency = binFreq / sampleInterval; // cycles per timestep
  // Hann coherent gain = 0.5 → amplitude ≈ 2·|X|/N / 0.5 = 4·|X|/N.
  const amplitude = (4 * mag[peak]) / N;
  return { frequency, amplitude };
}

/**
 * Mean period (in samples) from same-sign zero crossings of the demeaned signal. This
 * is the PRIMARY Strouhal-period estimator: with ~10⁵ samples its resolution beats the
 * raw FFT bin width (H7 §1, M4 pitfalls). Returns NaN if fewer than two full periods
 * (i.e. < 3 up-crossings) are present.
 *
 * A period spans two consecutive upward (negative→positive) crossings; the crossing
 * instant is linearly interpolated between the bracketing samples.
 */
export function meanPeriodFromZeroCrossings(signal: ArrayLike<number>): number {
  const N = signal.length;
  const mu = mean(signal);
  const crossings: number[] = [];
  for (let i = 1; i < N; i++) {
    const a = signal[i - 1] - mu;
    const b = signal[i] - mu;
    if (a < 0 && b >= 0) {
      // Linear interpolation of the zero location between i−1 and i.
      const t = a === b ? 0 : a / (a - b);
      crossings.push(i - 1 + t);
    }
  }
  if (crossings.length < 2) return NaN;
  const span = crossings[crossings.length - 1] - crossings[0];
  return span / (crossings.length - 1);
}

/**
 * Dimensionless force coefficient (2D, per unit depth): C = F / (½·ρ0·U²·L_ref), with
 * ρ0 = 1, L_ref = D (cells). Used for both Cd (F=Fx) and Cl (F=Fy). H7 §4.
 */
export function coefficient(force: number, u: number, refLength: number, rho0 = 1): number {
  return force / (0.5 * rho0 * u * u * refLength);
}
