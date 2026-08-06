import {
  AIR_KINEMATIC_VISCOSITY,
  AHMED,
  ForceHistory,
  ahmedScene,
  forceToNewtons,
  sectionStats,
  upstreamStations,
  type AhmedScene,
} from '@aeroflow/core';
import { initDevice, type GpuDeviceInit } from '../gpu/context';
import { Lbm3D } from './lbm3d';
import {
  clearCheckpoints,
  openCheckpointDb,
  requestPersistence,
  restoreCheckpoint,
  saveCheckpoint,
} from './checkpoint';
import {
  DEVICE_LOST_GRACE_MS,
  lostWithin,
  makeLostSignal,
  stepOrLost,
  type AhmedDiagnostics,
  type AhmedRunOptions,
  type AhmedSceneSummary,
  type AhmedWorkerCommand,
  type AhmedWorkerEvent,
  type LostSignal,
} from './ahmedRun';

/**
 * Dedicated worker driving the Ahmed long run (M9 steps 4–6). Runs the ENTIRE sim here —
 * its own GPUDevice, its own IndexedDB handle — because worker timers are exempt from
 * background-tab throttling (an rAF- or main-thread-timer-driven 4-hour run silently
 * freezes when the tab is backgrounded, the M9 pitfall). The page only renders events.
 *
 * Device-lost recovery (step 5): `initDevice`'s lost callback marks the run; the stepping
 * loop's pending GPU await then fails, and the loop rebuilds device + pipelines + scene
 * buffers, restores the latest checkpoint, and resumes. "simulate-device-loss" calls
 * device.destroy() so acceptance 4 can exercise the path on demand.
 *
 * Runtime-pending: authored and type/build-verified headlessly (WSL2 has no WebGPU / no
 * browser); validate in-browser before recording a Status pass — like all GPU work here.
 */

const post = (e: AhmedWorkerEvent): void => {
  (self as unknown as { postMessage(m: AhmedWorkerEvent): void }).postMessage(e);
};

interface RunState {
  opts: AhmedRunOptions;
  scene: AhmedScene;
  gpu: GpuDeviceInit;
  sim: Lbm3D;
  db: IDBDatabase;
  history: ForceHistory;
  sampleInterval: number;
  running: boolean;
  deviceLost: boolean;
  /** Fires from device.lost — raced against each step so a hung GPU call cannot stall
   *  loss detection. Re-armed for every (re)acquired device. */
  lost: LostSignal;
  recoveries: number;
  lastCheckpointAt: number;
  checkpointRequested: boolean;
  /** Physical unit mapping for the newtons HUD (dt from u·dx/U). */
  dx: number;
  dt: number;
}

let run: RunState | null = null;

function summarize(scene: AhmedScene, physU: number): AhmedSceneSummary {
  return {
    nx: scene.nx,
    ny: scene.ny,
    nz: scene.nz,
    totalCells: scene.nx * scene.ny * scene.nz,
    dxMm: scene.dx * 1e3,
    lengthCells: scene.lengthCells,
    tau: scene.tau,
    Re: scene.Re,
    blockage: scene.blockage,
    frontalCells: scene.frontalCells,
    bodyVoxels: scene.bodyVoxels,
    convectiveTimeSteps: scene.convectiveTimeSteps,
    physU,
    uLattice: scene.uLattice,
    noseX: scene.noseX,
  };
}

/**
 * Approach-flow diagnostics: what velocity does the flow ACTUALLY reach upstream of the
 * body? One `readMacro()` covers every station, so this costs a single readback.
 *
 * The acceptance coefficient is unchanged — `cdCommanded` is normalized by the commanded
 * lattice velocity exactly as before. `cdBulk`/`cdCore` are reported alongside it to
 * quantify the plain-`Inlet` sag M10 measured (0.660·u_in in a frictionless duct), never to
 * re-normalize the verdict: Cd ∝ 1/U², so choosing the denominator that flatters the
 * number is precisely the tolerance-shopping hard rule 3 forbids.
 */
async function collectDiagnostics(r: RunState): Promise<AhmedDiagnostics> {
  const { scene, sim } = r;
  const macro = await sim.readMacro();
  const stationsX = upstreamStations(scene.noseX);
  const stats = stationsX.map((x) =>
    sectionStats(macro, sim.flags, scene.nx, scene.ny, scene.nz, x),
  );

  // The station nearest the nose is the reference: it is what the body actually sees,
  // while still upstream of the nose's own stagnation rise.
  const ref = stats[stats.length - 1];
  // Same force and same 20-T_conv window the `sample` event reports, so cdCommanded here
  // is identical to the acceptance number rather than a parallel computation of it.
  const meanFx = r.history.stats(0, 20).mean;
  const cdFrom = (u: number): number =>
    u > 0 ? meanFx / (0.5 * u * u * scene.frontalCells) : Number.NaN;
  const meanCdCommanded = cdFrom(scene.uLattice);
  const reFrom = (u: number): number =>
    scene.uLattice > 0 ? (scene.Re * u) / scene.uLattice : NaN;

  return {
    totalSteps: sim.totalSteps,
    convectiveTimes: sim.totalSteps / scene.convectiveTimeSteps,
    cdCommanded: meanCdCommanded,
    cdBulk: cdFrom(ref.bulkUx),
    cdCore: cdFrom(ref.coreMeanUx),
    uCommanded: scene.uLattice,
    referenceStationX: ref.x,
    reNominal: scene.Re,
    reBulk: reFrom(ref.bulkUx),
    reCore: reFrom(ref.coreMeanUx),
    stations: stats.map((s) => ({
      ...s,
      cellsFromInlet: s.x,
      cellsToNose: scene.noseX - s.x,
    })),
  };
}

