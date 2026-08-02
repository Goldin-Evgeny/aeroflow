import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { D3Q19 } from '../src/lattice3d.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';

/**
 * Free-slip boundaries (H11). Three gates, in order of authority:
 *  1. reflect tables are exact mirrors of the frozen D3Q19 ordering;
 *  2. uniform flow parallel to free-slip walls stays EXACTLY uniform (the invariance
 *     test of H11 §6, with a no-slip control proving the test can fail);
 *  3. THE bit-identity gate (H11 §7): esoteric ≡ naive to Float64 equality on a scene
 *     exercising sheared inflow, outlet, interior solids, slip∩slip edges, and the
 *     slip∩solid ground ring — any deviation is an index bug by construction.
 */

const { ex, ey, ez, opp, reflectX, reflectY, reflectZ } = D3Q19;

describe('D3Q19 reflect tables', () => {
  it('negate exactly one axis component and preserve the others', () => {
    const neg = (v: number): number => -v + 0; // avoid −0 vs 0 in toEqual
    for (let i = 0; i < 19; i++) {
      expect([ex[reflectX[i]], ey[reflectX[i]], ez[reflectX[i]]]).toEqual([
        neg(ex[i]),
        ey[i],
        ez[i],
      ]);
      expect([ex[reflectY[i]], ey[reflectY[i]], ez[reflectY[i]]]).toEqual([
        ex[i],
        neg(ey[i]),
        ez[i],
      ]);
      expect([ex[reflectZ[i]], ey[reflectZ[i]], ez[reflectZ[i]]]).toEqual([
        ex[i],
        ey[i],
        neg(ez[i]),
      ]);
    }
  });

  it('compose to the full reversal: reflectX∘reflectY∘reflectZ = opp', () => {
    for (let i = 0; i < 19; i++) {
      expect(reflectX[reflectY[reflectZ[i]]]).toBe(opp[i]);
    }
  });

  it('are involutions', () => {
    for (let i = 0; i < 19; i++) {
      expect(reflectX[reflectX[i]]).toBe(i);
      expect(reflectY[reflectY[i]]).toBe(i);
      expect(reflectZ[reflectZ[i]]).toBe(i);
    }
  });
});

/** y faces of a periodic-x/z channel, either FreeSlip or Solid (the control). */
function channelFlags(nx: number, ny: number, nz: number, wall: CellType): Uint8Array {
  const f = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      f[x + nx * (0 + ny * z)] = wall;
      f[x + nx * (ny - 1 + ny * z)] = wall;
    }
  return f;
}

describe('uniform-channel invariance (H11 §6)', () => {
  const [NX, NY, NZ] = [8, 6, 8];
  const U = 0.05;

  it('naive: uniform flow between free-slip walls stays exactly uniform', () => {
    const s = new Solver3D({
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.7,
      flags: channelFlags(NX, NY, NZ, CellType.FreeSlip),
      periodicX: true,
      periodicZ: true,
      collision: 'trt',
      freeSlip: { yMin: true, yMax: true },
    });
    s.reset(1, U, 0, 0);
    s.step(50);
    const { ux, uy, uz } = s.macroscopics();
    for (let i = 0; i < NX * NY * NZ; i++) {
      if (s.flags[i] !== CellType.Fluid) continue;
      expect(Math.abs(ux[i] - U)).toBeLessThan(1e-13);
      expect(Math.abs(uy[i])).toBeLessThan(1e-13);
      expect(Math.abs(uz[i])).toBeLessThan(1e-13);
    }
  });

  it('control: the same channel with NO-SLIP walls does not stay uniform', () => {
    const s = new Solver3D({
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.7,
      flags: channelFlags(NX, NY, NZ, CellType.Solid),
      periodicX: true,
      periodicZ: true,
      collision: 'trt',
    });
    s.reset(1, U, 0, 0);
    s.step(50);
    const { ux } = s.macroscopics();
    let maxDev = 0;
    for (let i = 0; i < NX * NY * NZ; i++) {
      if (s.flags[i] === CellType.Fluid) maxDev = Math.max(maxDev, Math.abs(ux[i] - U));
    }
    expect(maxDev).toBeGreaterThan(1e-3); // bounce-back decays the near-wall flow
  });

  it('esoteric: inlet-fed channel with free-slip y AND z faces stays uniform', () => {
    const flags = new Uint8Array(NX * NY * NZ);
    const at = (x: number, y: number, z: number) => x + NX * (y + NY * z);
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        flags[at(x, y, 0)] = CellType.FreeSlip;
        flags[at(x, y, NZ - 1)] = CellType.FreeSlip;
      }
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        flags[at(x, 0, z)] = CellType.FreeSlip;
        flags[at(x, NY - 1, z)] = CellType.FreeSlip;
      }
    for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) flags[at(0, y, z)] = CellType.Inlet;
    for (let z = 1; z < NZ - 1; z++)
      for (let y = 1; y < NY - 1; y++) flags[at(NX - 1, y, z)] = CellType.Outlet;

    const s = new EsotericPull3D({
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.7,
      flags,
      inletVelocity: U,
      collision: 'trt',
      freeSlip: { yMin: true, yMax: true, zMin: true, zMax: true },
    });
    s.reset(1, U, 0, 0);
    s.step(50);
    const snap = s.snapshotCanonical();
    const n = NX * NY * NZ;
    // Uniform equilibrium is a fixed point: every fluid cell's ux moment stays U.
    for (let i = 0; i < n; i++) {
      if (flags[i] !== CellType.Fluid) continue;
      let rho = 0;
      let mx = 0;
      for (let d = 0; d < 19; d++) {
        rho += snap[d * n + i];
        mx += ex[d] * snap[d * n + i];
      }
      expect(Math.abs(mx / rho - U)).toBeLessThan(1e-13);
    }
  });
});

