import { describe, expect, it } from 'vitest';
import { Solver2D, cylinderScene, coefficient } from '../src/index.js';

/**
 * H10 projected regularization (Latt & Chopard 2005) — solver-level acceptance.
 *
 * The unit-level projection identities (conservation, ghost-only, equilibrium fixed
 * point, LES composition) live in collide.test.ts (O1–O4). Here we prove the two things
 * that motivated the operator at the M6 scale:
 *   O5 — it holds a high-Re under-resolved flow that plain Smagorinsky-TRT cannot (the
 *        M5 divergence-by-Re≈3000 finding), and
 *   O6 — it does NOT perturb a well-resolved laminar flow that never needed it (the M5
 *        V6 non-interference gate, re-run as an M6 prerequisite).
 *
 * 2D cylinder is the reduced CI proxy; the 3D GPU kernel is a 1:1 transliteration gated
 * by ?parity3d (H6). CPU is the oracle either way.
 */

async function runCylinder(
  opts: { Re: number; nx: number; ny: number; diameter: number },
  steps: number,
  flags: { les: boolean; regularize: boolean },
) {
  const scene = cylinderScene(opts);
  const solver = new Solver2D({
    nx: scene.nx,
    ny: scene.ny,
    omega: scene.omega,
    flags: scene.flags,
    forceMask: scene.forceMask,
    inletVelocity: scene.uLattice,
    periodicY: true,
    collision: 'trt',
    lambda: 3 / 16,
    outlet: 'pressure',
    les: flags.les ? { cs: 0.1 } : undefined,
    regularize: flags.regularize,
  });
  solver.reset(1, scene.uLattice, 0);
  const chunk = 500;
  for (let done = 0; done < steps; done += chunk) {
    solver.step(Math.min(chunk, steps - done));
    await new Promise((r) => setImmediate(r));
  }
  const { ux, uy } = solver.macroscopics();
  let allFinite = true;
  let maxSpeed = 0;
  for (let i = 0; i < ux.length; i++) {
    if (!Number.isFinite(ux[i]) || !Number.isFinite(uy[i])) {
      allFinite = false;
      continue;
    }
    maxSpeed = Math.max(maxSpeed, Math.hypot(ux[i], uy[i]));
  }
  return { scene, solver, allFinite, maxSpeed };
}

describe('H10 regularization: O5 stability flip (under-resolved, LES off)', () => {
  // The demo3d failure mode exactly: plain TRT, LES OFF, under-resolved (D=12) at a Re
  // where τ≈0.503 sits just off the 0.5 floor. Only the collision operator differs
  // between the two runs. Plain TRT diverges to NaN; regularized TRT holds it at Ma≈0.16.
  // (Calibrated: at Re≥~1300 with τ→0.5 even regularization can't manufacture the missing
  // viscosity and both diverge — this is a ghost-mode filter, not a viscosity substitute.)
  const opts = { Re: 600, nx: 200, ny: 64, diameter: 12 } as const;

  it('plain TRT diverges here (control)', { timeout: 120_000 }, async () => {
    const r = await runCylinder(opts, 4_000, { les: false, regularize: false });
    const held = r.allFinite && r.maxSpeed < 0.3;
    expect(held).toBe(false); // NaN blow-up — the demo3d symptom
  });

  it('regularized TRT holds the same case finite and subsonic', { timeout: 120_000 }, async () => {
    const r = await runCylinder(opts, 4_000, { les: false, regularize: true });
    expect(r.allFinite).toBe(true);
    expect(r.maxSpeed).toBeLessThan(0.3); // bounded, Ma < 0.52 — no runaway
  });
});

describe('H10 regularization: O6 non-interference (M6 prerequisite gate)', () => {
  // The subgrid stabilizer must not pollute resolved laminar flow. Re=20 is steady (no
  // shedding), so its drag is a clean deterministic target: enabling regularization must
  // shift Cd by ≤3% — mirrors the M5 LES V6 gate (les.test.ts) for the new operator.
  it(
    'Re=20 cylinder Cd shifts by ≤3% when regularization is enabled',
    { timeout: 120_000 },
    async () => {
      const opts = { Re: 20, nx: 200, ny: 80, diameter: 8 } as const;
      const cd = async (regularize: boolean) => {
        const { solver, scene } = await runCylinder(opts, 6_000, { les: false, regularize });
        const f1 = { ...solver.maskedForce };
        solver.step(1);
        const f2 = { ...solver.maskedForce };
        return coefficient(0.5 * (f1.x + f2.x), scene.uLattice, scene.diameter);
      };
      const cdOff = await cd(false);
      const cdOn = await cd(true);
      expect(Math.abs(cdOn - cdOff) / cdOff).toBeLessThanOrEqual(0.03);
    },
  );
});
