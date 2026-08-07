import { CellType } from '@aeroflow/core';
import { Lbm3D } from '../sim/lbm3d';

/**
 * `Lbm3D.forceAveraged` semantics gate (M9 force audit, step 0.1).
 *
 * `forceAveraged(k)` replaced `sampleForce(k)` as the Ahmed run's force source after the
 * single-parity sampling defect was found (H2 §4a; `packages/core/test/ahmedForceSampling.test.ts`).
 * Nothing tested the replacement. The CPU↔GPU force gate in `parity3d.ts` cannot: it
 * compares one implementation against the other at the SAME step and parity, and the
 * staggered momentum eigenmode moves both identically — parity passes with both sides
 * equally wrong. So this file checks the method against ITSELF, which is where its
 * contract actually lives.
 *
 * The contract, restated from the JSDoc:
 *
 *   1. It advances EXACTLY `k` steps — it is a drop-in for `sampleForce(k)` and no
 *      caller's step bookkeeping shifts.
 *   2. It averages the LAST TWO of those steps, which are consecutive and therefore of
 *      OPPOSITE parity — for every `k ≥ 2`, odd or even.
 *   3. Both steps are really collected (two reduce slots), not one step read twice.
 *
 * ## How this is proved without reaching into the class
 *
 * Each case is run twice from an identical reset:
 *
 *   A. `submitSteps(WARM)` then `forceAveraged(k)`
 *   B. `submitSteps(WARM)` then `submitSteps(k−2)` then `sampleForce(1)`, `sampleForce(1)`
 *
 * B produces the two single-step forces at the same two timesteps A collects, by a path
 * that shares no code with A's slot routing. A must equal their mean.
 *
 * That single comparison closes all three clauses at once, PROVIDED the two steps disagree
 * — which is why half the cases run at τ₀ = 0.500144, the Ahmed Re 1e5 rung, where the
 * staggered mode makes consecutive forces differ by tens of percent. There:
 *
 *   - if `forceAveraged` collected the wrong pair, or the same step twice, its answer would
 *     sit ~`stagger`/2 away from the mean — percent-level, not the 1e-6 bar;
 *   - if it advanced the wrong number of steps, `totalSteps` catches it directly.
 *
 * The τ = 0.8 cases are the control: there the mode is ~0.1% and the comparison is nearly
 * vacuous, so `staggerRel` is reported for both and ASSERTED to be large only at the low τ.
 * A low-τ case whose stagger collapses means something changed the mode's damping — the
 * H2 §4a instruction is to investigate that before celebrating, not to relax the gate.
 */

/** Duct + measured cube. Small on purpose: this gate is about bookkeeping, not physics. */
const N = 16;
/** Steps before measuring, matching `packages/core/test/forceLedger.test.ts`. */
const WARM = 200;

/**
 * Two rungs of the τ ladder in `forceLedger.test.ts` (which is the Ahmed ladder's own τ₀
 * set): the benign one H2 §4a originally measured, and the Re 1e5 rung where the Cd ladder
 * stepped and where a single-parity reading is ~52% wrong.
 */
const TAUS = [0.8, 0.500144] as const;
/** Odd AND even `k`. The pair is the last two steps either way — that is the claim. */
const KS = [2, 3, 4, 5] as const;

/**
 * `forceAveraged` and the replay run the identical kernel on identical data in the
 * identical dispatch order, so they are expected to agree BITWISE; `collectForces` gates
 * only whether `cellForce` is written, never the physics. The bar is nonetheless relative
 * rather than exact, so a driver that legitimately reorders a tree-reduce across command
 * buffers does not produce a red gate for a correct implementation. Any real defect in the
 * clauses above is percent-level at the low-τ rung — six orders of magnitude clear of this.
 */
const SEMANTICS_BAR = 1e-6;

/**
 * Below this, the low-τ cases are not proving anything and the gate has gone vacuous.
 * `forceLedger.test.ts` measures 5.19e-1 at this τ₀ on the CPU duct; 0.1 is a floor with
 * room for a different scene and fp32, not a target.
 */
const STAGGER_FLOOR = 0.1;

export interface ForceAveragedCase {
  tau: number;
  k: number;
  /** `forceAveraged(k)` — the value under test. */
  paired: { x: number; y: number; z: number };
  /** Mean of the two independently sampled single-step forces (the reference). */
  replayMean: { x: number; y: number; z: number };
  /** ‖paired − replayMean‖ / ‖replayMean‖. */
  relErr: number;
  /** ‖f₂ − f₁‖ / ‖replayMean‖ — the staggered-mode amplitude, i.e. the gate's leverage. */
  stagger: number;
  /** `totalSteps` after the call; must be WARM + k. */
  totalSteps: number;
  /** `currentParity` after the call; must be (WARM + k) % 2. */
  parity: 0 | 1;
  stepsOk: boolean;
  parityOk: boolean;
  /** Only asserted at the low-τ rung, where the mode is large. */
  staggerOk: boolean;
  pass: boolean;
}

export interface ForceAveragedReport {
  cases: ForceAveragedCase[];
  pass: boolean;
  /** One-line summaries, in the shape the parity panel already publishes. */
  lines: string[];
  gpuErrors: string[];
}

