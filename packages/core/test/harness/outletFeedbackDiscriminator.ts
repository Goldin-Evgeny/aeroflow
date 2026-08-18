import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CellType } from '../../src/lattice.js';
import { Solver3D } from '../../src/cpu/solver3d.js';
import type { Outlet3D } from '../../src/cpu/outlet3d.js';
import {
  boundaryMassByClass3D,
  type BoundaryMassBudget,
} from '../../src/analysis/boundaryMassBudget.js';
import { compareStrain } from '../../src/analysis/strainComparison.js';
import { lesKFromCs } from '../../src/cpu/collide.js';
import {
  CS,
  FREE_SLIP,
  INLET_VELOCITY,
  LEDGER_SCENE,
  TAU0,
  factorialFlags,
} from './nearFloorFactorial.js';

export const OUTLET_DISCRIMINATOR_EXPOSURE = 3_600;
export const OUTLET_DISCRIMINATOR_CADENCE = 25;

export interface OutletDiagnosticSample {
  step: number;
  finite: boolean;
  firstNonFinite: { x: number; y: number; z: number } | null;
  mass: number;
  momentum: { x: number; y: number; z: number };
  density: { min: number; mean: number; max: number };
  boundary: BoundaryMassBudget;
  streamwiseProfile: Array<{ x: number; cells: number; rho: number; ux: number }>;
  subgrid: { tauEffMean: number; tauEffMax: number; strainRatio: number | null };
  wavelengthEnergy: { cells2To4: number; cells4To8: number; cellsAbove8: number };
}

export interface OutletArmRecord {
  label: string;
  outlet: Outlet3D;
  materialFingerprint: string;
  configurationFingerprint: string;
  initialStateFingerprint: string;
  samples: OutletDiagnosticSample[];
  divergenceStep: number | null;
  completedSteps: number;
  error: string | null;
}

export interface RepeatabilityThreshold {
  metric: string;
  maximumControlDifference: number;
  scale: number;
  threshold: number;
}

export type OutletFeedbackBranch =
  'outlet-feedback-observed' | 'no-separation-in-exposure' | 'inconclusive';

export interface OutletFeedbackResult {
  branch: OutletFeedbackBranch;
  exposureSteps: number;
  cadence: number;
  earliestSeparation: {
    step: number;
    metric: string;
    difference: number;
    threshold: number;
  } | null;
  lastCommonInterval: { startStep: number; endStep: number };
  divergence: { zeroGradient: number | null; pressure: number | null };
  reason?: string;
}

