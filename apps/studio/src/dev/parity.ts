import { CellType, Solver2D } from '@aeroflow/core';
import { Lbm2D } from '../sim/lbm2d';
import {
  PARITY_CONFIGS,
  PARITY_GATES,
  cavityScene,
  ductScene,
  type ParityConfig,
  type ParityScene,
} from './parityScene';

/**
 * CPU↔GPU parity harness (docs/handoff/H6-parity-panel.md). Runs the proven Float64
 * CPU oracle (@aeroflow/core Solver2D) and the WGSL kernel on the identical fixed scene
 * for N steps, reads the GPU distributions back, and reports the max relative error
 * over non-solid cells. This is the instrument that verifies every GPU kernel change.
 *
 * This must be executed in a browser — it needs a real WebGPU device. Since 2026-07-28 both
 * e2e tiers launch one directly (docs/E2E.md), so `parity.spec.ts` runs it unattended.
 */

export interface ParityRun {
  n: number;
  gate: number;
  maxFErr: number;
  maxVelErr: number;
  argmax: { cell: number; dir: number };
  pass: boolean;
}

export interface ParityConfigResult {
  key: string;
  runs: ParityRun[];
  pass: boolean;
}

export interface ParityReport {
  results: ParityConfigResult[];
  pass: boolean;
  summary: string;
}

/** Non-solid cell velocity from a raw distribution array (physical, no forcing). */
function velocityOf(f: ArrayLike<number>, n: number, flags: Uint8Array): Float64Array {
  // D2Q9 ex/ey.
  const ex = [0, 1, 0, -1, 0, 1, -1, -1, 1];
  const ey = [0, 0, 1, 0, -1, 1, 1, -1, -1];
  const vel = new Float64Array(2 * n);
  for (let idx = 0; idx < n; idx++) {
    if (flags[idx] === CellType.Solid) continue;
    let rho = 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 9; i++) {
      const fi = f[i * n + idx];
      rho += fi;
      mx += ex[i] * fi;
      my += ey[i] * fi;
    }
    vel[2 * idx] = mx / rho;
    vel[2 * idx + 1] = my / rho;
  }
  return vel;
}

async function runConfigStep(
  gpu: Lbm2D,
  scene: ParityScene,
  cfg: ParityConfig,
  n: number,
  gate: number,
): Promise<ParityRun> {
  const { nx, ny, tau, uin, flags: cpuFlags, wallVel } = scene;
  const cells = nx * ny;

  // CPU oracle — identical config, identical init (1, uin, 0).
  const cpu = new Solver2D({
    nx,
    ny,
    omega: 1 / tau,
    flags: cpuFlags.slice(),
    inletVelocity: uin,
    collision: cfg.collision,
    lambda: 3 / 16,
    les: cfg.lesCs ? { cs: cfg.lesCs } : undefined,
    regularize: cfg.regularize,
    conserveMass: cfg.conserveMass,
    wallVelocity: wallVel ? wallVel.slice() : undefined,
  });
  cpu.reset(1, uin, 0);
  cpu.step(n);
  const cpuF = cpu.distributions();

  // GPU — same scene, same params, reset to (1, uin, 0) via resetFlow.
  gpu.setParams({
    omega: 1 / tau,
    uin,
    collision: cfg.collision,
    lambda: 3 / 16,
    lesCs: cfg.lesCs,
    regularize: cfg.regularize,
    conserveMass: cfg.conserveMass,
  });
  gpu.flags.set(Uint32Array.from(cpuFlags));
  gpu.uploadFlags();
  gpu.setWallVelocity(Float32Array.from(wallVel ?? new Float64Array(2 * cells)));
  gpu.resetFlow();
  gpu.submitSteps(n);
  const gpuF = await gpu.readDistributions();

  // Compare raw distributions over non-solid cells (H6 §3, pitfall 3).
  let maxFErr = 0;
  let argCell = -1;
  let argDir = -1;
  for (let idx = 0; idx < cells; idx++) {
    if (cpuFlags[idx] === CellType.Solid) continue;
    for (let i = 0; i < 9; i++) {
      const c = cpuF[i * cells + idx];
      const g = gpuF[i * cells + idx];
      const err = Math.abs(g - c) / (Math.abs(c) + 1e-12);
      if (err > maxFErr) {
        maxFErr = err;
        argCell = idx;
        argDir = i;
      }
    }
  }

  const cpuVel = velocityOf(cpuF, cells, cpuFlags);
  const gpuVel = velocityOf(gpuF, cells, cpuFlags);
  let maxVelErr = 0;
  for (let idx = 0; idx < cells; idx++) {
    if (cpuFlags[idx] === CellType.Solid) continue;
    for (let d = 0; d < 2; d++) {
      const c = cpuVel[2 * idx + d];
      const g = gpuVel[2 * idx + d];
      maxVelErr = Math.max(maxVelErr, Math.abs(g - c) / (Math.abs(c) + 1e-12));
    }
  }

  return {
    n,
    gate,
    maxFErr,
    maxVelErr,
    argmax: { cell: argCell, dir: argDir },
    pass: maxFErr <= gate,
  };
}

