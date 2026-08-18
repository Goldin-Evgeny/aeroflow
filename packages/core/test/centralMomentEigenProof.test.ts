import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  COLLISION_QUALIFICATION_MANIFEST,
  centralMomentAttractorsD3Q27,
  centralMomentMatrixD3Q27,
  collideD3Q27Central,
  conservedD3Q27,
  D3Q19,
  D3Q27,
  D3Q27_CENTRAL_EXPONENTS,
  d3q27CentralMomentIndex,
  equilibriumD3Q27Central,
  lesKFromCs,
  populationsFromCentralMomentsD3Q27,
  streamCollidePeriodicD3Q27,
  collideD3Q19Central as collideD3Q19CentralAuthority,
  conservedD3Q19 as conservedD3Q19Authority,
  equilibriumD3Q19Central as equilibriumD3Q19CentralAuthority,
} from '../src/index.js';

/**
 * Architecture gate for the De Rosis--Coreixas D3Q19 central-moment collision.
 *
 * This stays test-local until the two predeclared wavelengths decide whether the
 * architecture is eligible for the CPU oracle and WGSL.  The basis is Eq. (15), the
 * equilibrium central moments are Eqs. (18)--(21), and the fixed relaxation matrix is
 * the one immediately preceding Eq. (16) in De Rosis & Coreixas, Phys. Fluids 32 (2020).
 */

const Q = D3Q19.q;
const CS2 = 1 / 3;
const TAU_2M = 0.5000020740253772;
const TAU_8M = 0.5000033553578126;
const AHMED_U = 0.05;
const DIFFERENCE_EPSILON = 1e-6;
const PROJECTED_TARGET_GAIN_U005 = 1.0031360612718143;
const PROJECTED_TARGET_RATIO_U005 = 1.5282751522935;
const PROJECTED_TARGET_GAIN_U0 = 0.999996453743593;
const PROJECTED_TARGET_RATIO_U0 = 1.52442470590496;

interface Complex {
  re: number;
  im: number;
}

type ComplexMatrix = Complex[][];

interface ModeResult {
  wavelength: number;
  k: number;
  gain: Complex;
  gainAmplitude: number;
  gainPhaseDegrees: number;
  piOverHydro: Complex;
  piOverHydroAmplitude: number;
  piOverHydroPhaseDegrees: number;
  maxSpectrumAmplitude: number;
  maxTransverseSpectrumAmplitude: number;
  nonzeroSpectrum: Complex[];
  zeroEigenvalueMultiplicity: number;
  transverseSpectrum: Complex[];
  finite: boolean;
}

interface ProofArtifact {
  artifactSchema: 'aeroflow-d3q19-central-moment-eigen-proof-v1';
  generatedAt: string;
  formulation: string;
  constants: Record<string, number>;
  guards: {
    equilibriumFixedPointMax: number;
    conservationMax: number;
    cyclicOperatorMaxDistance: number;
    transverseDegeneracyMaxDistance: number;
  };
  cases: Array<{
    id: string;
    tau: number;
    backgroundU: number;
    target: ModeResult;
    control: ModeResult;
    longControl: ModeResult;
  }>;
  qualificationCases: Array<{
    tau: number;
    backgroundU: number;
    waveAxis: 0 | 1 | 2;
    polarizationAxis: 0 | 1 | 2;
    target: ModeResult;
    control: ModeResult;
  }>;
  gates: Record<string, boolean>;
  passed: boolean;
}

interface D3Q27ProofArtifact {
  artifactSchema: 'aeroflow-d3q27-central-moment-eigen-proof-v1';
  generatedAt: string;
  formulation: string;
  constants: Record<string, number>;
  guards: {
    equilibriumFixedPointMax: number;
    conservationMax: number;
    cyclicOperatorMaxDistance: number;
    transverseDegeneracyMaxDistance: number;
    latticeSymmetryMaxResidual: number;
    inverseTransformMaxResidual: number;
    equilibriumWeightMaxResidual: number;
    smagorinskyFormulaResidual: number;
    equilibriumSmagorinskyTauResidual: number;
    higherOrderAttractorMaxResidual: number;
  };
  cases: Array<{
    id: string;
    tau: number;
    backgroundU: number;
    target: ModeResult;
    control: ModeResult;
    longControl: ModeResult;
  }>;
  gates: Record<string, boolean>;
  passed: boolean;
}

interface D3Q27OperatorFingerprint {
  velocityOrdering: string;
  velocities: ReadonlyArray<readonly [number, number, number]>;
  weights: readonly number[];
  momentOrdering: string;
  exponents: ReadonlyArray<readonly [number, number, number]>;
  transform: string;
  equilibriumAttractor: string;
  relaxationSpectrum: {
    conserved: number[];
    shearAtOneOverTauEff: number[];
    bulkAtUnity: string;
    higherOrderAtUnity: number[];
  };
  inverseTransform: string;
  tauHandling: string;
  smagorinskyCoupling: string;
  conservationCorrectionDirection: number;
}

interface D3Q27PeriodicSpectrumSample {
  mode: number;
  wavelength: number | null;
  uy: Complex;
  uz: Complex;
  amplitude: number;
}

interface D3Q27PeriodicStepSample {
  step: number;
  intendedCoefficient: Complex;
  amplitude: number;
  unwrappedPhase: number;
  piCoefficient: Complex;
  piOverHydro: Complex;
  massDriftRelative: number;
  momentumDrift: readonly [number, number, number];
  momentumDriftNorm: number;
  tauMean: number;
  tauMin: number;
  tauMax: number;
  transverseSpectrum: D3Q27PeriodicSpectrumSample[];
}

interface D3Q27PeriodicCaseResult {
  wavelength: 3.2 | 8 | 16;
  mode: number;
  k: number;
  eigen: ModeResult;
  empiricalGain: number;
  empiricalPhaseDegreesPerStep: number;
  phaseSlopeErrorDegreesPerStep: number;
  amplitudeFitR2: number;
  phaseFitR2: number;
  pairEnvelopeGain: number;
  evenOddGainDistance: number;
  piOverHydro: Complex;
  piOverHydroAmplitude: number;
  massDriftRelativeMax: number;
  momentumDriftMax: number;
  tauMean: number;
  tauMin: number;
  tauMax: number;
  secondaryModes: Array<{
    mode: number;
    polarization: 'uy' | 'uz';
    peakAmplitude: number;
    peakRelativeToIntended: number;
    fittedGain: number | null;
    growing: boolean;
    material: boolean;
  }>;
  secondaryEigenGainMax: number;
  secondarySpectralPeakRatio: number;
  secondaryGrowingMode: boolean;
  persistentBeating: boolean;
  nonFinite: boolean;
  gates: Record<string, boolean>;
  passed: boolean;
  samples: D3Q27PeriodicStepSample[];
}

interface D3Q27PeriodicArtifact {
  artifactSchema: 'aeroflow-d3q27-central-moment-periodic-shear-v1';
  generatedAt: string;
  purpose: string;
  operatorAudit: {
    fingerprint: D3Q27OperatorFingerprint;
    guards: D3Q27ProofArtifact['guards'];
    passed: boolean;
  };
  constants: Record<string, number>;
  detectionConventions: Record<string, number>;
  cases: D3Q27PeriodicCaseResult[];
  failedGates: string[];
  passed: boolean;
  decision: 'Q27_EMPIRICAL_PASS' | 'Q27_EMPIRICAL_FAIL';
}

const c = (re = 0, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
const mul = (a: Complex, b: Complex): Complex =>
  c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const conj = (a: Complex): Complex => c(a.re, -a.im);
const scale = (a: Complex, factor: number): Complex => c(a.re * factor, a.im * factor);
const magnitude = (a: Complex): number => Math.hypot(a.re, a.im);
const distance = (a: Complex, b: Complex): number => magnitude(sub(a, b));
const divide = (a: Complex, b: Complex): Complex => {
  const denominator = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / denominator, (a.im * b.re - a.re * b.im) / denominator);
};
const sqrtComplex = (value: Complex): Complex => {
  const radius = magnitude(value);
  const re = Math.sqrt(Math.max(0, (radius + value.re) / 2));
  const im = Math.sign(value.im || 1) * Math.sqrt(Math.max(0, (radius - value.re) / 2));
  return c(re, im);
};

function identity(n: number): ComplexMatrix {
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, column) => c(row === column ? 1 : 0)),
  );
}

function cloneMatrix(matrix: ComplexMatrix): ComplexMatrix {
  return matrix.map((row) => row.map((value) => c(value.re, value.im)));
}

function multiplyMatrices(a: ComplexMatrix, b: ComplexMatrix): ComplexMatrix {
  const rows = a.length;
  const inner = b.length;
  const columns = b[0].length;
  const result = Array.from({ length: rows }, () => Array.from({ length: columns }, () => c()));
  for (let row = 0; row < rows; row++) {
    for (let shared = 0; shared < inner; shared++) {
      const left = a[row][shared];
      for (let column = 0; column < columns; column++) {
        result[row][column] = add(result[row][column], mul(left, b[shared][column]));
      }
    }
  }
  return result;
}

