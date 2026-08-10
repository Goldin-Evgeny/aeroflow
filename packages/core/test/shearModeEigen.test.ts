import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { D3Q19, D3Q19_SPEC, collideCell, equilibrium3, makeCollideContext } from '../src/index.js';

/**
 * Direct von-Neumann analysis of the axis-aligned transverse block used by the Ahmed
 * regularized D3Q19 collision. No spatial simulation is involved. A post-collision
 * transverse perturbation is exactly parameterized by (j_y, Pi_xy); Fourier streaming
 * followed by projected collision therefore closes as a complex 2x2 map.
 */

const TAU0_2M = 0.5000020740253772;
const TAU0_8M = 0.5000033553578126;
const TAU_APPROACH_8M_P50 = 0.5009890198707581;
const BACKGROUND_UX = 0.05;
const K_SAMPLES = 256;
const CS2 = 1 / 3;

interface Complex {
  re: number;
  im: number;
}

type Matrix2 = readonly [Complex, Complex, Complex, Complex];

interface EigenMode {
  eigenvalue: Complex;
  amplification: number;
  phaseDegrees: number;
  decayRate: number;
  postCollisionMomentum: Complex;
  postCollisionStress: Complex;
  preCollisionMomentum: Complex;
  preCollisionStress: Complex;
  analyticPiOverHydro: Complex;
  analyticPiOverHydroAmplitude: number;
}

interface SpectrumPoint {
  k: number;
  kOverPi: number;
  wavelengthCells: number | null;
  centeredDifferenceTransfer: number;
  hydrodynamic: EigenMode;
  stress: EigenMode;
}

interface SpectrumCase {
  id: string;
  tau: number;
  backgroundUx: number;
  collisionStressMultiplier: number;
  points: SpectrumPoint[];
}

interface Artifact {
  artifactSchema: 'aeroflow-shear-mode-eigen-v1';
  generatedAt: string;
  method: string;
  constants: Record<string, number>;
  productionJacobianGuardMaxError: number;
  productionFullInvariantResidualMax: number;
  cases: SpectrumCase[];
}

const c = (re = 0, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
const mul = (a: Complex, b: Complex): Complex =>
  c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: Complex, factor: number): Complex => c(a.re * factor, a.im * factor);
const magnitude = (a: Complex): number => Math.hypot(a.re, a.im);
const distance = (a: Complex, b: Complex): number => magnitude(sub(a, b));
const divide = (a: Complex, b: Complex): Complex => {
  const denominator = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / denominator, (a.im * b.re - a.re * b.im) / denominator);
};
const sqrtComplex = (value: Complex): Complex => {
  const r = magnitude(value);
  const re = Math.sqrt(Math.max(0, (r + value.re) / 2));
  const im = Math.sign(value.im || 1) * Math.sqrt(Math.max(0, (r - value.re) / 2));
  return c(re, im);
};

function streamState(
  k: number,
  backgroundUx: number,
  momentum: Complex,
  stress: Complex,
): Complex[] {
  return D3Q19.ex.map((ex, direction) => {
    const ey = D3Q19.ey[direction];
    const derivativeEquilibrium = D3Q19.w[direction] * ey * (3 + 9 * ex * backgroundUx);
    const projectedStress = 9 * D3Q19.w[direction] * ex * ey;
    const population = add(scale(momentum, derivativeEquilibrium), scale(stress, projectedStress));
    return mul(population, c(Math.cos(k * ex), -Math.sin(k * ex)));
  });
}

function preCollisionMoments(
  populations: readonly Complex[],
  backgroundUx: number,
): { momentum: Complex; stress: Complex } {
  let momentum = c();
  let rawStress = c();
  for (let direction = 0; direction < D3Q19.q; direction++) {
    momentum = add(momentum, scale(populations[direction], D3Q19.ey[direction]));
    rawStress = add(
      rawStress,
      scale(populations[direction], D3Q19.ex[direction] * D3Q19.ey[direction]),
    );
  }
  // Linearized equilibrium moment Pi_eq,xy = rho*u_x*u_y = U_x*j_y.
  return { momentum, stress: sub(rawStress, scale(momentum, backgroundUx)) };
}

function amplificationMatrix(k: number, tau: number, backgroundUx: number): Matrix2 {
  const stressMultiplier = 1 - 1 / tau;
  const fromMomentum = preCollisionMoments(streamState(k, backgroundUx, c(1), c()), backgroundUx);
  const fromStress = preCollisionMoments(streamState(k, backgroundUx, c(), c(1)), backgroundUx);
  return [
    fromMomentum.momentum,
    fromStress.momentum,
    scale(fromMomentum.stress, stressMultiplier),
    scale(fromStress.stress, stressMultiplier),
  ];
}

