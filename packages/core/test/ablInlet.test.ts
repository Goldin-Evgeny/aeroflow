import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { ablProfileLattice } from '../src/abl.js';

/**
 * M10 step 3 (inlet half): the per-height ABL inlet in both CPU solvers.
 *
 * The inlet mechanism is unchanged (Inlet cells are overwritten with equilibrium every
 * step — no new streaming rules), so the hard guarantee to keep is the H4 bit-identity:
 * esoteric vs naive must stay Float64-EXACT with a sheared inflow in play. Physics
 * sanity on top: the shear must actually propagate into the domain (ux increases with
 * height downstream), which fails if the profile is indexed on the wrong axis.
 */

const NX = 10;
const NY = 8;
const NZ = 6;

/**
 * ABL-scene layout (matches ahmedScene): no-slip ground y=0 (Solid, kept across the x
 * faces so no Outlet has a Solid upstream neighbor, H4 §10.9), freestream Inlet top and
 * z sides (they carry the profile's per-height velocity — the consistent sheared far
 * field, and what sustains the profile until true free-slip lands), inlet/outlet in x.
 */
function flags(): Uint8Array {
  const f = new Uint8Array(NX * NY * NZ);
  const at = (x: number, y: number, z: number) => x + NX * (y + NY * z);
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      f[at(x, y, 0)] = CellType.Inlet;
      f[at(x, y, NZ - 1)] = CellType.Inlet;
    }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[at(x, NY - 1, z)] = CellType.Inlet;
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[at(x, 0, z)] = CellType.Solid;
  for (let z = 0; z < NZ; z++)
    for (let y = 1; y < NY; y++) {
      f[at(0, y, z)] = CellType.Inlet;
      f[at(NX - 1, y, z)] = CellType.Outlet;
    }
  return f;
}

/** Power-law profile on the y axis, sampled exactly like a scene would (M10 step 1). */
function profile(): Float64Array {
  const { profile: f32 } = ablProfileLattice(
    { kind: 'power', uRef: 5, zRef: 0.6, alpha: 0.25 },
    NY,
    0.1,
    0.01,
  );
  return Float64Array.from(f32);
}

describe('ABL profile inlet (M10)', () => {
  it('esoteric stays bit-identical to naive with a sheared inflow (60 steps)', () => {
    const common = {
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.7,
      flags: flags(),
      collision: 'trt' as const,
      inletProfile: { axis: 'y' as const, ux: profile() },
    };
    const naive = new Solver3D(common);
    const eso = new EsotericPull3D(common);
    const n = NX * NY * NZ;
    for (let step = 1; step <= 60; step++) {
      naive.step(1);
      eso.step(1);
      const a = naive.snapshotPostCollision();
      const b = eso.snapshotCanonical();
      for (let s = 0; s < 19 * n; s++) {
        if (a[s] !== b[s]) {
          const fl = flags()[s % n];
          if (fl === CellType.Fluid) {
            expect.fail(`step ${step}: slot ${s} differs (${a[s]} vs ${b[s]})`);
          }
        }
      }
      expect(eso.force.x, `Fx step ${step}`).toBe(naive.force.x);
    }
  });

  it('the shear propagates: downstream ux increases with height away from the walls', () => {
    const solver = new Solver3D({
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.7,
      flags: flags(),
      collision: 'trt',
      inletProfile: { axis: 'y', ux: profile() },
    });
    solver.step(200);
    const { ux } = solver.macroscopics();
    const at = (x: number, y: number, z: number) => x + NX * (y + NY * z);
    const xProbe = Math.floor(NX / 2);
    const zMid = Math.floor(NZ / 2);
    // Monotone-increasing with height above the ground-dragged first layer (the top is
    // a freestream boundary carrying the profile, so the ordering holds to the top).
    // Wrong-axis indexing would flatten this entirely.
    for (let y = 2; y + 1 <= NY - 2; y++) {
      expect(ux[at(xProbe, y + 1, zMid)]).toBeGreaterThan(ux[at(xProbe, y, zMid)]);
    }
    // And the inlet itself reproduces the prescribed profile exactly (equilibrium ⇒ ux).
    const p = profile();
    for (let y = 1; y < NY - 1; y++) {
      expect(ux[at(0, y, zMid)]).toBeCloseTo(p[y], 12);
    }
  });

  it('rejects a profile whose length does not match the axis extent', () => {
    const bad = { axis: 'y' as const, ux: new Float64Array(NY + 1) };
    const opts = { nx: NX, ny: NY, nz: NZ, omega: 1.2, flags: flags(), inletProfile: bad };
    expect(() => new Solver3D(opts)).toThrow('extent');
    expect(() => new EsotericPull3D(opts)).toThrow('extent');
  });
});
