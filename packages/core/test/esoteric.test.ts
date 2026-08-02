import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { Solver3D } from '../src/cpu/solver3d.js';

/**
 * THE bit-identity test (docs/handoff/H4-esoteric-pull.md §8): the in-place esoteric
 * streaming must reproduce the naive two-array solver EXACTLY (Float64 ===), step by
 * step, at both parities, with solids + inlet/outlet in play. Any deviation is an
 * index bug; the first failing step localizes it (step 1 = EVEN rules, step 2 = ODD
 * rules / solid scratch, near outlets = snapshot pre-pass).
 */

const NX = 8;
const NY = 6;
const NZ = 5;
// Fixed literal obstacle list (no runtime RNG — failures must reproduce).
// None at x = nx−2: a Solid directly upstream of an Outlet is an ill-posed
// configuration that both solvers now reject (H4 §10.9 — discovered by this test).
const SOLIDS: Array<[number, number, number]> = [
  [3, 2, 2],
  [4, 3, 2],
  [2, 4, 1],
  [5, 1, 3],
  [3, 3, 3],
  [4, 2, 3],
];

function tunnelFlags(): Uint8Array {
  const flags = new Uint8Array(NX * NY * NZ);
  const idx = (x: number, y: number, z: number) => x + NX * (y + NY * z);
  for (let z = 0; z < NZ; z++)
    for (let y = 0; y < NY; y++)
      for (let x = 0; x < NX; x++) {
        if (y === 0 || y === NY - 1 || z === 0 || z === NZ - 1) {
          flags[idx(x, y, z)] = CellType.Solid;
        } else if (x === 0) {
          flags[idx(x, y, z)] = CellType.Inlet;
        } else if (x === NX - 1) {
          flags[idx(x, y, z)] = CellType.Outlet;
        }
      }
  for (const [x, y, z] of SOLIDS) flags[idx(x, y, z)] = CellType.Solid;
  return flags;
}

function fluidIndices(flags: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < flags.length; i++) if (flags[i] === CellType.Fluid) out.push(i);
  return out;
}

describe.each([
  ['TRT, LES off', {}],
  ['TRT, LES cs=0.1', { les: { cs: 0.1 } }],
  ['TRT, conservative collision', { conserveMass: true }],
])('EsotericPull3D bit-identity vs naive Solver3D (%s)', (_name, extra) => {
  it('is Float64-EXACT for 200 steps (both parities), forces included', { timeout: 30_000 }, () => {
    const flags = tunnelFlags();
    const common = {
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.8,
      flags,
      inletVelocity: 0.05,
      collision: 'trt' as const,
      ...extra,
    };
    const naive = new Solver3D(common);
    const eso = new EsotericPull3D(common);
    const fluid = fluidIndices(flags);
    const n = NX * NY * NZ;

    for (let step = 1; step <= 200; step++) {
      naive.step(1);
      eso.step(1);
      const a = naive.snapshotPostCollision();
      const b = eso.snapshotCanonical();
      let maxDiff = 0;
      let where = -1;
      for (const idx of fluid) {
        for (let i = 0; i < 19; i++) {
          const d = Math.abs(a[i * n + idx] - b[i * n + idx]);
          if (d > maxDiff) {
            maxDiff = d;
            where = i * n + idx;
          }
        }
      }
      expect(maxDiff, `step ${step} (parity ${step % 2}), slot ${where}`).toBe(0);
      // Forces: identical gather order ⇒ identical float accumulation order ⇒ exact.
      expect(eso.force.x, `Fx step ${step}`).toBe(naive.force.x);
      expect(eso.force.y, `Fy step ${step}`).toBe(naive.force.y);
      expect(eso.force.z, `Fz step ${step}`).toBe(naive.force.z);
    }
  });
});

describe('EsotericPull3D invariants', () => {
  it('conserves mass exactly in a closed box', () => {
    const s = 8;
    const flags = new Uint8Array(s * s * s);
    const idx = (x: number, y: number, z: number) => x + s * (y + s * z);
    for (let z = 0; z < s; z++)
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          if (x === 0 || x === s - 1 || y === 0 || y === s - 1 || z === 0 || z === s - 1) {
            flags[idx(x, y, z)] = CellType.Solid;
          }
        }
    const eso = new EsotericPull3D({ nx: s, ny: s, nz: s, omega: 1.2, flags });
    eso.reset(1, 0.03, 0, 0);
    const m0 = eso.totalMass();
    eso.step(201); // odd count: exercises the non-canonical-parity reconstruction too
    expect(Math.abs(eso.totalMass() - m0) / m0).toBeLessThan(1e-12);
  });

  it('rejects fluid on the shell and outlets off the +x face', () => {
    const flags = new Uint8Array(4 * 4 * 4); // all fluid — shell violated
    expect(() => new EsotericPull3D({ nx: 4, ny: 4, nz: 4, omega: 1.0, flags })).toThrow(/shell/);
  });
});