/** Stable complex Householder QR; matrices here are at most 19x19. */
function qr(matrix: ComplexMatrix): { q: ComplexMatrix; r: ComplexMatrix } {
  const n = matrix.length;
  const r = cloneMatrix(matrix);
  const q = identity(n);
  for (let pivot = 0; pivot < n; pivot++) {
    let normSquared = 0;
    for (let row = pivot; row < n; row++) {
      const value = magnitude(r[row][pivot]);
      normSquared += value * value;
    }
    const norm = Math.sqrt(normSquared);
    if (norm < 1e-30) continue;
    const first = r[pivot][pivot];
    const phase = magnitude(first) > 0 ? scale(first, 1 / magnitude(first)) : c(1);
    const alpha = scale(phase, -norm);
    const vector = Array.from({ length: n - pivot }, (_, offset) =>
      c(r[pivot + offset][pivot].re, r[pivot + offset][pivot].im),
    );
    vector[0] = sub(vector[0], alpha);
    let vectorNormSquared = 0;
    for (const value of vector) {
      const length = magnitude(value);
      vectorNormSquared += length * length;
    }
    if (vectorNormSquared < 1e-30) continue;
    const beta = 2 / vectorNormSquared;

    // R <- H R, H = I - beta v v^H.
    for (let column = pivot; column < n; column++) {
      let projection = c();
      for (let offset = 0; offset < vector.length; offset++) {
        projection = add(projection, mul(conj(vector[offset]), r[pivot + offset][column]));
      }
      projection = scale(projection, beta);
      for (let offset = 0; offset < vector.length; offset++) {
        r[pivot + offset][column] = sub(r[pivot + offset][column], mul(vector[offset], projection));
      }
    }

    // Q <- Q H.
    for (let row = 0; row < n; row++) {
      let projection = c();
      for (let offset = 0; offset < vector.length; offset++) {
        projection = add(projection, mul(q[row][pivot + offset], vector[offset]));
      }
      projection = scale(projection, beta);
      for (let offset = 0; offset < vector.length; offset++) {
        q[row][pivot + offset] = sub(q[row][pivot + offset], mul(projection, conj(vector[offset])));
      }
    }
  }
  return { q, r };
}

function eigenvalues2(a: Complex, b: Complex, c0: Complex, d: Complex): [Complex, Complex] {
  const trace = add(a, d);
  const determinant = sub(mul(a, d), mul(b, c0));
  const root = sqrtComplex(sub(mul(trace, trace), scale(determinant, 4)));
  return [scale(add(trace, root), 0.5), scale(sub(trace, root), 0.5)];
}

function hessenberg(matrix: ComplexMatrix): ComplexMatrix {
  const result = cloneMatrix(matrix);
  const n = result.length;
  for (let column = 0; column < n - 2; column++) {
    const vector = Array.from({ length: n - column - 1 }, (_, offset) =>
      c(result[column + 1 + offset][column].re, result[column + 1 + offset][column].im),
    );
    const norm = Math.sqrt(
      vector.reduce((sum, value) => {
        const length = magnitude(value);
        return sum + length * length;
      }, 0),
    );
    if (norm < 1e-30) continue;
    const phase = magnitude(vector[0]) > 0 ? scale(vector[0], 1 / magnitude(vector[0])) : c(1);
    vector[0] = sub(vector[0], scale(phase, -norm));
    let vectorNormSquared = 0;
    for (const value of vector) {
      const length = magnitude(value);
      vectorNormSquared += length * length;
    }
    const beta = 2 / vectorNormSquared;
    // H A.
    for (let targetColumn = column; targetColumn < n; targetColumn++) {
      let projection = c();
      for (let offset = 0; offset < vector.length; offset++) {
        projection = add(
          projection,
          mul(conj(vector[offset]), result[column + 1 + offset][targetColumn]),
        );
      }
      projection = scale(projection, beta);
      for (let offset = 0; offset < vector.length; offset++) {
        result[column + 1 + offset][targetColumn] = sub(
          result[column + 1 + offset][targetColumn],
          mul(vector[offset], projection),
        );
      }
    }
    // A H.
    for (let row = 0; row < n; row++) {
      let projection = c();
      for (let offset = 0; offset < vector.length; offset++) {
        projection = add(projection, mul(result[row][column + 1 + offset], vector[offset]));
      }
      projection = scale(projection, beta);
      for (let offset = 0; offset < vector.length; offset++) {
        result[row][column + 1 + offset] = sub(
          result[row][column + 1 + offset],
          mul(projection, conj(vector[offset])),
        );
      }
    }
    for (let row = column + 2; row < n; row++) result[row][column] = c();
  }
  return result;
}

/** Shifted complex QR with bottom-row deflation. */
function eigenvalues(matrix: ComplexMatrix): Complex[] {
  const work = hessenberg(matrix);
  const values = Array.from({ length: work.length }, () => c());
  let active = work.length;
  while (active > 2) {
    let deflated = 0;
    for (let iteration = 0; iteration < 20_000; iteration++) {
      const bottom = magnitude(work[active - 1][active - 2]);
      const scaleReference =
        1 + magnitude(work[active - 2][active - 2]) + magnitude(work[active - 1][active - 1]);
      if (bottom <= 2e-12 * scaleReference) {
        values[active - 1] = work[active - 1][active - 1];
        deflated = 1;
        break;
      }
      const pairCoupling = magnitude(work[active - 2][active - 3]);
      const pairScale =
        1 + magnitude(work[active - 3][active - 3]) + magnitude(work[active - 2][active - 2]);
      if (pairCoupling <= 2e-12 * pairScale) {
        const pair = eigenvalues2(
          work[active - 2][active - 2],
          work[active - 2][active - 1],
          work[active - 1][active - 2],
          work[active - 1][active - 1],
        );
        values[active - 2] = pair[0];
        values[active - 1] = pair[1];
        deflated = 2;
        break;
      }
      const a = work[active - 2][active - 2];
      const b = work[active - 2][active - 1];
      const c0 = work[active - 1][active - 2];
      const d = work[active - 1][active - 1];
      const candidates = eigenvalues2(a, b, c0, d);
      const shift =
        distance(candidates[0], d) <= distance(candidates[1], d) ? candidates[0] : candidates[1];
      const shifted = Array.from({ length: active }, (_, row) =>
        Array.from({ length: active }, (_, column) =>
          sub(work[row][column], row === column ? shift : c()),
        ),
      );
      const decomposition = qr(shifted);
      const next = multiplyMatrices(decomposition.r, decomposition.q);
      for (let row = 0; row < active; row++) {
        for (let column = 0; column < active; column++) {
          work[row][column] = add(next[row][column], row === column ? shift : c());
        }
      }
      for (let row = 2; row < active; row++) {
        for (let column = 0; column < row - 1; column++) work[row][column] = c();
      }
    }
    if (deflated === 0) throw new Error(`complex QR did not deflate ${active}x${active} block`);
    active -= deflated;
  }
  if (active === 2) {
    const final = eigenvalues2(work[0][0], work[0][1], work[1][0], work[1][1]);
    values[0] = final[0];
    values[1] = final[1];
  } else if (active === 1) {
    values[0] = work[0][0];
  }
  return values;
}

function solve(matrix: ComplexMatrix, rhs: Complex[]): Complex[] {
  const n = matrix.length;
  const augmented = matrix.map((row, index) => [
    ...row.map((value) => c(value.re, value.im)),
    c(rhs[index].re, rhs[index].im),
  ]);
  for (let pivot = 0; pivot < n; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (magnitude(augmented[row][pivot]) > magnitude(augmented[best][pivot])) best = row;
    }
    if (magnitude(augmented[best][pivot]) < 1e-18) throw new Error('singular complex solve');
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const diagonal = augmented[pivot][pivot];
    for (let column = pivot; column <= n; column++) {
      augmented[pivot][column] = divide(augmented[pivot][column], diagonal);
    }
    for (let row = 0; row < n; row++) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= n; column++) {
        augmented[row][column] = sub(augmented[row][column], mul(factor, augmented[pivot][column]));
      }
    }
  }
  return augmented.map((row) => row[n]);
}

function inverseEigenvector(matrix: ComplexMatrix, eigenvalue: Complex): Complex[] {
  const n = matrix.length;
  let vector = Array.from({ length: n }, (_, index) => c(index === 0 ? 1 : 0));
  const shiftedEigenvalue = add(eigenvalue, c(1e-10, 1e-10));
  for (let iteration = 0; iteration < 12; iteration++) {
    const shifted = matrix.map((row, rowIndex) =>
      row.map((value, columnIndex) =>
        sub(value, rowIndex === columnIndex ? shiftedEigenvalue : c()),
      ),
    );
    vector = solve(shifted, vector);
    const norm = Math.sqrt(
      vector.reduce((sum, value) => {
        const length = magnitude(value);
        return sum + length * length;
      }, 0),
    );
    vector = vector.map((value) => scale(value, 1 / norm));
  }
  return vector;
}

/**
 * The selected CM collision equilibrates ten moments, so its Jacobian (and C*streaming)
 * has rank nine.  Non-zero eigenvectors of A lie in range(A); projecting A onto an
 * orthonormal basis of that range retains every non-zero eigenvalue and removes the tenfold
 * exact-zero cluster that needlessly defeats a generic dense QR iteration.
 */
function nonzeroSpectrum(matrix: ComplexMatrix): Complex[] {
  const n = matrix.length;
  const basis: Complex[][] = [];
  for (let column = 0; column < n; column++) {
    const vector = Array.from({ length: n }, (_, row) =>
      c(matrix[row][column].re, matrix[row][column].im),
    );
    for (const existing of basis) {
      let projection = c();
      for (let row = 0; row < n; row++) {
        projection = add(projection, mul(conj(existing[row]), vector[row]));
      }
      for (let row = 0; row < n; row++) {
        vector[row] = sub(vector[row], mul(existing[row], projection));
      }
    }
    const norm = Math.sqrt(
      vector.reduce((sum, value) => {
        const length = magnitude(value);
        return sum + length * length;
      }, 0),
    );
    if (norm > 1e-8) basis.push(vector.map((value) => scale(value, 1 / norm)));
  }
  const reduced = Array.from({ length: basis.length }, () =>
    Array.from({ length: basis.length }, () => c()),
  );
  for (let column = 0; column < basis.length; column++) {
    const applied = matrix.map((row) =>
      row.reduce((sum, value, direction) => add(sum, mul(value, basis[column][direction])), c()),
    );
    for (let row = 0; row < basis.length; row++) {
      for (let direction = 0; direction < n; direction++) {
        reduced[row][column] = add(
          reduced[row][column],
          mul(conj(basis[row][direction]), applied[direction]),
        );
      }
    }
  }
  return eigenvalues(reduced);
}

