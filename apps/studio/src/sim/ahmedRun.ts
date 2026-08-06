import type { AhmedSceneOptions } from '@aeroflow/core';
import type { Precision } from '../gpu/ddfLayout';

/**
 * Message protocol between the Ahmed long-run page (ui/ahmed.ts) and its dedicated
 * worker (sim/ahmedWorker.ts) — M9 steps 4–6. The worker owns its own GPUDevice
 * (devices do not cross threads) and its own IndexedDB handle; the page only renders.
 */

export interface AhmedRunOptions {
  scene: AhmedSceneOptions;
  precision: Precision;
  /** Auto-checkpoint cadence, wall-clock. Spec default: 5 minutes. */
  checkpointEveryMs: number;
  /** Try to resume from the latest checkpoint before starting fresh. */
  resume: boolean;
}

export interface AhmedSceneSummary {
  nx: number;
  ny: number;
  nz: number;
  totalCells: number;
  dxMm: number;
  lengthCells: number;
  tau: number;
  Re: number;
  blockage: number;
  frontalCells: number;
  bodyVoxels: number;
  convectiveTimeSteps: number;
  /** Physical free-stream speed implied by Re (≈ 60 m/s at the experimental Re). */
  physU: number;
  uLattice: number;
  /** Nose station in cells — the upstream diagnostic stations are placed relative to it. */
  noseX: number;
}

/**
 * Approach-flow diagnostics (M9 acceptance-1). The Cd the page reports normalizes by the
 * COMMANDED lattice velocity, which is only meaningful if the flow reaches it — and the
 * Ahmed scene still uses the plain equilibrium `Inlet` that M10 measured settling at
 * 0.660·u_in. These statistics say what the approach flow actually is.
 *
 * **Diagnostic only.** `cdCommanded` remains the acceptance-facing coefficient; `cdBulk`
 * and `cdCore` exist to quantify the normalization question, never to re-normalize a
 * verdict into passing.
 */
export interface AhmedDiagnostics {
  totalSteps: number;
  convectiveTimes: number;
  /** Mean Cd over the force history, normalized by the commanded velocity — acceptance. */
  cdCommanded: number;
  /** Same force, normalized by the mass-flux velocity at the reference station. */
  cdBulk: number;
  /** Same force, normalized by the core (boundary-layer-excluded) velocity. */
  cdCore: number;
  /** Commanded lattice velocity the scene was built with. */
  uCommanded: number;
  /** Station used for cdBulk/cdCore/Re — the one nearest the nose. */
  referenceStationX: number;
  /** Re implied by the measured bulk velocity vs the nominal Re. */
  reNominal: number;
  reBulk: number;
  reCore: number;
  stations: {
    x: number;
    fluidCells: number;
    meanRho: number;
    areaMeanUx: number;
    massFlux: number;
    bulkUx: number;
    stdUx: number;
    nonUniformity: number;
    coreMeanUx: number;
    coreCells: number;
    yCore: number;
    blThicknessCells: number;
    /** Cells downstream of the inlet plane, and upstream of the nose. */
    cellsFromInlet: number;
    cellsToNose: number;
  }[];
}

export type AhmedWorkerCommand =
  | { type: 'start'; opts: AhmedRunOptions }
  | { type: 'stop' }
  | { type: 'checkpoint' }
  | { type: 'diagnostics' }
  | { type: 'simulate-device-loss' };

export type AhmedWorkerEvent =
  | { type: 'status'; message: string }
  | { type: 'ready'; scene: AhmedSceneSummary; gpu: string; precision: Precision }
  | {
      type: 'sample';
      totalSteps: number;
      convectiveTimes: number;
      cd: number;
      meanCd: number;
      stdCd: number;
      drift: number;
      converged: boolean;
      newtons: number;
      meanNewtons: number;
      mlups: number;
    }
  | { type: 'diagnostics'; diagnostics: AhmedDiagnostics }
  | { type: 'checkpoint-saved'; bytes: number; ms: number; totalSteps: number; savedAt: number }
  | { type: 'resumed'; totalSteps: number }
  | { type: 'device-lost'; reason: string; recoveries: number }
  | { type: 'recovered'; recoveries: number; totalSteps: number }
  | { type: 'stopped'; totalSteps: number }
  | { type: 'error'; message: string };

/**
 * A one-shot, resettable device-lost signal (M10 chaos-path fix, 2026-07-20). The worker
 * arms one per GPU device; `initDevice`'s `device.lost` callback calls `fire()`.
 */
export interface LostSignal {
  readonly promise: Promise<void>;
  fire(): void;
}

export function makeLostSignal(): LostSignal {
  let fire!: () => void;
  const promise = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { promise, fire };
}

/**
 * Await a GPU step, but resolve the instant the device is lost — even if the step's own
 * promise never settles. WHY (2026-07-20 Ampere chaos run): a destroyed device can leave
 * an in-flight `queue.submit`/`mapAsync` pending forever (it neither resolves nor
 * rejects), so `await sampleForce(...)` hangs the run loop and the catch block that posts
 * `device-lost` is never reached — the forced-loss acceptance-4 check timed out with no
 * event. `device.lost` fires independently of the GPU call, so racing against it breaks
 * the hang. Returns `{ lost: true }` on loss, else `{ lost: false, value }`. The existing
 * throw-based detection stays as the fallback for platforms where the step rejects.
 */
export async function stepOrLost<T>(
  step: Promise<T>,
  lost: Promise<void>,
): Promise<{ lost: true } | { lost: false; value: T }> {
  // A step that rejects/settles after the race is already decided must not surface as an
  // unhandled rejection (e.g. the hung readback finally rejecting post-recovery).
  step.catch(() => undefined);
  return Promise.race([
    step.then((value) => ({ lost: false as const, value })),
    lost.then(() => ({ lost: true as const })),
  ]);
}

/**
 * Resolve `true` if `lost` settles within `graceMs`, else `false`. WHY (2026-07-21 Ampere
 * chaos run): on a destroyed device the in-flight `mapAsync` rejects with an AbortError a
 * microtask/tick BEFORE `device.lost` fires the `deviceLost` flag, so the step's catch
 * saw `deviceLost === false` and misclassified a real loss as a generic error (run stopped
 * instead of recovering). When a step throws, wait this out before deciding: a genuine
 * loss makes `device.lost` resolve within a tick; a real solver error never resolves it,
 * so we only pay the full `graceMs` on true errors (rare).
 */
export function lostWithin(lost: Promise<void>, graceMs: number): Promise<boolean> {
  return Promise.race([
    lost.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
}

/** How long a thrown step waits for `device.lost` to confirm a loss before it is treated
 *  as a genuine error. device.lost normally fires within a tick; this only delays the
 *  reporting of real (non-loss) errors, which end the run anyway. */
export const DEVICE_LOST_GRACE_MS = 250;

/** Ahmed 25° literature band (M9 acceptance 1): Cd = 0.285 ± 15% (stretch ± 10%). */
export const AHMED_CD_TARGET = 0.285;
export const AHMED_CD_BAND: [number, number] = [0.242, 0.328];
export const AHMED_CD_STRETCH: [number, number] = [0.257, 0.314];
