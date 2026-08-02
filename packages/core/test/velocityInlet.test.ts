import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';

/**
 * H12 flux-imposing velocity inlet. Gates (H12 §5):
 *  1. bit-identity: esoteric ≡ naive Float64-exact with VelocityInlet + free-slip +
 *     solids + sheared profile in play (the snapshot pre-pass and the i-order ρ sum
 *     are exactly what this catches);
 *  2. flux imposition: the frictionless duct that settles at 0.66·u_in under the plain
 *     equilibrium inlet (the measured M10 blocker) converges to u_in under
 *     VelocityInlet from the same from-rest start;
 *  3. constructor validation: x=0 face only, Fluid +x neighbor required.
 */

const NX = 10;
const NY = 8;
const NZ = 7;
const at = (x: number, y: number, z: number): number => x + NX * (y + NY * z);

const SOLIDS: Array<[number, number, number]> = [
  [4, 2, 3],
  [5, 3, 3],
  [6, 2, 5],
  [4, 6, 4],
];

function sceneFlags(): Uint8Array {
  const f = new Uint8Array(NX * NY * NZ);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[at(x, NY - 1, z)] = CellType.FreeSlip;
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      f[at(x, y, 0)] = CellType.FreeSlip;
      f[at(x, y, NZ - 1)] = CellType.FreeSlip;
    }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[at(x, 0, z)] = CellType.Solid;
  // Inlet face: flux-imposing interior, plain-Inlet edge rings (H12 §2).
  for (let z = 1; z < NZ - 1; z++)
    for (let y = 1; y < NY - 1; y++) f[at(0, y, z)] = CellType.VelocityInlet;
  for (let z = 0; z < NZ; z++) f[at(0, NY - 1, z)] = CellType.Inlet;
  for (let y = 1; y < NY; y++) {
    f[at(0, y, 0)] = CellType.Inlet;
    f[at(0, y, NZ - 1)] = CellType.Inlet;
  }
  for (let z = 1; z < NZ - 1; z++)
    for (let y = 1; y < NY - 1; y++) f[at(NX - 1, y, z)] = CellType.Outlet;
  for (const [x, y, z] of SOLIDS) f[at(x, y, z)] = CellType.Solid;
  return f;
}

describe('VelocityInlet (H12)', () => {
  it('bit-identity: esoteric ≡ naive, Float64-exact, 100 steps', () => {
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
    }
  });

  it(
    'imposes the flux: frictionless duct from rest converges to u_in (plain Inlet: 0.66)',
    { timeout: 30_000 },
    () => {
      const [MX, MY, MZ] = [40, 12, 8];
      const m = (x: number, y: number, z: number): number => x + MX * (y + MY * z);
      const U = 0.03;
      const build = (inlet: CellType): Uint8Array => {
        const f = new Uint8Array(MX * MY * MZ);
        for (let z = 0; z < MZ; z++)
          for (let x = 0; x < MX; x++) {
            f[m(x, 0, z)] = CellType.FreeSlip;
            f[m(x, MY - 1, z)] = CellType.FreeSlip;
          }
        for (let y = 0; y < MY; y++)
          for (let x = 0; x < MX; x++) {
            f[m(x, y, 0)] = CellType.FreeSlip;
            f[m(x, y, MZ - 1)] = CellType.FreeSlip;
          }
        for (let z = 1; z < MZ - 1; z++)
          for (let y = 1; y < MY - 1; y++) {
            f[m(0, y, z)] = inlet;
            f[m(MX - 1, y, z)] = CellType.Outlet;
          }
        return f;
      };
      const run = (inlet: CellType): number => {
        const s = new Solver3D({
          nx: MX,
          ny: MY,
          nz: MZ,
          omega: 1 / 0.51,
          flags: build(inlet),
          collision: 'trt',
          regularize: true,
          inletVelocity: U,
          freeSlip: { yMin: true, yMax: true, zMin: true, zMax: true },
        });
        s.step(4000);
        return s.macroscopics().ux[m(20, 6, 4)] / U;
      };
      expect(run(CellType.Inlet)).toBeLessThan(0.75); // the measured impedance sag
      expect(run(CellType.VelocityInlet)).toBeGreaterThan(0.99); // flux imposed
    },
  );

  it('rejects VelocityInlet off the x=0 face or without a Fluid neighbor', () => {
    const base = { nx: NX, ny: NY, nz: NZ, omega: 1.2 };
    const offFace = sceneFlags();
    offFace[at(NX - 1, 3, 3)] = CellType.VelocityInlet;
    expect(
      () =>
        new Solver3D({ ...base, flags: offFace, freeSlip: { yMax: true, zMin: true, zMax: true } }),
    ).toThrow('x=0 face');
    const blocked = sceneFlags();
    blocked[at(1, 3, 3)] = CellType.Solid; // neighbor of a VelocityInlet cell
    expect(
      () =>
        new EsotericPull3D({
          ...base,
          flags: blocked,
          freeSlip: { yMax: true, zMin: true, zMax: true },
        }),
    ).toThrow('Fluid +x neighbor');
  });
});
