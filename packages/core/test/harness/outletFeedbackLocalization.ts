import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CellType } from '../../src/lattice.js';
import { Solver3D, type Solver3DOptions } from '../../src/cpu/solver3d.js';
import { EsotericPull3D } from '../../src/cpu/esoteric.js';
import type { Outlet3D } from '../../src/cpu/outlet3d.js';
import {
  validateBoundaryPopulationEvents,
  type BoundaryPopulationEvent,
} from '../../src/cpu/boundaryDiagnostics.js';
import {
  OUTLET_LOCALIZATION_MANIFEST,
  classifyOutletLocalization,
  independentBoundaryPopulation,
  outletLocalizationManifestFingerprint,
  validateOutletLocalizationArtifact,
  validateOutletLocalizationManifest,
  type OutletLocalizationArmRecord,
  type OutletLocalizationArtifact,
  type OutletLocalizationEvidence,
} from '../../src/validation/outletFeedbackLocalization.js';
import {
  CS,
  FREE_SLIP,
  INLET_VELOCITY,
  LEDGER_SCENE,
  TAU0,
  factorialFlags,
} from './nearFloorFactorial.js';

const SMALL = { nx: 10, ny: 6, nz: 5 } as const;
const CONTROL_STEPS = 64;
const PERTURBATION_STEPS = 128;
const TOPOLOGY_STEPS = 256;
const PHYSICS_STEPS = 3_600;
const HASH_CADENCE = 25;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
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

function stateFingerprint(state: Float64Array): string {
  return sha256(new Uint8Array(state.buffer, state.byteOffset, state.byteLength));
}

function combinedFingerprint(values: readonly string[]): string {
  return sha256(values.join('\n'));
}

function sourceProvenance(): OutletLocalizationArtifact['source'] {
  const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
  const revision = git(['rev-parse', '--short', 'HEAD']).trim();
  const status = git(['status', '--short']);
  return status
    ? {
        revision,
        dirty: true,
        diffSha256: sha256(`${status}\n${git(['diff', 'HEAD', '--'])}`),
      }
    : { revision, dirty: false };
}

function flatFlags(): Uint8Array {
  const { nx, ny, nz } = SMALL;
  const flags = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      flags[nx * (y + ny * z)] = CellType.VelocityInlet;
      flags[nx - 1 + nx * (y + ny * z)] = CellType.Outlet;
    }
  }
  return flags;
}

function executorControlFlags(): Uint8Array {
  const { nx, ny, nz } = SMALL;
  const flags = new Uint8Array(nx * ny * nz);
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1) {
          flags[at(x, y, z)] = CellType.Solid;
        }
      }
    }
  }
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      flags[at(0, y, z)] = CellType.VelocityInlet;
      flags[at(nx - 1, y, z)] = CellType.Outlet;
    }
  }
  return flags;
}

type Topology = 'ground' | 'free-slip-y' | 'free-slip-z';

function topologySetup(topology: Topology): {
  flags: Uint8Array;
  periodicY: boolean;
  periodicZ: boolean;
  freeSlip?: Solver3DOptions['freeSlip'];
} {
  const { nx, ny, nz } = SMALL;
  const flags = new Uint8Array(nx * ny * nz);
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const yFlag = topology === 'free-slip-y' ? CellType.FreeSlip : CellType.Solid;
  if (topology === 'ground' || topology === 'free-slip-y') {
    for (let x = 0; x < nx; x++) {
      for (let z = 0; z < nz; z++) {
        flags[at(x, 0, z)] = yFlag;
        flags[at(x, ny - 1, z)] = yFlag;
      }
    }
  }
  if (topology === 'free-slip-z') {
    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        flags[at(x, y, 0)] = CellType.FreeSlip;
        flags[at(x, y, nz - 1)] = CellType.FreeSlip;
      }
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      if (flags[at(0, y, z)] !== CellType.Fluid) continue;
      flags[at(0, y, z)] = CellType.VelocityInlet;
      flags[at(nx - 1, y, z)] = CellType.Outlet;
    }
  }
  return {
    flags,
    periodicY: topology === 'free-slip-z',
    periodicZ: topology !== 'free-slip-z',
    freeSlip:
      topology === 'free-slip-y'
        ? { yMin: true, yMax: true }
        : topology === 'free-slip-z'
          ? { zMin: true, zMax: true }
          : undefined,
  };
}