function eigenvalues(matrix: Matrix2): readonly [Complex, Complex] {
  const [a, b, c0, d] = matrix;
  const trace = add(a, d);
  const determinant = sub(mul(a, d), mul(b, c0));
  const discriminant = sqrtComplex(sub(mul(trace, trace), scale(determinant, 4)));
  return [scale(add(trace, discriminant), 0.5), scale(sub(trace, discriminant), 0.5)];
}

function eigenvector(matrix: Matrix2, eigenvalue: Complex): readonly [Complex, Complex] {
  const [a, b, c0, d] = matrix;
  let momentum: Complex;
  let stress: Complex;
  if (magnitude(b) >= magnitude(c0)) {
    momentum = b;
    stress = sub(eigenvalue, a);
  } else {
    momentum = sub(eigenvalue, d);
    stress = c0;
  }
  const norm = Math.hypot(magnitude(momentum), magnitude(stress));
  if (!(norm > 0)) return [c(1), c()];
  return [scale(momentum, 1 / norm), scale(stress, 1 / norm)];
}

function modeFor(
  matrix: Matrix2,
  eigenvalue: Complex,
  k: number,
  tau: number,
  backgroundUx: number,
): EigenMode {
  const [momentum, stress] = eigenvector(matrix, eigenvalue);
  const pre = preCollisionMoments(streamState(k, backgroundUx, momentum, stress), backgroundUx);
  const hydro = mul(c(0, -CS2 * tau * k), pre.momentum);
  const ratio =
    k > 0 && magnitude(hydro) > 0 ? divide(pre.stress, hydro) : c(Number.NaN, Number.NaN);
  const amplification = magnitude(eigenvalue);
  return {
    eigenvalue,
    amplification,
    phaseDegrees: (Math.atan2(eigenvalue.im, eigenvalue.re) * 180) / Math.PI,
    decayRate: -Math.log(amplification),
    postCollisionMomentum: momentum,
    postCollisionStress: stress,
    preCollisionMomentum: pre.momentum,
    preCollisionStress: pre.stress,
    analyticPiOverHydro: ratio,
    analyticPiOverHydroAmplitude: magnitude(ratio),
  };
}

function spectrum(id: string, tau: number, backgroundUx: number): SpectrumCase {
  const points: SpectrumPoint[] = [];
  let previousHydrodynamic = c(1);
  let previousStress = c(1 - 1 / tau);
  for (let sample = 0; sample <= K_SAMPLES; sample++) {
    const k = (Math.PI * sample) / K_SAMPLES;
    const matrix = amplificationMatrix(k, tau, backgroundUx);
    const candidates = eigenvalues(matrix);
    const direct =
      distance(candidates[0], previousHydrodynamic) + distance(candidates[1], previousStress);
    const swapped =
      distance(candidates[1], previousHydrodynamic) + distance(candidates[0], previousStress);
    const hydrodynamicEigenvalue = direct <= swapped ? candidates[0] : candidates[1];
    const stressEigenvalue = direct <= swapped ? candidates[1] : candidates[0];
    const hydrodynamic = modeFor(matrix, hydrodynamicEigenvalue, k, tau, backgroundUx);
    const stress = modeFor(matrix, stressEigenvalue, k, tau, backgroundUx);
    points.push({
      k,
      kOverPi: k / Math.PI,
      wavelengthCells: k === 0 ? null : (2 * Math.PI) / k,
      centeredDifferenceTransfer: k === 0 ? 1 : Math.sin(k) / k,
      hydrodynamic,
      stress,
    });
    previousHydrodynamic = hydrodynamicEigenvalue;
    previousStress = stressEigenvalue;
  }
  return {
    id,
    tau,
    backgroundUx,
    collisionStressMultiplier: 1 - 1 / tau,
    points,
  };
}

function productionCollisionDerivative(
  perturbation: readonly number[],
  tau: number,
  backgroundUx: number,
): Float64Array {
  const epsilon = 1e-6;
  const plus = new Float64Array(D3Q19.q);
  const minus = new Float64Array(D3Q19.q);
  for (let direction = 0; direction < D3Q19.q; direction++) {
    const base = equilibrium3(D3Q19_SPEC, direction, 1, backgroundUx, 0, 0);
    plus[direction] = base + epsilon * perturbation[direction];
    minus[direction] = base - epsilon * perturbation[direction];
  }
  const context = makeCollideContext(D3Q19_SPEC, {
    tau,
    collision: 'trt',
    lambda: 3 / 16,
    regularize: true,
    conserveMass: true,
  });
  collideCell(plus, context);
  collideCell(minus, context);
  return Float64Array.from(plus, (value, direction) => (value - minus[direction]) / (2 * epsilon));
}

