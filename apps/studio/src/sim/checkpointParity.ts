import { CellType } from '@aeroflow/core';
import { hooks } from '../dev/testHooks';
import { Lbm3D } from './lbm3d';
import {
  clearCheckpoints,
  openCheckpointDb,
  restoreCheckpoint,
  saveCheckpoint,
} from './checkpoint';

const N = 64;
const CHECKPOINT_STEP = 51;
const CONTINUATION_STEPS = 100;
const SCENE_ID = 'checkpoint-parity-64';

export interface CheckpointParityResult {
  grid: number;
  precision: 'fp16';
  conserveMass: true;
  checkpointStep: number;
  continuationSteps: number;
  checkpointBytes: number;
  rawDdfMismatches: number;
  densityMismatches: number;
  nonRestFluidCells: number;
  firstRawMismatch?: string;
  firstDensityMismatch?: string;
  pass: boolean;
  summary: string;
}

function tunnelFlags(): Uint8Array {
  const flags = new Uint8Array(N * N * N).fill(CellType.Fluid);
  const idx = (x: number, y: number, z: number): number => x + N * (y + N * z);

  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (y === 0 || y === N - 1 || z === 0 || z === N - 1) {
          flags[idx(x, y, z)] = CellType.Solid;
        } else if (x === 0) {
          flags[idx(x, y, z)] = CellType.Inlet;
        } else if (x === N - 1) {
          flags[idx(x, y, z)] = CellType.Outlet;
        }
      }
    }
  }

  // Asymmetric obstacle keeps the state evolving and makes a parity/layout error visible.
  for (let z = 27; z <= 34; z++) {
    for (let y = 23; y <= 31; y++) {
      for (let x = 20; x <= 25; x++) flags[idx(x, y, z)] = CellType.Solid;
    }
  }
  return flags;
}

function buildSim(device: GPUDevice, flags: Uint8Array): Lbm3D {
  const sim = new Lbm3D(device, {
    nx: N,
    ny: N,
    nz: N,
    omega: 1 / 0.8,
    inletVel: 0.05,
    collision: 'trt',
    conserveMass: true,
    precision: 'fp16',
    hasF16: true,
    maxBindingBytes: Math.min(
      device.limits.maxStorageBufferBindingSize,
      device.limits.maxBufferSize,
    ),
  });
  sim.flags.set(flags);
  sim.uploadFlags();
  sim.reset(1, 0, 0, 0);
  return sim;
}

async function readRawDdf(sim: Lbm3D): Promise<ArrayBuffer[]> {
  return Promise.all(sim.ddfBufferSizes().map((size, buffer) => sim.readDdfChunk(buffer, 0, size)));
}

function compareRawDdf(
  expected: readonly ArrayBuffer[],
  actual: readonly ArrayBuffer[],
): { mismatches: number; first?: string } {
  let mismatches = 0;
  let first: string | undefined;
  for (let buffer = 0; buffer < expected.length; buffer++) {
    const a = new Uint8Array(expected[buffer]);
    const b = new Uint8Array(actual[buffer]);
    for (let offset = 0; offset < a.length; offset++) {
      if (a[offset] === b[offset]) continue;
      if (!first) first = `buffer ${buffer}, byte ${offset}: ${a[offset]} != ${b[offset]}`;
      mismatches++;
    }
  }
  return { mismatches, first };
}

function densityBits(macro: Float32Array, cells: number): Uint32Array {
  const macroBits = new Uint32Array(macro.buffer, macro.byteOffset, macro.length);
  const result = new Uint32Array(cells);
  for (let cell = 0; cell < cells; cell++) result[cell] = macroBits[4 * cell];
  return result;
}

function compareDensity(
  expected: Uint32Array,
  actual: Uint32Array,
): { mismatches: number; first?: string } {
  let mismatches = 0;
  let first: string | undefined;
  for (let cell = 0; cell < expected.length; cell++) {
    if (expected[cell] === actual[cell]) continue;
    if (!first) {
      first =
        `cell ${cell}: 0x${expected[cell].toString(16).padStart(8, '0')} != ` +
        `0x${actual[cell].toString(16).padStart(8, '0')}`;
    }
    mismatches++;
  }
  return { mismatches, first };
}