describe('bit-identity with free-slip in play (H11 §7)', () => {
  const [NX, NY, NZ] = [10, 8, 7];
  // Fixed literal obstacle list; cells adjacent to the top (y=6) and zMax (z=5) faces
  // force the slip∩solid fallback path; none at x = NX−2 (H4 §10.9).
  const SOLIDS: Array<[number, number, number]> = [
    [4, 2, 3],
    [5, 3, 3],
    [6, 2, 5],
    [4, 6, 4],
    [3, 3, 2],
  ];

  function sceneFlags(): Uint8Array {
    const f = new Uint8Array(NX * NY * NZ);
    const at = (x: number, y: number, z: number) => x + NX * (y + NY * z);
    // Free-slip top and z faces first; solid ground overwrites every shared edge; x
    // faces carve inlet/outlet leaving the slip-adjacent outlet rings FreeSlip (§3.2).
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) f[at(x, NY - 1, z)] = CellType.FreeSlip;
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        f[at(x, y, 0)] = CellType.FreeSlip;
        f[at(x, y, NZ - 1)] = CellType.FreeSlip;
      }
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[at(x, 0, z)] = CellType.Solid;
    for (let z = 0; z < NZ; z++) for (let y = 1; y < NY; y++) f[at(0, y, z)] = CellType.Inlet;
    for (let z = 1; z < NZ - 1; z++)
      for (let y = 1; y < NY - 1; y++) f[at(NX - 1, y, z)] = CellType.Outlet;
    for (const [x, y, z] of SOLIDS) f[at(x, y, z)] = CellType.Solid;
    return f;
  }

  it('esoteric ≡ naive, Float64-exact, 100 steps, sheared inflow + slip faces', () => {
    const profile = Float64Array.from({ length: NY }, (_, y) => 0.02 + 0.004 * y);
    const flags = sceneFlags();
    const common = {
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.7,
      flags,
      collision: 'trt' as const,
      inletProfile: { axis: 'y' as const, ux: profile },
      freeSlip: { yMax: true, zMin: true, zMax: true },
    };
    const naive = new Solver3D(common);
    const eso = new EsotericPull3D(common);
    const n = NX * NY * NZ;
    for (let step = 1; step <= 100; step++) {
      naive.step(1);
      eso.step(1);
      const a = naive.snapshotPostCollision();
      const b = eso.snapshotCanonical();
      let bad = -1;
      for (let i = 0; i < n && bad < 0; i++) {
        if (flags[i] !== CellType.Fluid) continue;
        for (let d = 0; d < 19; d++) {
          if (a[d * n + i] !== b[d * n + i]) {
            bad = d * n + i;
            break;
          }
        }
      }
      expect(bad, `step ${step} (parity ${step % 2}) first differing slot`).toBe(-1);
      expect(eso.force.x, `Fx step ${step}`).toBe(naive.force.x);
      expect(eso.force.y, `Fy step ${step}`).toBe(naive.force.y);
      expect(eso.force.z, `Fz step ${step}`).toBe(naive.force.z);
    }
  });

  it('rejects FreeSlip off configured faces and upstream of outlets', () => {
    const flags = sceneFlags();
    const base = { nx: NX, ny: NY, nz: NZ, omega: 1.2, flags };
    // zMin face flagged FreeSlip but not configured → constructor throws.
    expect(() => new Solver3D({ ...base, freeSlip: { yMax: true, zMax: true } })).toThrow(
      'not on a configured',
    );
    // FreeSlip directly upstream of an outlet is ill-posed.
    const bad = sceneFlags();
    bad[NX - 2 + NX * (3 + NY * 3)] = CellType.FreeSlip;
    expect(
      () =>
        new EsotericPull3D({
          ...base,
          flags: bad,
          freeSlip: { yMax: true, zMin: true, zMax: true },
        }),
    ).toThrow('not on a configured');
  });
});
