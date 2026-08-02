import { describe, it, expect } from 'vitest';
import {
  fft,
  dominantFrequency,
  meanPeriodFromZeroCrossings,
  coefficient,
} from '../src/analysis/spectrum.js';

/**
 * Spectral utility tests. Targets and tolerances from docs/handoff/H7-measurement.md §1
 * (T-FREQ-1…4). `dominantFrequency` returns cycles per timestep; the H7 vectors use
 * sampleInterval = 1 so frequency == cycles per sample.
 */
describe('spectrum: dominantFrequency', () => {
  it('T-FREQ-1: single tone recovered within 5e-6 (parabolic interpolation)', () => {
    const N = 4096;
    const f = 0.01234567;
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) x[n] = Math.sin(2 * Math.PI * f * n);
    const { frequency } = dominantFrequency(x);
    expect(Math.abs(frequency - f)).toBeLessThanOrEqual(5e-6);
  });

  it('T-FREQ-2: dominant of two tones returns the stronger (0.012) within 5e-6', () => {
    const N = 4096;
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      x[n] = 1.0 * Math.sin(2 * Math.PI * 0.012 * n) + 0.3 * Math.sin(2 * Math.PI * 0.031 * n);
    }
    const { frequency } = dominantFrequency(x);
    expect(Math.abs(frequency - 0.012)).toBeLessThanOrEqual(5e-6);
  });

  it('T-FREQ-3: tone in seeded uniform noise recovered within 5e-5', () => {
    const N = 4096;
    const f = 0.0123;
    // Deterministic LCG (Numerical Recipes ranqd1), amplitude 0.5.
    let seed = 1234567 >>> 0;
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const u = seed / 0x100000000 - 0.5; // [-0.5, 0.5)
      x[n] = Math.sin(2 * Math.PI * f * n) + 0.5 * u;
    }
    const { frequency } = dominantFrequency(x);
    expect(Math.abs(frequency - f)).toBeLessThanOrEqual(5e-5);
  });

  it('T-FREQ-4: tone exactly on a bin → interpolation offset ≈ 0', () => {
    const N = 4096;
    const f = 50 / N;
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) x[n] = Math.sin(2 * Math.PI * f * n);
    const { frequency } = dominantFrequency(x);
    // δ = (frequency·N − 50); |δ| ≤ 1e-3.
    expect(Math.abs(frequency * N - 50)).toBeLessThanOrEqual(1e-3);
  });
});

describe('spectrum: fft', () => {
  it('round-trips a real sinusoid to the expected complex-conjugate peaks', () => {
    const N = 16;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let n = 0; n < N; n++) re[n] = Math.cos((2 * Math.PI * 2 * n) / N);
    fft(re, im);
    // A pure cos at bin 2 has magnitude N/2 at bins 2 and N−2, ~0 elsewhere.
    for (let k = 0; k < N; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (k === 2 || k === N - 2) expect(Math.abs(mag - N / 2)).toBeLessThan(1e-9);
      else expect(mag).toBeLessThan(1e-9);
    }
  });

  it('rejects non-power-of-two lengths', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
  });
});

describe('spectrum: meanPeriodFromZeroCrossings', () => {
  it('recovers an exact integer period from a sinusoid', () => {
    // Period = 40 samples exactly, 25 periods.
    const period = 40;
    const N = period * 25;
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) x[n] = Math.sin((2 * Math.PI * n) / period);
    const p = meanPeriodFromZeroCrossings(x);
    expect(Math.abs(p - period)).toBeLessThan(1e-6);
  });

  it('recovers a non-integer period via crossing interpolation', () => {
    const period = 37.3;
    const N = Math.floor(period * 30);
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) x[n] = Math.sin((2 * Math.PI * n) / period);
    const p = meanPeriodFromZeroCrossings(x);
    expect(Math.abs(p - period)).toBeLessThan(0.05);
  });

  it('returns NaN for a signal with fewer than two periods', () => {
    const x = new Float64Array(10).map((_, n) => n); // monotone, no repeat crossing
    expect(Number.isNaN(meanPeriodFromZeroCrossings(x))).toBe(true);
  });
});

describe('spectrum: coefficient', () => {
  it('matches a hand computation: C = F/(½·ρ0·U²·D)', () => {
    // F=0.01, U=0.05, D=25 → 0.01 / (0.5·1·0.0025·25) = 0.01/0.03125 = 0.32.
    expect(coefficient(0.01, 0.05, 25)).toBeCloseTo(0.32, 12);
  });
});
