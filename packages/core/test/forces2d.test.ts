import { describe, it, expect } from 'vitest';
import { Solver2D, cylinderScene, coefficient } from '../src/index.js';

/**
 * Momentum-exchange force validation (M4 step 10). The machine-precision global
 * momentum-balance identity (H2 §4) lives in solver2d.test.ts (T-FORCE); here we cover
 * the two force-specific checks: lift symmetry and a coarse steady-drag sanity value.
 *
 * All forces are TWO-CONSECUTIVE-STEP AVERAGES: forced/obstructed flows settle into an
 * exact period-2 staggered momentum eigenmode whose single-step force alternates ±
 * around the true value (H2 §4a).
 */

async function runScene(scene: ReturnType<typeof cylinderScene>, steps: number) {
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
  });
  solver.reset(1, scene.uLattice, 0);
  // Step in chunks, yielding to the event loop so vitest's reporter heartbeat isn't
  // starved by the long synchronous run (otherwise it raises an onTaskUpdate timeout).
  const target = steps - 1;
  const chunk = 500;
  for (let done = 0; done < target; done += chunk) {
    solver.step(Math.min(chunk, target - done));
    await new Promise((r) => setImmediate(r));
  }
  const f1 = { ...solver.maskedForce };
  solver.step(1);
  const f2 = { ...solver.maskedForce };
  return { fx: 0.5 * (f1.x + f2.x), fy: 0.5 * (f1.y + f2.y) };
}

describe('forces2d: symmetry', () => {
  // A perfectly symmetric cylinder (centre on an integer row, cyOffset = 0) must
  // produce zero lift: |Fy| ≤ 1e-10·|Fx| (M4 step 10b). Reduced grid for test speed;
  // symmetry is geometric, not resolution-dependent.
  it('produces zero lift for a symmetric cylinder', { timeout: 60_000 }, async () => {
    const scene = cylinderScene({ Re: 100, nx: 240, ny: 120, diameter: 20, cyOffset: 0 });
    const { fx, fy } = await runScene(scene, 500);
    expect(Math.abs(fx)).toBeGreaterThan(0); // drag is real
    expect(Math.abs(fy)).toBeLessThanOrEqual(1e-10 * Math.abs(fx));
  });
});

describe('forces2d: steady drag sanity (Re=20)', () => {
  // Re=20 cylinder is steady (no shedding); literature Cd ≈ 2.0. Coarse grid smoke
  // test, ±20 % gate (M4 step 10c). The tight quantitative gates run on GPU.
  it('gives Cd within ±20 % of 2.0 on a reduced grid', { timeout: 120_000 }, async () => {
    // Reduced from the spec's 512×170×20k for JS-CPU test speed (~35 s here); the
    // slightly higher 6.3 % blockage lifts Cd modestly but stays inside the ±20 % gate.
    const scene = cylinderScene({ Re: 20, nx: 320, ny: 128, diameter: 8 });
    const { fx } = await runScene(scene, 10_000);
    const cd = coefficient(fx, scene.uLattice, scene.diameter);
    expect(cd).toBeGreaterThan(2.0 * 0.8);
    expect(cd).toBeLessThan(2.0 * 1.2);
  });
});