function equilibriumCentral(rho: number, ux: number, uy: number, uz: number): Float64Array {
  return equilibriumD3Q19CentralAuthority(rho, ux, uy, uz);
}

function rawConserved(populations: ArrayLike<number>): [number, number, number, number] {
  return conservedD3Q19Authority(populations);
}

function collideCentral(populations: Float64Array, tau: number): void {
  collideD3Q19CentralAuthority(populations, { tau0: tau });
}

function collisionJacobian(
  backgroundAxis: 0 | 1 | 2,
  tau: number,
  backgroundU: number,
): number[][] {
  const velocity = [0, 0, 0];
  velocity[backgroundAxis] = backgroundU;
  const base = equilibriumCentral(1, velocity[0], velocity[1], velocity[2]);
  const jacobian = Array.from({ length: Q }, () => new Array<number>(Q).fill(0));
  for (let column = 0; column < Q; column++) {
    const plus = new Float64Array(base);
    const minus = new Float64Array(base);
    plus[column] += DIFFERENCE_EPSILON;
    minus[column] -= DIFFERENCE_EPSILON;
    collideCentral(plus, tau);
    collideCentral(minus, tau);
    for (let row = 0; row < Q; row++) {
      jacobian[row][column] = (plus[row] - minus[row]) / (2 * DIFFERENCE_EPSILON);
    }
  }
  return jacobian;
}

function amplificationOperator(
  k: number,
  waveAxis: 0 | 1 | 2,
  tau: number,
  backgroundU: number,
): ComplexMatrix {
  const jacobian = collisionJacobian(waveAxis, tau, backgroundU);
  const components = [D3Q19.ex, D3Q19.ey, D3Q19.ez] as const;
  return jacobian.map((row) =>
    row.map((value, direction) => {
      const phase = -k * components[waveAxis][direction];
      return c(value * Math.cos(phase), value * Math.sin(phase));
    }),
  );
}

interface OddPair {
  positive: number;
  negative: number;
}

function transversePairs(polarizationAxis: 0 | 1 | 2): OddPair[] {
  const components = [D3Q19.ex, D3Q19.ey, D3Q19.ez] as const;
  const pairs: OddPair[] = [];
  for (let positive = 0; positive < Q; positive++) {
    if (components[polarizationAxis][positive] !== 1) continue;
    const target = [D3Q19.ex[positive], D3Q19.ey[positive], D3Q19.ez[positive]];
    target[polarizationAxis] = -1;
    const negative = Array.from({ length: Q }, (_, index) => index).find(
      (direction) =>
        D3Q19.ex[direction] === target[0] &&
        D3Q19.ey[direction] === target[1] &&
        D3Q19.ez[direction] === target[2],
    );
    if (negative === undefined) throw new Error('missing reflected D3Q19 direction');
    pairs.push({ positive, negative });
  }
  return pairs;
}

function transverseOperator(
  full: ComplexMatrix,
  polarizationAxis: 0 | 1 | 2,
): { matrix: ComplexMatrix; pairs: OddPair[] } {
  const pairs = transversePairs(polarizationAxis);
  const matrix = Array.from({ length: pairs.length }, () =>
    Array.from({ length: pairs.length }, () => c()),
  );
  for (let column = 0; column < pairs.length; column++) {
    const input = Array.from({ length: Q }, () => c());
    input[pairs[column].positive] = c(1);
    input[pairs[column].negative] = c(-1);
    const output = full.map((row) =>
      row.reduce((sum, value, direction) => add(sum, mul(value, input[direction])), c()),
    );
    for (let row = 0; row < pairs.length; row++) {
      matrix[row][column] = scale(
        sub(output[pairs[row].positive], output[pairs[row].negative]),
        0.5,
      );
    }
  }
  return { matrix, pairs };
}

function expandTransverse(vector: Complex[], pairs: OddPair[]): Complex[] {
  const result = Array.from({ length: Q }, () => c());
  for (let index = 0; index < pairs.length; index++) {
    result[pairs[index].positive] = vector[index];
    result[pairs[index].negative] = scale(vector[index], -1);
  }
  return result;
}

function modeResult(
  wavelength: number,
  waveAxis: 0 | 1 | 2,
  polarizationAxis: 0 | 1 | 2,
  tau: number,
  backgroundU: number,
): ModeResult {
  const k = (2 * Math.PI) / wavelength;
  const full = amplificationOperator(k, waveAxis, tau, backgroundU);
  const spectrum = nonzeroSpectrum(full);
  const transverse = transverseOperator(full, polarizationAxis);
  const transverseSpectrum = eigenvalues(transverse.matrix);
  let selected = transverseSpectrum[0];
  let selectedVector = inverseEigenvector(transverse.matrix, selected);
  let selectedMomentumFraction = -Infinity;
  const components = [D3Q19.ex, D3Q19.ey, D3Q19.ez] as const;
  for (const candidate of transverseSpectrum) {
    const candidateVector = inverseEigenvector(transverse.matrix, candidate);
    const expanded = expandTransverse(candidateVector, transverse.pairs);
    let momentum = c();
    for (let direction = 0; direction < Q; direction++) {
      momentum = add(momentum, scale(expanded[direction], components[polarizationAxis][direction]));
    }
    const fraction = magnitude(momentum);
    if (fraction > selectedMomentumFraction) {
      selectedMomentumFraction = fraction;
      selected = candidate;
      selectedVector = candidateVector;
    }
  }

  const postCollision = expandTransverse(selectedVector, transverse.pairs);
  const preCollision = postCollision.map((value, direction) => {
    const phase = -k * components[waveAxis][direction];
    return mul(value, c(Math.cos(phase), Math.sin(phase)));
  });
  let momentum = c();
  let rawStress = c();
  for (let direction = 0; direction < Q; direction++) {
    momentum = add(
      momentum,
      scale(preCollision[direction], components[polarizationAxis][direction]),
    );
    rawStress = add(
      rawStress,
      scale(
        preCollision[direction],
        components[waveAxis][direction] * components[polarizationAxis][direction],
      ),
    );
  }
  const piNeq = sub(rawStress, scale(momentum, backgroundU));
  const hydro = mul(c(0, -CS2 * tau * k), momentum);
  const ratio = divide(piNeq, hydro);
  return {
    wavelength,
    k,
    gain: selected,
    gainAmplitude: magnitude(selected),
    gainPhaseDegrees: (Math.atan2(selected.im, selected.re) * 180) / Math.PI,
    piOverHydro: ratio,
    piOverHydroAmplitude: magnitude(ratio),
    piOverHydroPhaseDegrees: (Math.atan2(ratio.im, ratio.re) * 180) / Math.PI,
    maxSpectrumAmplitude: Math.max(...spectrum.map(magnitude)),
    maxTransverseSpectrumAmplitude: Math.max(...transverseSpectrum.map(magnitude)),
    nonzeroSpectrum: spectrum,
    zeroEigenvalueMultiplicity: Q - spectrum.length,
    transverseSpectrum,
    finite: [
      selected.re,
      selected.im,
      ratio.re,
      ratio.im,
      ...spectrum.flatMap((v) => [v.re, v.im]),
    ].every(Number.isFinite),
  };
}

function cyclicOperatorDistance(
  reference: ComplexMatrix,
  rotated: ComplexMatrix,
  targetAxis: 1 | 2,
): number {
  const permutation = Array.from({ length: Q }, (_, direction) => {
    const original = [D3Q19.ex[direction], D3Q19.ey[direction], D3Q19.ez[direction]];
    const target =
      targetAxis === 1
        ? [original[2], original[0], original[1]]
        : [original[1], original[2], original[0]];
    const mapped = Array.from({ length: Q }, (_, index) => index).find(
      (index) =>
        D3Q19.ex[index] === target[0] &&
        D3Q19.ey[index] === target[1] &&
        D3Q19.ez[index] === target[2],
    );
    if (mapped === undefined) throw new Error('missing cyclic D3Q19 direction');
    return mapped;
  });
  let residual = 0;
  for (let row = 0; row < Q; row++) {
    for (let column = 0; column < Q; column++) {
      residual = Math.max(
        residual,
        distance(reference[row][column], rotated[permutation[row]][permutation[column]]),
      );
    }
  }
  return residual;
}

const D3Q27_VELOCITIES = D3Q27.velocities;
const D3Q27_WEIGHTS = D3Q27.w;
const D3Q27_COMPONENTS = [D3Q27.ex, D3Q27.ey, D3Q27.ez] as const;
const D3Q27_EXPONENTS = D3Q27_CENTRAL_EXPONENTS;
const d3q27MomentIndex = d3q27CentralMomentIndex;
const centralMatrix27 = centralMomentMatrixD3Q27;
const equilibriumMoments27 = centralMomentAttractorsD3Q27;
const equilibriumCentral27 = equilibriumD3Q27Central;
const rawConserved27 = conservedD3Q27;
const collideCentral27 = (
  populations: Float64Array,
  tau0: number,
  lesCs = 0,
  lesNorm?: 'spec' | 'legacy',
) => collideD3Q27Central(populations, { tau0, lesCs, lesNorm });

