import { describe, it, expect } from 'vitest';
import { CellType, D2Q9, Solver2D, cylinderScene, coefficient } from '../src/index.js';

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

/**
 * fix-confirmed-physics-defects, solver-failure-visibility: moving-wall momentum exchange
 * must include the Ladd wall-velocity term (PHYSICS.md §8's F_link = e_ī·(f̃_ī(t)+f_i(t+1)))
 * in the FORCE, not just in the returning population. The pre-fix code used `2*ex[ib]*base`
 * — correct only when streamed === base, i.e. only at zero wall velocity.
 *
 * The expected delta is derived independently of solver2d.ts's own formula: at t=0 every
 * population is at rest equilibrium (f_i = w_i for all i, since rho=1, u=0), so for a link
 * bouncing off a wall moving at (uLid, 0), `base = w_ib = w_i` (D2Q9 opposite-direction
 * weights are equal) and `streamed = w_i + 6*w_i*ex[i]*uLid`. Summed by hand over the three
 * directions whose neighbor is the moving top wall (N, NE, NW: i = 2, 5, 6).
 */
describe('forces2d: moving-wall momentum exchange (Ladd term)', () => {
  it('the force on a moving wall differs from a stationary one by the independently-derived Ladd delta', () => {
    const nx = 5;
    const ny = 5;
    const n = nx * ny;
    const idx = (x: number, y: number) => y * nx + x;
    const flags = new Uint8Array(n).fill(CellType.Fluid);
    for (let x = 0; x < nx; x++) {
      flags[idx(x, 0)] = CellType.BodySolid;
      flags[idx(x, ny - 1)] = CellType.BodySolid;
    }
    for (let y = 0; y < ny; y++) {
      flags[idx(0, y)] = CellType.BodySolid;
      flags[idx(nx - 1, y)] = CellType.BodySolid;
    }

    const uLid = 0.02;
    const wallVelocityMoving = new Float64Array(2 * n);
    for (let x = 0; x < nx; x++) {
      wallVelocityMoving[2 * idx(x, ny - 1)] = uLid;
    }
    const wallVelocityStationary = new Float64Array(2 * n); // all zero

    function forceAfterOneStep(wallVelocity: Float64Array) {
      const solver = new Solver2D({ nx, ny, omega: 1.0, flags, wallVelocity });
      solver.reset(1, 0, 0); // rest equilibrium: f_i = w_i everywhere
      solver.step(1);
      return solver.force;
    }

    const moving = forceAfterOneStep(wallVelocityMoving);
    const stationary = forceAfterOneStep(wallVelocityStationary);

    // Independently-derived expected delta. Per fluid cell touching the moving wall, the
    // three directions whose PULL SOURCE is the wall row (S=4, SW=7, SE=8 — ey[i] = −1,
    // since sy = y − ey[i] must land on the wall row above) bounce back with ib = opp(i)
    // (N=2, NE=5, NW=6). The force contribution is ex[ib]/ey[ib] * (base + streamed), so
    // the wall-velocity term's contribution per direction is ex[ib] * 6*w[i]*ex[i]*uLid
    // (Fx) / ey[ib] * 6*w[i]*ex[i]*uLid (Fy) — using i's own ex/ey in the Ladd term, ib's
    // in the force projection. nx-2 fluid cells sit under the top wall row (the two corner
    // columns are solid), each contributing identically at t=0's uniform rest equilibrium.
    const fluidCellsUnderWall = nx - 2;
    let expectedDeltaFxPerCell = 0;
    let expectedDeltaFyPerCell = 0;
    for (const i of [4, 7, 8]) {
      const ib = D2Q9.opp[i];
      const ladd = 6 * D2Q9.w[i] * D2Q9.ex[i] * uLid;
      expectedDeltaFxPerCell += D2Q9.ex[ib] * ladd;
      expectedDeltaFyPerCell += D2Q9.ey[ib] * ladd;
    }
    const expectedDeltaFx = fluidCellsUnderWall * expectedDeltaFxPerCell;
    const expectedDeltaFy = fluidCellsUnderWall * expectedDeltaFyPerCell;

    expect(moving.x - stationary.x).toBeCloseTo(expectedDeltaFx, 12);
    expect(moving.y - stationary.y).toBeCloseTo(expectedDeltaFy, 12);
    // The delta must be non-trivial, or this test would pass vacuously.
    expect(Math.abs(expectedDeltaFx)).toBeGreaterThan(1e-6);

    // Regression guard: at zero wall velocity the corrected formula must reproduce the
    // pre-fix stationary-wall value exactly (base + streamed === 2*base there).
    const noWallVelOption = (() => {
      const solver = new Solver2D({ nx, ny, omega: 1.0, flags }); // wallVelocity omitted
      solver.reset(1, 0, 0);
      solver.step(1);
      return solver.force;
    })();
    expect(stationary.x).toBeCloseTo(noWallVelOption.x, 15);
    expect(stationary.y).toBeCloseTo(noWallVelOption.y, 15);
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
