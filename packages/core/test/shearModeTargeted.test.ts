import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  D3Q19,
  D3Q19_SPEC,
  collideCell,
  equilibrium3,
  makeCollideContext,
  piNeq,
  piNeqNorm,
  smagorinskyTauEff,
} from '../src/index.js';

/**
 * Final bounded empirical check selected by shearModeEigen.test.ts. Exactly two wavelengths
 * and two A/B controls are used: LES off and projected regularization off. The harness is
 * one-dimensional and fully periodic; y/z are invariant, so no boundary or geometry exists.
 */

const N = 64;
const Q = D3Q19.q;
const TAU0 = 0.5000020740253772;
const AMPLITUDE = 0.005;
const BACKGROUND_UX = 0.05;
const STEPS = 120;
const DISCARD = 40;
const CS2 = 1 / 3;

interface Complex {
  re: number;
  im: number;
}

interface TargetCase {
  id: string;
  wavelength: 8 | 3.2;
  lesCs: 0 | 0.1;
  regularize: boolean;
  recursive3?: boolean;
}

interface StepSample {
  step: number;
  velocityMode: Complex;
  piMode: Complex;
  tauMean: number;
  tauMin: number;
  tauMax: number;
  analyticPiOverHydro: Complex;
  finiteDifferencePiOverHydro: Complex;
}

interface TargetResult {
  id: string;
  wavelength: number;
  k: number;
  lesCs: number;
  regularize: boolean;
  samples: StepSample[];
  modalGain: Complex;
  modalGainAmplitude: number;
  modalGainPhaseDegrees: number;
  endpointGrowthRate: number;
  analyticPiOverHydro: Complex;
  analyticPiOverHydroAmplitude: number;
  finiteDifferencePiOverHydro: Complex;
  finiteDifferencePiOverHydroAmplitude: number;
  tauMean: number;
  tauMin: number;
  tauMax: number;
  nonFinite: boolean;
}

interface Artifact {
  artifactSchema: 'aeroflow-shear-mode-targeted-v1';
  generatedAt: string;
  purpose: string;
  constants: Record<string, number>;
  cases: TargetResult[];
}

interface CandidateArtifact {
  artifactSchema: 'aeroflow-shear-mode-rr3-candidate-v1';
  generatedAt: string;
  mechanism: string;
  intervention: string;
  falsification: string[];
  implementationGuards: {
    thirdOrderLowerMomentMax: number;
    collisionMassResidual: number;
    collisionMomentumResidualMax: number;
  };
  passed: boolean;
  failedGates: string[];
  baseline: TargetResult[];
  candidate: TargetResult[];
}

const c = (re = 0, im = 0): Complex => ({ re, im });
const magnitude = (value: Complex): number => Math.hypot(value.re, value.im);
const divide = (a: Complex, b: Complex): Complex => {
  const denominator = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / denominator, (a.im * b.re - a.re * b.im) / denominator);
};

function meanComplex(values: readonly Complex[]): Complex {
  let re = 0;
  let im = 0;
  for (const value of values) {
    re += value.re;
    im += value.im;
  }
  return c(re / values.length, im / values.length);
}

function fourier(values: ArrayLike<number>, k: number): Complex {
  let re = 0;
  let im = 0;
  for (let x = 0; x < N; x++) {
    re += values[x] * Math.cos(k * x);
    im -= values[x] * Math.sin(k * x);
  }
  return c(re / N, im / N);
}

/**
 * Malaspinas (2015), Eqs. 30-31 and the D3Q19 expansion in Eqs. 38-39, truncated after
 * the lattice-supported third-order Hermite terms. This is deliberately test-local until
 * the predeclared spectral gates decide whether RR3 is a viable production candidate.
 */
function thirdOrderHermiteContribution(
  direction: number,
  xxx: readonly [number, number, number, number, number, number, number],
): number {
  const ex = D3Q19.ex[direction];
  const ey = D3Q19.ey[direction];
  const ez = D3Q19.ez[direction];
  const hXxy = (ex * ex - CS2) * ey;
  const hXxz = (ex * ex - CS2) * ez;
  const hXyy = ex * (ey * ey - CS2);
  const hXzz = ex * (ez * ez - CS2);
  const hYyz = (ey * ey - CS2) * ez;
  const hYzz = ey * (ez * ez - CS2);
  const hXyz = ex * ey * ez;
  const [aXxy, aXxz, aXyy, aXzz, aYyz, aYzz, aXyz] = xxx;
  // 1/(2 c_s^6) = 13.5. The xyz term has six rather than three permutations, hence 2x.
  return (
    13.5 *
    D3Q19.w[direction] *
    (hXxy * aXxy +
      hXxz * aXxz +
      hXyy * aXyy +
      hXzz * aXzz +
      hYyz * aYyz +
      hYzz * aYzz +
      2 * hXyz * aXyz)
  );
}

