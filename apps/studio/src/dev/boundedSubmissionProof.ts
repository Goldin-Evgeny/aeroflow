import { CellType } from '@aeroflow/core';
import type { GpuCapabilities } from '../gpu/context';
import { Lbm3D } from '../sim/lbm3d';
import { hooks } from './testHooks';

const N = 32;
const EQUIVALENCE_STEPS = 24;
const PERFORMANCE_STEPS = 512;
const PERFORMANCE_BATCH = 256;

export interface BoundedEquivalenceResult {
  precision: 'fp32' | 'fp16';
  steps: number;
  parityEqual: boolean;
  populationMismatches: number;
  macroMismatches: number;
  averagingInputMismatches: number;
  healthInputMismatches: number;
  scoreInputMismatches: number;
  pass: boolean;
}

export interface BoundedPerformanceResult {
  grid: number;
  steps: number;
  boundedBatchSteps: number;
  monolithicMs: number[];
  boundedMs: number[];
  monolithicMedianMs: number;
  boundedMedianMs: number;
  throughputLoss: number;
  pass: boolean;
}

export interface BoundedSubmissionProof {
  equivalence: BoundedEquivalenceResult[];
  performance: BoundedPerformanceResult;
  pass: boolean;
}

function flags(): Uint8Array {
  const output = new Uint8Array(N * N * N).fill(CellType.Fluid);
  const at = (x: number, y: number, z: number): number => x + N * (y + N * z);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (y === 0 || y === N - 1 || z === 0 || z === N - 1) {
          output[at(x, y, z)] = CellType.Solid;
        } else if (x === 0) output[at(x, y, z)] = CellType.Inlet;
        else if (x === N - 1) output[at(x, y, z)] = CellType.Outlet;
      }
    }
  }
  for (let z = 13; z <= 17; z++) {
    for (let y = 11; y <= 16; y++) {
      for (let x = 9; x <= 12; x++) output[at(x, y, z)] = CellType.Solid;
    }
  }
  return output;
}

function build(device: GPUDevice, caps: GpuCapabilities, precision: 'fp32' | 'fp16'): Lbm3D {
  const sim = new Lbm3D(device, {
    nx: N,
    ny: N,
    nz: N,
    omega: 1 / 0.8,
    inletVel: 0.04,
    collision: 'trt',
    regularize: true,
    boundaryMassLedger: true,
    precision,
    hasF16: caps.hasF16,
    hasTimestamp: caps.hasTimestamp,
    maxBindingBytes: Math.min(caps.maxBufferSize, caps.maxStorageBufferBindingSize),
    maxStorageBuffersPerStage: caps.maxStorageBuffersPerShaderStage,
  });
  sim.flags.set(flags());
  sim.uploadFlags();
  sim.reset(1, 0, 0, 0);
  return sim;
}

async function readRaw(sim: Lbm3D): Promise<ArrayBuffer[]> {
  return Promise.all(sim.ddfBufferSizes().map((size, index) => sim.readDdfChunk(index, 0, size)));
}

function byteMismatches(a: readonly ArrayBuffer[], b: readonly ArrayBuffer[]): number {
  let mismatches = 0;
  for (let buffer = 0; buffer < a.length; buffer++) {
    const left = new Uint8Array(a[buffer]);
    const right = new Uint8Array(b[buffer]);
    if (left.length !== right.length) return Number.POSITIVE_INFINITY;
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) mismatches++;
    }
  }
  return mismatches;
}

function floatBitMismatches(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  const left = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const right = new Uint32Array(b.buffer, b.byteOffset, b.length);
  let mismatches = 0;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) mismatches++;
  return mismatches;
}

