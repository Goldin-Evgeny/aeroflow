import {
  collideD3Q27Central,
  conservedD3Q27,
  D3Q27,
  equilibriumD3Q27Central,
} from '@aeroflow/core';
import { hooks } from '../dev/testHooks';
import type { GpuCapabilities } from '../gpu/context';
import shaderCode from './shaders/central_moment_d3q27_periodic.wgsl?raw';

const Q = 27;
const DIAGNOSTICS = 6;
const WORKGROUP_SIZE = 64;
const TAU_2M = 0.5000020740253772;
const PERIODIC_N = 64;
const PERIODIC_AMPLITUDE = 0.005;
const PERIODIC_UX = 0.05;
const PERIODIC_CS = 0.1;
const PERIODIC_STEPS = 120;
const PERIODIC_DISCARD = 40;
const SECONDARY_FLOOR = PERIODIC_AMPLITUDE * 1e-7;
const SECONDARY_MATERIAL_RATIO = 1e-3;

/**
 * Predeclared before the first aggregate GPU run. The repository's accumulated D3Q19 f32
 * convention is 5e-5 after 100 steps (`parity3d.ts`). Single-collision gates are tighter;
 * periodic macro/gain gates retain that established accumulated-f32 scale. These values are
 * recorded in the durable artifact and must not be adjusted in response to measurements.
 */
export const Q27_GPU_TOLERANCES = Object.freeze({
  collisionPopulationAbs: 2e-5,
  collisionPopulationRel: 5e-4,
  collisionRho: 5e-6,
  collisionMomentum: 5e-6,
  collisionTauEff: 5e-6,
  equilibriumFixedPoint: 2e-5,
  cyclicPermutation: 2e-5,
  periodicGain: 5e-5,
  periodicPhaseDegreesPerStep: 0.01,
  periodicPiOverHydro: 0.005,
  periodicMassDriftRelative: 5e-5,
  periodicMomentumDrift: 5e-5,
});

export const Q27_GPU_DIRECTION_MAPPING = Object.freeze(
  Array.from({ length: Q }, (_, direction) => ({
    cpu: direction,
    gpu: direction,
    velocity: Object.freeze([
      Math.floor(direction / 9) - 1,
      Math.floor((direction % 9) / 3) - 1,
      (direction % 3) - 1,
    ] as const),
  })),
);

export interface Q27PopulationMemoryRow {
  tier: string;
  cells: number;
  d3q19Bytes: number;
  d3q27Bytes: number;
  deltaBytes: number;
}

/** Actual population-only layouts: production D3Q19 Esoteric Pull has one f32 copy; the
 * bounded Q27 periodic proof uses two direction-major f32 ping-pong copies. */
export function q27PopulationMemory(cells: number): Q27PopulationMemoryRow {
  const d3q19Bytes = cells * 19 * Float32Array.BYTES_PER_ELEMENT;
  const d3q27Bytes = cells * 2 * 27 * Float32Array.BYTES_PER_ELEMENT;
  return {
    tier: `${cells / 1e6}M`,
    cells,
    d3q19Bytes,
    d3q27Bytes,
    deltaBytes: d3q27Bytes - d3q19Bytes,
  };
}

interface Grid {
  nx: number;
  ny: number;
  nz: number;
}

interface GpuRun {
  populations: Float32Array;
  history: Float32Array;
  preCollisionHistory: Float32Array;
  postCollisionHistory: Float32Array;
  wallMs: number;
}

type Conserved = readonly [number, number, number, number];

interface Complex {
  re: number;
  im: number;
}

export interface Q27GpuCollisionResult {
  case: string;
  lesCs: number;
  maxAbsPopulationError: number;
  maxRelPopulationError: number;
  rhoError: number;
  momentumError: number;
  tauEffError: number;
  equilibriumFixedPointError: number | null;
  finite: boolean;
  pass: boolean;
}

export interface Q27GpuPeriodicSample {
  step: number;
  coefficient: Complex;
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
  secondaryPeakRelative: number;
}

export interface Q27GpuPeriodicResult {
  wavelength: 3.2 | 8 | 16;
  mode: number;
  cpuGain: number;
  gpuGain: number;
  gainDelta: number;
  cpuPhaseDegreesPerStep: number;
  gpuPhaseDegreesPerStep: number;
  phaseDeltaDegreesPerStep: number;
  cpuPiOverHydro: number;
  gpuPiOverHydro: number;
  piOverHydroDelta: number;
  pairEnvelopeGain: number;
  evenOddGainDistance: number;
  massDriftRelativeMax: number;
  momentumDriftMax: number;
  secondarySpectralPeakRatio: number;
  secondaryGrowingMode: boolean;
  persistentBeating: boolean;
  nonFinite: boolean;
  wallMs: number;
  gates: Record<string, boolean>;
  pass: boolean;
  samples: Q27GpuPeriodicSample[];
  conservationAudit: Q27PeriodicConservationAudit;
}

export interface Q27ConservationHistorySample {
  step: number;
  oldDiagnosticDrift: readonly [number, number, number];
  oldDiagnosticDriftNorm: number;
  preCollision: Conserved;
  preCollisionDrift: readonly [number, number, number];
  preCollisionDriftNorm: number;
  postCollision: Conserved;
  postCollisionDrift: readonly [number, number, number];
  postCollisionDriftNorm: number;
  streamingDelta: readonly [number, number, number];
  streamingDeltaNorm: number;
  collisionDelta: readonly [number, number, number];
  collisionDeltaNorm: number;
}