export interface OutletFeedbackArtifact {
  schemaVersion: 1;
  generatedAt: string;
  provenance: { revision: string; dirty: boolean; diffSha256?: string };
  configuration: {
    tau0: number;
    cs: number;
    lesNorm: 'spec';
    collision: 'trt';
    regularize: true;
    conserveMass: true;
    grid: typeof LEDGER_SCENE;
    exposureSteps: number;
    cadence: number;
  };
  fingerprints: {
    material: string;
    initialState: string;
    configurations: Record<string, string>;
  };
  controls: { left: OutletArmRecord; right: OutletArmRecord };
  thresholds: RepeatabilityThreshold[];
  comparison: { zeroGradient: OutletArmRecord; pressure: OutletArmRecord };
  result: OutletFeedbackResult;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function repositoryProvenance(): OutletFeedbackArtifact['provenance'] {
  const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
  const revision = git(['rev-parse', '--short', 'HEAD']).trim();
  const status = git(['status', '--short']);
  if (!status) return { revision, dirty: false };
  return {
    revision,
    dirty: true,
    diffSha256: sha256(`${status}\n${git(['diff', 'HEAD', '--'])}`),
  };
}

const MATERIAL = {
  grid: { nx: LEDGER_SCENE.nx, ny: LEDGER_SCENE.ny, nz: LEDGER_SCENE.nz },
  tau0: TAU0,
  inletVelocity: INLET_VELOCITY,
  collision: 'trt',
  regularize: true,
  conserveMass: true,
  les: { cs: CS, norm: 'spec' },
  freeSlip: FREE_SLIP,
} as const;

function configuration(outlet: Outlet3D): Record<string, unknown> {
  return { ...MATERIAL, outlet };
}

function makeSolver(outlet: Outlet3D): Solver3D {
  const solver = new Solver3D({
    nx: LEDGER_SCENE.nx,
    ny: LEDGER_SCENE.ny,
    nz: LEDGER_SCENE.nz,
    omega: 1 / TAU0,
    flags: factorialFlags(LEDGER_SCENE),
    inletVelocity: INLET_VELOCITY,
    collision: 'trt',
    regularize: true,
    conserveMass: true,
    les: { cs: CS, norm: 'spec' },
    outlet,
    freeSlip: FREE_SLIP,
  });
  solver.reset(1);
  return solver;
}

function snapshotFingerprint(solver: Solver3D): string {
  const snapshot = solver.snapshotPostCollision();
  return sha256(new Uint8Array(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength));
}

function emptyBudget(): BoundaryMassBudget {
  return {
    velocityInlet: 0,
    inlet: 0,
    outlet: 0,
    solid: 0,
    freeSlipFace: 0,
    freeSlipEdge: 0,
    freeSlipInletRing: 0,
    freeSlipOutletRing: 0,
    total: 0,
  };
}

function addBudget(target: BoundaryMassBudget, source: BoundaryMassBudget): void {
  for (const key of Object.keys(target) as Array<keyof BoundaryMassBudget>)
    target[key] += source[key];
}

function wavelengthEnergy(profile: readonly number[]): OutletDiagnosticSample['wavelengthEnergy'] {
  const energy = { cells2To4: 0, cells4To8: 0, cellsAbove8: 0 };
  const n = profile.length;
  if (n < 2) return energy;
  const mean = profile.reduce((sum, value) => sum + value, 0) / n;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    let real = 0;
    let imaginary = 0;
    for (let x = 0; x < n; x++) {
      const phase = (-2 * Math.PI * k * x) / n;
      real += (profile[x] - mean) * Math.cos(phase);
      imaginary += (profile[x] - mean) * Math.sin(phase);
    }
    const binEnergy = (real * real + imaginary * imaginary) / (n * n);
    const wavelength = n / k;
    if (wavelength <= 4) energy.cells2To4 += binEnergy;
    else if (wavelength <= 8) energy.cells4To8 += binEnergy;
    else energy.cellsAbove8 += binEnergy;
  }
  return energy;
}

function takeSample(
  solver: Solver3D,
  tauEff: Float64Array,
  evaluated: Uint8Array,
  boundary: BoundaryMassBudget,
  step: number,
): OutletDiagnosticSample {
  const { nx, ny, nz } = LEDGER_SCENE;
  const macro = solver.macroscopics();
  let mass = 0;
  let momentumX = 0;
  let momentumY = 0;
  let momentumZ = 0;
  let min = Infinity;
  let max = -Infinity;
  let finite = true;
  let firstNonFinite: OutletDiagnosticSample['firstNonFinite'] = null;
  let cells = 0;
  let tauSum = 0;
  let tauMax = -Infinity;
  const profile = Array.from({ length: nx }, (_, x) => ({ x, cells: 0, rho: 0, ux: 0 }));
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = x + nx * (y + ny * z);
        if (evaluated[idx] !== 1) continue;
        const rho = macro.rho[idx];
        const ux = macro.ux[idx];
        const uy = macro.uy[idx];
        const uz = macro.uz[idx];
        if (![rho, ux, uy, uz, tauEff[idx]].every(Number.isFinite)) {
          finite = false;
          firstNonFinite ??= { x, y, z };
          continue;
        }
        cells++;
        mass += rho;
        momentumX += rho * ux;
        momentumY += rho * uy;
        momentumZ += rho * uz;
        min = Math.min(min, rho);
        max = Math.max(max, rho);
        tauSum += tauEff[idx];
        tauMax = Math.max(tauMax, tauEff[idx]);
        profile[x].cells++;
        profile[x].rho += rho;
        profile[x].ux += ux;
      }
    }
  }
  for (const row of profile) {
    if (row.cells > 0) {
      row.rho /= row.cells;
      row.ux /= row.cells;
    }
  }
  const strain = finite
    ? compareStrain({
        nx,
        ny,
        nz,
        tauEff,
        evaluated,
        ux: macro.ux,
        uy: macro.uy,
        uz: macro.uz,
        rho: macro.rho,
        tau0: TAU0,
        lesK: lesKFromCs(CS),
        lesNorm: 'spec',
      }).medianRatioSlope
    : Number.NaN;
  return {
    step,
    finite,
    firstNonFinite,
    mass,
    momentum: { x: momentumX, y: momentumY, z: momentumZ },
    density: { min, mean: mass / Math.max(cells, 1), max },
    boundary: structuredClone(boundary),
    streamwiseProfile: profile,
    subgrid: {
      tauEffMean: tauSum / Math.max(cells, 1),
      tauEffMax: tauMax,
      strainRatio: Number.isFinite(strain) ? strain : null,
    },
    wavelengthEnergy: wavelengthEnergy(profile.filter((row) => row.cells > 0).map((row) => row.ux)),
  };
}