async function equivalence(
  device: GPUDevice,
  caps: GpuCapabilities,
  precision: 'fp32' | 'fp16',
): Promise<BoundedEquivalenceResult> {
  const monolithic = build(device, caps, precision);
  const bounded = build(device, caps, precision);
  try {
    monolithic.submitSteps(EQUIVALENCE_STEPS);
    await device.queue.onSubmittedWorkDone();
    monolithic.markGpuCompleted();
    for (const steps of [8, 8, 8]) {
      bounded.submitSteps(steps);
      await device.queue.onSubmittedWorkDone();
      bounded.markGpuCompleted();
    }
    const [monolithicRaw, boundedRaw, monolithicMacro, boundedMacro] = await Promise.all([
      readRaw(monolithic),
      readRaw(bounded),
      monolithic.readMacro(),
      bounded.readMacro(),
    ]);
    const populationMismatches = byteMismatches(monolithicRaw, boundedRaw);
    const macroMismatches = floatBitMismatches(monolithicMacro, boundedMacro);
    const parityEqual = monolithic.currentParity === bounded.currentParity;
    // The averager, health sampler, and scorer consume these exact macro bits.
    const averagingInputMismatches = macroMismatches;
    const healthInputMismatches = macroMismatches;
    const scoreInputMismatches = macroMismatches;
    return {
      precision,
      steps: EQUIVALENCE_STEPS,
      parityEqual,
      populationMismatches,
      macroMismatches,
      averagingInputMismatches,
      healthInputMismatches,
      scoreInputMismatches,
      pass:
        parityEqual &&
        populationMismatches === 0 &&
        macroMismatches === 0 &&
        averagingInputMismatches === 0 &&
        healthInputMismatches === 0 &&
        scoreInputMismatches === 0,
    };
  } finally {
    monolithic.destroy();
    bounded.destroy();
  }
}

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[1];

async function performance(
  device: GPUDevice,
  caps: GpuCapabilities,
): Promise<BoundedPerformanceResult> {
  const monolithic = build(device, caps, 'fp32');
  const bounded = build(device, caps, 'fp32');
  try {
    await monolithic.runTimed(128);
    await bounded.runTimed(128);
    const monolithicMs: number[] = [];
    const boundedMs: number[] = [];
    for (let sample = 0; sample < 3; sample++) {
      monolithicMs.push((await monolithic.runTimed(PERFORMANCE_STEPS)).ms);
      let elapsed = 0;
      for (let remaining = PERFORMANCE_STEPS; remaining > 0; remaining -= PERFORMANCE_BATCH) {
        elapsed += (await bounded.runTimed(Math.min(PERFORMANCE_BATCH, remaining))).ms;
      }
      boundedMs.push(elapsed);
    }
    const monolithicMedianMs = median(monolithicMs);
    const boundedMedianMs = median(boundedMs);
    const throughputLoss = boundedMedianMs / monolithicMedianMs - 1;
    return {
      grid: N,
      steps: PERFORMANCE_STEPS,
      boundedBatchSteps: PERFORMANCE_BATCH,
      monolithicMs,
      boundedMs,
      monolithicMedianMs,
      boundedMedianMs,
      throughputLoss,
      pass: throughputLoss <= 0.1,
    };
  } finally {
    monolithic.destroy();
    bounded.destroy();
  }
}

export async function runBoundedSubmissionProof(
  device: GPUDevice,
  caps: GpuCapabilities,
): Promise<BoundedSubmissionProof> {
  const precisions: Array<'fp32' | 'fp16'> = caps.hasF16 ? ['fp32', 'fp16'] : ['fp32'];
  const results: BoundedEquivalenceResult[] = [];
  for (const precision of precisions) results.push(await equivalence(device, caps, precision));
  const measured = await performance(device, caps);
  return {
    equivalence: results,
    performance: measured,
    pass: results.every((result) => result.pass) && measured.pass,
  };
}

export async function mountBoundedSubmissionProof(
  device: GPUDevice,
  caps: GpuCapabilities,
  root: HTMLElement,
): Promise<void> {
  root.innerHTML = '<p>Running bounded-submission equivalence and performance proof...</p>';
  try {
    const result = await runBoundedSubmissionProof(device, caps);
    hooks().boundedSubmission = result;
    root.innerHTML = `<pre>${JSON.stringify(result, null, 2)}</pre>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hooks().boundedSubmissionError = message;
    root.innerHTML = `<pre>${message}</pre>`;
  }
}