function equilibriumRecursive3(
  direction: number,
  rho: number,
  ux: number,
  uy: number,
  uz: number,
): number {
  return (
    equilibrium3(D3Q19_SPEC, direction, rho, ux, uy, uz) +
    thirdOrderHermiteContribution(direction, [
      rho * ux * ux * uy,
      rho * ux * ux * uz,
      rho * ux * uy * uy,
      rho * ux * uz * uz,
      rho * uy * uy * uz,
      rho * uy * uz * uz,
      rho * ux * uy * uz,
    ])
  );
}

function collideCellRecursive3(
  f: Float64Array,
  context: ReturnType<typeof makeCollideContext>,
): void {
  let rho = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let direction = 0; direction < Q; direction++) {
    const value = f[direction];
    rho += value;
    mx += D3Q19.ex[direction] * value;
    my += D3Q19.ey[direction] * value;
    mz += D3Q19.ez[direction] * value;
  }
  const ux = mx / rho;
  const uy = my / rho;
  const uz = mz / rho;
  for (let direction = 0; direction < Q; direction++) {
    context.feq[direction] = equilibriumRecursive3(direction, rho, ux, uy, uz);
  }

  piNeq(f, context.feq, D3Q19_SPEC, context.piNeq);
  const tauEff =
    context.lesK === 0
      ? context.tau0
      : smagorinskyTauEff(context.tau0, context.lesK, piNeqNorm(context.piNeq), rho);
  const [pxx, pyy, pzz, pxy, pxz, pyz] = context.piNeq;
  const a3: readonly [number, number, number, number, number, number, number] = [
    uy * pxx + 2 * ux * pxy,
    uz * pxx + 2 * ux * pxz,
    ux * pyy + 2 * uy * pxy,
    ux * pzz + 2 * uz * pxz,
    uz * pyy + 2 * uy * pyz,
    uy * pzz + 2 * uz * pyz,
    ux * pyz + uy * pxz + uz * pxy,
  ];
  const trace = (pxx + pyy + pzz) / 3;
  for (let direction = 0; direction < Q; direction++) {
    const ex = D3Q19.ex[direction];
    const ey = D3Q19.ey[direction];
    const ez = D3Q19.ez[direction];
    const qContract =
      ex * ex * pxx +
      ey * ey * pyy +
      ez * ez * pzz +
      2 * (ex * ey * pxy + ex * ez * pxz + ey * ez * pyz) -
      trace;
    f[direction] =
      context.feq[direction] +
      4.5 * D3Q19.w[direction] * qContract +
      thirdOrderHermiteContribution(direction, a3);
  }

  const omegaPlus = 1 / tauEff;
  const omegaMinus = 1 / (0.5 + context.lambda / (tauEff - 0.5));
  f[0] += omegaPlus * (context.feq[0] - f[0]);
  for (const [a, b] of D3Q19_SPEC.pairs) {
    const symmetric = 0.5 * (f[a] + f[b]);
    const antisymmetric = 0.5 * (f[a] - f[b]);
    const equilibriumSymmetric = 0.5 * (context.feq[a] + context.feq[b]);
    const equilibriumAntisymmetric = 0.5 * (context.feq[a] - context.feq[b]);
    const deltaSymmetric = omegaPlus * (symmetric - equilibriumSymmetric);
    const deltaAntisymmetric = omegaMinus * (antisymmetric - equilibriumAntisymmetric);
    f[a] -= deltaSymmetric + deltaAntisymmetric;
    f[b] -= deltaSymmetric - deltaAntisymmetric;
  }
  if (context.conserveMass) {
    let rhoOut = 0;
    for (const value of f) rhoOut += value;
    f[0] += rho - rhoOut;
  }
  context.macro[0] = rho;
  context.macro[1] = ux;
  context.macro[2] = uy;
  context.macro[3] = uz;
  context.macro[4] = tauEff;
}

