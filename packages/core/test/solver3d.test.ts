import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver3D } from '../src/cpu/solver3d.js';

/**
 * Square-duct Poiseuille series (H3 §3, corrected prefactor 4gH²/νπ³):
 * wall-anchored y,z ∈ [0,H]; overflow-safe cosh ratio.
 */
function ductSeries(y: number, z: number, H: number, g: number, nu: number): number {
  let sum = 0;
  for (let n = 1; n <= 101; n += 2) {
    const t = (n * Math.PI * Math.abs(z - H / 2)) / H;
    const T = (n * Math.PI) / 2;
    const ratio = (Math.exp(t - T) * (1 + Math.exp(-2 * t))) / (1 + Math.exp(-2 * T));
    sum += ((1 - ratio) * Math.sin((n * Math.PI * y) / H)) / (n * n * n);
  }
  return ((4 * g * H * H) / (nu * Math.PI ** 3)) * sum;
}

/** Solid shell on ±y and ±z faces (x periodic). */
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

describe('Solver3D (CPU reference, D3Q19)', () => {
  it('conserves mass exactly in a closed box', () => {
    const s = 10;
    const flags = new Uint8Array(s * s * s);
    const idx = (x: number, y: number, z: number) => x + s * (y + s * z);
    for (let z = 0; z < s; z++)
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          if (x === 0 || x === s - 1 || y === 0 || y === s - 1 || z === 0 || z === s - 1) {
            flags[idx(x, y, z)] = CellType.Solid;
          }
        }
    const solver = new Solver3D({ nx: s, ny: s, nz: s, omega: 1.2, flags });
    solver.reset(1, 0.03, 0, 0);
    const m0 = solver.totalMass();
    solver.step(200);
    expect(Math.abs(solver.totalMass() - m0) / m0).toBeLessThan(1e-12);
  });

  it('rejects fluid cells on a non-periodic boundary (shell invariant, H3 §2)', () => {
    expect(() => new Solver3D({ nx: 4, ny: 4, nz: 4, omega: 1.0 })).toThrow(/shell/);
  });

  it(
    'T-DUCT: matches the analytic square-duct series within 2% of the peak',
    { timeout: 60_000 },
    () => {
      const nx = 4;
      const ny = 14;
      const nz = 14;
      const H = ny - 2;
      const tau = 0.8;
      const nu = (tau - 0.5) / 3;
      const g = (0.02 * nu) / (0.2947 * (H / 2) * (H / 2)); // sizes u_center ≈ 0.02
      const solver = new Solver3D({
        nx,
        ny,
        nz,
        omega: 1 / tau,
        flags: ductFlags(nx, ny, nz),
        gravity: [g, 0, 0],
        periodicX: true,
        collision: 'trt',
      });
      const cIdx = solver.idx(0, ny / 2, nz / 2);
      let prev = Number.POSITIVE_INFINITY;
      for (let it = 0; it < 60; it++) {
        solver.step(1000);
        const { ux } = solver.macroscopics();
        if (Math.abs(ux[cIdx] - prev) / Math.abs(ux[cIdx]) < 1e-12) break;
        prev = ux[cIdx];
      }
      const { ux, uy, uz } = solver.macroscopics();
      const uPeak = ductSeries(H / 2, H / 2, H, g, nu);
      expect(uPeak).toBeGreaterThan(0.015); // sizing sanity: the 0.2947 anchor holds
      let maxErr = 0;
      for (let j = 1; j <= H; j++) {
        for (let k = 1; k <= H; k++) {
          const idx = solver.idx(1, j, k);
          const analytic = ductSeries(j - 0.5, k - 0.5, H, g, nu);
          maxErr = Math.max(maxErr, Math.abs(ux[idx] - analytic) / uPeak);
          // Transverse velocities: essentially zero, but finite-Ma LBM carries tiny
          // spurious corner currents (measured ~1e-5 of peak here) — gate at 1e-4·peak.
          expect(Math.abs(uy[idx])).toBeLessThan(1e-4 * uPeak);
          expect(Math.abs(uz[idx])).toBeLessThan(1e-4 * uPeak);
        }
      }
      expect(maxErr).toBeLessThan(0.02);
      // 4-fold symmetry of the profile (value-level, float-noise tolerance).
      for (let j = 1; j <= H / 2; j++) {
        expect(
          Math.abs(ux[solver.idx(1, j, nz / 2)] - ux[solver.idx(1, ny - 1 - j, nz / 2)]),
        ).toBeLessThan(1e-9);
        expect(Math.abs(ux[solver.idx(1, ny / 2, j)] - ux[solver.idx(1, j, nz / 2)])).toBeLessThan(
          1e-9,
        );
      }
    },
  );

  it(
    'T-FORCE-3D: two-step-averaged drag balances injected momentum (≤1e-6)',
    { timeout: 60_000 },
    () => {
      const nx = 8;
      const ny = 10;
      const nz = 10;
      const g = 1e-6;
      const flags = ductFlags(nx, ny, nz);
      const mask = new Uint8Array(nx * ny * nz);
      const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
      for (let y = 3; y <= 6; y++)
        for (let z = 3; z <= 6; z++) {
          flags[idx(4, y, z)] = CellType.Solid;
          mask[idx(4, y, z)] = 1;
        }
      const solver = new Solver3D({
        nx,
        ny,
        nz,
        omega: 1 / 0.8,
        flags,
        gravity: [g, 0, 0],
        periodicX: true,
        collision: 'trt',
        forceMask: mask,
      });
      let prevF = Number.POSITIVE_INFINITY;
      for (let it = 0; it < 60; it++) {
        solver.step(1000);
        const F = solver.force.x;
        if (Math.abs(F - prevF) / Math.abs(F) < 1e-11) break;
        prevF = F;
      }
      // Two-step average (staggered momentum mode — H2 §4a).
      const f1 = { ...solver.force };
      const m1 = { ...solver.maskedForce };
      solver.step(1);
      const Fx = 0.5 * (f1.x + solver.force.x);
      const Fy = 0.5 * (f1.y + solver.force.y);
      const Fz = 0.5 * (f1.z + solver.force.z);
      const Mx = 0.5 * (m1.x + solver.maskedForce.x);
      const { rho } = solver.macroscopics();
      let injected = 0;
      for (let c = 0; c < nx * ny * nz; c++) {
        if (flags[c] !== CellType.Solid) injected += rho[c] * g;
      }
      expect(Math.abs(Fx - injected) / injected).toBeLessThan(1e-6);
      expect(Mx).toBeGreaterThan(0);
      expect(Mx).toBeLessThan(Fx);
      expect(Math.abs(Fy)).toBeLessThan(1e-10 * Fx);
      expect(Math.abs(Fz)).toBeLessThan(1e-10 * Fx);
    },
  );
});
