import type { AhmedSceneOptions, FieldStats, TauLayer, TauStats } from '@aeroflow/core';
import type { Precision } from '../gpu/ddfLayout';

/**
 * Message protocol between the Ahmed long-run page (ui/ahmed.ts) and its dedicated
 * worker (sim/ahmedWorker.ts) — M9 steps 4–6. The worker owns its own GPUDevice
 * (devices do not cross threads) and its own IndexedDB handle; the page only renders.
 */

export interface AhmedRunOptions {
  scene: AhmedSceneOptions;
  precision: Precision;
  /**
   * Smagorinsky Cs. Defaults to `AHMED_LES_CS`. A run knob, not a scene property — the scene
   * decides only that LES is REQUIRED at this τ₀ (`AhmedScene.les`), never how strong it is.
   *
   * 0 is a meaningful value (LES fully off) and must be passed through, not treated as unset.
   */
  lesCs?: number;
  /**
   * Convective times between whole-field stability snapshots. Defaults to
   * `FIELD_SNAPSHOT_TCONV_DEFAULT`.
   *
   * Reduced-Cs rungs should set this LOWER. The snapshot's whole value is being the last
   * record before a divergence, and a rung run below the dissipation its τ₀ needs can go from
   * healthy to NaN quickly — at a 20-T_conv cadence the "last healthy" record could sit almost
   * 20 T_conv before the failure and show nothing of the approach to it.
   */
  fieldEveryTConv?: number;
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
  /**
   * The Cs and DDF storage precision the solver was actually BUILT with — not what was typed.
   * Reported on every row because a Cd, a δ99 or a ν_LES/ν_mol is uninterpretable without
   * them, and because the page's verdict suppression keys off these exact values.
   */
  lesCs: number;
  precision: Precision;
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
  /**
   * Whole-field stability over the SAME `readMacro()` this diagnostic already performs, so it
   * costs no extra readback. Answers "did this rung stay healthy?", which a Cd alone cannot:
   * a run that finishes with mass drifting or ρ excursions widening is a marginal result, not
   * a data point (M9 step 7).
   */
  field: FieldStats;
}

/**
 * τ_eff snapshot (M9 step 6) — reconstructed from the GPU's own DDF image by `tauOracle.ts`
 * and validated by `?tauoracle` before any number here is believed.
 *
 * The question it answers: **is the nominal Reynolds number still controlling the physics?**
 * ν = (τ − ½)/3, so ν_mol = (τ₀ − ½)/3 and ν_LES = (τ_eff − τ₀)/3. At Re 1e5 the Ahmed scene
 * runs τ₀ = 0.500144, i.e. ν_mol ≈ 4.8e-5 — ten times smaller than at Re 1e4. If the eddy
 * viscosity dwarfs that over most of the domain, the effective Re is set by the model and the
 * grid, and the Re label on the ladder describes an input that no longer reaches the solver.
 *
 * There is no clamp in the model: τ_t ≥ 0, so τ₀ is itself the floor and `atFloorFraction`
 * counts cells where the LES contributes nothing — not cells where a limiter fired.
 */
export interface AhmedTauReport {
  totalSteps: number;
  convectiveTimes: number;
  parity: 0 | 1;
  tau0: number;
  nuMolecular: number;
  lesK: number;
  /** Cs behind `lesK` (lesK = 18√2·Cs²) — the swept knob, reported directly. */
  lesCs: number;
  Re: number;
  fluidCells: number;
  /** Cells the oracle declined to evaluate because a neighbour is FreeSlip. */
  freeSlipAdjacentSkipped: number;
  /** Any non-zero value invalidates the snapshot. */
  nonFinite: number;
  bodyHeight: number;
  slantStartX: number;
  regions: { name: string; stats: TauStats }[];
  layers: { x: number; layers: TauLayer[] }[];
}