function collisionJacobian27(
  backgroundAxis: 0 | 1 | 2,
  tau: number,
  backgroundU: number,
): number[][] {
  const velocity = [0, 0, 0];
  velocity[backgroundAxis] = backgroundU;
  const base = equilibriumCentral27(1, velocity[0], velocity[1], velocity[2]);
  const jacobian = Array.from({ length: 27 }, () => new Array<number>(27).fill(0));
  for (let column = 0; column < 27; column++) {
    const plus = new Float64Array(base);
    const minus = new Float64Array(base);
    plus[column] += DIFFERENCE_EPSILON;
    minus[column] -= DIFFERENCE_EPSILON;
    collideCentral27(plus, tau);
    collideCentral27(minus, tau);
    for (let row = 0; row < 27; row++) {
      jacobian[row][column] = (plus[row] - minus[row]) / (2 * DIFFERENCE_EPSILON);
    }
  }
  return jacobian;
}

function amplificationOperator27(
  k: number,
  waveAxis: 0 | 1 | 2,
  tau: number,
  backgroundU: number,
): ComplexMatrix {
  const jacobian = collisionJacobian27(waveAxis, tau, backgroundU);
  return jacobian.map((row) =>
    row.map((value, direction) => {
      const phase = -k * D3Q27_COMPONENTS[waveAxis][direction];
      return c(value * Math.cos(phase), value * Math.sin(phase));
    }),
  );
}

function transversePairs27(polarizationAxis: 0 | 1 | 2): OddPair[] {
  const pairs: OddPair[] = [];
  for (let positive = 0; positive < 27; positive++) {
    if (D3Q27_COMPONENTS[polarizationAxis][positive] !== 1) continue;
    const target = [...D3Q27_VELOCITIES[positive]];
    target[polarizationAxis] = -1;
    const negative = D3Q27_VELOCITIES.findIndex((velocity) =>
      velocity.every((component, axis) => component === target[axis]),
    );
    if (negative < 0) throw new Error('missing reflected D3Q27 direction');
    pairs.push({ positive, negative });
  }
  return pairs;
}

function transverseOperator27(
  full: ComplexMatrix,
  polarizationAxis: 0 | 1 | 2,
): { matrix: ComplexMatrix; pairs: OddPair[] } {
  const pairs = transversePairs27(polarizationAxis);
  const matrix = Array.from({ length: pairs.length }, () =>
    Array.from({ length: pairs.length }, () => c()),
  );
  for (let column = 0; column < pairs.length; column++) {
    const input = Array.from({ length: 27 }, () => c());
    input[pairs[column].positive] = c(1);
    input[pairs[column].negative] = c(-1);
    const output = full.map((row) =>
      row.reduce((sum, value, direction) => add(sum, mul(value, input[direction])), c()),
    );
    for (let row = 0; row < pairs.length; row++) {
      matrix[row][column] = scale(
        sub(output[pairs[row].positive], output[pairs[row].negative]),
        0.5,
      );
    }
  }
  return { matrix, pairs };
}

function expandTransverse27(vector: Complex[], pairs: OddPair[]): Complex[] {
  const result = Array.from({ length: 27 }, () => c());
  for (let index = 0; index < pairs.length; index++) {
    result[pairs[index].positive] = vector[index];
    result[pairs[index].negative] = scale(vector[index], -1);
  }
  return result;
}

function modeResult27(
  wavelength: number,
  waveAxis: 0 | 1 | 2,
  polarizationAxis: 0 | 1 | 2,
  tau: number,
  backgroundU: number,
): ModeResult {
  const k = (2 * Math.PI) / wavelength;
  const full = amplificationOperator27(k, waveAxis, tau, backgroundU);
  const spectrum = nonzeroSpectrum(full);
  const transverse = transverseOperator27(full, polarizationAxis);
  const transverseSpectrum = eigenvalues(transverse.matrix);
  let selected = transverseSpectrum[0];
  let selectedVector = inverseEigenvector(transverse.matrix, selected);
  let selectedMomentumFraction = -Infinity;
  for (const candidate of transverseSpectrum) {
    const candidateVector = inverseEigenvector(transverse.matrix, candidate);
    const expanded = expandTransverse27(candidateVector, transverse.pairs);
    let momentum = c();
    for (let direction = 0; direction < 27; direction++) {
      momentum = add(
        momentum,
        scale(expanded[direction], D3Q27_COMPONENTS[polarizationAxis][direction]),
      );
    }
    const fraction = magnitude(momentum);
    if (fraction > selectedMomentumFraction) {
      selectedMomentumFraction = fraction;
      selected = candidate;
      selectedVector = candidateVector;
    }
  }

  const postCollision = expandTransverse27(selectedVector, transverse.pairs);
  const preCollision = postCollision.map((value, direction) => {
    const phase = -k * D3Q27_COMPONENTS[waveAxis][direction];
    return mul(value, c(Math.cos(phase), Math.sin(phase)));
  });
  let momentum = c();
  let rawStress = c();
  for (let direction = 0; direction < 27; direction++) {
    momentum = add(
      momentum,
      scale(preCollision[direction], D3Q27_COMPONENTS[polarizationAxis][direction]),
    );
    rawStress = add(
      rawStress,
      scale(
        preCollision[direction],
        D3Q27_COMPONENTS[waveAxis][direction] * D3Q27_COMPONENTS[polarizationAxis][direction],
      ),
    );
  }
  const piNeq = sub(rawStress, scale(momentum, backgroundU));
  const hydro = mul(c(0, -CS2 * tau * k), momentum);
  const ratio = divide(piNeq, hydro);
  return {
    wavelength,
    k,
    gain: selected,
    gainAmplitude: magnitude(selected),
    gainPhaseDegrees: (Math.atan2(selected.im, selected.re) * 180) / Math.PI,
    piOverHydro: ratio,
    piOverHydroAmplitude: magnitude(ratio),
    piOverHydroPhaseDegrees: (Math.atan2(ratio.im, ratio.re) * 180) / Math.PI,
    maxSpectrumAmplitude: Math.max(...spectrum.map(magnitude)),
    maxTransverseSpectrumAmplitude: Math.max(...transverseSpectrum.map(magnitude)),
    nonzeroSpectrum: spectrum,
    zeroEigenvalueMultiplicity: 27 - spectrum.length,
    transverseSpectrum,
    finite: [
      selected.re,
      selected.im,
      ratio.re,
      ratio.im,
      ...spectrum.flatMap((v) => [v.re, v.im]),
    ].every(Number.isFinite),
  };
}

function cyclicOperatorDistance27(
  reference: ComplexMatrix,
  rotated: ComplexMatrix,
  targetAxis: 1 | 2,
): number {
  const permutation = D3Q27_VELOCITIES.map((original) => {
    const target =
      targetAxis === 1
        ? [original[2], original[0], original[1]]
        : [original[1], original[2], original[0]];
    const mapped = D3Q27_VELOCITIES.findIndex((velocity) =>
      velocity.every((component, axis) => component === target[axis]),
    );
    if (mapped < 0) throw new Error('missing cyclic D3Q27 direction');
    return mapped;
  });
  let residual = 0;
  for (let row = 0; row < 27; row++) {
    for (let column = 0; column < 27; column++) {
      residual = Math.max(
        residual,
        distance(reference[row][column], rotated[permutation[row]][permutation[column]]),
      );
    }
  }
  return residual;
}

const Q27_PERIODIC_N = 64;
const Q27_PERIODIC_AMPLITUDE = 0.005;
const Q27_PERIODIC_LES_CS = 0.1;
const Q27_PERIODIC_STEPS = 120;
const Q27_PERIODIC_DISCARD = 40;
const Q27_SECONDARY_DETECTION_FLOOR = Q27_PERIODIC_AMPLITUDE * 1e-7;
const Q27_SECONDARY_MATERIAL_RATIO = 1e-3;

function operatorFingerprint27(): D3Q27OperatorFingerprint {
  const conserved = [
    d3q27MomentIndex(0, 0, 0),
    d3q27MomentIndex(1, 0, 0),
    d3q27MomentIndex(0, 1, 0),
    d3q27MomentIndex(0, 0, 1),
  ];
  const shear = [
    d3q27MomentIndex(2, 0, 0),
    d3q27MomentIndex(0, 2, 0),
    d3q27MomentIndex(0, 0, 2),
    d3q27MomentIndex(1, 1, 0),
    d3q27MomentIndex(1, 0, 1),
    d3q27MomentIndex(0, 1, 1),
  ];
  return {
    velocityOrdering: 'lexicographic x-major: direction=(cx+1)*9+(cy+1)*3+(cz+1)',
    velocities: D3Q27_VELOCITIES,
    weights: D3Q27_WEIGHTS,
    momentOrdering: 'lexicographic px-major: moment=px*9+py*3+pz, px/py/pz in {0,1,2}',
    exponents: D3Q27_EXPONENTS,
    transform: 'K[p,i]=(cix-ux)^px*(ciy-uy)^py*(ciz-uz)^pz',
    equilibriumAttractor: 'kappa_eq=0 if any exponent is 1; otherwise rho*(1/3)^count(exponent==2)',
    relaxationSpectrum: {
      conserved,
      shearAtOneOverTauEff: shear,
      bulkAtUnity: 'the diagonal trace kappa200+kappa020+kappa002 is set to rho',
      higherOrderAtUnity: D3Q27_EXPONENTS.flatMap(([px, py, pz], index) =>
        px + py + pz >= 3 ? [index] : [],
      ),
    },
    inverseTransform: 'Float64 Gaussian solve of K*f*=kappa* with partial pivoting',
    tauHandling:
      'tau0 is exact input; shear omega=1/tauEff; there is no TRT odd rate, clamp, or floor',
    smagorinskyCoupling: 'tauEff=tau0+0.5*(sqrt(tau0^2+18*sqrt(2)*Cs^2*||Pi_neq||/rho)-tau0)',
    conservationCorrectionDirection: 13,
  };
}