function buildSim(state: Pick<RunState, 'scene' | 'gpu' | 'opts'>): Lbm3D {
  const { scene, gpu, opts } = state;
  const precision = opts.precision === 'fp16' && gpu.caps.hasF16 ? 'fp16' : 'fp32';
  const sim = new Lbm3D(gpu.device, {
    nx: scene.nx,
    ny: scene.ny,
    nz: scene.nz,
    omega: scene.omega,
    inletVel: scene.uLattice,
    collision: 'trt',
    regularize: true, // τ microscopically above 0.5 — the M7 Re=10⁴ stability recipe
    conserveMass: true, // H13: prevent systematic collision-density drift on long runs
    les: { cs: 0.1 },
    forces: true,
    precision,
    hasF16: gpu.caps.hasF16,
    hasTimestamp: gpu.caps.hasTimestamp,
    maxBindingBytes: gpu.caps.maxStorageBufferBindingSize,
  });
  sim.flags.set(scene.flags);
  sim.uploadFlags();
  sim.reset(1, 0, 0, 0);
  return sim;
}

/** Marks the run lost and fires the raced signal (see RunState.lost). Reads `run`
 *  dynamically so it always targets the current device's signal after a recovery. */
function onDeviceLost(): void {
  if (!run) return;
  run.deviceLost = true;
  run.lost.fire();
}

async function start(opts: AhmedRunOptions): Promise<void> {
  if (run?.running) return;
  post({ type: 'status', message: 'building Ahmed scene (CPU voxelization)…' });
  const scene = ahmedScene(opts.scene);
  post({ type: 'status', message: 'requesting GPU device…' });
  const gpu = await initDevice(onDeviceLost);
  const db = await openCheckpointDb();
  void requestPersistence();

  const physU = (scene.Re * AIR_KINEMATIC_VISCOSITY) / (AHMED.length * 1e-3);
  const sim = buildSim({ scene, gpu, opts });
  // Even sample interval ~T_conv/10 (aliases the staggered momentum mode, H2 §4a).
  const sampleInterval = Math.max(2, 2 * Math.round(scene.convectiveTimeSteps / 20));
  let history = new ForceHistory({
    sampleIntervalSteps: sampleInterval,
    convectiveTimeSteps: scene.convectiveTimeSteps,
  });

  if (opts.resume) {
    const meta = await restoreCheckpoint(db, sim).catch((e) => {
      post({ type: 'status', message: `resume failed (${String(e)}) — starting fresh` });
      return null;
    });
    if (meta) {
      if (meta.forceHistory) history = ForceHistory.restore(meta.forceHistory);
      post({ type: 'resumed', totalSteps: meta.totalSteps });
    }
  } else {
    await clearCheckpoints(db);
  }

  run = {
    opts,
    scene,
    gpu,
    sim,
    db,
    history,
    sampleInterval,
    running: true,
    deviceLost: false,
    lost: makeLostSignal(),
    recoveries: 0,
    lastCheckpointAt: performance.now(),
    checkpointRequested: false,
    dx: scene.dx,
    dt: (scene.uLattice * scene.dx) / physU,
  };
  post({
    type: 'ready',
    scene: summarize(scene, physU),
    gpu: gpu.description,
    precision: sim.precision,
  });
  void loop();
}

async function doCheckpoint(): Promise<void> {
  if (!run) return;
  const r = await saveCheckpoint(run.db, run.sim, {
    sceneId: 'ahmed-25',
    sceneOptions: run.opts.scene,
    forceHistory: run.history.serialize(),
  });
  run.lastCheckpointAt = performance.now();
  run.checkpointRequested = false;
  post({
    type: 'checkpoint-saved',
    bytes: r.bytes,
    ms: r.ms,
    totalSteps: run.sim.totalSteps,
    savedAt: Date.now(),
  });
}