/**
 * Which slice of the H6 matrix to run.
 *
 * `full` — every scene × config × step count (H6 §3). The physics gate. It does not finish
 * inside a sane Tier-A budget on SwiftShader (measured 2026-07-27: >5 min, still unfinished),
 * so it is the **Tier B** (real GPU) matrix and the one the `?dev` button runs by default.
 *
 * `quick` — every scene and every config, but only the N=10 / 1e-5 gate; the N=200 / 1e-4
 * runs are dropped. That keeps coverage of all four collision paths and both boundary-
 * condition scenes (which is what catches a structurally broken kernel) and drops only the
 * accumulated-drift check, which is 20× the work. The matrix appends all four H10
 * regularization compositions to the original four H6 configs. **A quick PASS is not the
 * H6 gate** — the report says so in `summary`, and Tier A's job is to catch breakage cheaply,
 * not to certify physics on a software rasterizer.
 *
 * No tolerance is changed either way (CLAUDE.md rule 3): `quick` runs a subset of the gates
 * at their published values, it does not relax any.
 */
export type ParityMatrix = 'full' | 'quick';

export async function runParity(
  device: GPUDevice,
  matrix: ParityMatrix = 'full',
  onProgress?: (step: string) => void,
): Promise<ParityReport> {
  // Duct (M1/M2) + lid-driven cavity (M3, moving-wall BC). Both fixed 32×32.
  const scenes = [ductScene(), cavityScene()];
  const gates = matrix === 'quick' ? PARITY_GATES.filter((g) => g.n === 10) : PARITY_GATES;

  // One offscreen GPU instance, reused across scenes/configs (pipelines are
  // config-independent, and every scene shares the 32×32 grid).
  const { nx, ny } = scenes[0];
  const gpu = new Lbm2D(device, nx, ny, { omega: 1 / scenes[0].tau, uin: scenes[0].uin });

  const results: ParityConfigResult[] = [];
  try {
    for (const scene of scenes) {
      for (const cfg of PARITY_CONFIGS) {
        const runs: ParityRun[] = [];
        for (const { n, gate } of gates) {
          // Report BEFORE the run: if it throws, the last progress string names what died.
          // The report itself only lands after every scene × config, so without this a
          // mid-matrix failure is indistinguishable from a slow one.
          onProgress?.(`${scene.key}${cfg.key} N=${n}`);
          runs.push(await runConfigStep(gpu, scene, cfg, n, gate));
        }
        results.push({ key: `${scene.key}${cfg.key}`, runs, pass: runs.every((r) => r.pass) });
      }
    }
  } finally {
    gpu.destroy();
  }

  const pass = results.every((r) => r.pass);
  const fmt = (x: number) => x.toExponential(1);
  const summary =
    // Name the slice first: a `quick` line must never be mistaken for the H6 gate.
    `parity [${matrix}] ${nx}x${ny}: ` +
    results
      .map((r) => `${r.key} ${r.runs.map((run) => `${run.n}=${fmt(run.maxFErr)}`).join('/')}`)
      .join('  ') +
    `  ${pass ? 'PASS' : 'FAIL'}`;

  return { results, pass, summary };
}
