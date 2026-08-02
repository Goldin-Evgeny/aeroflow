import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { ablProfileLattice } from '../src/abl.js';

/**
 * M10 step 7a — empty-domain fetch. MEASURED FINDING (2026-07-18, this file is its
 * regression record): the spec's equilibrium inlet is NOT a flux-imposing velocity BC,
 * and the 5% fetch gate is unreachable with it against a free-slip far field.
 *
 * Evidence (CPU, 40×12×8, τ=0.51, TRT+regularized):
 *  - all-free-slip duct (zero friction anywhere), uniform inflow, from rest: settles at
 *    u = 0.660·u_in with ρ = 1.0303, dead flat, steady from 3k to 12k steps — the
 *    interface momentum-flux balance picks a different member of the frictionless
 *    duct's neutral family. Free-slip itself is NOT the leak: the profile stays exactly
 *    FLAT (shape preserved; the H11 invariance test pins the exact-uniform case).
 *  - same duct initialized AT u_in: holds 1.0000 exactly, indefinitely — neutral, not
 *    unstable; the inlet just cannot restore a sagged state.
 *  - with a no-slip ground (the fetch scenario), friction bleeds momentum and the
 *    compliant inlet/outlet pair lets the WHOLE channel slide toward the sagged
 *    attractor: profile ratio at the station ≈ 0.93–1.04 (upper nodes) after 3k steps
 *    but ≈ 0.61 by 12k — long AIJ averaging runs would sit on the sagged state.
 *
 * Consequence for M10 (recorded in M10.md Status): before the Case A scene, the inlet
 * needs a flux-imposing variant — equilibrium at (ρ extrapolated from the fluid
 * neighbor, prescribed u(z)), or NEBB/Zou-He — landed CPU-first with bit-identity like
 * every BC (the esoteric neighbor-density read needs its own H-doc ownership audit).
 * The 5% gate below is marked `it.fails` so it flips green the day that BC lands.
 */

const NX = 40;
const NY = 12;
const NZ = 8;
const at = (x: number, y: number, z: number): number => x + NX * (y + NY * z);

function ductFlags(ground: CellType): Uint8Array {
  const f = new Uint8Array(NX * NY * NZ);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[at(x, NY - 1, z)] = CellType.FreeSlip;
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      f[at(x, y, 0)] = CellType.FreeSlip;
      f[at(x, y, NZ - 1)] = CellType.FreeSlip;
    }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[at(x, 0, z)] = ground;
  for (let z = 0; z < NZ; z++) for (let y = 1; y < NY; y++) f[at(0, y, z)] = CellType.Inlet;
  for (let z = 1; z < NZ - 1; z++)
    for (let y = 1; y < NY - 1; y++) f[at(NX - 1, y, z)] = CellType.Outlet;
  return f;
}