function auditAdditionalGuards27(): Omit<
  D3Q27ProofArtifact['guards'],
  | 'equilibriumFixedPointMax'
  | 'conservationMax'
  | 'cyclicOperatorMaxDistance'
  | 'transverseDegeneracyMaxDistance'
> {
  let latticeSymmetryMaxResidual = Math.abs(
    D3Q27_WEIGHTS.reduce((sum, value) => sum + value, 0) - 1,
  );
  for (let axis = 0; axis < 3; axis++) {
    let first = 0;
    let second = 0;
    for (let direction = 0; direction < 27; direction++) {
      const component = D3Q27_COMPONENTS[axis][direction];
      first += D3Q27_WEIGHTS[direction] * component;
      second += D3Q27_WEIGHTS[direction] * component * component;
      const opposite = D3Q27_VELOCITIES.findIndex((velocity) =>
        velocity.every((value, index) => value === -D3Q27_VELOCITIES[direction][index]),
      );
      latticeSymmetryMaxResidual = Math.max(
        latticeSymmetryMaxResidual,
        opposite < 0 ? Infinity : Math.abs(D3Q27_WEIGHTS[direction] - D3Q27_WEIGHTS[opposite]),
      );
    }
    latticeSymmetryMaxResidual = Math.max(
      latticeSymmetryMaxResidual,
      Math.abs(first),
      Math.abs(second - CS2),
    );
  }

  const inverseInput = Float64Array.from(
    { length: 27 },
    (_, direction) => D3Q27_WEIGHTS[direction] + 1e-5 * Math.sin(0.43 * (direction + 1)),
  );
  const [rho, mx, my, mz] = rawConserved27(inverseInput);
  const inverseTransform = centralMatrix27(mx / rho, my / rho, mz / rho);
  const inverseMoments = inverseTransform.map((row) =>
    row.reduce((sum, value, direction) => sum + value * inverseInput[direction], 0),
  );
  const inverseOutput = populationsFromCentralMomentsD3Q27(inverseTransform, inverseMoments);
  let inverseTransformMaxResidual = 0;
  for (let direction = 0; direction < 27; direction++) {
    inverseTransformMaxResidual = Math.max(
      inverseTransformMaxResidual,
      Math.abs(inverseOutput[direction] - inverseInput[direction]),
    );
  }

  const equilibriumAtRest = equilibriumCentral27(1, 0, 0, 0);
  let equilibriumWeightMaxResidual = 0;
  for (let direction = 0; direction < 27; direction++) {
    equilibriumWeightMaxResidual = Math.max(
      equilibriumWeightMaxResidual,
      Math.abs(equilibriumAtRest[direction] - D3Q27_WEIGHTS[direction]),
    );
  }

  // piNorm below is an independent re-derivation of the `'legacy'` norm (√(2·Σ) in one
  // sqrt, not √2·√(Σ)) — see collide.ts's `LesNorm` doc. Pin the collisions it audits to
  // 'legacy' explicitly so this stays a check against that hand-derived formula regardless
  // of collideD3Q27Central's own default (fix-confirmed-physics-defects task 6.9).
  const equilibriumWithLes = equilibriumCentral27(1, AHMED_U, 0, 0);
  const equilibriumCollision = collideCentral27(
    new Float64Array(equilibriumWithLes),
    TAU_2M,
    Q27_PERIODIC_LES_CS,
    'legacy',
  );
  const equilibriumSmagorinskyTauResidual = Math.abs(equilibriumCollision.tauEff - TAU_2M);

  const perturbed = new Float64Array(equilibriumWithLes);
  for (let direction = 0; direction < 27; direction++) {
    perturbed[direction] += 2e-5 * Math.sin(0.71 * (direction + 1));
  }
  const collision = collideCentral27(perturbed, TAU_2M, Q27_PERIODIC_LES_CS, 'legacy');
  const piNorm = Math.sqrt(
    2 *
      (collision.piNeq[0] ** 2 +
        collision.piNeq[1] ** 2 +
        collision.piNeq[2] ** 2 +
        2 * (collision.piNeq[3] ** 2 + collision.piNeq[4] ** 2 + collision.piNeq[5] ** 2)),
  );
  const lesK = lesKFromCs(Q27_PERIODIC_LES_CS);
  const expectedTau =
    TAU_2M + 0.5 * (Math.sqrt(TAU_2M ** 2 + (lesK * piNorm) / collision.rho) - TAU_2M);
  const smagorinskyFormulaResidual = Math.abs(collision.tauEff - expectedTau);

  const postTransform = centralMatrix27(collision.ux, collision.uy, collision.uz);
  const postMoments = postTransform.map((row) =>
    row.reduce((sum, value, direction) => sum + value * perturbed[direction], 0),
  );
  const postEquilibrium = equilibriumMoments27(collision.rho);
  let higherOrderAttractorMaxResidual = 0;
  for (let moment = 0; moment < 27; moment++) {
    const [px, py, pz] = D3Q27_EXPONENTS[moment];
    if (px + py + pz < 3) continue;
    higherOrderAttractorMaxResidual = Math.max(
      higherOrderAttractorMaxResidual,
      Math.abs(postMoments[moment] - postEquilibrium[moment]),
    );
  }

  return {
    latticeSymmetryMaxResidual,
    inverseTransformMaxResidual,
    equilibriumWeightMaxResidual,
    smagorinskyFormulaResidual,
    equilibriumSmagorinskyTauResidual,
    higherOrderAttractorMaxResidual,
  };
}

function realLinearFit(points: ReadonlyArray<readonly [number, number]>): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  const slope = covariance / varianceX;
  return {
    slope,
    intercept: meanY - slope * meanX,
    r2: varianceY === 0 ? 1 : (covariance * covariance) / (varianceX * varianceY),
  };
}

function fourier27(values: ArrayLike<number>, mode: number): Complex {
  const k = (2 * Math.PI * mode) / Q27_PERIODIC_N;
  let result = c();
  for (let x = 0; x < Q27_PERIODIC_N; x++) {
    result = add(result, c(values[x] * Math.cos(k * x), -values[x] * Math.sin(k * x)));
  }
  return scale(result, 1 / Q27_PERIODIC_N);
}

function unwrapPhase(previous: number | undefined, value: Complex): number {
  let phase = Math.atan2(value.im, value.re);
  if (previous === undefined) return phase;
  while (phase - previous > Math.PI) phase -= 2 * Math.PI;
  while (phase - previous < -Math.PI) phase += 2 * Math.PI;
  return phase;
}

function stateConserved27(state: Float64Array): [number, number, number, number] {
  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let direction = 0; direction < 27; direction++) {
    for (let x = 0; x < Q27_PERIODIC_N; x++) {
      const value = state[direction * Q27_PERIODIC_N + x];
      result[0] += value;
      result[1] += D3Q27_COMPONENTS[0][direction] * value;
      result[2] += D3Q27_COMPONENTS[1][direction] * value;
      result[3] += D3Q27_COMPONENTS[2][direction] * value;
    }
  }
  return result;
}