async function recover(): Promise<void> {
  if (!run) return;
  post({ type: 'status', message: 'device lost — re-requesting adapter and restoring…' });
  run.sim.destroy();
  // Re-arm the lost signal for the fresh device BEFORE acquiring it, so a loss on the
  // new device fires the new signal, not the already-resolved old one.
  run.lost = makeLostSignal();
  run.deviceLost = false;
  run.gpu = await initDevice(onDeviceLost);
  run.sim = buildSim(run);
  const meta = await restoreCheckpoint(run.db, run.sim);
  if (meta?.forceHistory) run.history = ForceHistory.restore(meta.forceHistory);
  run.recoveries++;
  post({ type: 'recovered', recoveries: run.recoveries, totalSteps: run.sim.totalSteps });
}

async function handleLoss(): Promise<'continue' | 'stop'> {
  if (!run) return 'stop';
  post({ type: 'device-lost', reason: 'device lost mid-step', recoveries: run.recoveries });
  try {
    await recover();
    return 'continue';
  } catch (e) {
    post({ type: 'error', message: `recovery failed: ${String(e)}` });
    if (run) run.running = false;
    return 'stop';
  }
}

async function loop(): Promise<void> {
  let windowSteps = 0;
  let windowStart = performance.now();
  while (run?.running) {
    try {
      const r = run;
      // Race the step against the device-lost signal: a destroyed device may leave the
      // submit/readback pending forever, which would hang this await and starve loss
      // detection (2026-07-20 chaos symptom). See stepOrLost in ahmedRun.ts.
      const outcome = await stepOrLost(r.sim.sampleForce(r.sampleInterval), r.lost.promise);
      if (outcome.lost) {
        if ((await handleLoss()) === 'stop') break;
        windowSteps = 0;
        windowStart = performance.now();
        continue;
      }
      const f = outcome.value;
      windowSteps += r.sampleInterval;
      const cd = f.fx / (0.5 * r.scene.uLattice ** 2 * r.scene.frontalCells);
      if (!Number.isFinite(cd)) {
        post({
          type: 'error',
          message: `Cd went non-finite at step ${r.sim.totalSteps} — solver diverged (check τ_eff/LES)`,
        });
        r.running = false;
        break;
      }
      r.history.push(f.fx, f.fy, f.fz);
      const cdOf = (fx: number): number =>
        fx / (0.5 * r.scene.uLattice ** 2 * r.scene.frontalCells);
      const stats = r.history.stats(0, 20);
      const now = performance.now();
      const mlups = ((windowSteps / (now - windowStart)) * 1000 * r.sim.n) / 1e6;
      if (now - windowStart > 4000) {
        windowStart = now;
        windowSteps = 0;
      }
      post({
        type: 'sample',
        totalSteps: r.sim.totalSteps,
        convectiveTimes: r.sim.totalSteps / r.scene.convectiveTimeSteps,
        cd,
        meanCd: cdOf(stats.mean),
        stdCd: cdOf(stats.std),
        drift: r.history.runningMeanDrift(20),
        converged: r.history.isConverged(20, 0.03),
        newtons: forceToNewtons(f.fx, { dx: r.dx, dt: r.dt }),
        meanNewtons: forceToNewtons(stats.mean, { dx: r.dx, dt: r.dt }),
        mlups,
      });
      if (r.checkpointRequested || now - r.lastCheckpointAt > r.opts.checkpointEveryMs) {
        await doCheckpoint();
      }
    } catch (e) {
      if (!run?.running) break;
      // Fallback path: the step threw. On a destroyed device the GPU call (mapAsync)
      // rejects a tick BEFORE device.lost sets deviceLost (observed on Ampere/Chrome:
      // "AbortError: Buffer was unmapped before mapping was resolved"), so a real loss
      // first looks like a generic error. Give device.lost that tick to settle before
      // classifying. (stepOrLost above covers the other case — a lost device that leaves
      // the step pending forever instead of rejecting.)
      if (!run.deviceLost) await lostWithin(run.lost.promise, DEVICE_LOST_GRACE_MS);
      if (run.deviceLost) {
        if ((await handleLoss()) === 'stop') break;
        windowSteps = 0;
        windowStart = performance.now();
      } else {
        post({ type: 'error', message: String(e) });
        run.running = false;
      }
    }
  }
  if (run) post({ type: 'stopped', totalSteps: run.sim.totalSteps });
}

self.onmessage = (ev: MessageEvent<AhmedWorkerCommand>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'start':
      void start(msg.opts).catch((e) => post({ type: 'error', message: String(e) }));
      break;
    case 'stop':
      if (run) run.running = false;
      break;
    case 'checkpoint':
      if (run?.running) run.checkpointRequested = true;
      break;
    case 'diagnostics':
      if (run) {
        void collectDiagnostics(run)
          .then((diagnostics) => post({ type: 'diagnostics', diagnostics }))
          .catch((e) => post({ type: 'error', message: `diagnostics: ${String(e)}` }));
      }
      break;
    case 'simulate-device-loss':
      // destroy() fires device.lost with reason 'destroyed' — acceptance 4's forced loss.
      if (run?.running) run.gpu.device.destroy();
      break;
  }
};
