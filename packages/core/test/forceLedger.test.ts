import { describe, expect, it } from 'vitest';
import { CellType, isSolid } from '../src/lattice.js';
import { Solver3D } from '../src/cpu/solver3d.js';

/**
 * M9 force audit — is the REPORTED drag the TRUE drag as τ₀ → ½?
 *
 * The Ahmed ladder reports Cd ≈ 3.5–4.0 against a band of [0.242, 0.328], and the error
 * appears as a STEP between the Re 1e4 (τ₀ = 0.501439) and Re 1e5 (τ₀ = 0.500144) rungs
 * rather than as a trend — the signature of a numerical threshold, not of resolution.
 * These tests separate two questions that the existing suite conflates:
 *
 *   1. Is the momentum-exchange FUNCTIONAL right?  → T-FORCE-LEDGER below. Yes, exactly.
 *   2. Is a single-parity SAMPLE of it the physical force? → T-STAGGER below. No — and it
 *      degrades catastrophically exactly where the Cd ladder steps.
 *
 * Neither question is reachable by the CPU/GPU force-parity gate: it compares the two
 * implementations at the SAME step and parity, and the staggered eigenmode moves both
 * identically (`Lbm3D.sampleForce` JSDoc). Parity can pass with both sides equally wrong.
 */

/** Solid shell on ±y and ±z faces (x periodic) — same duct as T-FORCE-3D (H2 §4). */
function ductFlags(nx: number, ny: number, nz: number): Uint8Array {
  const flags = new Uint8Array(nx * ny * nz);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (y === 0 || y === ny - 1 || z === 0 || z === nz - 1)
          flags[idx(x, y, z)] = CellType.Solid;
      }
  return flags;
}

const NX = 8;
const NY = 10;
const NZ = 10;
const G = 1e-6;

function ductWithBlock(): Uint8Array {
  const flags = ductFlags(NX, NY, NZ);
  const idx = (x: number, y: number, z: number) => x + NX * (y + NY * z);
  for (let y = 3; y <= 6; y++)
    for (let z = 3; z <= 6; z++) flags[idx(4, y, z)] = CellType.BodySolid;
  return flags;
}

function makeSolver(tau: number, cs: number, flags: Uint8Array): Solver3D {
  return new Solver3D({
    nx: NX,
    ny: NY,
    nz: NZ,
    omega: 1 / tau,
    flags,
    gravity: [G, 0, 0],
    periodicX: true,
    collision: 'trt',
    forcing: 'guo',
    ...(cs > 0 ? { les: { cs } } : {}),
  });
}

/**
 * Raw first moment Σ_fluid Σ_i e_ix·f_i and fluid mass Σ_fluid ρ.
 * `macroscopics()` reports the Guo-corrected velocity (moment/ρ − g/2), so the raw
 * moment is recovered as ρ·(ux + g/2) — the ledger is a statement about the raw moment.
 */
function rawMomentX(solver: Solver3D, flags: Uint8Array): { m: number; mass: number } {
  const { rho, ux } = solver.macroscopics();
  let m = 0;
  let mass = 0;
  for (let c = 0; c < NX * NY * NZ; c++) {
    if (isSolid(flags[c])) continue;
    m += rho[c] * (ux[c] + 0.5 * G);
    mass += rho[c];
  }
  return { m, mass };
}

/**
 * The τ ladder is the Ahmed Cd ladder's own τ₀ values (docs/private/milestones/M9.md),
 * so a number measured here is directly comparable to a rung there.
 *   0.8      — the τ at which H2 §4a originally measured the staggered mode (0.1%)
 *   0.514394 — Re 1e3   (Cd 1.0661, σ 0.0012 — the believable rung)
 *   0.501439 — Re 1e4   (Cd 0.9971, σ 0.1417)
 *   0.500144 — Re 1e5   (Cd 3.6989, σ 1.0091 — the step)
 *   0.500003 — Re 4.29e6 (Cd 3.9873, σ 1.0464 — the acceptance Re)
 */
const TAU_LADDER = [0.8, 0.514394, 0.501439, 0.500144, 0.500003] as const;
const CASES = TAU_LADDER.flatMap((tau) => [
  { tau, cs: 0 },
  { tau, cs: 0.1 },
]);