export interface Q27PeriodicConservationAudit {
  initial: Conserved;
  final: Conserved;
  finalDrift: readonly [number, number, number];
  finalDriftNorm: number;
  oldReportedDriftMax: number;
  reconstructedPreCollisionDriftMax: number;
  reconstructedPostCollisionDriftMax: number;
  maxOldVsReconstructedSameSnapshotDelta: number;
  streamingOnlyMaxDelta: number;
  collisionOnlyMaxDelta: number;
  collisionRepresentatives: Q27ConservationHistorySample[];
  history: Q27ConservationHistorySample[];
}

export interface Q27GpuAuthorityArtifact {
  artifactSchema: 'aeroflow-d3q27-gpu-authority-v1';
  generatedAt: string;
  device: {
    adapter: string;
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxStorageBuffersPerShaderStage: number;
    hasF16: boolean;
    hasTimestamp: boolean;
  };
  operator: {
    version: string;
    precision: 'f32';
    populationLayout: string;
    bufferCount: 2;
    directionMapping: typeof Q27_GPU_DIRECTION_MAPPING;
    momentOrdering: string;
    inverse: string;
  };
  constants: {
    tau0: number;
    lesCs: number;
    backgroundUx: number;
    amplitude: number;
    n: number;
    steps: number;
    discard: number;
  };
  tolerances: typeof Q27_GPU_TOLERANCES;
  collisionCases: Q27GpuCollisionResult[];
  collisionMaxima: {
    populationAbs: number;
    populationRel: number;
    rho: number;
    momentum: number;
    tauEff: number;
  };
  fixedPointMax: number;
  cyclicPermutationMax: number;
  periodicCases: Q27GpuPeriodicResult[];
  memory: {
    d3q19BytesPerCell: 76;
    d3q27BytesPerCell: 216;
    ratio: number;
    rows: Q27PopulationMemoryRow[];
    target15_7MCompatibleWith24GiBPopulationOnly: boolean;
  };
  timing: { method: 'wall-clock-submit-through-readback'; totalMs: number };
  finite: boolean;
  passed: boolean;
}

export interface Q27GpuConservationAuditArtifact {
  artifactSchema: 'aeroflow-d3q27-gpu-conservation-audit-v1';
  generatedAt: string;
  device: Q27GpuAuthorityArtifact['device'];
  unchangedMomentumGate: 5e-5;
  existingMetric: {
    location: 'CPU/JavaScript from GPU f32 diagnostics';
    accumulationPrecision: 'JavaScript Float64 over f32 rho and velocity values';
    formula: 'Euclidean norm of [sum(rho*ux),sum(rho*uy),sum(rho*uz)] minus initial raw momentum';
    normalized: false;
    baseFlowSubtractedBeforeNorm: false;
    snapshot: 'post-periodic-pull, pre-collision';
  };
  independentMetric: {
    location: 'CPU/JavaScript directly from raw GPU f32 Q27 populations';
    accumulationPrecision: 'JavaScript Float64';
    formula: 'direction-major sums of [f,cx*f,cy*f,cz*f] using authoritative D3Q27 directions';
  };
  cases: Array<{
    wavelength: 3.2 | 8 | 16;
    oldReportedDrift: number;
    audit: Q27PeriodicConservationAudit;
  }>;
  classification:
    | 'diagnostic/reduction artifact'
    | 'concrete GPU implementation bug'
    | 'genuine unexplained Q27 GPU drift';
  identifiedCause: string;
  originalAuthorityRestored: boolean;
  passed: boolean;
}

const CPU_PERIODIC = Object.freeze({
  3.2: { gain: 0.9973070736048442, phase: -4.935654144157841, pi: 1.5043900013404317 },
  8: { gain: 0.9999641535700905, phase: -2.2446612822552794, pi: 1.0542218595340442 },
  16: { gain: 0.9999968903299469, phase: -1.124816066822214, pi: 1.013734382584388 },
} as const);

function maxError(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let result = 0;
  for (let index = 0; index < a.length; index++) {
    result = Math.max(result, Math.abs(a[index] - b[index]));
  }
  return result;
}

function cyclicPermutation(populations: ArrayLike<number>): Float32Array {
  const result = new Float32Array(Q);
  for (let direction = 0; direction < Q; direction++) {
    const [x, y, z] = D3Q27.velocities[direction];
    const mapped = D3Q27.velocities.findIndex(
      (velocity) => velocity[0] === z && velocity[1] === x && velocity[2] === y,
    );
    result[mapped] = populations[direction];
  }
  return result;
}

async function checkedPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
  const module = device.createShaderModule({
    label: 'Q27 CM periodic authority',
    code: shaderCode,
  });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === 'error');
  if (errors.length > 0) {
    throw new Error(
      errors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n'),
    );
  }
  return device.createComputePipelineAsync({
    label: 'Q27 CM periodic authority pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'streamCollidePeriodic' },
  });
}

function createParams(
  grid: Grid,
  tau0: number,
  lesCs: number,
  historyStep: number,
  streamPeriodic: boolean,
): ArrayBuffer {
  const cells = grid.nx * grid.ny * grid.nz;
  const bytes = new ArrayBuffer(32);
  const view = new DataView(bytes);
  view.setUint32(0, grid.nx, true);
  view.setUint32(4, grid.ny, true);
  view.setUint32(8, grid.nz, true);
  view.setUint32(12, cells, true);
  view.setFloat32(16, tau0, true);
  view.setFloat32(20, lesCs, true);
  view.setUint32(24, historyStep, true);
  view.setUint32(28, streamPeriodic ? 1 : 0, true);
  return bytes;
}