function productionColumn(
  k: number,
  tau: number,
  backgroundUx: number,
  momentum: Complex,
  stress: Complex,
): readonly [Complex, Complex] {
  const streamed = streamState(k, backgroundUx, momentum, stress);
  const collidePart = (part: 're' | 'im'): { momentum: number; stress: number } => {
    const derivative = productionCollisionDerivative(
      streamed.map((value) => value[part]),
      tau,
      backgroundUx,
    );
    let outputMomentum = 0;
    let rawStress = 0;
    for (let direction = 0; direction < D3Q19.q; direction++) {
      outputMomentum += D3Q19.ey[direction] * derivative[direction];
      rawStress += D3Q19.ex[direction] * D3Q19.ey[direction] * derivative[direction];
    }
    return { momentum: outputMomentum, stress: rawStress - backgroundUx * outputMomentum };
  };
  const real = collidePart('re');
  const imaginary = collidePart('im');
  return [c(real.momentum, imaginary.momentum), c(real.stress, imaginary.stress)];
}

function productionFullInvariantResidual(
  k: number,
  tau: number,
  backgroundUx: number,
  momentum: Complex,
  stress: Complex,
): number {
  const streamed = streamState(k, backgroundUx, momentum, stress);
  const derivatives = {
    re: productionCollisionDerivative(
      streamed.map((value) => value.re),
      tau,
      backgroundUx,
    ),
    im: productionCollisionDerivative(
      streamed.map((value) => value.im),
      tau,
      backgroundUx,
    ),
  };
  const column = productionColumn(k, tau, backgroundUx, momentum, stress);
  const reconstructed = streamState(0, backgroundUx, column[0], column[1]);
  let residual = 0;
  for (let direction = 0; direction < D3Q19.q; direction++) {
    residual = Math.max(
      residual,
      distance(c(derivatives.re[direction], derivatives.im[direction]), reconstructed[direction]),
    );
  }
  return residual;
}

let artifact: Artifact | undefined;

describe('direct regularized D3Q19 transverse eigenanalysis', () => {
  it('matches the production collision Jacobian and emits the fixed-tau spectrum', () => {
    let maxGuardError = 0;
    let maxFullInvariantResidual = 0;
    for (const k of [0, Math.PI / 4, 1.9780398189, (3 * Math.PI) / 4, Math.PI]) {
      const analytic = amplificationMatrix(k, TAU0_2M, BACKGROUND_UX);
      const fromMomentum = productionColumn(k, TAU0_2M, BACKGROUND_UX, c(1), c());
      const fromStress = productionColumn(k, TAU0_2M, BACKGROUND_UX, c(), c(1));
      const production: Matrix2 = [fromMomentum[0], fromStress[0], fromMomentum[1], fromStress[1]];
      for (let entry = 0; entry < 4; entry++) {
        maxGuardError = Math.max(maxGuardError, distance(analytic[entry], production[entry]));
      }
      maxFullInvariantResidual = Math.max(
        maxFullInvariantResidual,
        productionFullInvariantResidual(k, TAU0_2M, BACKGROUND_UX, c(1), c()),
        productionFullInvariantResidual(k, TAU0_2M, BACKGROUND_UX, c(), c(1)),
      );
    }
    expect(maxGuardError).toBeLessThan(2e-9);
    expect(maxFullInvariantResidual).toBeLessThan(2e-9);

    const cases = [
      spectrum('tau0-2m-u005', TAU0_2M, BACKGROUND_UX),
      spectrum('tau0-8m-u005', TAU0_8M, BACKGROUND_UX),
      spectrum('tau0-2m-u0', TAU0_2M, 0),
      spectrum('tau-approach-p50-u005', TAU_APPROACH_8M_P50, BACKGROUND_UX),
      spectrum('tau08-u005', 0.8, BACKGROUND_UX),
    ];
    for (const result of cases) {
      expect(result.points[0].hydrodynamic.amplification).toBeCloseTo(1, 12);
      expect(result.points[0].stress.eigenvalue.re).toBeCloseTo(
        result.collisionStressMultiplier,
        12,
      );
    }

    artifact = {
      artifactSchema: 'aeroflow-shear-mode-eigen-v1',
      generatedAt: new Date().toISOString(),
      method:
        'exact complex 2x2 (transverse momentum, projected shear stress) Fourier amplification block; guarded against the production collideCell finite-difference Jacobian',
      constants: {
        tau0_2m: TAU0_2M,
        tau0_8m: TAU0_8M,
        tauApproach8mP50: TAU_APPROACH_8M_P50,
        backgroundUx: BACKGROUND_UX,
        kSamples: K_SAMPLES,
      },
      productionJacobianGuardMaxError: maxGuardError,
      productionFullInvariantResidualMax: maxFullInvariantResidual,
      cases,
    };
  });
});

afterAll(() => {
  if (!artifact) return;
  const directory = resolve('test-results', 'strain-calibration');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'shear-mode-eigen.json'),
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  );
});