function runCase(spec: TargetCase): TargetResult {
  const mode = N / spec.wavelength;
  if (!Number.isInteger(mode)) throw new Error(`${spec.id}: wavelength must divide ${N}`);
  const k = (2 * Math.PI * mode) / N;
  let source = new Float64Array(Q * N);
  let destination = new Float64Array(Q * N);
  for (let x = 0; x < N; x++) {
    const uy = AMPLITUDE * Math.cos(k * x);
    for (let direction = 0; direction < Q; direction++) {
      source[direction * N + x] = spec.recursive3
        ? equilibriumRecursive3(direction, 1, BACKGROUND_UX, uy, 0)
        : equilibrium3(D3Q19_SPEC, direction, 1, BACKGROUND_UX, uy, 0);
    }
  }

  const context = makeCollideContext(D3Q19_SPEC, {
    tau: TAU0,
    collision: 'trt',
    lambda: 3 / 16,
    lesCs: spec.lesCs,
    regularize: spec.regularize,
    conserveMass: true,
  });
  const gathered = new Float64Array(Q);
  const equilibrium = new Float64Array(Q);
  const tensor = new Float64Array(6);
  const samples: StepSample[] = [];
  let nonFinite = false;

  for (let step = 1; step <= STEPS; step++) {
    const rho = new Float64Array(N);
    const uy = new Float64Array(N);
    const pi = new Float64Array(N);
    const tau = new Float64Array(N);
    for (let x = 0; x < N; x++) {
      for (let direction = 0; direction < Q; direction++) {
        const sourceX = (x - D3Q19.ex[direction] + N) % N;
        gathered[direction] = source[direction * N + sourceX];
      }
      let cellRho = 0;
      let ux = 0;
      let cellUy = 0;
      for (let direction = 0; direction < Q; direction++) {
        const value = gathered[direction];
        cellRho += value;
        ux += D3Q19.ex[direction] * value;
        cellUy += D3Q19.ey[direction] * value;
      }
      ux /= cellRho;
      cellUy /= cellRho;
      rho[x] = cellRho;
      uy[x] = cellUy;
      for (let direction = 0; direction < Q; direction++) {
        equilibrium[direction] = spec.recursive3
          ? equilibriumRecursive3(direction, cellRho, ux, cellUy, 0)
          : equilibrium3(D3Q19_SPEC, direction, cellRho, ux, cellUy, 0);
      }
      piNeq(gathered, equilibrium, D3Q19_SPEC, tensor);
      pi[x] = tensor[3];
      if (spec.recursive3) collideCellRecursive3(gathered, context);
      else collideCell(gathered, context);
      tau[x] = context.macro[4];
      for (let direction = 0; direction < Q; direction++) {
        destination[direction * N + x] = gathered[direction];
      }
    }

    const velocityMode = fourier(uy, k);
    const piMode = fourier(pi, k);
    const hydroAnalytic = new Float64Array(N);
    const hydroFiniteDifference = new Float64Array(N);
    for (let x = 0; x < N; x++) {
      const minus = (x - 1 + N) % N;
      const plus = (x + 1) % N;
      const fd = (uy[plus] - uy[minus]) / 2;
      const analyticDerivative =
        2 * (-k * velocityMode.im * Math.cos(k * x) - k * velocityMode.re * Math.sin(k * x));
      const factor = -rho[x] * CS2 * tau[x];
      hydroAnalytic[x] = factor * analyticDerivative;
      hydroFiniteDifference[x] = factor * fd;
    }
    const analyticPiOverHydro = divide(piMode, fourier(hydroAnalytic, k));
    const finiteDifferencePiOverHydro = divide(piMode, fourier(hydroFiniteDifference, k));
    let tauSum = 0;
    let tauMin = Infinity;
    let tauMax = -Infinity;
    for (const value of tau) {
      tauSum += value;
      tauMin = Math.min(tauMin, value);
      tauMax = Math.max(tauMax, value);
    }
    nonFinite ||= ![
      velocityMode.re,
      velocityMode.im,
      piMode.re,
      piMode.im,
      analyticPiOverHydro.re,
      analyticPiOverHydro.im,
    ].every(Number.isFinite);
    if (step > DISCARD) {
      samples.push({
        step,
        velocityMode,
        piMode,
        tauMean: tauSum / N,
        tauMin,
        tauMax,
        analyticPiOverHydro,
        finiteDifferencePiOverHydro,
      });
    }
    const previous = source;
    source = destination;
    destination = previous;
  }

  const gains: Complex[] = [];
  for (let index = 1; index < samples.length; index++) {
    gains.push(divide(samples[index].velocityMode, samples[index - 1].velocityMode));
  }
  const modalGain = meanComplex(gains);
  const analyticPiOverHydro = meanComplex(samples.map((sample) => sample.analyticPiOverHydro));
  const finiteDifferencePiOverHydro = meanComplex(
    samples.map((sample) => sample.finiteDifferencePiOverHydro),
  );
  const first = samples[0];
  const last = samples.at(-1)!;
  return {
    id: spec.id,
    wavelength: spec.wavelength,
    k,
    lesCs: spec.lesCs,
    regularize: spec.regularize,
    samples,
    modalGain,
    modalGainAmplitude: magnitude(modalGain),
    modalGainPhaseDegrees: (Math.atan2(modalGain.im, modalGain.re) * 180) / Math.PI,
    endpointGrowthRate:
      Math.log(magnitude(last.velocityMode) / magnitude(first.velocityMode)) /
      (last.step - first.step),
    analyticPiOverHydro,
    analyticPiOverHydroAmplitude: magnitude(analyticPiOverHydro),
    finiteDifferencePiOverHydro,
    finiteDifferencePiOverHydroAmplitude: magnitude(finiteDifferencePiOverHydro),
    tauMean: samples.reduce((sum, sample) => sum + sample.tauMean, 0) / samples.length,
    tauMin: Math.min(...samples.map((sample) => sample.tauMin)),
    tauMax: Math.max(...samples.map((sample) => sample.tauMax)),
    nonFinite,
  };
}