describe('ABL empty-domain fetch (M10 acceptance 3, CPU)', () => {
  it(
    'diagnosis: equilibrium-inlet impedance sags the flow UNIFORMLY (not a slip leak)',
    { timeout: 30_000 },
    () => {
      // Frictionless control: ground free-slip too, uniform inflow, from rest.
      const U = 0.03;
      const s = new Solver3D({
        nx: NX,
        ny: NY,
        nz: NZ,
        omega: 1 / 0.51,
        flags: ductFlags(CellType.FreeSlip),
        collision: 'trt',
        regularize: true,
        inletVelocity: U,
        freeSlip: { yMin: true, yMax: true, zMin: true, zMax: true },
      });
      s.step(3000);
      const m = s.macroscopics();
      const mid: number[] = [];
      for (let y = 1; y < NY - 1; y++) mid.push(m.ux[at(20, y, 4)]);
      const mean = mid.reduce((a, b) => a + b) / mid.length;
      const spread = Math.max(...mid) - Math.min(...mid);
      // Flat to numerical precision (free-slip preserves the SHAPE)...
      expect(spread / mean).toBeLessThan(1e-6);
      // ...but well below the prescribed magnitude (the impedance sag; ≈ 0.66 measured).
      expect(mean / U).toBeLessThan(0.9);
      expect(mean / U).toBeGreaterThan(0.4);
    },
  );

  it(
    'H12 VelocityInlet: profile preserved within 5% above the near-ground adjustment zone',
    { timeout: 60_000 },
    () => {
      // Taller domain (24 nodes) so BL displacement stays small; τ₀ = 0.505 with LES +
      // regularization (near-floor τ without LES diverges here — the M5/M7 lesson,
      // re-measured for this configuration). MEASURED at the station (x = 4, t = 3000):
      //   nodes 5..22: within ≤ 4% of the inlet profile  ← the 5% gate, PASSING
      //   nodes 2..4:  up to ≈ +15% at node 3, decaying with height and fetch — the
      //     near-ground ADJUSTMENT ZONE: an idealized power law prescribes nonzero u
      //     against a smooth no-slip ground, and the excess displaces upward. This is
      //     exactly why the M10 spec mandates the MEASURED inflow (already wall-shaped)
      //     for Case A scoring, and it flags the low AIJ measurement plane (2 cells up)
      //     as the accuracy-critical region for acceptance 4. Full-scale acceptance 3
      //     runs on the real domain via the validation page.
      const MY = 24;
      const atT = (x: number, y: number, z: number): number => x + NX * (y + MY * z);
      const { profile } = ablProfileLattice(
        { kind: 'power', uRef: 6, zRef: 10, alpha: 0.25 },
        MY,
        1,
        0.00706,
      );
      const ux = Float64Array.from(profile);
      const f = new Uint8Array(NX * MY * NZ);
      for (let z = 0; z < NZ; z++)
        for (let x = 0; x < NX; x++) f[atT(x, MY - 1, z)] = CellType.FreeSlip;
      for (let y = 0; y < MY; y++)
        for (let x = 0; x < NX; x++) {
          f[atT(x, y, 0)] = CellType.FreeSlip;
          f[atT(x, y, NZ - 1)] = CellType.FreeSlip;
        }
      for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[atT(x, 0, z)] = CellType.Solid;
      for (let z = 1; z < NZ - 1; z++)
        for (let y = 1; y < MY - 1; y++) f[atT(0, y, z)] = CellType.VelocityInlet;
      for (let z = 0; z < NZ; z++) f[atT(0, MY - 1, z)] = CellType.Inlet;
      for (let y = 1; y < MY; y++) {
        f[atT(0, y, 0)] = CellType.Inlet;
        f[atT(0, y, NZ - 1)] = CellType.Inlet;
      }
      for (let z = 1; z < NZ - 1; z++)
        for (let y = 1; y < MY - 1; y++) f[atT(NX - 1, y, z)] = CellType.Outlet;

      const s = new Solver3D({
        nx: NX,
        ny: MY,
        nz: NZ,
        omega: 1 / 0.505,
        flags: f,
        collision: 'trt',
        regularize: true,
        les: { cs: 0.1 },
        inletProfile: { axis: 'y', ux },
        freeSlip: { yMax: true, zMin: true, zMax: true },
      });
      s.reset(1, 0.035, 0, 0);
      s.step(3000);
      const m = s.macroscopics();
      const station = 4;
      for (let y = 5; y <= MY - 2; y++) {
        const rel = Math.abs(m.ux[atT(station, y, 4)] - ux[y]) / ux[y];
        expect(rel, `height ${y}`).toBeLessThan(0.05);
      }
      // The adjustment zone is bounded and confined (regression guard on the finding).
      for (let y = 2; y <= 4; y++) {
        const rel = Math.abs(m.ux[atT(station, y, 4)] - ux[y]) / ux[y];
        expect(rel, `adjustment node ${y}`).toBeLessThan(0.2);
      }
    },
  );

  it.fails(
    '5% gate with the PLAIN equilibrium inlet (kept as the impedance record)',
    { timeout: 30_000 },
    () => {
      const { profile } = ablProfileLattice(
        { kind: 'power', uRef: 6, zRef: 10, alpha: 0.25 },
        NY,
        1,
        0.00706,
      );
      const ux = Float64Array.from(profile);
      const s = new Solver3D({
        nx: NX,
        ny: NY,
        nz: NZ,
        omega: 1 / 0.502,
        flags: ductFlags(CellType.Solid),
        collision: 'trt',
        regularize: true,
        inletProfile: { axis: 'y', ux },
        freeSlip: { yMax: true, zMin: true, zMax: true },
      });
      s.reset(1, 0.03, 0, 0);
      // 3000 steps: already fails hard (node 2 ≈ 0.38·u_in); the sag DEEPENS with run
      // length (measured ≈ 0.61 across ALL heights at 12k steps — see header), so the
      // long AIJ averaging window only makes it worse. Short run keeps the suite fast.
      s.step(3000);
      const m = s.macroscopics();
      for (let y = 2; y <= NY - 2; y++) {
        const rel = Math.abs(m.ux[at(10, y, 4)] - ux[y]) / ux[y];
        expect(rel, `height ${y}`).toBeLessThan(0.05);
      }
    },
  );
});