function runPeriodicCase27(wavelength: 3.2 | 8 | 16): D3Q27PeriodicCaseResult {
  const mode = Q27_PERIODIC_N / wavelength;
  if (!Number.isInteger(mode)) throw new Error(`wavelength ${wavelength} does not divide N=64`);
  const k = (2 * Math.PI * mode) / Q27_PERIODIC_N;
  let source = new Float64Array(27 * Q27_PERIODIC_N);
  let destination = new Float64Array(source.length);
  for (let x = 0; x < Q27_PERIODIC_N; x++) {
    const uy = Q27_PERIODIC_AMPLITUDE * Math.cos(k * x);
    const equilibrium = equilibriumCentral27(1, AHMED_U, uy, 0);
    for (let direction = 0; direction < 27; direction++) {
      source[direction * Q27_PERIODIC_N + x] = equilibrium[direction];
    }
  }
  const initialConserved = stateConserved27(source);
  const samples: D3Q27PeriodicStepSample[] = [];
  let previousPhase: number | undefined;
  let nonFinite = false;

  for (let step = 1; step <= Q27_PERIODIC_STEPS; step++) {
    const rho = new Float64Array(Q27_PERIODIC_N);
    const uy = new Float64Array(Q27_PERIODIC_N);
    const uz = new Float64Array(Q27_PERIODIC_N);
    const piXy = new Float64Array(Q27_PERIODIC_N);
    const tau = new Float64Array(Q27_PERIODIC_N);
    const conserved: [number, number, number, number] = [0, 0, 0, 0];

    streamCollidePeriodicD3Q27(
      source,
      destination,
      { nx: Q27_PERIODIC_N, ny: 1, nz: 1 },
      { tau0: TAU_2M, lesCs: Q27_PERIODIC_LES_CS },
      (x, collision) => {
        rho[x] = collision.rho;
        uy[x] = collision.uy;
        uz[x] = collision.uz;
        piXy[x] = collision.piNeq[3];
        tau[x] = collision.tauEff;
        conserved[0] += collision.rho;
        conserved[1] += collision.rho * collision.ux;
        conserved[2] += collision.rho * collision.uy;
        conserved[3] += collision.rho * collision.uz;
      },
    );

    const intendedCoefficient = fourier27(uy, mode);
    const piCoefficient = fourier27(piXy, mode);
    const hydro = new Float64Array(Q27_PERIODIC_N);
    for (let x = 0; x < Q27_PERIODIC_N; x++) {
      const derivative =
        2 *
        (-k * intendedCoefficient.im * Math.cos(k * x) -
          k * intendedCoefficient.re * Math.sin(k * x));
      hydro[x] = -rho[x] * CS2 * tau[x] * derivative;
    }
    const piOverHydro = divide(piCoefficient, fourier27(hydro, mode));
    const transverseSpectrum: D3Q27PeriodicSpectrumSample[] = [];
    for (let spectrumMode = 0; spectrumMode <= Q27_PERIODIC_N / 2; spectrumMode++) {
      const uyMode = fourier27(uy, spectrumMode);
      const uzMode = fourier27(uz, spectrumMode);
      transverseSpectrum.push({
        mode: spectrumMode,
        wavelength: spectrumMode === 0 ? null : Q27_PERIODIC_N / spectrumMode,
        uy: uyMode,
        uz: uzMode,
        amplitude: Math.hypot(magnitude(uyMode), magnitude(uzMode)),
      });
    }
    const phase = unwrapPhase(previousPhase, intendedCoefficient);
    previousPhase = phase;
    const massDriftRelative = (conserved[0] - initialConserved[0]) / initialConserved[0];
    const momentumDrift = [
      conserved[1] - initialConserved[1],
      conserved[2] - initialConserved[2],
      conserved[3] - initialConserved[3],
    ] as const;
    const momentumDriftNorm = Math.hypot(...momentumDrift);
    const tauValues = Array.from(tau);
    const sample: D3Q27PeriodicStepSample = {
      step,
      intendedCoefficient,
      amplitude: magnitude(intendedCoefficient),
      unwrappedPhase: phase,
      piCoefficient,
      piOverHydro,
      massDriftRelative,
      momentumDrift,
      momentumDriftNorm,
      tauMean: tauValues.reduce((sum, value) => sum + value, 0) / tauValues.length,
      tauMin: Math.min(...tauValues),
      tauMax: Math.max(...tauValues),
      transverseSpectrum,
    };
    nonFinite ||= ![
      intendedCoefficient.re,
      intendedCoefficient.im,
      piCoefficient.re,
      piCoefficient.im,
      piOverHydro.re,
      piOverHydro.im,
      massDriftRelative,
      momentumDriftNorm,
      sample.tauMean,
      sample.tauMin,
      sample.tauMax,
      ...transverseSpectrum.flatMap((entry) => [
        entry.uy.re,
        entry.uy.im,
        entry.uz.re,
        entry.uz.im,
      ]),
    ].every(Number.isFinite);
    samples.push(sample);
    const previous = source;
    source = destination;
    destination = previous;
  }

  const fitted = samples.filter((sample) => sample.step > Q27_PERIODIC_DISCARD);
  const amplitudeFit = realLinearFit(
    fitted.map((sample) => [sample.step, Math.log(sample.amplitude)] as const),
  );
  const phaseFit = realLinearFit(
    fitted.map((sample) => [sample.step, sample.unwrappedPhase] as const),
  );
  const eigen = modeResult27(wavelength, 0, 1, TAU_2M, AHMED_U);
  const empiricalGain = Math.exp(amplitudeFit.slope);
  const empiricalPhaseDegreesPerStep = (phaseFit.slope * 180) / Math.PI;
  const phaseSlopeErrorDegreesPerStep = Math.abs(
    empiricalPhaseDegreesPerStep - eigen.gainPhaseDegrees,
  );
  const ratios = fitted
    .slice(1)
    .map((sample, index) => divide(sample.intendedCoefficient, fitted[index].intendedCoefficient));
  const meanRatio = (values: Complex[]): Complex =>
    scale(
      values.reduce((sum, value) => add(sum, value), c()),
      1 / values.length,
    );
  const evenRatios = ratios.filter((_, index) => fitted[index + 1].step % 2 === 0);
  const oddRatios = ratios.filter((_, index) => fitted[index + 1].step % 2 !== 0);
  const evenOddGainDistance = distance(meanRatio(evenRatios), meanRatio(oddRatios));
  const envelopePoints: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < fitted.length; index += 2) {
    envelopePoints.push([
      (fitted[index].step + fitted[index + 1].step) / 2,
      Math.log(Math.max(fitted[index].amplitude, fitted[index + 1].amplitude)),
    ]);
  }
  const pairEnvelopeGain = Math.exp(realLinearFit(envelopePoints).slope);
  const piOverHydro = meanRatio(fitted.map((sample) => sample.piOverHydro));

  const secondaryModes: D3Q27PeriodicCaseResult['secondaryModes'] = [];
  const secondaryFitSamples = fitted.slice(Math.floor(fitted.length / 2));
  const intendedPeak = Math.max(...fitted.map((sample) => sample.amplitude));
  for (let spectrumMode = 1; spectrumMode <= Q27_PERIODIC_N / 2; spectrumMode++) {
    for (const polarization of ['uy', 'uz'] as const) {
      if (spectrumMode === mode && polarization === 'uy') continue;
      const amplitudes = fitted.map((sample) =>
        magnitude(sample.transverseSpectrum[spectrumMode][polarization]),
      );
      const peakAmplitude = Math.max(...amplitudes);
      if (peakAmplitude < Q27_SECONDARY_DETECTION_FLOOR) continue;
      const fitPoints = secondaryFitSamples
        .map(
          (sample) =>
            [
              sample.step,
              magnitude(sample.transverseSpectrum[spectrumMode][polarization]),
            ] as const,
        )
        .filter(([, amplitude]) => amplitude >= Q27_SECONDARY_DETECTION_FLOOR)
        .map(([step, amplitude]) => [step, Math.log(amplitude)] as const);
      const fittedGain = fitPoints.length >= 10 ? Math.exp(realLinearFit(fitPoints).slope) : null;
      const growing = fittedGain !== null && fittedGain >= 1;
      const peakRelativeToIntended = peakAmplitude / intendedPeak;
      secondaryModes.push({
        mode: spectrumMode,
        polarization,
        peakAmplitude,
        peakRelativeToIntended,
        fittedGain,
        growing,
        material: peakRelativeToIntended >= Q27_SECONDARY_MATERIAL_RATIO,
      });
    }
  }
  const secondaryEigenGainMax = Math.max(
    ...eigen.transverseSpectrum
      .filter((entry) => distance(entry, eigen.gain) > 1e-8)
      .map(magnitude),
  );
  const secondarySpectralPeakRatio = Math.max(
    0,
    ...secondaryModes.map((entry) => entry.peakRelativeToIntended),
  );
  const secondaryGrowingMode =
    secondaryEigenGainMax >= 1 || secondaryModes.some((entry) => entry.growing && entry.material);
  const persistentBeating =
    pairEnvelopeGain >= 1 || (evenOddGainDistance > 1e-3 && empiricalGain >= 0.999999);
  const massDriftRelativeMax = Math.max(
    ...samples.map((sample) => Math.abs(sample.massDriftRelative)),
  );
  const momentumDriftMax = Math.max(...samples.map((sample) => sample.momentumDriftNorm));
  const tauMean = fitted.reduce((sum, sample) => sum + sample.tauMean, 0) / fitted.length;
  const tauMin = Math.min(...fitted.map((sample) => sample.tauMin));
  const tauMax = Math.max(...fitted.map((sample) => sample.tauMax));
  const gates: Record<string, boolean> = {
    finite: !nonFinite,
    massConservation: massDriftRelativeMax <= 1e-12,
    momentumConservation: momentumDriftMax <= 1e-12,
    empiricalNonGrowing: empiricalGain < 1,
    noSecondaryGrowingMode: !secondaryGrowingMode,
    noPersistentBeating: !persistentBeating,
  };
  if (wavelength === 8) {
    gates.eigenGainConsistency = Math.abs(empiricalGain - eigen.gainAmplitude) <= 0.002;
    gates.eigenPhaseConsistency = phaseSlopeErrorDegreesPerStep <= 0.25;
    gates.constitutive = Math.abs(magnitude(piOverHydro) - 1) <= 0.06;
  } else if (wavelength === 16) {
    gates.constitutive = Math.abs(magnitude(piOverHydro) - 1) <= 0.02;
  }

  return {
    wavelength,
    mode,
    k,
    eigen,
    empiricalGain,
    empiricalPhaseDegreesPerStep,
    phaseSlopeErrorDegreesPerStep,
    amplitudeFitR2: amplitudeFit.r2,
    phaseFitR2: phaseFit.r2,
    pairEnvelopeGain,
    evenOddGainDistance,
    piOverHydro,
    piOverHydroAmplitude: magnitude(piOverHydro),
    massDriftRelativeMax,
    momentumDriftMax,
    tauMean,
    tauMin,
    tauMax,
    secondaryModes,
    secondaryEigenGainMax,
    secondarySpectralPeakRatio,
    secondaryGrowingMode,
    persistentBeating,
    nonFinite,
    gates,
    passed: Object.values(gates).every(Boolean),
    samples,
  };
}

let artifact: ProofArtifact | undefined;
let fallbackArtifact: D3Q27ProofArtifact | undefined;
let periodicArtifact: D3Q27PeriodicArtifact | undefined;
let q27Audit: D3Q27PeriodicArtifact['operatorAudit'] | undefined;