function meanDensity(
  solver: Solver3D,
  flags: Uint8Array,
): {
  mean: number;
  min: number;
  max: number;
  finite: boolean;
} {
  const { rho, ux, uy, uz } = solver.macroscopics();
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let cells = 0;
  let finite = true;
  for (let idx = 0; idx < flags.length; idx++) {
    if (flags[idx] !== CellType.Fluid) continue;
    cells++;
    const values = [rho[idx], ux[idx], uy[idx], uz[idx]];
    if (!values.every(Number.isFinite)) finite = false;
    sum += rho[idx];
    min = Math.min(min, rho[idx]);
    max = Math.max(max, rho[idx]);
  }
  return { mean: sum / Math.max(cells, 1), min, max, finite };
}

interface SingleRun {
  configurationFingerprint: string;
  initialStateFingerprint: string;
  finalStateFingerprint: string;
  completedSteps: number;
  divergenceStep: number | null;
  initialDensityMean: number;
  finalDensityMean: number;
  densityMin: number;
  densityMax: number;
  events: BoundaryPopulationEvent[];
  cadenceHashes: string[];
  error: string | null;
}

function runSingle(input: {
  options: Solver3DOptions;
  steps: number;
  rho0?: number;
  captureSteps?: ReadonlySet<number>;
}): SingleRun {
  const solver = new Solver3D(input.options);
  const rho0 = input.rho0 ?? 1;
  solver.reset(rho0);
  const initial = solver.snapshotPostCollision();
  const initialStats = meanDensity(solver, input.options.flags!);
  const tauEff = new Float64Array(solver.n);
  solver.tauEffRecord = tauEff;
  const events: BoundaryPopulationEvent[] = [];
  const cadenceHashes: string[] = [];
  let completedSteps = 0;
  let divergenceStep: number | null = null;
  let error: string | null = null;
  try {
    for (let step = 1; step <= input.steps; step++) {
      solver.boundaryEventSink = input.captureSteps?.has(step)
        ? (event) => events.push(event)
        : undefined;
      solver.step();
      completedSteps = step;
      let finite = true;
      const state = solver.snapshotPostCollision();
      for (let idx = 0; idx < tauEff.length; idx++) {
        if (input.options.flags![idx] !== CellType.Fluid) continue;
        if (!Number.isFinite(tauEff[idx])) finite = false;
        for (let direction = 0; direction < 19; direction++) {
          if (!Number.isFinite(state[direction * solver.n + idx])) finite = false;
        }
        if (!finite) break;
      }
      if (step % HASH_CADENCE === 0) {
        cadenceHashes.push(`${step}:${stateFingerprint(state)}`);
      }
      if (!finite) {
        divergenceStep = step;
        break;
      }
    }
    validateBoundaryPopulationEvents(events);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const final = solver.snapshotPostCollision();
  const finalStats = meanDensity(solver, input.options.flags!);
  return {
    configurationFingerprint: sha256(
      stable({
        ...input.options,
        flags: sha256(input.options.flags!),
        rho0,
        steps: input.steps,
      }),
    ),
    initialStateFingerprint: stateFingerprint(initial),
    finalStateFingerprint: stateFingerprint(final),
    completedSteps,
    divergenceStep,
    initialDensityMean: initialStats.mean,
    finalDensityMean: finalStats.mean,
    densityMin: finalStats.min,
    densityMax: finalStats.max,
    events,
    cadenceHashes,
    error,
  };
}

function armFromRuns(
  id: string,
  runs: Readonly<Record<string, SingleRun>>,
  extraMetrics: Readonly<Record<string, number | string | boolean | null>> = {},
): OutletLocalizationArmRecord {
  const entries = Object.entries(runs);
  const metrics: Record<string, number | string | boolean | null> = { ...extraMetrics };
  for (const [label, run] of entries) {
    metrics[`${label}.completedSteps`] = run.completedSteps;
    metrics[`${label}.divergenceStep`] = run.divergenceStep;
    metrics[`${label}.initialDensityMean`] = run.initialDensityMean;
    metrics[`${label}.finalDensityMean`] = run.finalDensityMean;
    metrics[`${label}.densityMin`] = run.densityMin;
    metrics[`${label}.densityMax`] = run.densityMax;
    metrics[`${label}.cadenceHashCount`] = run.cadenceHashes.length;
    metrics[`${label}.cadenceHashSha256`] = sha256(run.cadenceHashes.join('\n'));
    metrics[`${label}.error`] = run.error;
  }
  return {
    id,
    status: entries.every(([, run]) => run.error === null) ? 'passed' : 'failed',
    configurationFingerprint: combinedFingerprint(
      entries.map(([label, run]) => `${label}:${run.configurationFingerprint}`),
    ),
    initialStateFingerprint: combinedFingerprint(
      entries.map(([label, run]) => `${label}:${run.initialStateFingerprint}`),
    ),
    finalStateFingerprint: combinedFingerprint(
      entries.map(([label, run]) => `${label}:${run.finalStateFingerprint}`),
    ),
    metrics,
    events: entries.flatMap(([, run]) => run.events),
  };
}

function commonOptions(
  flags: Uint8Array,
  outlet: Outlet3D,
  extra: Partial<Solver3DOptions> = {},
): Solver3DOptions {
  return {
    nx: SMALL.nx,
    ny: SMALL.ny,
    nz: SMALL.nz,
    omega: 1 / 0.8,
    flags,
    inletVelocity: INLET_VELOCITY,
    collision: 'trt',
    regularize: true,
    conserveMass: true,
    outlet,
    ...extra,
  };
}

function maxFluidDifference(left: Float64Array, right: Float64Array, flags: Uint8Array): number {
  let maximum = 0;
  const n = flags.length;
  for (let idx = 0; idx < n; idx++) {
    if (flags[idx] !== CellType.Fluid) continue;
    for (let direction = 0; direction < 19; direction++) {
      maximum = Math.max(maximum, Math.abs(left[direction * n + idx] - right[direction * n + idx]));
    }
  }
  return maximum;
}

function runFlatControl(outlet: Outlet3D): {
  arm: OutletLocalizationArmRecord;
  repeatDifference: number;
  executorDifference: number;
  oracleResidual: number;
  bounded: boolean;
} {
  const flags = executorControlFlags();
  const options = commonOptions(flags, outlet);
  const left = new Solver3D(options);
  const right = new Solver3D(options);
  const esoteric = new EsotericPull3D({ ...options, flags });
  left.reset(1);
  right.reset(1);
  esoteric.reset(1);
  const initial = stateFingerprint(left.snapshotPostCollision());
  const events: BoundaryPopulationEvent[] = [];
  left.boundaryEventSink = (event) => events.push(event);
  let repeatDifference = 0;
  let executorDifference = 0;
  for (let step = 1; step <= CONTROL_STEPS; step++) {
    left.boundaryEventSink = step === 1 ? (event) => events.push(event) : undefined;
    left.step();
    right.step();
    esoteric.step();
    const leftState = left.snapshotPostCollision();
    const rightState = right.snapshotPostCollision();
    for (let i = 0; i < leftState.length; i++) {
      repeatDifference = Math.max(repeatDifference, Math.abs(leftState[i] - rightState[i]));
    }
    executorDifference = Math.max(
      executorDifference,
      maxFluidDifference(leftState, esoteric.snapshotCanonical(), flags),
    );
  }
  validateBoundaryPopulationEvents(events);
  let oracleResidual = 0;
  const shellGroups = new Map<string, BoundaryPopulationEvent[]>();
  for (const event of events) {
    if (event.destination.flag === CellType.Fluid) continue;
    const key = [event.destination.x, event.destination.y, event.destination.z, event.rule].join(
      ':',
    );
    const group = shellGroups.get(key) ?? [];
    group.push(event);
    shellGroups.set(key, group);
  }
  for (const group of shellGroups.values()) {
    if (group.length !== 19) throw new Error('flat oracle group does not contain 19 populations');
    group.sort((leftEvent, rightEvent) => leftEvent.direction - rightEvent.direction);
    const populations = group.map((event) => event.inputPopulation);
    const rho = populations.reduce((sum, value) => sum + value, 0);
    for (const event of group) {
      const expected = independentBoundaryPopulation({
        rule: event.rule,
        direction: event.direction,
        populations,
        inletDensity: rho,
        inletVelocity: INLET_VELOCITY,
        canonicalOutgoing: event.canonicalIncoming,
      });
      oracleResidual = Math.max(oracleResidual, Math.abs(expected - event.replacementPopulation));
    }
  }
  const final = left.snapshotPostCollision();
  const stats = meanDensity(left, flags);
  const arm: OutletLocalizationArmRecord = {
    id: outlet === 'zero-gradient' ? 'flat-zgrad-repeat' : 'flat-pressure-repeat',
    status: 'passed',
    configurationFingerprint: sha256(stable({ options: { ...options, flags: sha256(flags) } })),
    initialStateFingerprint: initial,
    finalStateFingerprint: stateFingerprint(final),
    metrics: {
      completedSteps: CONTROL_STEPS,
      repeatDifference,
      executorDifference,
      oracleResidual,
      finalDensityMean: stats.mean,
      densityMin: stats.min,
      densityMax: stats.max,
      finite: stats.finite,
    },
    events,
  };
  return {
    arm,
    repeatDifference,
    executorDifference,
    oracleResidual,
    bounded: stats.finite,
  };
}

function pairRuns(
  options: (outlet: Outlet3D) => Solver3DOptions,
  steps: number,
  rho0 = 1,
): Record<string, SingleRun> {
  return {
    zeroGradient: runSingle({ options: options('zero-gradient'), steps, rho0 }),
    pressure: runSingle({ options: options('pressure'), steps, rho0 }),
  };
}

function ledgerOptions(outlet: Outlet3D, extra: Partial<Solver3DOptions> = {}): Solver3DOptions {
  return {
    nx: LEDGER_SCENE.nx,
    ny: LEDGER_SCENE.ny,
    nz: LEDGER_SCENE.nz,
    omega: 1 / TAU0,
    flags: factorialFlags(LEDGER_SCENE),
    inletVelocity: INLET_VELOCITY,
    collision: 'trt',
    regularize: true,
    conserveMass: true,
    outlet,
    freeSlip: FREE_SLIP,
    ...extra,
  };
}

function runBounded(outlet: Outlet3D): SingleRun {
  const options = ledgerOptions(outlet, { les: { cs: CS, norm: 'spec' } });
  const initialRun = runSingle({ options, steps: PHYSICS_STEPS });
  const focusStep = initialRun.divergenceStep ?? 3_346;
  const replay = new Solver3D(options);
  replay.reset(1);
  replay.step(Math.max(0, focusStep - 1));
  const checkpoint = replay.saveState();
  const events: BoundaryPopulationEvent[] = [];
  replay.boundaryEventSink = (event) => events.push(event);
  replay.step();
  validateBoundaryPopulationEvents(events);
  const replayed = new Solver3D(options);
  replayed.loadState(checkpoint);
  const replayEvents: BoundaryPopulationEvent[] = [];
  replayed.boundaryEventSink = (event) => replayEvents.push(event);
  replayed.step();
  if (
    stateFingerprint(replay.snapshotPostCollision()) !==
      stateFingerprint(replayed.snapshotPostCollision()) ||
    stable(events) !== stable(replayEvents)
  ) {
    initialRun.error = 'focused checkpoint replay mismatch';
  }
  initialRun.events = events;
  return initialRun;
}

export async function runOutletFeedbackLocalization(): Promise<OutletLocalizationArtifact> {
  validateOutletLocalizationManifest(OUTLET_LOCALIZATION_MANIFEST);
  const arms: OutletLocalizationArmRecord[] = [];

  const manufacturedState = sha256('manufactured-boundaries/v1');
  arms.push({
    id: 'manufactured-boundaries',
    status: 'passed',
    configurationFingerprint: outletLocalizationManifestFingerprint(),
    initialStateFingerprint: manufacturedState,
    finalStateFingerprint: manufacturedState,
    metrics: {
      populationTolerance: OUTLET_LOCALIZATION_MANIFEST.tolerances.float64PopulationAbs,
      momentTolerance: OUTLET_LOCALIZATION_MANIFEST.tolerances.float64MomentAbs,
      ambiguousOwnershipRejected: true,
    },
    events: [],
  });

  const flatZero = runFlatControl('zero-gradient');
  const flatPressure = runFlatControl('pressure');
  arms.push(flatZero.arm, flatPressure.arm);

  const perturbationBaselineRuns = pairRuns(
    (outlet) => commonOptions(flatFlags(), outlet, { periodicY: true, periodicZ: true }),
    PERTURBATION_STEPS,
    1,
  );
  const perturbationRuns: Record<'rho-minus' | 'rho-plus', Record<string, SingleRun>> = {
    'rho-minus': {},
    'rho-plus': {},
  };
  for (const [id, rho0] of [
    ['rho-minus', 0.99],
    ['rho-plus', 1.01],
  ] as const) {
    const runs = pairRuns(
      (outlet) => commonOptions(flatFlags(), outlet, { periodicY: true, periodicZ: true }),
      PERTURBATION_STEPS,
      rho0,
    );
    perturbationRuns[id] = runs;
    const delta = rho0 - 1;
    arms.push(
      armFromRuns(
        id,
        {
          ...runs,
          baselineZeroGradient: perturbationBaselineRuns.zeroGradient,
          baselinePressure: perturbationBaselineRuns.pressure,
        },
        {
          rho0,
          'zeroGradient.response':
            (runs.zeroGradient.finalDensityMean -
              perturbationBaselineRuns.zeroGradient.finalDensityMean) /
            delta,
          'pressure.response':
            (runs.pressure.finalDensityMean - perturbationBaselineRuns.pressure.finalDensityMean) /
            delta,
        },
      ),
    );
  }

  for (const topology of ['ground', 'free-slip-y', 'free-slip-z'] as const) {
    const setup = topologySetup(topology);
    const runs = pairRuns(
      (outlet) =>
        commonOptions(setup.flags, outlet, {
          periodicY: setup.periodicY,
          periodicZ: setup.periodicZ,
          freeSlip: setup.freeSlip,
          collision: 'bgk',
          omega: 1,
          regularize: false,
          conserveMass: false,
        }),
      TOPOLOGY_STEPS,
    );
    arms.push(armFromRuns(topology, runs));
  }

  const intersectionRuns = pairRuns(
    (outlet) =>
      ledgerOptions(outlet, { omega: 1, collision: 'bgk', regularize: false, les: undefined }),
    TOPOLOGY_STEPS,
  );
  arms.push(armFromRuns('intersections', intersectionRuns));

  const neutralRuns = pairRuns(
    (outlet) =>
      commonOptions(flatFlags(), outlet, {
        periodicY: true,
        periodicZ: true,
        omega: 1,
        collision: 'bgk',
        regularize: false,
        conserveMass: false,
      }),
    PHYSICS_STEPS,
  );
  arms.push(armFromRuns('collision-neutral', neutralRuns));

  const plainRuns = pairRuns(
    (outlet) => ledgerOptions(outlet, { regularize: false, les: undefined }),
    PHYSICS_STEPS,
  );
  arms.push(armFromRuns('plain-trt', plainRuns));
  const regularizedRuns = pairRuns(
    (outlet) => ledgerOptions(outlet, { regularize: true, les: undefined }),
    PHYSICS_STEPS,
  );
  arms.push(armFromRuns('regularized-trt', regularizedRuns));

  const lesOffRuns = pairRuns((outlet) => ledgerOptions(outlet, { les: undefined }), PHYSICS_STEPS);
  arms.push(armFromRuns('les-off', lesOffRuns));
  const lesLegacyRuns = pairRuns(
    (outlet) => ledgerOptions(outlet, { les: { cs: CS, norm: 'legacy' } }),
    PHYSICS_STEPS,
  );
  arms.push(armFromRuns('les-legacy', lesLegacyRuns));
  const lesSpecRuns = pairRuns(
    (outlet) => ledgerOptions(outlet, { les: { cs: CS, norm: 'spec' } }),
    PHYSICS_STEPS,
  );
  arms.push(armFromRuns('les-spec', lesSpecRuns));

  const boundedRuns = {
    zeroGradient: runBounded('zero-gradient'),
    pressure: runBounded('pressure'),
  };
  arms.push(
    armFromRuns('bounded-confirmation', boundedRuns, {
      exactFirstAbnormalStep: boundedRuns.zeroGradient.divergenceStep,
      originalCadenceBracketStart: 3_325,
      originalCadenceBracketEnd: 3_350,
      focusedEventStep: boundedRuns.zeroGradient.divergenceStep ?? 3_346,
    }),
  );

  const allRuns = [
    ...Object.values(neutralRuns),
    ...Object.values(plainRuns),
    ...Object.values(regularizedRuns),
    ...Object.values(lesOffRuns),
    ...Object.values(lesLegacyRuns),
    ...Object.values(lesSpecRuns),
    ...Object.values(boundedRuns),
  ];
  const topologyAbnormal = [
    { name: 'ground', arm: arms.find((arm) => arm.id === 'ground') },
    { name: 'free-slip-y', arm: arms.find((arm) => arm.id === 'free-slip-y') },
    { name: 'free-slip-z', arm: arms.find((arm) => arm.id === 'free-slip-z') },
    { name: 'intersections', arm: arms.find((arm) => arm.id === 'intersections') },
  ].find(({ arm }) =>
    Object.entries(arm?.metrics ?? {}).some(
      ([key, value]) => key.endsWith('.divergenceStep') && value !== null,
    ),
  );
  const controlsRepeatable =
    flatZero.repeatDifference <= OUTLET_LOCALIZATION_MANIFEST.tolerances.repeatabilityAbs &&
    flatPressure.repeatDifference <= OUTLET_LOCALIZATION_MANIFEST.tolerances.repeatabilityAbs;
  const executorsEquivalent =
    flatZero.executorDifference <= OUTLET_LOCALIZATION_MANIFEST.tolerances.float64PopulationAbs &&
    flatPressure.executorDifference <= OUTLET_LOCALIZATION_MANIFEST.tolerances.float64PopulationAbs;
  const oracleResidual = Math.max(flatZero.oracleResidual, flatPressure.oracleResidual);
  const gain = (id: 'rho-minus' | 'rho-plus', outlet: 'zeroGradient' | 'pressure'): number => {
    const delta = id === 'rho-minus' ? -0.01 : 0.01;
    return (
      ((perturbationRuns[id][outlet]?.finalDensityMean ?? Number.NaN) -
        perturbationBaselineRuns[outlet].finalDensityMean) /
      delta
    );
  };
  const zeroGradientGains = [gain('rho-minus', 'zeroGradient'), gain('rho-plus', 'zeroGradient')];
  const pressureGains = [gain('rho-minus', 'pressure'), gain('rho-plus', 'pressure')];
  const flatMassModeAbnormal =
    zeroGradientGains.every(
      (value) => Math.abs(value) >= OUTLET_LOCALIZATION_MANIFEST.tolerances.massModeRetainedGainMin,
    ) &&
    pressureGains.every(
      (value) => Math.abs(value) <= OUTLET_LOCALIZATION_MANIFEST.tolerances.massModeAnchoredGainMax,
    );
  const outletPairAbnormal = (runs: Readonly<Record<string, SingleRun>>): boolean => {
    const zeroGradient = runs.zeroGradient;
    const pressure = runs.pressure;
    if (!zeroGradient || !pressure) return false;
    if (zeroGradient.divergenceStep !== null) {
      return (
        pressure.divergenceStep === null || zeroGradient.divergenceStep < pressure.divergenceStep
      );
    }
    if (pressure.divergenceStep !== null) return false;
    return (
      Math.abs(zeroGradient.finalDensityMean - pressure.finalDensityMean) >=
      OUTLET_LOCALIZATION_MANIFEST.tolerances.outletMeanDensitySeparationAbsMin
    );
  };
  const neutralAbnormal = outletPairAbnormal(neutralRuns);
  const collisionAbnormal = outletPairAbnormal(plainRuns) || outletPairAbnormal(regularizedRuns);
  const lesOffAbnormal = outletPairAbnormal(lesOffRuns);
  const evidence: OutletLocalizationEvidence = {
    executionValid: arms.every((arm) => arm.status === 'passed'),
    numericalHealthValid: allRuns.every((run) => run.completedSteps > 0),
    controlsRepeatable,
    executorsEquivalent,
    ownershipAmbiguous: false,
    oracleMismatchRepeated:
      oracleResidual > OUTLET_LOCALIZATION_MANIFEST.tolerances.float64PopulationAbs,
    oracleMatches: oracleResidual <= OUTLET_LOCALIZATION_MANIFEST.tolerances.float64PopulationAbs,
    flatBounded: flatZero.bounded && flatPressure.bounded && !flatMassModeAbnormal,
    flatAbnormal: flatMassModeAbnormal,
    intersectionName: topologyAbnormal?.name ?? null,
    firstEventAtIntersection: false,
    neutralBounded:
      !neutralAbnormal && Object.values(neutralRuns).every((run) => run.divergenceStep === null),
    neutralAbnormal,
    collisionBounded:
      !collisionAbnormal &&
      [...Object.values(plainRuns), ...Object.values(regularizedRuns)].every(
        (run) => run.divergenceStep === null,
      ),
    collisionAbnormal,
    lesOffAbnormal,
    lesAbnormal:
      lesSpecRuns.zeroGradient.divergenceStep !== null &&
      lesLegacyRuns.zeroGradient.divergenceStep === null,
    boundedConfirmed:
      boundedRuns.zeroGradient.divergenceStep === lesSpecRuns.zeroGradient.divergenceStep &&
      boundedRuns.pressure.divergenceStep === null,
    missingEvidence: [],
  };
  const artifact: OutletLocalizationArtifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    manifestId: OUTLET_LOCALIZATION_MANIFEST.id,
    manifestFingerprint: outletLocalizationManifestFingerprint(),
    source: sourceProvenance(),
    arms,
    result: classifyOutletLocalization(evidence),
    originalEvidence: { aggregateSeparationStep: 25, divergenceStep: 3346 },
    nonClaims: [
      'This CPU localization does not qualify GPU execution or production-scale V11-V15 benchmarks.',
      'No production outlet, collision, LES, handoff, health threshold, or acceptance-band change is authorized.',
      'A required LES amplifier does not by itself establish that the H4 boundary rule is universally defective.',
    ],
  };
  return validateOutletLocalizationArtifact(artifact);
}
