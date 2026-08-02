import { describe, expect, it } from 'vitest';
import { Solver3D } from '../src/cpu/solver3d.js';
import { sphereMask } from '../src/geometry/sphere.js';
import { CellType } from '../src/lattice.js';

/**
 * M7 step 2 acceptance: 3D momentum-exchange force (Mei, Yu, Shyy & Luo 2002), already
 * implemented in solver3d.ts. Two analytic oracles pin the sign, the magnitude, and the
 * symmetry:
 *
 *  - **Single-link, hand-computed.** For one isolated solid cell in a periodic box filled
 *    with equilibrium at uniform u, every one of its 18 neighbours bounces exactly one
 *    link. Summed, the halfway-BB contribution 2·e_opp(i)·f_opp(i) telescopes to
 *    Σ_i 2·e_i·f_i^eq(u) = 2ρu — twice the equilibrium momentum. Exact to round-off.
 *  - **Symmetric sphere at rest.** At u = 0 every f_i^eq = w_i·ρ is direction-symmetric, so
 *    the force on a reflection-symmetric sphere cancels to |F| = 0.
 *
 * (Momentum *balance* over a driven duct is separately covered by T-FORCE-3D in
 * solver3d.test.ts; these tests fix the absolute force, not just its conservation.)
 */
describe('3D momentum-exchange force (forces3d)', () => {
  it('single solid cell in equilibrium flow feels F = 2ρu (hand-computed)', () => {
    const N = 5;
    const flags = new Uint8Array(N * N * N);
    flags[2 + N * (2 + N * 2)] = CellType.Solid; // one isolated solid cell at the center
    const [ux, uy, uz] = [0.1, 0.05, -0.03];
    const solver = new Solver3D({
      nx: N,
      ny: N,
      nz: N,
      omega: 1 / 0.8,
      flags,
      periodicX: true,
      periodicY: true,
      periodicZ: true,
    });
    solver.reset(1, ux, uy, uz); // fSrc = equilibrium(ρ=1, u) everywhere
    solver.step(1); // force is accumulated from fSrc (pre-collision) during this step

    const F = solver.force;
    expect(F.x).toBeCloseTo(2 * ux, 12);
    expect(F.y).toBeCloseTo(2 * uy, 12);
    expect(F.z).toBeCloseTo(2 * uz, 12);
  });

  it('gives |F| = 0 on a symmetric sphere in a fluid at rest (u = 0)', () => {
    const N = 40;
    const c = N / 2;
    const flags = sphereMask(N, N, N, c, c, c, 8);
    const solver = new Solver3D({
      nx: N,
      ny: N,
      nz: N,
      omega: 1 / 0.8,
      flags,
      periodicX: true,
      periodicY: true,
      periodicZ: true,
    });
    solver.reset(1, 0, 0, 0);
    solver.step(1);

    const F = solver.force;
    expect(Math.hypot(F.x, F.y, F.z)).toBeLessThan(1e-12);
  });
});