async function runGpu(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  input: Float32Array,
  grid: Grid,
  tau0: number,
  lesCs: number,
  steps: number,
  streamPeriodic: boolean,
): Promise<GpuRun> {
  const cells = grid.nx * grid.ny * grid.nz;
  if (input.length !== Q * cells) throw new Error(`expected ${Q * cells} Q27 populations`);
  const populationBytes = input.byteLength;
  const historyBytes = steps * DIAGNOSTICS * cells * Float32Array.BYTES_PER_ELEMENT;
  const populationHistoryBytes = steps * populationBytes;
  const populations = [0, 1].map((index) =>
    device.createBuffer({
      label: `Q27 population ${index}`,
      size: populationBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
  );
  const history = device.createBuffer({
    label: 'Q27 diagnostics history',
    size: historyBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const preCollisionHistory = device.createBuffer({
    label: 'Q27 pre-collision population history',
    size: populationHistoryBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const postCollisionHistory = device.createBuffer({
    label: 'Q27 post-collision population history',
    size: populationHistoryBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const parameterBuffers: GPUBuffer[] = [];
  const bindGroups: GPUBindGroup[] = [];
  device.queue.writeBuffer(
    populations[0],
    0,
    input.buffer as ArrayBuffer,
    input.byteOffset,
    input.byteLength,
  );
  for (let step = 0; step < steps; step++) {
    const parameterBuffer = device.createBuffer({
      label: `Q27 params step ${step}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      parameterBuffer,
      0,
      createParams(grid, tau0, lesCs, step, streamPeriodic),
    );
    parameterBuffers.push(parameterBuffer);
    bindGroups.push(
      device.createBindGroup({
        label: `Q27 step ${step} ${step % 2}->${(step + 1) % 2}`,
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: parameterBuffer } },
          { binding: 1, resource: { buffer: populations[step % 2] } },
          { binding: 2, resource: { buffer: populations[(step + 1) % 2] } },
          { binding: 3, resource: { buffer: history } },
          { binding: 4, resource: { buffer: preCollisionHistory } },
          { binding: 5, resource: { buffer: postCollisionHistory } },
        ],
      }),
    );
  }
  const populationReadback = device.createBuffer({
    label: 'Q27 population readback',
    size: populationBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const historyReadback = device.createBuffer({
    label: 'Q27 diagnostics readback',
    size: historyBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const preCollisionReadback = device.createBuffer({
    label: 'Q27 pre-collision population readback',
    size: populationHistoryBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const postCollisionReadback = device.createBuffer({
    label: 'Q27 post-collision population readback',
    size: populationHistoryBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  device.pushErrorScope('validation');
  const encoder = device.createCommandEncoder({ label: 'Q27 authority steps' });
  for (let step = 0; step < steps; step++) {
    const pass = encoder.beginComputePass({ label: `Q27 periodic step ${step}` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroups[step]);
    pass.dispatchWorkgroups(Math.ceil(cells / WORKGROUP_SIZE));
    pass.end();
  }
  encoder.copyBufferToBuffer(populations[steps % 2], 0, populationReadback, 0, populationBytes);
  encoder.copyBufferToBuffer(history, 0, historyReadback, 0, historyBytes);
  encoder.copyBufferToBuffer(
    preCollisionHistory,
    0,
    preCollisionReadback,
    0,
    populationHistoryBytes,
  );
  encoder.copyBufferToBuffer(
    postCollisionHistory,
    0,
    postCollisionReadback,
    0,
    populationHistoryBytes,
  );
  const started = performance.now();
  device.queue.submit([encoder.finish()]);
  await Promise.all([
    populationReadback.mapAsync(GPUMapMode.READ),
    historyReadback.mapAsync(GPUMapMode.READ),
    preCollisionReadback.mapAsync(GPUMapMode.READ),
    postCollisionReadback.mapAsync(GPUMapMode.READ),
  ]);
  const wallMs = performance.now() - started;
  const validationError = await device.popErrorScope();
  if (validationError) throw new Error(validationError.message);

  const output = new Float32Array(populationReadback.getMappedRange()).slice();
  const diagnosticOutput = new Float32Array(historyReadback.getMappedRange()).slice();
  const preCollisionOutput = new Float32Array(preCollisionReadback.getMappedRange()).slice();
  const postCollisionOutput = new Float32Array(postCollisionReadback.getMappedRange()).slice();
  populationReadback.unmap();
  historyReadback.unmap();
  preCollisionReadback.unmap();
  postCollisionReadback.unmap();
  for (const buffer of [
    ...populations,
    history,
    preCollisionHistory,
    postCollisionHistory,
    ...parameterBuffers,
    populationReadback,
    historyReadback,
    preCollisionReadback,
    postCollisionReadback,
  ])
    buffer.destroy();
  return {
    populations: output,
    history: diagnosticOutput,
    preCollisionHistory: preCollisionOutput,
    postCollisionHistory: postCollisionOutput,
    wallMs,
  };
}

function collisionStates(): Array<{
  case: string;
  populations: Float32Array;
  lesCs: number;
  equilibrium: boolean;
}> {
  const states: Array<{
    case: string;
    populations: Float32Array;
    lesCs: number;
    equilibrium: boolean;
  }> = [];
  const addEquilibrium = (
    caseName: string,
    rho: number,
    ux: number,
    uy: number,
    uz: number,
    lesCs: number,
  ) =>
    states.push({
      case: caseName,
      populations: Float32Array.from(equilibriumD3Q27Central(rho, ux, uy, uz)),
      lesCs,
      equilibrium: true,
    });
  addEquilibrium('equilibrium-rest-cs0', 1, 0, 0, 0, 0);
  addEquilibrium('equilibrium-moving-cs0', 1.025, 0.05, -0.012, 0.008, 0);
  addEquilibrium('equilibrium-moving-cs01', 1.01, 0.05, 0.004, -0.003, 0.1);

  const perturb = Float32Array.from(equilibriumD3Q27Central(1, 0.05, 0.003, -0.002));
  for (let direction = 0; direction < Q; direction++) {
    perturb[direction] = Math.fround(
      perturb[direction] * (1 + 4e-4 * Math.sin(0.71 * (direction + 1))),
    );
  }
  states.push({
    case: 'small-nonequilibrium-cs0',
    populations: perturb,
    lesCs: 0,
    equilibrium: false,
  });

  const anisotropic = Float32Array.from(equilibriumD3Q27Central(1.02, 0.047, -0.006, 0.004));
  for (let direction = 0; direction < Q; direction++) {
    const [x, y, z] = D3Q27.velocities[direction];
    anisotropic[direction] = Math.fround(
      anisotropic[direction] * (1 + 8e-4 * (x * y - 0.6 * y * z + 0.35 * x * z)),
    );
  }
  states.push({
    case: 'anisotropic-stress-cs01',
    populations: anisotropic,
    lesCs: 0.1,
    equilibrium: false,
  });

  let random = 0x6d2b79f5;
  const next = (): number => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 0x1_0000_0000;
  };
  for (let state = 0; state < 5; state++) {
    const values = Float32Array.from(
      equilibriumD3Q27Central(
        0.98 + 0.01 * state,
        0.025 + 0.004 * state,
        -0.006 + 0.002 * state,
        0.003 - 0.001 * state,
      ),
    );
    for (let direction = 0; direction < Q; direction++) {
      values[direction] = Math.fround(values[direction] * (1 + (next() - 0.5) * 8e-4));
    }
    states.push({
      case: `deterministic-random-${state + 1}-cs${state % 2 === 0 ? '0' : '01'}`,
      populations: values,
      lesCs: state % 2 === 0 ? 0 : 0.1,
      equilibrium: false,
    });
  }
  return states;
}

function fourier(values: ArrayLike<number>, mode: number): Complex {
  const k = (2 * Math.PI * mode) / PERIODIC_N;
  let re = 0;
  let im = 0;
  for (let x = 0; x < PERIODIC_N; x++) {
    re += values[x] * Math.cos(k * x);
    im -= values[x] * Math.sin(k * x);
  }
  return { re: re / PERIODIC_N, im: im / PERIODIC_N };
}

const magnitude = (value: Complex): number => Math.hypot(value.re, value.im);
const divide = (a: Complex, b: Complex): Complex => {
  const scale = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / scale, im: (a.im * b.re - a.re * b.im) / scale };
};

function fit(points: ReadonlyArray<readonly [number, number]>): { slope: number; r2: number } {
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  return {
    slope: covariance / varianceX,
    r2: varianceY === 0 ? 1 : covariance ** 2 / (varianceX * varianceY),
  };
}

export function reconstructQ27ConservedFloat64(
  field: ArrayLike<number>,
  cells: number,
): [number, number, number, number] {
  if (field.length !== Q * cells) {
    throw new Error(`Q27 reconstruction expected ${Q * cells} populations, got ${field.length}`);
  }
  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let direction = 0; direction < Q; direction++) {
    for (let cell = 0; cell < cells; cell++) {
      const value = field[direction * cells + cell];
      result[0] += value;
      result[1] += D3Q27.ex[direction] * value;
      result[2] += D3Q27.ey[direction] * value;
      result[3] += D3Q27.ez[direction] * value;
    }
  }
  return result;
}

function momentumDifference(a: Conserved, b: Conserved): readonly [number, number, number] {
  return [a[1] - b[1], a[2] - b[2], a[3] - b[3]];
}

function momentumNorm(value: readonly [number, number, number]): number {
  return Math.hypot(value[0], value[1], value[2]);
}

async function runPeriodic(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  wavelength: 3.2 | 8 | 16,
): Promise<Q27GpuPeriodicResult> {
  const mode = PERIODIC_N / wavelength;
  const k = (2 * Math.PI * mode) / PERIODIC_N;
  const input = new Float32Array(Q * PERIODIC_N);
  for (let x = 0; x < PERIODIC_N; x++) {
    const uy = PERIODIC_AMPLITUDE * Math.cos(k * x);
    const equilibrium = equilibriumD3Q27Central(1, PERIODIC_UX, uy, 0);
    for (let direction = 0; direction < Q; direction++) {
      input[direction * PERIODIC_N + x] = equilibrium[direction];
    }
  }
  const initial = reconstructQ27ConservedFloat64(input, PERIODIC_N);
  const gpu = await runGpu(
    device,
    pipeline,
    input,
    { nx: PERIODIC_N, ny: 1, nz: 1 },
    TAU_2M,
    PERIODIC_CS,
    PERIODIC_STEPS,
    true,
  );

  const samples: Q27GpuPeriodicSample[] = [];
  const conservationHistory: Q27ConservationHistorySample[] = [];
  const spectra: Array<Array<{ uy: number; uz: number }>> = [];
  let previousPhase: number | undefined;
  let previousPost: Conserved = initial;
  let nonFinite = !gpu.populations.every(Number.isFinite);
  for (let step = 0; step < PERIODIC_STEPS; step++) {
    const base = step * DIAGNOSTICS * PERIODIC_N;
    const component = (index: number): Float32Array =>
      gpu.history.subarray(base + index * PERIODIC_N, base + (index + 1) * PERIODIC_N);
    const rho = component(0);
    const ux = component(1);
    const uy = component(2);
    const uz = component(3);
    const tau = component(4);
    const piXy = component(5);
    const coefficient = fourier(uy, mode);
    const piCoefficient = fourier(piXy, mode);
    let phase = Math.atan2(coefficient.im, coefficient.re);
    if (previousPhase !== undefined) {
      while (phase - previousPhase > Math.PI) phase -= 2 * Math.PI;
      while (phase - previousPhase < -Math.PI) phase += 2 * Math.PI;
    }
    previousPhase = phase;

    const hydro = new Float64Array(PERIODIC_N);
    const conserved: [number, number, number, number] = [0, 0, 0, 0];
    for (let x = 0; x < PERIODIC_N; x++) {
      const derivative =
        2 * (-k * coefficient.im * Math.cos(k * x) - k * coefficient.re * Math.sin(k * x));
      hydro[x] = -rho[x] * D3Q27.cs2 * tau[x] * derivative;
      conserved[0] += rho[x];
      conserved[1] += rho[x] * ux[x];
      conserved[2] += rho[x] * uy[x];
      conserved[3] += rho[x] * uz[x];
    }
    const piOverHydro = divide(piCoefficient, fourier(hydro, mode));
    const stepSpectrum: Array<{ uy: number; uz: number }> = [];
    let secondaryPeak = 0;
    for (let spectrumMode = 0; spectrumMode <= PERIODIC_N / 2; spectrumMode++) {
      const uyMagnitude = magnitude(fourier(uy, spectrumMode));
      const uzMagnitude = magnitude(fourier(uz, spectrumMode));
      stepSpectrum.push({ uy: uyMagnitude, uz: uzMagnitude });
      if (spectrumMode !== mode) secondaryPeak = Math.max(secondaryPeak, uyMagnitude);
      secondaryPeak = Math.max(secondaryPeak, uzMagnitude);
    }
    spectra.push(stepSpectrum);
    const momentumDrift = [
      conserved[1] - initial[1],
      conserved[2] - initial[2],
      conserved[3] - initial[3],
    ] as const;
    const tauValues = [...tau];
    const sample: Q27GpuPeriodicSample = {
      step: step + 1,
      coefficient,
      amplitude: magnitude(coefficient),
      unwrappedPhase: phase,
      piCoefficient,
      piOverHydro,
      massDriftRelative: (conserved[0] - initial[0]) / initial[0],
      momentumDrift,
      momentumDriftNorm: Math.hypot(...momentumDrift),
      tauMean: tauValues.reduce((sum, value) => sum + value, 0) / PERIODIC_N,
      tauMin: Math.min(...tauValues),
      tauMax: Math.max(...tauValues),
      secondaryPeakRelative: secondaryPeak / magnitude(coefficient),
    };
    const populationBase = step * Q * PERIODIC_N;
    const populationEnd = populationBase + Q * PERIODIC_N;
    const preCollision = reconstructQ27ConservedFloat64(
      gpu.preCollisionHistory.subarray(populationBase, populationEnd),
      PERIODIC_N,
    );
    const postCollision = reconstructQ27ConservedFloat64(
      gpu.postCollisionHistory.subarray(populationBase, populationEnd),
      PERIODIC_N,
    );
    const preCollisionDrift = momentumDifference(preCollision, initial);
    const postCollisionDrift = momentumDifference(postCollision, initial);
    const streamingDelta = momentumDifference(preCollision, previousPost);
    const collisionDelta = momentumDifference(postCollision, preCollision);
    conservationHistory.push({
      step: step + 1,
      oldDiagnosticDrift: momentumDrift,
      oldDiagnosticDriftNorm: sample.momentumDriftNorm,
      preCollision,
      preCollisionDrift,
      preCollisionDriftNorm: momentumNorm(preCollisionDrift),
      postCollision,
      postCollisionDrift,
      postCollisionDriftNorm: momentumNorm(postCollisionDrift),
      streamingDelta,
      streamingDeltaNorm: momentumNorm(streamingDelta),
      collisionDelta,
      collisionDeltaNorm: momentumNorm(collisionDelta),
    });
    previousPost = postCollision;
    nonFinite ||= ![
      coefficient.re,
      coefficient.im,
      piCoefficient.re,
      piCoefficient.im,
      piOverHydro.re,
      piOverHydro.im,
      sample.massDriftRelative,
      sample.momentumDriftNorm,
      sample.tauMean,
      sample.tauMin,
      sample.tauMax,
    ].every(Number.isFinite);
    samples.push(sample);
  }

  const fitted = samples.filter((sample) => sample.step > PERIODIC_DISCARD);
  const gain = Math.exp(
    fit(fitted.map((sample) => [sample.step, Math.log(sample.amplitude)] as const)).slope,
  );
  const phaseDegrees =
    (fit(fitted.map((sample) => [sample.step, sample.unwrappedPhase] as const)).slope * 180) /
    Math.PI;
  const ratios = fitted
    .slice(1)
    .map((sample, index) => divide(sample.coefficient, fitted[index].coefficient));
  const average = (values: Complex[]): Complex => ({
    re: values.reduce((sum, value) => sum + value.re, 0) / values.length,
    im: values.reduce((sum, value) => sum + value.im, 0) / values.length,
  });
  const even = average(ratios.filter((_, index) => fitted[index + 1].step % 2 === 0));
  const odd = average(ratios.filter((_, index) => fitted[index + 1].step % 2 !== 0));
  const evenOddGainDistance = Math.hypot(even.re - odd.re, even.im - odd.im);
  const envelope: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < fitted.length; index += 2) {
    envelope.push([
      (fitted[index].step + fitted[index + 1].step) / 2,
      Math.log(Math.max(fitted[index].amplitude, fitted[index + 1].amplitude)),
    ]);
  }
  const pairEnvelopeGain = Math.exp(fit(envelope).slope);
  const piMean = average(fitted.map((sample) => sample.piOverHydro));
  const gpuPi = magnitude(piMean);

  let secondarySpectralPeakRatio = 0;
  let secondaryGrowingMode = false;
  const intendedPeak = Math.max(...fitted.map((sample) => sample.amplitude));
  const fitStart = PERIODIC_DISCARD + Math.floor(fitted.length / 2);
  for (let spectrumMode = 1; spectrumMode <= PERIODIC_N / 2; spectrumMode++) {
    for (const polarization of ['uy', 'uz'] as const) {
      if (spectrumMode === mode && polarization === 'uy') continue;
      const amplitudes = fitted.map(
        (_, index) => spectra[PERIODIC_DISCARD + index][spectrumMode][polarization],
      );
      const peak = Math.max(...amplitudes);
      const relative = peak / intendedPeak;
      secondarySpectralPeakRatio = Math.max(secondarySpectralPeakRatio, relative);
      const points = amplitudes
        .map((amplitude, index) => [PERIODIC_DISCARD + index + 1, amplitude] as const)
        .filter(([step, amplitude]) => step > fitStart && amplitude >= SECONDARY_FLOOR)
        .map(([step, amplitude]) => [step, Math.log(amplitude)] as const);
      const fittedGain = points.length >= 10 ? Math.exp(fit(points).slope) : null;
      if (relative >= SECONDARY_MATERIAL_RATIO && fittedGain !== null && fittedGain >= 1) {
        secondaryGrowingMode = true;
      }
    }
  }
  const cpu = CPU_PERIODIC[wavelength];
  const persistentBeating =
    pairEnvelopeGain >= 1 || (evenOddGainDistance > 1e-3 && gain >= 0.999999);
  const massDriftRelativeMax = Math.max(
    ...samples.map((sample) => Math.abs(sample.massDriftRelative)),
  );
  const momentumDriftMax = Math.max(...samples.map((sample) => sample.momentumDriftNorm));
  const final = reconstructQ27ConservedFloat64(gpu.populations, PERIODIC_N);
  const finalDrift = momentumDifference(final, initial);
  const conservationAudit: Q27PeriodicConservationAudit = {
    initial,
    final,
    finalDrift,
    finalDriftNorm: momentumNorm(finalDrift),
    oldReportedDriftMax: momentumDriftMax,
    reconstructedPreCollisionDriftMax: Math.max(
      ...conservationHistory.map((sample) => sample.preCollisionDriftNorm),
    ),
    reconstructedPostCollisionDriftMax: Math.max(
      ...conservationHistory.map((sample) => sample.postCollisionDriftNorm),
    ),
    maxOldVsReconstructedSameSnapshotDelta: Math.max(
      ...conservationHistory.map((sample) =>
        momentumNorm([
          sample.oldDiagnosticDrift[0] - sample.preCollisionDrift[0],
          sample.oldDiagnosticDrift[1] - sample.preCollisionDrift[1],
          sample.oldDiagnosticDrift[2] - sample.preCollisionDrift[2],
        ]),
      ),
    ),
    streamingOnlyMaxDelta: Math.max(
      ...conservationHistory.map((sample) => sample.streamingDeltaNorm),
    ),
    collisionOnlyMaxDelta: Math.max(
      ...conservationHistory.map((sample) => sample.collisionDeltaNorm),
    ),
    collisionRepresentatives: conservationHistory.filter((sample) =>
      [1, 40, 80, 120].includes(sample.step),
    ),
    history: conservationHistory,
  };
  const gates = {
    finite: !nonFinite,
    empiricalNonGrowing: gain < 1,
    cpuGainParity: Math.abs(gain - cpu.gain) <= Q27_GPU_TOLERANCES.periodicGain,
    cpuPhaseParity:
      Math.abs(phaseDegrees - cpu.phase) <= Q27_GPU_TOLERANCES.periodicPhaseDegreesPerStep,
    cpuPiParity: Math.abs(gpuPi - cpu.pi) <= Q27_GPU_TOLERANCES.periodicPiOverHydro,
    massConservation: massDriftRelativeMax <= Q27_GPU_TOLERANCES.periodicMassDriftRelative,
    momentumConservation: momentumDriftMax <= Q27_GPU_TOLERANCES.periodicMomentumDrift,
    noSecondaryGrowingMode: !secondaryGrowingMode,
    noPersistentBeating: !persistentBeating,
  };
  return {
    wavelength,
    mode,
    cpuGain: cpu.gain,
    gpuGain: gain,
    gainDelta: gain - cpu.gain,
    cpuPhaseDegreesPerStep: cpu.phase,
    gpuPhaseDegreesPerStep: phaseDegrees,
    phaseDeltaDegreesPerStep: phaseDegrees - cpu.phase,
    cpuPiOverHydro: cpu.pi,
    gpuPiOverHydro: gpuPi,
    piOverHydroDelta: gpuPi - cpu.pi,
    pairEnvelopeGain,
    evenOddGainDistance,
    massDriftRelativeMax,
    momentumDriftMax,
    secondarySpectralPeakRatio,
    secondaryGrowingMode,
    persistentBeating,
    nonFinite,
    wallMs: gpu.wallMs,
    gates,
    pass: Object.values(gates).every(Boolean),
    samples,
    conservationAudit,
  };
}

export async function runQ27GpuAuthority(
  device: GPUDevice,
  caps: GpuCapabilities,
  adapter: string,
): Promise<Q27GpuAuthorityArtifact> {
  const pipeline = await checkedPipeline(device);
  const collisionCases: Q27GpuCollisionResult[] = [];
  let fixedPointMax = 0;
  let totalMs = 0;
  let anisotropicGpu: Float32Array | undefined;
  for (const state of collisionStates()) {
    const cpuInput = Float64Array.from(state.populations);
    const cpuOutput = new Float64Array(cpuInput);
    const cpuCollision = collideD3Q27Central(cpuOutput, { tau0: TAU_2M, lesCs: state.lesCs });
    const gpu = await runGpu(
      device,
      pipeline,
      state.populations,
      { nx: 1, ny: 1, nz: 1 },
      TAU_2M,
      state.lesCs,
      1,
      false,
    );
    totalMs += gpu.wallMs;
    let maxAbsPopulationError = 0;
    let maxRelPopulationError = 0;
    for (let direction = 0; direction < Q; direction++) {
      const error = Math.abs(gpu.populations[direction] - cpuOutput[direction]);
      maxAbsPopulationError = Math.max(maxAbsPopulationError, error);
      if (Math.abs(cpuOutput[direction]) >= 1e-6) {
        maxRelPopulationError = Math.max(
          maxRelPopulationError,
          error / Math.abs(cpuOutput[direction]),
        );
      }
    }
    const gpuConserved = conservedD3Q27(gpu.populations);
    const cpuConserved = conservedD3Q27(cpuOutput);
    const rhoError = Math.abs(gpuConserved[0] - cpuConserved[0]);
    const momentumError = Math.hypot(
      gpuConserved[1] - cpuConserved[1],
      gpuConserved[2] - cpuConserved[2],
      gpuConserved[3] - cpuConserved[3],
    );
    const tauEffError = Math.abs(gpu.history[4] - cpuCollision.tauEff);
    const equilibriumFixedPointError = state.equilibrium
      ? maxError(gpu.populations, state.populations)
      : null;
    if (equilibriumFixedPointError !== null)
      fixedPointMax = Math.max(fixedPointMax, equilibriumFixedPointError);
    const finite = [...gpu.populations, ...gpu.history].every(Number.isFinite);
    const pass =
      finite &&
      maxAbsPopulationError <= Q27_GPU_TOLERANCES.collisionPopulationAbs &&
      maxRelPopulationError <= Q27_GPU_TOLERANCES.collisionPopulationRel &&
      rhoError <= Q27_GPU_TOLERANCES.collisionRho &&
      momentumError <= Q27_GPU_TOLERANCES.collisionMomentum &&
      tauEffError <= Q27_GPU_TOLERANCES.collisionTauEff &&
      (equilibriumFixedPointError === null ||
        equilibriumFixedPointError <= Q27_GPU_TOLERANCES.equilibriumFixedPoint);
    collisionCases.push({
      case: state.case,
      lesCs: state.lesCs,
      maxAbsPopulationError,
      maxRelPopulationError,
      rhoError,
      momentumError,
      tauEffError,
      equilibriumFixedPointError,
      finite,
      pass,
    });
    if (state.case === 'anisotropic-stress-cs01') anisotropicGpu = gpu.populations;
  }

  const anisotropic = collisionStates().find((state) => state.case === 'anisotropic-stress-cs01')!;
  const rotatedInput = cyclicPermutation(anisotropic.populations);
  const rotated = await runGpu(
    device,
    pipeline,
    rotatedInput,
    { nx: 1, ny: 1, nz: 1 },
    TAU_2M,
    0.1,
    1,
    false,
  );
  totalMs += rotated.wallMs;
  const cyclicPermutationMax = maxError(rotated.populations, cyclicPermutation(anisotropicGpu!));

  const periodicCases: Q27GpuPeriodicResult[] = [];
  for (const wavelength of [3.2, 8, 16] as const) {
    const result = await runPeriodic(device, pipeline, wavelength);
    totalMs += result.wallMs;
    periodicCases.push(result);
  }
  const collisionMaxima = {
    populationAbs: Math.max(...collisionCases.map((entry) => entry.maxAbsPopulationError)),
    populationRel: Math.max(...collisionCases.map((entry) => entry.maxRelPopulationError)),
    rho: Math.max(...collisionCases.map((entry) => entry.rhoError)),
    momentum: Math.max(...collisionCases.map((entry) => entry.momentumError)),
    tauEff: Math.max(...collisionCases.map((entry) => entry.tauEffError)),
  };
  const memoryRows = [2_000_000, 8_000_000, 15_700_000].map(q27PopulationMemory);
  const finite =
    collisionCases.every((entry) => entry.finite) &&
    periodicCases.every((entry) => !entry.nonFinite);
  const passed =
    finite &&
    collisionCases.every((entry) => entry.pass) &&
    fixedPointMax <= Q27_GPU_TOLERANCES.equilibriumFixedPoint &&
    cyclicPermutationMax <= Q27_GPU_TOLERANCES.cyclicPermutation &&
    periodicCases.every((entry) => entry.pass) &&
    memoryRows[2].d3q27Bytes < 24 * 1024 ** 3;
  return {
    artifactSchema: 'aeroflow-d3q27-gpu-authority-v1',
    generatedAt: new Date().toISOString(),
    device: {
      adapter,
      maxBufferSize: caps.maxBufferSize,
      maxStorageBufferBindingSize: caps.maxStorageBufferBindingSize,
      maxStorageBuffersPerShaderStage: caps.maxStorageBuffersPerShaderStage,
      hasF16: caps.hasF16,
      hasTimestamp: caps.hasTimestamp,
    },
    operator: {
      version: 'q27-cm-wgsl-v1',
      precision: 'f32',
      populationLayout: 'direction-major slot=direction*cells+cell; two-buffer periodic ping-pong',
      bufferCount: 2,
      directionMapping: Q27_GPU_DIRECTION_MAPPING,
      momentOrdering: 'moment=px*9+py*3+pz; px,py,pz in {0,1,2}',
      inverse:
        'WGSL f32 Gauss-Jordan solve with partial pivoting, transliterated from CPU authority',
    },
    constants: {
      tau0: TAU_2M,
      lesCs: PERIODIC_CS,
      backgroundUx: PERIODIC_UX,
      amplitude: PERIODIC_AMPLITUDE,
      n: PERIODIC_N,
      steps: PERIODIC_STEPS,
      discard: PERIODIC_DISCARD,
    },
    tolerances: Q27_GPU_TOLERANCES,
    collisionCases,
    collisionMaxima,
    fixedPointMax,
    cyclicPermutationMax,
    periodicCases,
    memory: {
      d3q19BytesPerCell: 76,
      d3q27BytesPerCell: 216,
      ratio: 216 / 76,
      rows: memoryRows,
      target15_7MCompatibleWith24GiBPopulationOnly: memoryRows[2].d3q27Bytes < 24 * 1024 ** 3,
    },
    timing: { method: 'wall-clock-submit-through-readback', totalMs },
    finite,
    passed,
  };
}

export function buildQ27GpuConservationAudit(
  authority: Q27GpuAuthorityArtifact,
): Q27GpuConservationAuditArtifact {
  const cases = authority.periodicCases.map((periodic) => ({
    wavelength: periodic.wavelength,
    oldReportedDrift: periodic.momentumDriftMax,
    audit: periodic.conservationAudit,
  }));
  const rawStatePass = cases.every(
    (entry) =>
      entry.audit.reconstructedPreCollisionDriftMax <= Q27_GPU_TOLERANCES.periodicMomentumDrift &&
      entry.audit.reconstructedPostCollisionDriftMax <= Q27_GPU_TOLERANCES.periodicMomentumDrift,
  );
  const streamingDefect = cases.some((entry) => entry.audit.streamingOnlyMaxDelta > 1e-7);
  const classification = rawStatePass
    ? 'diagnostic/reduction artifact'
    : streamingDefect
      ? 'concrete GPU implementation bug'
      : 'genuine unexplained Q27 GPU drift';
  const identifiedCause = rawStatePass
    ? 'The raw population reconstruction remains within the unchanged gate; only rho*u diagnostic reconstruction exceeded it.'
    : streamingDefect
      ? 'The pre-collision raw population snapshot is not a global permutation of the preceding post-collision state.'
      : 'Raw populations confirm the excess drift; periodic streaming is a permutation, while small f32 collision reconstruction residuals accumulate without a demonstrated port defect.';
  const originalAuthorityRestored = classification === 'diagnostic/reduction artifact';
  return {
    artifactSchema: 'aeroflow-d3q27-gpu-conservation-audit-v1',
    generatedAt: new Date().toISOString(),
    device: authority.device,
    unchangedMomentumGate: 5e-5,
    existingMetric: {
      location: 'CPU/JavaScript from GPU f32 diagnostics',
      accumulationPrecision: 'JavaScript Float64 over f32 rho and velocity values',
      formula: 'Euclidean norm of [sum(rho*ux),sum(rho*uy),sum(rho*uz)] minus initial raw momentum',
      normalized: false,
      baseFlowSubtractedBeforeNorm: false,
      snapshot: 'post-periodic-pull, pre-collision',
    },
    independentMetric: {
      location: 'CPU/JavaScript directly from raw GPU f32 Q27 populations',
      accumulationPrecision: 'JavaScript Float64',
      formula: 'direction-major sums of [f,cx*f,cy*f,cz*f] using authoritative D3Q27 directions',
    },
    cases,
    classification,
    identifiedCause,
    originalAuthorityRestored,
    passed: originalAuthorityRestored,
  };
}

export async function mountQ27GpuAuthority(
  device: GPUDevice,
  caps: GpuCapabilities,
  adapter: string,
  root: HTMLElement,
): Promise<void> {
  root.innerHTML = '<pre>Running bounded D3Q27 WGSL authority parity…</pre>';
  try {
    const result = await runQ27GpuAuthority(device, caps, adapter);
    hooks().q27GpuAuthority = result;
    hooks().q27GpuConservationAudit = buildQ27GpuConservationAudit(result);
    root.innerHTML = `<pre>${JSON.stringify(result, null, 2)}</pre>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hooks().q27GpuAuthorityError = message;
    root.innerHTML = `<pre style="color:#c22">Q27 GPU authority error:\n${message}</pre>`;
  }
}