export type AhmedWorkerCommand =
  | { type: 'start'; opts: AhmedRunOptions }
  | { type: 'stop' }
  | { type: 'checkpoint' }
  | { type: 'diagnostics' }
  | { type: 'tau' }
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
  | { type: 'tau'; tau: AhmedTauReport }
  /**
   * Periodic in-run stability snapshot (M9 step 7). Emitted on a coarse convective-time
   * cadence, NOT per sample: it costs a whole-field `readMacro()`.
   *
   * It exists because a diverged rung cannot be measured after the fact — the field is
   * already poison and `collectDiagnostics` would return NaNs. The last snapshot before
   * divergence is the only evidence of what the run looked like while it was still healthy,
   * and for a Cs sweep that deliberately removes stabilizing dissipation, that evidence is
   * the difference between "diverged" and "diverged, and here is how it got there".
   */
  | {
      type: 'stability';
      totalSteps: number;
      convectiveTimes: number;
      field: FieldStats;
      /** Wall-clock cost of this snapshot (readback + reduction), so its overhead is visible
       *  and the cadence can be justified from measurement rather than assumed cheap. */
      ms: number;
    }
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

/**
 * The teardown surface `quarantineRun` needs, structurally — not `RunState`, so the worker's
 * fatal path can be proven headlessly against fakes exactly as `stepOrLost` is.
 */
export interface QuarantineTarget {
  db: IDBDatabase;
  sim: { destroy(): void };
  gpu: { device: { destroy(): void } };
}

/**
 * Tear down everything a DIVERGED run could otherwise leave behind for the next rung.
 *
 * A ladder rung is only a controlled comparison if it starts from the same fresh state as
 * every other rung, and a run that ends in NaN has two ways to leak into its successor:
 *
 *  - **A poisoned checkpoint.** The 5-minute auto-save is unconditional, so a diverging run can
 *    persist NaN DDFs to IndexedDB, which survives navigation. `start(resume: false)` does
 *    clear checkpoints before running, so this is already covered — but it is covered by the
 *    NEXT rung remembering to, which is the wrong place for the guarantee. Clearing here makes
 *    the diverged run responsible for its own mess.
 *  - **GPU memory.** ~0.5 GB of DDF buffers at the 8M FP16 tier. Navigation does collect it
 *    with the worker, but not necessarily before the next rung requests its allocation, and an
 *    OOM there would look like a physics result.
 *
 * Every step is independently guarded and its failure swallowed. Two reasons, both load-bearing:
 * this runs on an already-failed path and must not replace a physics error message with a
 * teardown one; and a device that is already lost — the most likely way to get here — throws
 * from exactly these calls, so a single try block would let the first failure skip the rest.
 *
 * `clear` is injected (the worker passes `clearCheckpoints`) to keep this module free of the
 * IndexedDB glue while the fatal path stays testable.
 */
export async function quarantineRun(
  r: QuarantineTarget,
  clear: (db: IDBDatabase) => Promise<void>,
): Promise<void> {
  try {
    await clear(r.db);
  } catch {
    /* the next rung clears again on a fresh start */
  }
  try {
    r.sim.destroy();
  } catch {
    /* already gone */
  }
  try {
    r.gpu.device.destroy();
  } catch {
    /* already gone */
  }
}

/**
 * The Smagorinsky Cs the acceptance configuration is DEFINED at (M7's Re=10⁴ recipe, carried
 * into M9). Named rather than left as a bare 0.1 in `buildSim` for the same reason
 * `AHMED_EXPERIMENTAL_RE` is named: the Cd 0.285 verdict is only defined for this
 * configuration, so the page must be able to test "is this the acceptance configuration?"
 * rather than assume it.
 */
export const AHMED_LES_CS = 0.1;

/**
 * Default convective times between stability snapshots. Each is a whole-field `readMacro()`
 * (~128 MB at the 8M tier), so this is coarse on purpose; reduced-Cs rungs override it down
 * (see `AhmedRunOptions.fieldEveryTConv`).
 */
export const FIELD_SNAPSHOT_TCONV_DEFAULT = 20;

/**
 * The DDF storage precision criterion 1′ specifies ("with LES + FP16 storage"). A run at any
 * other precision is a diagnostic, exactly as a run at any other Re or Cs is.
 */
export const AHMED_ACCEPTANCE_PRECISION: Precision = 'fp16';

/** Ahmed 25° literature band (M9 acceptance 1): Cd = 0.285 ± 15% (stretch ± 10%). */
export const AHMED_CD_TARGET = 0.285;
export const AHMED_CD_BAND: [number, number] = [0.242, 0.328];
export const AHMED_CD_STRETCH: [number, number] = [0.257, 0.314];