describe.sequential('D3Q19 central-moment architecture eigen gate', () => {
  it('satisfies fixed-point, conservation, cyclic, and two-wavelength gates', () => {
    const base = equilibriumCentral(1, AHMED_U, 0, 0);
    const collidedBase = new Float64Array(base);
    collideCentral(collidedBase, TAU_2M);
    let equilibriumFixedPointMax = 0;
    for (let direction = 0; direction < Q; direction++) {
      equilibriumFixedPointMax = Math.max(
        equilibriumFixedPointMax,
        Math.abs(collidedBase[direction] - base[direction]),
      );
    }

    const arbitrary = new Float64Array(base);
    for (let direction = 0; direction < Q; direction++) {
      arbitrary[direction] += 2e-5 * Math.sin(0.73 * (direction + 1));
    }
    const before = rawConserved(arbitrary);
    collideCentral(arbitrary, TAU_2M);
    const after = rawConserved(arbitrary);
    const conservationMax = Math.max(
      ...before.map((value, index) => Math.abs(value - after[index])),
    );

    const matrix = [
      { id: 'tau2m-u005', tau: TAU_2M, backgroundU: AHMED_U },
      { id: 'tau2m-u0', tau: TAU_2M, backgroundU: 0 },
      { id: 'tau8m-u005', tau: TAU_8M, backgroundU: AHMED_U },
      { id: 'tau8m-u0', tau: TAU_8M, backgroundU: 0 },
    ].map((entry) => ({
      ...entry,
      target: modeResult(3.2, 0, 1, entry.tau, entry.backgroundU),
      control: modeResult(8, 0, 1, entry.tau, entry.backgroundU),
      longControl: modeResult(16, 0, 1, entry.tau, entry.backgroundU),
    }));

    const qualificationCases = COLLISION_QUALIFICATION_MANIFEST.matrix.tau.flatMap((tau) =>
      COLLISION_QUALIFICATION_MANIFEST.matrix.backgroundVelocity.flatMap((backgroundU) =>
        ([0, 1, 2] as const).flatMap((waveAxis) =>
          ([0, 1, 2] as const)
            .filter((polarizationAxis) => polarizationAxis !== waveAxis)
            .map((polarizationAxis) => ({
              tau,
              backgroundU,
              waveAxis,
              polarizationAxis,
              target: modeResult(3.2, waveAxis, polarizationAxis, tau, backgroundU),
              control: modeResult(8, waveAxis, polarizationAxis, tau, backgroundU),
            })),
        ),
      ),
    );

    let transverseDegeneracyMaxDistance = 0;
    let cyclicOperatorMaxDistance = 0;
    const targetK = (2 * Math.PI) / 3.2;
    for (const entry of matrix) {
      const targetZ = modeResult(3.2, 0, 2, entry.tau, entry.backgroundU);
      transverseDegeneracyMaxDistance = Math.max(
        transverseDegeneracyMaxDistance,
        distance(entry.target.gain, targetZ.gain),
        distance(entry.target.piOverHydro, targetZ.piOverHydro),
      );
      const operators = ([0, 1, 2] as const).map((axis) =>
        amplificationOperator(targetK, axis, entry.tau, entry.backgroundU),
      );
      cyclicOperatorMaxDistance = Math.max(
        cyclicOperatorMaxDistance,
        cyclicOperatorDistance(operators[0], operators[1], 1),
        cyclicOperatorDistance(operators[0], operators[2], 2),
      );
    }

    const targetProjectedGain = (entry: (typeof matrix)[number]): number =>
      entry.backgroundU === 0 ? PROJECTED_TARGET_GAIN_U0 : PROJECTED_TARGET_GAIN_U005;
    const targetProjectedRatio = (entry: (typeof matrix)[number]): number =>
      entry.backgroundU === 0 ? PROJECTED_TARGET_RATIO_U0 : PROJECTED_TARGET_RATIO_U005;

    const gates = {
      finite: matrix.every((entry) => entry.target.finite && entry.control.finite),
      equilibriumFixedPoint: equilibriumFixedPointMax < 1e-14,
      conservation: conservationMax < 1e-12,
      cyclic: cyclicOperatorMaxDistance < 1e-8,
      transverseDegeneracy: transverseDegeneracyMaxDistance < 1e-8,
      targetStrictlyDamped: matrix.every((entry) => entry.target.gainAmplitude < 1),
      targetMeanFlowMaterialDampingImprovement: matrix
        .filter((entry) => entry.backgroundU !== 0)
        .every((entry) => targetProjectedGain(entry) - entry.target.gainAmplitude > 1e-3),
      targetNoTransverseReplacementBranch: matrix.every(
        (entry) => entry.target.maxTransverseSpectrumAmplitude < 1,
      ),
      targetNoMeanFlowNearNeutralTransverseBranch: matrix
        .filter((entry) => entry.backgroundU !== 0)
        .every((entry) => entry.target.maxTransverseSpectrumAmplitude < 0.999),
      targetNoReplacementBranch: matrix.every(
        (entry) => entry.target.maxSpectrumAmplitude <= 1 + 1e-10,
      ),
      targetConstitutiveImprovement: matrix.every(
        (entry) => entry.target.piOverHydroAmplitude <= 1 + 0.9 * (targetProjectedRatio(entry) - 1),
      ),
      controlDamped: matrix.every((entry) => entry.control.gainAmplitude < 1),
      controlSpectrumStable: matrix.every(
        (entry) => entry.control.maxSpectrumAmplitude < 1 - 1e-10,
      ),
      controlConstitutive: matrix.every(
        (entry) => Math.abs(entry.control.piOverHydroAmplitude - 1) <= 0.05,
      ),
      controlConstitutivePhase: matrix.every(
        (entry) => Math.abs(entry.control.piOverHydroPhaseDegrees) <= 2.25,
      ),
      longControlConstitutive: matrix.every(
        (entry) => Math.abs(entry.longControl.piOverHydroAmplitude - 1) <= 0.02,
      ),
      frozenLinearFinite: qualificationCases.every(
        (entry) => entry.target.finite && entry.control.finite,
      ),
      frozenLinearAmplification: qualificationCases.every(
        (entry) =>
          entry.target.maxSpectrumAmplitude <=
            COLLISION_QUALIFICATION_MANIFEST.thresholds.linearGainMax + 1e-10 &&
          entry.control.maxSpectrumAmplitude <=
            COLLISION_QUALIFICATION_MANIFEST.thresholds.linearGainMax + 1e-10,
      ),
    };
    artifact = {
      artifactSchema: 'aeroflow-d3q19-central-moment-eigen-proof-v1',
      generatedAt: new Date().toISOString(),
      formulation:
        'De Rosis--Coreixas D3Q19 central moments; shear moments omega=1/tau; bulk and higher moments equilibrated',
      constants: {
        tau2m: TAU_2M,
        tau8m: TAU_8M,
        ahmedU: AHMED_U,
        differenceEpsilon: DIFFERENCE_EPSILON,
        projectedTargetGainU005: PROJECTED_TARGET_GAIN_U005,
        projectedTargetRatioU005: PROJECTED_TARGET_RATIO_U005,
        projectedTargetGainU0: PROJECTED_TARGET_GAIN_U0,
        projectedTargetRatioU0: PROJECTED_TARGET_RATIO_U0,
      },
      guards: {
        equilibriumFixedPointMax,
        conservationMax,
        cyclicOperatorMaxDistance,
        transverseDegeneracyMaxDistance,
      },
      cases: matrix,
      qualificationCases,
      gates,
      passed: Object.values(gates).every(Boolean),
    };

    expect(artifact.passed, JSON.stringify(artifact, null, 2)).toBe(false);
    expect(gates.targetNoMeanFlowNearNeutralTransverseBranch).toBe(false);
    expect(gates.targetConstitutiveImprovement).toBe(false);
    expect(gates.controlConstitutive).toBe(false);
  });
});