/** Solid y/z shell, inlet x=0, outlet x=nx−1, BodySolid cube (the only measured object). */
function ductFlags(n: number): Uint8Array {
  const flags = new Uint8Array(n * n * n);
  const idx = (x: number, y: number, z: number) => x + n * (y + n * z);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (y === 0 || y === n - 1 || z === 0 || z === n - 1) flags[idx(x, y, z)] = CellType.Solid;
        else if (x === 0) flags[idx(x, y, z)] = CellType.Inlet;
        else if (x === n - 1) flags[idx(x, y, z)] = CellType.Outlet;
      }
  // Kept clear of x = n−2 so no solid sits directly upstream of the outlet (H4 §10.9).
  const c = Math.floor(n / 3);
  for (let z = c; z < c + 3; z++)
    for (let y = c; y < c + 3; y++)
      for (let x = c; x < c + 3; x++) flags[idx(x, y, z)] = CellType.BodySolid;
  return flags;
}

type Vec = { x: number; y: number; z: number };
const norm = (v: Vec): number => Math.hypot(v.x, v.y, v.z);
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mean = (a: Vec, b: Vec): Vec => ({
  x: 0.5 * (a.x + b.x),
  y: 0.5 * (a.y + b.y),
  z: 0.5 * (a.z + b.z),
});

export async function runForceAveragedSemantics(device: GPUDevice): Promise<ForceAveragedReport> {
  const flags = ductFlags(N);
  const gpuErrors: string[] = [];
  const onErr = (e: Event) => gpuErrors.push(String((e as GPUUncapturedErrorEvent).error.message));
  device.addEventListener('uncapturederror', onErr);

  const cases: ForceAveragedCase[] = [];
  try {
    for (const tau of TAUS) {
      // The M9 production recipe. τ₀ = 0.500144 sits on the stability floor, so LES +
      // regularization are what keep the low rung a measurement rather than a NaN — and
      // they are also what the Ahmed run uses, so the mode being probed is the real one.
      const gpu = new Lbm3D(device, {
        nx: N,
        ny: N,
        nz: N,
        omega: 1 / tau,
        inletVel: 0.05,
        collision: 'trt',
        regularize: true,
        conserveMass: true,
        les: { cs: 0.1 },
        forces: true,
        precision: 'fp32', // fp16 storage noise would swamp a 1e-6 bar
      });
      try {
        gpu.flags.set(flags);
        gpu.uploadFlags();

        for (const k of KS) {
          // A — the method under test.
          gpu.reset(1, 0, 0, 0);
          gpu.submitSteps(WARM);
          const paired = await gpu.forceAveraged(k);
          const totalSteps = gpu.totalSteps;
          const parity = gpu.currentParity;

          // B — the same two timesteps, reached by a path that shares none of A's slot
          // routing. `reset` restores parity and totalSteps to 0, so this is the same
          // trajectory, not merely a similar one.
          gpu.reset(1, 0, 0, 0);
          gpu.submitSteps(WARM);
          if (k > 2) gpu.submitSteps(k - 2);
          const f1 = await gpu.sampleForce(1);
          const f2 = await gpu.sampleForce(1);

          const a = { x: paired.fx, y: paired.fy, z: paired.fz };
          const v1 = { x: f1.fx, y: f1.fy, z: f1.fz };
          const v2 = { x: f2.fx, y: f2.fy, z: f2.fz };
          const replayMean = mean(v1, v2);
          const denom = Math.max(norm(replayMean), 1e-30);
          const relErr = norm(sub(a, replayMean)) / denom;
          const stagger = norm(sub(v2, v1)) / denom;

          const stepsOk = totalSteps === WARM + k;
          const parityOk = parity === (WARM + k) % 2;
          // Only the low-τ rung carries the leverage; at τ=0.8 the mode is ~0.1% by
          // design and a stagger assertion there would be asserting the control.
          const staggerOk = tau > 0.51 ? true : stagger > STAGGER_FLOOR;

          cases.push({
            tau,
            k,
            paired: a,
            replayMean,
            relErr,
            stagger,
            totalSteps,
            parity,
            stepsOk,
            parityOk,
            staggerOk,
            pass: stepsOk && parityOk && staggerOk && relErr <= SEMANTICS_BAR,
          });
        }
      } finally {
        gpu.destroy();
      }
    }
  } finally {
    device.removeEventListener('uncapturederror', onErr);
  }

  const pass = cases.every((c) => c.pass) && gpuErrors.length === 0;
  const lines = cases.map(
    (c) =>
      `${c.pass ? 'PASS' : 'FAIL'} forceAveraged τ₀=${c.tau} k=${c.k}: ` +
      `rel=${c.relErr.toExponential(2)} (bar ${SEMANTICS_BAR.toExponential(0)}) ` +
      `stagger=${c.stagger.toExponential(2)} steps=${c.totalSteps}${c.stepsOk ? '' : '!'} ` +
      `parity=${c.parity}${c.parityOk ? '' : '!'}`,
  );
  return { cases, pass, lines, gpuErrors };
}