export function flattenOutletDiagnostics(sample: OutletDiagnosticSample): Record<string, number> {
  const values: Record<string, number> = {
    mass: sample.mass,
    momentumX: sample.momentum.x,
    momentumY: sample.momentum.y,
    momentumZ: sample.momentum.z,
    densityMin: sample.density.min,
    densityMean: sample.density.mean,
    densityMax: sample.density.max,
    boundaryTotal: sample.boundary.total,
    boundaryInlet: sample.boundary.velocityInlet + sample.boundary.inlet,
    boundaryOutlet: sample.boundary.outlet,
    tauEffMean: sample.subgrid.tauEffMean,
    tauEffMax: sample.subgrid.tauEffMax,
    strainRatio: sample.subgrid.strainRatio ?? 0,
    wavelength2To4: sample.wavelengthEnergy.cells2To4,
    wavelength4To8: sample.wavelengthEnergy.cells4To8,
    wavelengthAbove8: sample.wavelengthEnergy.cellsAbove8,
  };
  for (const row of sample.streamwiseProfile) {
    values[`profileRhoX${row.x}`] = row.rho;
    values[`profileUxX${row.x}`] = row.ux;
  }
  return values;
}

export async function runOutletArm(input: {
  label: string;
  outlet: Outlet3D;
  exposureSteps?: number;
  cadence?: number;
}): Promise<OutletArmRecord> {
  const exposureSteps = input.exposureSteps ?? OUTLET_DISCRIMINATOR_EXPOSURE;
  const cadence = input.cadence ?? OUTLET_DISCRIMINATOR_CADENCE;
  const solver = makeSolver(input.outlet);
  const initialStateFingerprint = snapshotFingerprint(solver);
  const flags = factorialFlags(LEDGER_SCENE);
  const evaluated = Uint8Array.from(flags, (flag) => (flag === CellType.Fluid ? 1 : 0));
  const tauEff = new Float64Array(solver.n);
  solver.tauEffRecord = tauEff;
  const boundary = emptyBudget();
  const record: OutletArmRecord = {
    label: input.label,
    outlet: input.outlet,
    materialFingerprint: sha256(stable(MATERIAL)),
    configurationFingerprint: sha256(stable(configuration(input.outlet))),
    initialStateFingerprint,
    samples: [],
    divergenceStep: null,
    completedSteps: 0,
    error: null,
  };
  try {
    for (let step = 1; step <= exposureSteps; step++) {
      addBudget(
        boundary,
        boundaryMassByClass3D(
          solver.snapshotPostCollision(),
          flags,
          LEDGER_SCENE.nx,
          LEDGER_SCENE.ny,
          LEDGER_SCENE.nz,
          FREE_SLIP,
        ),
      );
      solver.step();
      record.completedSteps = step;
      let finite = true;
      for (let idx = 0; idx < tauEff.length; idx++) {
        if (evaluated[idx] === 1 && !Number.isFinite(tauEff[idx])) {
          finite = false;
          break;
        }
      }
      if (!finite) {
        record.divergenceStep = step;
        break;
      }
      if (step % cadence === 0 || step === exposureSteps) {
        record.samples.push(takeSample(solver, tauEff, evaluated, boundary, step));
      }
      if (step % 500 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }
  return record;
}

/** Established reproducer without sampling, boundary accounting, or spectral instrumentation. */
export function uninstrumentedNearFloorDivergence(input: {
  outlet: Outlet3D;
  exposureSteps?: number;
}): number | null {
  const solver = makeSolver(input.outlet);
  const evaluated = Uint8Array.from(factorialFlags(LEDGER_SCENE), (flag) =>
    flag === CellType.Fluid ? 1 : 0,
  );
  const tauEff = new Float64Array(solver.n);
  solver.tauEffRecord = tauEff;
  const exposureSteps = input.exposureSteps ?? OUTLET_DISCRIMINATOR_EXPOSURE;
  for (let step = 1; step <= exposureSteps; step++) {
    solver.step();
    for (let idx = 0; idx < tauEff.length; idx++) {
      if (evaluated[idx] === 1 && !Number.isFinite(tauEff[idx])) return step;
    }
  }
  return null;
}

export function deriveRepeatabilityThresholds(
  left: OutletArmRecord,
  right: OutletArmRecord,
): RepeatabilityThreshold[] {
  const rightByStep = new Map(right.samples.map((sample) => [sample.step, sample]));
  const accumulated = new Map<string, { difference: number; scale: number }>();
  for (const leftSample of left.samples) {
    const rightSample = rightByStep.get(leftSample.step);
    if (!rightSample) continue;
    const a = flattenOutletDiagnostics(leftSample);
    const b = flattenOutletDiagnostics(rightSample);
    for (const key of Object.keys(a)) {
      if (!(key in b)) continue;
      const current = accumulated.get(key) ?? { difference: 0, scale: 0 };
      current.difference = Math.max(current.difference, Math.abs(a[key] - b[key]));
      current.scale = Math.max(current.scale, Math.abs(a[key]), Math.abs(b[key]));
      accumulated.set(key, current);
    }
  }
  return [...accumulated.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([metric, value]) => ({
      metric,
      maximumControlDifference: value.difference,
      scale: value.scale,
      threshold: Math.max(4 * value.difference, 1e-12 * Math.max(value.scale, 1), 1e-14),
    }));
}

export function classifyOutletFeedback(input: {
  zeroGradient: OutletArmRecord;
  pressure: OutletArmRecord;
  thresholds: readonly RepeatabilityThreshold[];
  exposureSteps: number;
  cadence: number;
}): OutletFeedbackResult {
  const { zeroGradient, pressure, thresholds, exposureSteps, cadence } = input;
  const inconclusive = (reason: string): OutletFeedbackResult => ({
    branch: 'inconclusive',
    exposureSteps,
    cadence,
    earliestSeparation: null,
    lastCommonInterval: { startStep: 0, endStep: 0 },
    divergence: {
      zeroGradient: zeroGradient.divergenceStep,
      pressure: pressure.divergenceStep,
    },
    reason,
  });
  if (zeroGradient.materialFingerprint !== pressure.materialFingerprint) {
    return inconclusive('material-configuration-mismatch');
  }
  if (zeroGradient.initialStateFingerprint !== pressure.initialStateFingerprint) {
    return inconclusive('initial-state-mismatch');
  }
  if (zeroGradient.error || pressure.error) return inconclusive('arm-execution-error');
  if (thresholds.length === 0) return inconclusive('missing-repeatability-thresholds');
  const thresholdByMetric = new Map(thresholds.map((threshold) => [threshold.metric, threshold]));
  const pressureByStep = new Map(pressure.samples.map((sample) => [sample.step, sample]));
  let earliest: OutletFeedbackResult['earliestSeparation'] = null;
  for (const left of zeroGradient.samples) {
    const right = pressureByStep.get(left.step);
    if (!right) return inconclusive(`missing-synchronized-diagnostic-at-${left.step}`);
    const leftValues = flattenOutletDiagnostics(left);
    const rightValues = flattenOutletDiagnostics(right);
    for (const [metric, threshold] of thresholdByMetric) {
      if (!(metric in leftValues) || !(metric in rightValues)) {
        return inconclusive(`missing-required-diagnostic-${metric}`);
      }
      const difference = Math.abs(leftValues[metric] - rightValues[metric]);
      if (difference > threshold.threshold) {
        earliest = { step: left.step, metric, difference, threshold: threshold.threshold };
        break;
      }
    }
    if (earliest) break;
  }
  const divergenceObserved =
    zeroGradient.divergenceStep !== pressure.divergenceStep &&
    (zeroGradient.divergenceStep !== null || pressure.divergenceStep !== null);
  const branch: OutletFeedbackBranch =
    earliest || divergenceObserved ? 'outlet-feedback-observed' : 'no-separation-in-exposure';
  const earliestStep =
    earliest?.step ??
    Math.min(
      zeroGradient.divergenceStep ?? exposureSteps,
      pressure.divergenceStep ?? exposureSteps,
    );
  const lastCommonEnd = Math.max(0, earliestStep - cadence);
  return {
    branch,
    exposureSteps,
    cadence,
    earliestSeparation: earliest,
    lastCommonInterval: {
      startStep: Math.max(0, lastCommonEnd - cadence),
      endStep: lastCommonEnd,
    },
    divergence: {
      zeroGradient: zeroGradient.divergenceStep,
      pressure: pressure.divergenceStep,
    },
  };
}

export async function runOutletFeedbackDiscriminator(
  input: {
    exposureSteps?: number;
    cadence?: number;
  } = {},
): Promise<OutletFeedbackArtifact> {
  const exposureSteps = input.exposureSteps ?? OUTLET_DISCRIMINATOR_EXPOSURE;
  const cadence = input.cadence ?? OUTLET_DISCRIMINATOR_CADENCE;
  const controlLeft = await runOutletArm({
    label: 'same-outlet-pressure-left',
    outlet: 'pressure',
    exposureSteps,
    cadence,
  });
  const controlRight = await runOutletArm({
    label: 'same-outlet-pressure-right',
    outlet: 'pressure',
    exposureSteps,
    cadence,
  });
  const thresholds = deriveRepeatabilityThresholds(controlLeft, controlRight);
  const zeroGradient = await runOutletArm({
    label: 'zero-gradient',
    outlet: 'zero-gradient',
    exposureSteps,
    cadence,
  });
  const pressure = await runOutletArm({
    label: 'pressure',
    outlet: 'pressure',
    exposureSteps,
    cadence,
  });
  const material = sha256(stable(MATERIAL));
  const initialState = controlLeft.initialStateFingerprint;
  const result = classifyOutletFeedback({
    zeroGradient,
    pressure,
    thresholds,
    exposureSteps,
    cadence,
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provenance: repositoryProvenance(),
    configuration: {
      tau0: TAU0,
      cs: CS,
      lesNorm: 'spec',
      collision: 'trt',
      regularize: true,
      conserveMass: true,
      grid: LEDGER_SCENE,
      exposureSteps,
      cadence,
    },
    fingerprints: {
      material,
      initialState,
      configurations: {
        controlLeft: controlLeft.configurationFingerprint,
        controlRight: controlRight.configurationFingerprint,
        zeroGradient: zeroGradient.configurationFingerprint,
        pressure: pressure.configurationFingerprint,
      },
    },
    controls: { left: controlLeft, right: controlRight },
    thresholds,
    comparison: { zeroGradient, pressure },
    result,
  };
}