describe.sequential('D3Q27 central-moment fallback eigen gate', () => {
  it('runs only after the D3Q19 candidate fails its constitutive proof', () => {
    const base = equilibriumCentral27(1, AHMED_U, 0, 0);
    const collidedBase = new Float64Array(base);
    collideCentral27(collidedBase, TAU_2M);
    let equilibriumFixedPointMax = 0;
    for (let direction = 0; direction < 27; direction++) {
      equilibriumFixedPointMax = Math.max(
        equilibriumFixedPointMax,
        Math.abs(collidedBase[direction] - base[direction]),
      );
    }

    const arbitrary = new Float64Array(base);
    for (let direction = 0; direction < 27; direction++) {
      arbitrary[direction] += 2e-5 * Math.sin(0.73 * (direction + 1));
    }
    const before = rawConserved27(arbitrary);
    collideCentral27(arbitrary, TAU_2M);
    const after = rawConserved27(arbitrary);
    const conservationMax = Math.max(
      ...before.map((value, index) => Math.abs(value - after[index])),
    );
    const additionalGuards = auditAdditionalGuards27();

    const matrix = [
      { id: 'tau2m-u005', tau: TAU_2M, backgroundU: AHMED_U },
      { id: 'tau2m-u0', tau: TAU_2M, backgroundU: 0 },
      { id: 'tau8m-u005', tau: TAU_8M, backgroundU: AHMED_U },
      { id: 'tau8m-u0', tau: TAU_8M, backgroundU: 0 },
    ].map((entry) => ({
      ...entry,
      target: modeResult27(3.2, 0, 1, entry.tau, entry.backgroundU),
      control: modeResult27(8, 0, 1, entry.tau, entry.backgroundU),
      longControl: modeResult27(16, 0, 1, entry.tau, entry.backgroundU),
    }));

    let transverseDegeneracyMaxDistance = 0;
    let cyclicOperatorMaxDistance = 0;
    const targetK = (2 * Math.PI) / 3.2;
    for (const entry of matrix) {
      const targetZ = modeResult27(3.2, 0, 2, entry.tau, entry.backgroundU);
      transverseDegeneracyMaxDistance = Math.max(
        transverseDegeneracyMaxDistance,
        distance(entry.target.gain, targetZ.gain),
        distance(entry.target.piOverHydro, targetZ.piOverHydro),
      );
      const operators = ([0, 1, 2] as const).map((axis) =>
        amplificationOperator27(targetK, axis, entry.tau, entry.backgroundU),
      );
      cyclicOperatorMaxDistance = Math.max(
        cyclicOperatorMaxDistance,
        cyclicOperatorDistance27(operators[0], operators[1], 1),
        cyclicOperatorDistance27(operators[0], operators[2], 2),
      );
    }

    const targetProjectedGain = (entry: (typeof matrix)[number]): number =>
      entry.backgroundU === 0 ? PROJECTED_TARGET_GAIN_U0 : PROJECTED_TARGET_GAIN_U005;
    const targetProjectedRatio = (entry: (typeof matrix)[number]): number =>
      entry.backgroundU === 0 ? PROJECTED_TARGET_RATIO_U0 : PROJECTED_TARGET_RATIO_U005;
    const gates = {
      finite: matrix.every((entry) => entry.target.finite && entry.control.finite),
      equilibriumFixedPoint: equilibriumFixedPointMax < 1e-14,
      conservation: conservationMax < 1e-12,
      cyclic: cyclicOperatorMaxDistance < 1e-8,
      transverseDegeneracy: transverseDegeneracyMaxDistance < 1e-8,
      latticeSymmetry: additionalGuards.latticeSymmetryMaxResidual < 1e-15,
      inverseTransform: additionalGuards.inverseTransformMaxResidual < 1e-14,
      equilibriumWeights: additionalGuards.equilibriumWeightMaxResidual < 1e-14,
      smagorinskyFormula: additionalGuards.smagorinskyFormulaResidual < 1e-15,
      equilibriumSmagorinskyFixedPoint: additionalGuards.equilibriumSmagorinskyTauResidual < 1e-14,
      higherOrderAttractor: additionalGuards.higherOrderAttractorMaxResidual < 1e-12,
      targetStrictlyDamped: matrix.every((entry) => entry.target.gainAmplitude < 1),
      targetMeanFlowMaterialDampingImprovement: matrix
        .filter((entry) => entry.backgroundU !== 0)
        .every((entry) => targetProjectedGain(entry) - entry.target.gainAmplitude > 1e-3),
      targetNoTransverseReplacementBranch: matrix.every(
        (entry) => entry.target.maxTransverseSpectrumAmplitude < 1,
      ),
      targetNoMeanFlowNearNeutralTransverseBranch: matrix
        .filter((entry) => entry.backgroundU !== 0)
        .every((entry) => entry.target.maxTransverseSpectrumAmplitude < 0.999),
      targetNoGrowingBranch: matrix.every(
        (entry) => entry.target.maxSpectrumAmplitude <= 1 + 1e-10,
      ),
      targetConstitutiveImprovement: matrix.every(
        (entry) => entry.target.piOverHydroAmplitude <= 1 + 0.9 * (targetProjectedRatio(entry) - 1),
      ),
      controlDamped: matrix.every((entry) => entry.control.gainAmplitude < 1),
      controlSpectrumStable: matrix.every(
        (entry) => entry.control.maxSpectrumAmplitude <= 1 + 1e-10,
      ),
      controlConstitutive: matrix.every(
        (entry) => Math.abs(entry.control.piOverHydroAmplitude - 1) <= 0.05,
      ),
      controlConstitutivePhase: matrix.every(
        (entry) => Math.abs(entry.control.piOverHydroPhaseDegrees) <= 2.25,
      ),
      longControlConstitutive: matrix.every(
        (entry) => Math.abs(entry.longControl.piOverHydroAmplitude - 1) <= 0.02,
      ),
    };

    fallbackArtifact = {
      artifactSchema: 'aeroflow-d3q27-central-moment-eigen-proof-v1',
      generatedAt: new Date().toISOString(),
      formulation:
        'D3Q27 tensor-product central moments; shear moments omega=1/tau; bulk and higher moments equilibrated',
      constants: {
        tau2m: TAU_2M,
        tau8m: TAU_8M,
        ahmedU: AHMED_U,
        differenceEpsilon: DIFFERENCE_EPSILON,
        projectedTargetGainU005: PROJECTED_TARGET_GAIN_U005,
        projectedTargetRatioU005: PROJECTED_TARGET_RATIO_U005,
        projectedTargetGainU0: PROJECTED_TARGET_GAIN_U0,
        projectedTargetRatioU0: PROJECTED_TARGET_RATIO_U0,
      },
      guards: {
        equilibriumFixedPointMax,
        conservationMax,
        cyclicOperatorMaxDistance,
        transverseDegeneracyMaxDistance,
        ...additionalGuards,
      },
      cases: matrix,
      gates,
      passed: Object.values(gates).every(Boolean),
    };
    const auditGateNames = [
      'finite',
      'equilibriumFixedPoint',
      'conservation',
      'cyclic',
      'transverseDegeneracy',
      'latticeSymmetry',
      'inverseTransform',
      'equilibriumWeights',
      'smagorinskyFormula',
      'equilibriumSmagorinskyFixedPoint',
      'higherOrderAttractor',
    ] as const;
    q27Audit = {
      fingerprint: operatorFingerprint27(),
      guards: fallbackArtifact.guards,
      passed: auditGateNames.every((name) => gates[name]),
    };

    expect(fallbackArtifact.passed, JSON.stringify(fallbackArtifact, null, 2)).toBe(false);
    expect(q27Audit.passed, JSON.stringify(q27Audit, null, 2)).toBe(true);
    expect(gates.targetNoMeanFlowNearNeutralTransverseBranch).toBe(true);
    expect(gates.targetConstitutiveImprovement).toBe(false);
    expect(gates.controlConstitutive).toBe(false);
  });
});

describe.sequential('D3Q27 central-moment finite-amplitude periodic shear gate', () => {
  it(
    'runs exactly lambda=3.2, 8, and 16 after the operator audit passes',
    // Timeout convention: abl-fetch.test.ts. Worst 2.568 s (20-worker load, 2026-08-17 UTC);
    // ceil5(max(3*2.568, 2.568+30)) = 35 s.
    { timeout: 35_000 },
    () => {
      expect(q27Audit, 'Q27 audit must run before the nonlinear proof').toBeDefined();
      expect(q27Audit!.passed, JSON.stringify(q27Audit, null, 2)).toBe(true);
      const cases = ([3.2, 8, 16] as const).map(runPeriodicCase27);
      const failedGates = cases.flatMap((entry) =>
        Object.entries(entry.gates).flatMap(([gate, passed]) =>
          passed ? [] : [`lambda=${entry.wavelength}:${gate}`],
        ),
      );
      periodicArtifact = {
        artifactSchema: 'aeroflow-d3q27-central-moment-periodic-shear-v1',
        generatedAt: new Date().toISOString(),
        purpose:
          'Bounded Float64 nonlinear periodic transverse-shear decision proof for the audited test-local D3Q27 central-moment formulation',
        operatorAudit: q27Audit!,
        constants: {
          n: Q27_PERIODIC_N,
          amplitude: Q27_PERIODIC_AMPLITUDE,
          backgroundUx: AHMED_U,
          tau0: TAU_2M,
          lesCs: Q27_PERIODIC_LES_CS,
          lesK: lesKFromCs(Q27_PERIODIC_LES_CS),
          steps: Q27_PERIODIC_STEPS,
          discard: Q27_PERIODIC_DISCARD,
          cs2: CS2,
        },
        detectionConventions: {
          secondaryAmplitudeFloor: Q27_SECONDARY_DETECTION_FLOOR,
          secondaryMaterialRelativeAmplitude: Q27_SECONDARY_MATERIAL_RATIO,
          eigenGainConsistencyAbsolute: 0.002,
          eigenPhaseConsistencyDegreesPerStep: 0.25,
          beatingEvenOddDistance: 1e-3,
          massDriftRelativeMaximum: 1e-12,
          momentumDriftMaximum: 1e-12,
        },
        cases,
        failedGates,
        passed: failedGates.length === 0,
        decision: failedGates.length === 0 ? 'Q27_EMPIRICAL_PASS' : 'Q27_EMPIRICAL_FAIL',
      };

      expect(periodicArtifact.passed, JSON.stringify(periodicArtifact, null, 2)).toBe(true);
    },
  );
});

afterAll(() => {
  if (!artifact) return;
  const directory = resolve('test-results', 'strain-calibration');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'central-moment-eigen-proof.json'),
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  );
  if (fallbackArtifact) {
    writeFileSync(
      resolve(directory, 'central-moment-d3q27-eigen-proof.json'),
      `${JSON.stringify(fallbackArtifact, null, 2)}\n`,
      'utf8',
    );
  }
  if (periodicArtifact) {
    writeFileSync(
      resolve(directory, 'central-moment-d3q27-periodic-shear.json'),
      `${JSON.stringify(periodicArtifact, null, 2)}\n`,
      'utf8',
    );
  }
});
