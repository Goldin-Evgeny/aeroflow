import { Solver3D } from '../cpu/solver3d.js';
import type { LesNorm } from '../cpu/collide.js';
import {
  freestreamEddyViscosity,
  type FreestreamEddyViscosity,
} from './freestreamEddyViscosity.js';

export interface PeriodicUniformFlowOracleOptions {
  lesNorm: LesNorm;
  tau0?: number;
  cs?: number;
  velocity?: number;
  steps?: number;
  size?: number;
}

export interface PeriodicUniformFlowOracleResult {
  kind: 'fully-periodic-uniform-flow';
  precision: 'float64-cpu';
  closureConvention: LesNorm;
  tau0: number;
  cs: number;
  velocity: number;
  exposureSteps: number;
  grid: { nx: number; ny: number; nz: number; cells: number };
  analyticStrain: 0;
  selectedCells: number;
  maximumVelocityDeviation: number;
  subgridActivity: FreestreamEddyViscosity;
  spatialDistribution: {
    activeCells: number;
    maximumCell: { x: number; y: number; z: number; ratio: number } | null;
  };
}

/** Bounded dynamic analytic-zero oracle: no walls, inlet, outlet, forcing, or solid cells. */
export function periodicUniformFlowOracle(
  options: PeriodicUniformFlowOracleOptions,
): PeriodicUniformFlowOracleResult {
  const tau0 = options.tau0 ?? 0.5000005;
  const cs = options.cs ?? 0.1;
  const velocity = options.velocity ?? 0.05;
  const steps = options.steps ?? 128;
  const size = options.size ?? 8;
  const cells = size ** 3;
  const solver = new Solver3D({
    nx: size,
    ny: size,
    nz: size,
    omega: 1 / tau0,
    periodicX: true,
    periodicY: true,
    periodicZ: true,
    collision: 'trt',
    regularize: true,
    les: { cs, norm: options.lesNorm },
  });
  const tauEff = new Float64Array(cells);
  solver.tauEffRecord = tauEff;
  solver.reset(1, velocity, 0, 0);
  solver.step(steps);

  const evaluated = new Uint8Array(cells).fill(1);
  const subgridActivity = freestreamEddyViscosity({
    nx: size,
    ny: size,
    nz: size,
    tauEff,
    evaluated,
    tau0,
    selection: 'fully-periodic',
    exclusionDistance: 0,
  });
  const macro = solver.macroscopics();
  let maximumVelocityDeviation = 0;
  let activeCells = 0;
  let maximumCell: PeriodicUniformFlowOracleResult['spatialDistribution']['maximumCell'] = null;
  const molecularViscosity = (tau0 - 0.5) / 3;
  for (let idx = 0; idx < cells; idx++) {
    maximumVelocityDeviation = Math.max(
      maximumVelocityDeviation,
      Math.abs(macro.ux[idx] - velocity),
      Math.abs(macro.uy[idx]),
      Math.abs(macro.uz[idx]),
      Math.abs(macro.rho[idx] - 1),
    );
    const ratio = (tauEff[idx] - tau0) / 3 / molecularViscosity;
    if (ratio > 0) activeCells++;
    if (maximumCell === null || ratio > maximumCell.ratio) {
      const z = Math.floor(idx / (size * size));
      const rest = idx - z * size * size;
      const y = Math.floor(rest / size);
      const x = rest - y * size;
      maximumCell = { x, y, z, ratio };
    }
  }
  if (maximumCell?.ratio === 0) maximumCell = null;
  return {
    kind: 'fully-periodic-uniform-flow',
    precision: 'float64-cpu',
    closureConvention: options.lesNorm,
    tau0,
    cs,
    velocity,
    exposureSteps: steps,
    grid: { nx: size, ny: size, nz: size, cells },
    analyticStrain: 0,
    selectedCells: subgridActivity.survivingCells,
    maximumVelocityDeviation,
    subgridActivity,
    spatialDistribution: { activeCells, maximumCell },
  };
}

/** Seeded control using the identical fully-periodic selection and reduction path. */
export function periodicOraclePerturbedControl(
  input: {
    size?: number;
    tau0?: number;
    targetRatio?: number;
  } = {},
): FreestreamEddyViscosity {
  const size = input.size ?? 8;
  const tau0 = input.tau0 ?? 0.5000005;
  const targetRatio = input.targetRatio ?? 42;
  const cells = size ** 3;
  const tauEff = new Float64Array(cells).fill(tau0);
  const molecularViscosity = (tau0 - 0.5) / 3;
  tauEff[Math.floor(cells / 2)] = tau0 + 3 * targetRatio * molecularViscosity;
  return freestreamEddyViscosity({
    nx: size,
    ny: size,
    nz: size,
    tauEff,
    evaluated: new Uint8Array(cells).fill(1),
    tau0,
    selection: 'fully-periodic',
    exclusionDistance: 0,
  });
}