describe('momentum-exchange force: functional vs sample (M9 audit)', () => {
  /**
   * T-FORCE-LEDGER — the per-step momentum ledger, exact at EVERY step.
   *
   *   M(t+1) − M(t) + F_x(t) == g · Σ_fluid ρ(t+1)
   *
   * where M is the raw first moment and F_x is the momentum-exchange accumulator.
   * Derivation: streaming conserves the moment except at bounce-back links, where the
   * population that would have entered the solid is removed (−e_ī·f*_ī) and its reflection
   * appears (+e_i·f*_ī = −e_ī·f*_ī) — a change of exactly −2·e_ī·f*_ī, which is the link's
   * force contribution (H2 §1). Collision then adds exactly ρg per fluid cell, "for any τ,
   * any Λ, LES on or off" (H1 §4).
   *
   * Why this and not the existing steady-state T-FORCE-3D (H2 §4, solver3d.test.ts):
   * that form requires a converged state, and convergence is diffusive — O(H²/ν) steps,
   * ≈1e6 at τ₀ = 0.500003. It therefore cannot be run at the acceptance τ at all, which is
   * why the force functional had never been tested in the regime where Cd goes wrong.
   * The unsteady form holds from rest, so 200 steps suffice at any τ.
   *
   * Gate 1e-9; measured ~2e-12 (Float64 roundoff over ~500 fluid cells).
   */
  it.each(CASES)('T-FORCE-LEDGER: balances at every step (τ₀=$tau, Cs=$cs)', ({ tau, cs }) => {
    const flags = ductWithBlock();
    const solver = makeSolver(tau, cs, flags);
    solver.step(200);

    let worst = 0;
    for (let k = 0; k < 8; k++) {
      const before = rawMomentX(solver, flags);
      solver.step(1);
      const after = rawMomentX(solver, flags);
      const injected = G * after.mass;
      const residual = after.m - before.m + solver.force.x - injected;
      worst = Math.max(worst, Math.abs(residual / injected));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  /**
   * T-STAGGER — the period-2 staggered momentum eigenmode vs τ₀.
   *
   * H2 §4a measured this mode at ±0.1% at τ=0.8 and derived the rule "**All reported
   * forces are two-consecutive-step averages**", noting that a `forceAveraged()` helper
   * would be wanted "when the GPU force plumbing lands". It landed without one:
   * `Lbm3D.sampleForce` returns the instantaneous single-parity force and `ahmedWorker`
   * samples on a fixed EVEN interval, so every Ahmed sample lands on the same parity.
   * The JSDoc argues the mode aliases to a constant offset "removed by downstream mean
   * subtraction" — true for an amplitude (Cl, St), false for a mean Cd, which IS a DC
   * quantity.
   *
   * The 0.1% figure was never extrapolated. It is not a constant: the mode is damped by
   * ω⁻ = 1/(½ + Λ/(τ_eff−½)), which collapses as τ₀ → ½. Interleaved subsequences are
   * compared (steps 0,2,4,6 vs 1,3,5,7), so a smooth trend cancels and only a genuine
   * period-2 oscillation survives.
   *
   * This test asserts the DEFECT, not a target. It is a record of measured behaviour: if
   * the low-τ assertions start failing, something changed the mode's damping or the
   * sampling — investigate before celebrating (the H2 §4a instruction).
   */
  it.each(CASES)(
    'T-STAGGER: single-parity force error grows as τ₀→½ (τ₀=$tau, Cs=$cs)',
    ({ tau, cs }) => {
      const flags = ductWithBlock();
      const solver = makeSolver(tau, cs, flags);
      solver.step(200);

      const fs: number[] = [];
      for (let k = 0; k < 8; k++) {
        solver.step(1);
        fs.push(solver.force.x);
      }
      const even = (fs[0] + fs[2] + fs[4] + fs[6]) / 4;
      const odd = (fs[1] + fs[3] + fs[5] + fs[7]) / 4;
      const pairAveraged = 0.5 * (even + odd);
      const staggerRel = Math.abs((even - pairAveraged) / pairAveraged);

      // Measured 2026-08-07 (Float64, this scene):
      //   τ₀ 0.8      → 1.04e-3   (reproduces H2 §4a's 0.1%)
      //   τ₀ 0.514394 → 4.86e-3
      //   τ₀ 0.501439 → 1.57e-1   ← Cd ladder still sane here (0.9971)
      //   τ₀ 0.500144 → 5.19e-1   ← Cd ladder steps to 3.6989 here
      //   τ₀ 0.500003 → 6.04e-1   ← acceptance Re; parities differ by 4.05×
      if (tau > 0.51) {
        expect(staggerRel).toBeLessThan(1e-2);
      } else {
        // Below τ₀ ≈ 0.5015 a single-parity reading is not a measurement of the force.
        expect(staggerRel).toBeGreaterThan(0.1);
      }
      if (tau <= 0.5002) expect(staggerRel).toBeGreaterThan(0.5);
    },
  );

  /**
   * The mode is a SAMPLING artefact, not a force-functional error: at a converged state
   * the two-step average recovers the exact injected momentum (the H2 §4 identity) while
   * either single-parity reading misses it. τ=0.8 is the only ladder point that reaches
   * steady state in feasible time, which is precisely why the defect stayed invisible.
   */
  it(
    'T-STAGGER-CURE: pair-averaging recovers the exact balance where single-parity does not',
    { timeout: 60_000 },
    () => {
      const flags = ductWithBlock();
      const solver = makeSolver(0.8, 0, flags);
      let prev = Number.POSITIVE_INFINITY;
      for (let it = 0; it < 60; it++) {
        solver.step(1000);
        const f = solver.force.x;
        if (Math.abs(f - prev) / Math.abs(f) < 1e-11) break;
        prev = f;
      }
      const f1 = solver.force.x;
      solver.step(1);
      const f2 = solver.force.x;
      const { mass } = rawMomentX(solver, flags);
      const injected = G * mass;

      expect(Math.abs(0.5 * (f1 + f2) - injected) / injected).toBeLessThan(1e-6);
      // Negative control: each single-parity reading really is off (H2 §4a).
      expect(Math.abs(f1 - injected) / injected).toBeGreaterThan(1e-5);
      expect(Math.abs(f2 - injected) / injected).toBeGreaterThan(1e-5);
    },
  );
});
