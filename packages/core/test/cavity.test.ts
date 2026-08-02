import { describe, expect, it } from 'vitest';
import { Solver2D } from '../src/cpu/solver2d.js';
import { GHIA_U, GHIA_V, interpProfile } from '../src/fixtures/ghia.js';
import { cavityScene2D } from '../src/scenes/cavity2d.js';
import { cavityCenterlines } from '../src/validation/cavity.js';

/**
 * M3 — lid-driven cavity vs Ghia, Ghia & Shin 1982 (docs/handoff/H9-fixtures-ghia.md).
 *
 * Proves the moving-wall halfway bounce-back BC (Solver2D `wallVelocity`). Run at
 * H=64 for CI speed with the resolution-fair metric: interpolate the SIM centerline
 * to Ghia's coordinates and take the max absolute deviation. Calibration across
 * H=64/96/128 (recorded in the M3 status) shows the extrema converge monotonically
 * to Ghia (u_min −0.2074→−0.2096→−0.2108 vs −0.2109), i.e. the physics is correct and
 * merely under-resolved at H=64. The headline ±1.5%@256² gate (V2) is a GPU
 * validation-page run, not this unit test.
 */
function runCavityRe100(H: number): {
  simY: number[];
  simU: number[];
  simX: number[];
  simV: number[];
} {
  // The shared M3 scene builder — the SAME one the GPU acceptance runs use, so this test
  // is what keeps the two paths on one geometry/τ convention.
  const { nx, ny, flags, wallVelocity, omega, uLid } = cavityScene2D({ H, Re: 100 });
  const idx = (x: number, y: number) => y * nx + x;

  const s = new Solver2D({
    nx,
    ny,
    omega,
    flags,
    collision: 'trt',
    wallVelocity,
  });

  // Run to steady state (centerline convergence).
  const probe = idx(Math.floor(nx / 2), Math.floor(ny / 2));
  let prev = 1e9;
  for (let it = 0; it < 100; it++) {
    s.step(2000);
    const c = s.macroscopics().ux[probe];
    if (Math.abs(c - prev) < 1e-9 * Math.max(1e-6, Math.abs(c))) break;
    prev = c;
  }

  const { ux, uy } = s.macroscopics();
  // Shared centreline extraction (nodes at (j−0.5)/H, central columns averaged).
  const lines = cavityCenterlines(ux, uy, H, uLid);
  return { simY: lines.y, simU: lines.u, simX: lines.x, simV: lines.v };
}

describe('M3 lid-driven cavity vs Ghia 1982 (Re=100)', () => {
  // 60 s, not 30 s: the run is ~24 s standalone but the full suite saturates the CPU and
  // pushes it over a 30 s bar (a spurious timeout, not a physics failure).
  it('reproduces both centerline profiles and the primary vortex', { timeout: 60_000 }, () => {
    const { simY, simU, simX, simV } = runCavityRe100(64);

    // u along the vertical centerline vs Ghia Table I.
    let maxUErr = 0;
    for (let k = 0; k < GHIA_U.y.length; k++) {
      const yq = GHIA_U.y[k];
      if (yq <= simY[0] || yq >= simY[simY.length - 1]) continue;
      maxUErr = Math.max(maxUErr, Math.abs(interpProfile(simY, simU, yq) - GHIA_U.re100[k]));
    }
    // v along the horizontal centerline vs Ghia Table II.
    let maxVErr = 0;
    for (let k = 0; k < GHIA_V.x.length; k++) {
      const xq = GHIA_V.x[k];
      if (xq <= simX[0] || xq >= simX[simX.length - 1]) continue;
      maxVErr = Math.max(maxVErr, Math.abs(interpProfile(simX, simV, xq) - GHIA_V.re100[k]));
    }
    // Observed ~0.005 at H=64; gate at 0.012 (a broken moving-lid BC gives >0.1).
    expect(maxUErr).toBeLessThan(0.012);
    expect(maxVErr).toBeLessThan(0.012);

    // Primary vortex signature: u dips negative in the lower-centre, extremum near y≈0.45.
    let uMin = Infinity;
    let uMinY = -1;
    for (let j = 0; j < simY.length; j++) {
      if (simU[j] < uMin) {
        uMin = simU[j];
        uMinY = simY[j];
      }
    }
    expect(uMin).toBeGreaterThan(-0.24);
    expect(uMin).toBeLessThan(-0.18); // Ghia −0.2109
    expect(uMinY).toBeGreaterThan(0.4);
    expect(uMinY).toBeLessThan(0.5); // Ghia 0.4531

    // v recirculation: strong negative near the right wall, positive near the left.
    expect(Math.min(...simV)).toBeLessThan(-0.2); // Ghia v_min −0.2453
    expect(Math.max(...simV)).toBeGreaterThan(0.14); // Ghia v_max 0.1753

    // Lid drives +x flow at the top; near-wall no-slip is recovered at the bottom.
    expect(simU[simU.length - 1]).toBeGreaterThan(0.3); // just under the lid
    expect(Math.abs(simU[0])).toBeLessThan(0.05); // just above the floor
  });
});