/** M9 acceptance 3: raw FP16 checkpoint + odd parity must resume bit-identically. */
export async function runCheckpointParity(device: GPUDevice): Promise<CheckpointParityResult> {
  if (!device.features.has('shader-f16')) {
    throw new Error('checkpoint parity requires shader-f16 (the M9 acceptance storage path)');
  }

  const flags = tunnelFlags();
  const cells = N * N * N;
  let db: IDBDatabase | undefined;
  let reference: Lbm3D | undefined;
  let resumed: Lbm3D | undefined;

  try {
    db = await openCheckpointDb();
    await clearCheckpoints(db);

    reference = buildSim(device, flags);
    reference.submitSteps(CHECKPOINT_STEP);
    const checkpointDdf = await readRawDdf(reference);
    const saved = await saveCheckpoint(db, reference, {
      sceneId: SCENE_ID,
      sceneOptions: { grid: N, tau: 0.8, inletVel: 0.05, conserveMass: true },
    });

    reference.submitSteps(CONTINUATION_STEPS);
    const referenceDensity = densityBits(await reference.readMacro(), cells);
    reference.destroy();
    reference = undefined;

    resumed = buildSim(device, flags);
    const meta = await restoreCheckpoint(db, resumed, SCENE_ID);
    if (!meta) throw new Error('checkpoint parity restore found no checkpoint');
    if (meta.totalSteps !== CHECKPOINT_STEP || meta.parity !== 1) {
      throw new Error(
        `checkpoint restored step/parity ${meta.totalSteps}/${meta.parity}, expected ${CHECKPOINT_STEP}/1`,
      );
    }

    const raw = compareRawDdf(checkpointDdf, await readRawDdf(resumed));
    resumed.submitSteps(CONTINUATION_STEPS);
    const resumedDensity = densityBits(await resumed.readMacro(), cells);
    const density = compareDensity(referenceDensity, resumedDensity);

    const oneBits = new Uint32Array(new Float32Array([1]).buffer)[0];
    let nonRestFluidCells = 0;
    for (let cell = 0; cell < cells; cell++) {
      if (flags[cell] === CellType.Fluid && referenceDensity[cell] !== oneBits) {
        nonRestFluidCells++;
      }
    }

    const pass = raw.mismatches === 0 && density.mismatches === 0 && nonRestFluidCells > 0;
    const summary =
      `M9 GPU checkpoint parity ${N}^3 fp16: save@${CHECKPOINT_STEP} +${CONTINUATION_STEPS} ` +
      `H13=on rawDdf=${raw.mismatches} densityBits=${density.mismatches} ` +
      `nonRestFluid=${nonRestFluidCells} ${pass ? 'PASS' : 'FAIL'}`;
    return {
      grid: N,
      precision: 'fp16',
      conserveMass: true,
      checkpointStep: CHECKPOINT_STEP,
      continuationSteps: CONTINUATION_STEPS,
      checkpointBytes: saved.bytes,
      rawDdfMismatches: raw.mismatches,
      densityMismatches: density.mismatches,
      nonRestFluidCells,
      firstRawMismatch: raw.first,
      firstDensityMismatch: density.first,
      pass,
      summary,
    };
  } finally {
    reference?.destroy();
    resumed?.destroy();
    if (db) {
      await clearCheckpoints(db).catch(() => undefined);
      db.close();
    }
  }
}

export async function mountCheckpointParity(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running M9 64³ FP16 checkpoint parity...</p>';
  try {
    const result = await runCheckpointParity(device);
    hooks().checkpointParity = result;
    root.innerHTML = `
      <h2>M9 GPU checkpoint parity</h2>
      <p style="font-size:1.4em;font-weight:bold;color:${result.pass ? '#2a2' : '#c22'}">
        ${result.pass ? 'PASS' : 'FAIL'}
      </p>
      <pre>${result.summary}</pre>
      <p>Checkpoint bytes: ${result.checkpointBytes.toLocaleString()}</p>
      ${result.firstRawMismatch ? `<p>First raw mismatch: ${result.firstRawMismatch}</p>` : ''}
      ${result.firstDensityMismatch ? `<p>First density mismatch: ${result.firstDensityMismatch}</p>` : ''}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    hooks().checkpointParityError = message;
    root.innerHTML = `<pre style="color:#c22">checkpoint parity error:\n${message}</pre>`;
  }
}
