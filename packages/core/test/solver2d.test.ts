import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver2D, type Solver2DOptions } from '../src/cpu/solver2d.js';

function channelFlags(nx: number, ny: number): Uint8Array {
  const flags = new Uint8Array(nx * ny);
  for (let x = 0; x < nx; x++) {
    flags[x] = CellType.Solid;
    flags[(ny - 1) * nx + x] = CellType.Solid;
  }
  return flags;
}

/**
 * Body-force channel run to steady state; returns max pointwise deviation from the
 * analytic Poiseuille parabola, relative to the analytic peak (H1 §6 T1 protocol).
 */
function poiseuilleMaxRelError(tau: number, opts: Partial<Solver2DOptions>): number {
  const nx = 4;
  const ny = 10;
  const H = ny - 2;
  const nu = (tau - 0.5) / 3;
  const uTarget = 0.02;
  const g = (8 * nu * uTarget) / (H * H);
  const solver = new Solver2D({
    nx,
    ny,
    omega: 1 / tau,
    flags: channelFlags(nx, ny),
    gravity: [g, 0],
    periodicX: true,
    ...opts,
  });
  const cIdx = solver.idx(nx / 2, Math.floor(ny / 2));
  let prev = Number.POSITIVE_INFINITY;
  for (let it = 0; it < 800; it++) {
    solver.step(500);
    const { ux } = solver.macroscopics();
    const center = ux[cIdx];
    if (Math.abs(center - prev) / Math.abs(center) < 1e-13) break;
    prev = center;
  }
  const { ux } = solver.macroscopics();
  const uMax = (g * H * H) / (8 * nu);
  let maxErr = 0;
  for (let j = 1; j <= H; j++) {
    const y = j - 0.5;
    const analytic = (g / (2 * nu)) * y * (H - y);
    const err = Math.abs(ux[solver.idx(nx / 2, j)] - analytic) / uMax;
    if (err > maxErr) maxErr = err;
  }
  return maxErr;
}