const MATRIX: readonly TargetCase[] = ([8, 3.2] as const).flatMap((wavelength) => [
  { id: `les-reg-lambda${wavelength}`, wavelength, lesCs: 0.1, regularize: true },
  { id: `fixed-tau0-reg-lambda${wavelength}`, wavelength, lesCs: 0, regularize: true },
  { id: `les-plain-trt-lambda${wavelength}`, wavelength, lesCs: 0.1, regularize: false },
]);

let artifact: Artifact | undefined;
let candidateArtifact: CandidateArtifact | undefined;

describe.sequential('targeted periodic shear-mode discrimination', () => {
  it('runs only the two eigen-selected wavelengths and two controls', () => {
    const results = MATRIX.map(runCase);
    expect(results).toHaveLength(6);
    expect(results.every((result) => !result.nonFinite)).toBe(true);

    const fixedHighK = results.find((result) => result.id === 'fixed-tau0-reg-lambda3.2')!;
    // Direct eigen result: |g|=1.003136061, phase=-4.902296 degrees, analytic Pi/S=1.528275.
    expect(fixedHighK.modalGainAmplitude).toBeCloseTo(1.003136061, 6);
    expect(fixedHighK.modalGainPhaseDegrees).toBeCloseTo(-4.902296, 4);
    expect(fixedHighK.analyticPiOverHydroAmplitude).toBeCloseTo(1.528275, 5);

    artifact = {
      artifactSchema: 'aeroflow-shear-mode-targeted-v1',
      generatedAt: new Date().toISOString(),
      purpose:
        'Final empirical discrimination of the eigen-identified 3.2-cell transverse mode; two wavelengths and two A/B controls only',
      constants: {
        n: N,
        amplitude: AMPLITUDE,
        backgroundUx: BACKGROUND_UX,
        tau0: TAU0,
        steps: STEPS,
        discard: DISCARD,
      },
      cases: results,
    };
  });

  it('tests the single RR3 candidate at only the long and Ahmed-band wavelengths', () => {
    const arbitraryA3 = [0.013, -0.007, 0.011, -0.005, 0.003, -0.009, 0.004] as const;
    let mass3 = 0;
    let mx3 = 0;
    let my3 = 0;
    let mz3 = 0;
    let second3Max = 0;
    const second3 = new Float64Array(6);
    for (let direction = 0; direction < Q; direction++) {
      const value = thirdOrderHermiteContribution(direction, arbitraryA3);
      const ex = D3Q19.ex[direction];
      const ey = D3Q19.ey[direction];
      const ez = D3Q19.ez[direction];
      mass3 += value;
      mx3 += ex * value;
      my3 += ey * value;
      mz3 += ez * value;
      second3[0] += ex * ex * value;
      second3[1] += ey * ey * value;
      second3[2] += ez * ez * value;
      second3[3] += ex * ey * value;
      second3[4] += ex * ez * value;
      second3[5] += ey * ez * value;
    }
    for (const value of second3) second3Max = Math.max(second3Max, Math.abs(value));
    const thirdOrderLowerMomentMax = Math.max(
      Math.abs(mass3),
      Math.abs(mx3),
      Math.abs(my3),
      Math.abs(mz3),
      second3Max,
    );

    const guardContext = makeCollideContext(D3Q19_SPEC, {
      tau: TAU0,
      collision: 'trt',
      lambda: 3 / 16,
      lesCs: 0.1,
      conserveMass: true,
    });
    const guardCell = new Float64Array(Q);
    for (let direction = 0; direction < Q; direction++) {
      guardCell[direction] =
        equilibriumRecursive3(direction, 1.02, 0.05, -0.003, 0.002) +
        1e-4 * Math.sin(0.7 * (direction + 1));
    }
    const before = [0, 0, 0, 0];
    for (let direction = 0; direction < Q; direction++) {
      before[0] += guardCell[direction];
      before[1] += D3Q19.ex[direction] * guardCell[direction];
      before[2] += D3Q19.ey[direction] * guardCell[direction];
      before[3] += D3Q19.ez[direction] * guardCell[direction];
    }
    collideCellRecursive3(guardCell, guardContext);
    const after = [0, 0, 0, 0];
    for (let direction = 0; direction < Q; direction++) {
      after[0] += guardCell[direction];
      after[1] += D3Q19.ex[direction] * guardCell[direction];
      after[2] += D3Q19.ey[direction] * guardCell[direction];
      after[3] += D3Q19.ez[direction] * guardCell[direction];
    }
    const collisionMassResidual = Math.abs(after[0] - before[0]);
    const collisionMomentumResidualMax = Math.max(
      Math.abs(after[1] - before[1]),
      Math.abs(after[2] - before[2]),
      Math.abs(after[3] - before[3]),
    );

    const baseline = MATRIX.filter((entry) => entry.regularize && entry.lesCs === 0.1).map(runCase);
    const candidate = ([8, 3.2] as const).map((wavelength) =>
      runCase({
        id: `les-rr3-lambda${wavelength}`,
        wavelength,
        lesCs: 0.1,
        regularize: true,
        recursive3: true,
      }),
    );
    const longBaseline = baseline.find((entry) => entry.wavelength === 8)!;
    const longCandidate = candidate.find((entry) => entry.wavelength === 8)!;
    const targetCandidate = candidate.find((entry) => entry.wavelength === 3.2)!;
    const gates = {
      finite: candidate.every((entry) => !entry.nonFinite),
      targetDamped: targetCandidate.modalGainAmplitude < 1,
      targetConstitutive: targetCandidate.analyticPiOverHydroAmplitude < 1.2,
      longGainPreserved:
        Math.abs(longCandidate.modalGainAmplitude / longBaseline.modalGainAmplitude - 1) < 0.02,
      longConstitutivePreserved:
        Math.abs(
          longCandidate.analyticPiOverHydroAmplitude / longBaseline.analyticPiOverHydroAmplitude -
            1,
        ) < 0.02,
    };
    const failedGates = Object.entries(gates)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    candidateArtifact = {
      artifactSchema: 'aeroflow-shear-mode-rr3-candidate-v1',
      generatedAt: new Date().toISOString(),
      mechanism:
        'mean-flow-dependent high-k anti-dissipation after projected regularization removes third-order shear transport',
      intervention:
        'add only D3Q19-supported third-order equilibrium and recursively reconstructed nonequilibrium Hermite moments',
      falsification: [
        'lambda=3.2 modal gain must be below one',
        'lambda=3.2 analytic Pi/Pi_hydro amplitude must be below 1.20',
        'lambda=8 gain and analytic constitutive amplitude must remain within 2% of projected baseline',
        'all candidate samples must remain finite',
      ],
      implementationGuards: {
        thirdOrderLowerMomentMax,
        collisionMassResidual,
        collisionMomentumResidualMax,
      },
      passed: failedGates.length === 0,
      failedGates,
      baseline,
      candidate,
    };

    expect(thirdOrderLowerMomentMax).toBeLessThan(2e-16);
    expect(collisionMassResidual).toBeLessThan(2e-15);
    expect(collisionMomentumResidualMax).toBeLessThan(2e-15);
    // The candidate is preserved as a negative result: it violated the predeclared target-band
    // damping and constitutive gates, so it must not be ported to production WGSL.
    expect(candidateArtifact.passed).toBe(false);
    expect(candidateArtifact.failedGates).toEqual(['targetDamped', 'targetConstitutive']);
  });
});

afterAll(() => {
  if (!artifact) return;
  const directory = resolve('test-results', 'strain-calibration');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'shear-mode-targeted.json'),
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  );
  if (candidateArtifact) {
    writeFileSync(
      resolve(directory, 'shear-mode-rr3-candidate.json'),
      `${JSON.stringify(candidateArtifact, null, 2)}\n`,
      'utf8',
    );
  }
});