describe('Solver2D (CPU reference)', () => {
  it('conserves mass exactly in a closed box', () => {
    const nx = 24;
    const ny = 24;
    const flags = new Uint8Array(nx * ny);
    for (let x = 0; x < nx; x++) {
      flags[x] = CellType.Solid;
      flags[(ny - 1) * nx + x] = CellType.Solid;
    }
    for (let y = 0; y < ny; y++) {
      flags[y * nx] = CellType.Solid;
      flags[y * nx + nx - 1] = CellType.Solid;
    }
    const solver = new Solver2D({ nx, ny, omega: 1.2, flags });
    solver.reset(1, 0.03, 0);
    const m0 = solver.totalMass();
    solver.step(300);
    const m1 = solver.totalMass();
    expect(Math.abs(m1 - m0) / m0).toBeLessThan(1e-12);
  });

  it('reproduces the analytic Poiseuille profile with BGK at moderate τ (legacy 2% gate)', () => {
    expect(poiseuilleMaxRelError(0.8, { collision: 'bgk' })).toBeLessThan(0.02);
  });

  it('V1: TRT(Λ=3/16)+Guo is τ-INDEPENDENT — ≤1e-4 of u_max at every τ', () => {
    // The headline M2 gate (docs/VALIDATION.md V1; docs/handoff/H1 §6 T1).
    for (const tau of [0.51, 0.6, 0.8, 1.0, 1.5]) {
      const err = poiseuilleMaxRelError(tau, { collision: 'trt' });
      expect(err, `τ=${tau}`).toBeLessThan(1e-4);
    }
  });

  it('V1 negative control: plain BGK FAILS the 1e-4 gate at high τ (the test can detect the defect TRT fixes)', () => {
    const err = poiseuilleMaxRelError(1.5, { collision: 'bgk' });
    expect(err).toBeGreaterThan(5e-4);
  });

  it('LES: cs→0 recovers the exact TRT profile; cs=0.1 perturbs shear physics only mildly', () => {
    // A per-cell τ_eff(shear) legitimately deviates the profile from the parabola —
    // the gates check continuity (cs→0) and boundedness (≤1%), per H1 §6 T3 (amended).
    expect(poiseuilleMaxRelError(0.8, { collision: 'trt', les: { cs: 1e-6 } })).toBeLessThan(1e-4);
    const withLes = poiseuilleMaxRelError(0.8, { collision: 'trt', les: { cs: 0.1 } });
    expect(withLes).toBeLessThan(0.01);
    expect(withLes).toBeGreaterThan(1e-6); // and it genuinely does something in shear
  });

  it(
    'T-FORCE: momentum-exchange drag balances the injected body force exactly (≤1e-6)',
    { timeout: 30_000 },
    () => {
      // Machine-precision identity oracle — H2 §4. Forced periodic channel + plate.
      const nx = 12;
      const ny = 14;
      const g = 1e-6;
      const flags = channelFlags(nx, ny);
      const mask = new Uint8Array(nx * ny);
      for (let y = 4; y <= 9; y++) {
        flags[y * nx + 6] = CellType.Solid;
        mask[y * nx + 6] = 1;
      }
      const solver = new Solver2D({
        nx,
        ny,
        omega: 1 / 0.8,
        flags,
        gravity: [g, 0],
        periodicX: true,
        collision: 'trt',
        forceMask: mask,
      });
      let prevF = Number.POSITIVE_INFINITY;
      for (let it = 0; it < 400; it++) {
        solver.step(500);
        const F = solver.force.x;
        if (Math.abs(F - prevF) / Math.abs(F) < 1e-12) break;
        prevF = F;
      }
      // Forced flows with bounce-back settle into an exact period-2 staggered momentum
      // cycle (H2 §6a): the physical force is the TWO-STEP AVERAGE. Single-step F sits
      // ~1e-3 off Mg on this setup; the pair average is exact to ~1e-12.
      const s1 = { f: { ...solver.force }, m: { ...solver.maskedForce } };
      solver.step(1);
      const s2 = { f: { ...solver.force }, m: { ...solver.maskedForce } };
      const Fx = 0.5 * (s1.f.x + s2.f.x);
      const Fy = 0.5 * (s1.f.y + s2.f.y);
      const Mx = 0.5 * (s1.m.x + s2.m.x);
      const { rho } = solver.macroscopics();
      let injected = 0;
      for (let idx = 0; idx < nx * ny; idx++) {
        if (flags[idx] !== CellType.Solid) injected += rho[idx] * g;
      }
      expect(Math.abs(Fx - injected) / injected).toBeLessThan(1e-6);
      // ...and the single-step reading really is off by ~1e-3 (documents the staggered
      // mode; if this ever "passes" at 1e-6 single-step, the mode got damped — fine,
      // but investigate what changed):
      expect(Math.abs(s1.f.x - injected) / injected).toBeGreaterThan(1e-5);
      expect(Mx).toBeGreaterThan(0); // the plate feels drag
      expect(Mx).toBeLessThan(Fx); // walls carry the rest
      expect(Math.abs(Fy)).toBeLessThan(1e-10 * Fx); // symmetric geometry (f64 noise floor)
    },
  );

  it('develops uniform flow between inlet and outlet in an empty tunnel', () => {
    const nx = 48;
    const ny = 16;
    const uin = 0.05;
    const flags = new Uint8Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      flags[y * nx] = CellType.Inlet;
      flags[y * nx + nx - 1] = CellType.Outlet;
    }
    const solver = new Solver2D({ nx, ny, omega: 1.0, flags, inletVelocity: uin, periodicY: true });
    solver.reset(1, uin, 0);
    solver.step(2000);
    const { ux, uy } = solver.macroscopics();
    for (let y = 0; y < ny; y++) {
      for (let x = 1; x < nx - 1; x++) {
        expect(Math.abs(ux[solver.idx(x, y)] - uin)).toBeLessThan(1e-6);
        expect(Math.abs(uy[solver.idx(x, y)])).toBeLessThan(1e-8);
      }
    }
  });
});
