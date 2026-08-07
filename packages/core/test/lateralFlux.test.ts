import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { lateralFlux } from '../src/analysis/lateralFlux.js';

/**
 * `lateralFlux` (M9 phase 3). The analytic targets are exact, not banded: this is a signed sum
 * over a known cell set, so every case below has a closed-form answer and any deviation is a
 * bug in the indexing or the sign convention rather than a numerical tolerance question.
 *
 * The sign convention is the one thing worth pinning hard. Positive means OUTWARD on every
 * face, so that `net` can be compared directly against the streamwise budget
 * (inFlux − outFlux). Getting a face's sign backwards would silently cancel a real leak
 * against a real inflow and report a healthy zero.
 */
describe('lateralFlux', () => {
  const nx = 6;
  const ny = 5;
  const nz = 5;
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);

  /** The Ahmed shell: Solid ground, Inlet lid and sides, Inlet/Outlet x faces, Fluid interior. */
  function shellFlags(): Uint8Array {
    const flags = new Uint8Array(nx * ny * nz).fill(CellType.Fluid);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        flags[at(x, y, 0)] = CellType.Inlet;
        flags[at(x, y, nz - 1)] = CellType.Inlet;
      }
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, ny - 1, z)] = CellType.Inlet;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, 0, z)] = CellType.Solid;
    for (let z = 0; z < nz; z++)
      for (let y = 1; y < ny; y++) {
        flags[at(0, y, z)] = CellType.Inlet;
        flags[at(nx - 1, y, z)] = CellType.Outlet;
      }
    return flags;
  }

  /**
   * Expected flux for a uniform field, computed through `Math.fround`.
   *
   * `macro` is a `Float32Array` — that is the GPU readback format, not a test shortcut — so a
   * velocity like 0.02 is stored as 0.019999999552965164 and the sum lands ~1e-8 off the
   * exact decimal product. Rounding the operands the same way the storage does keeps these
   * assertions exact statements about the SUM rather than loose bands that would also pass
   * with a genuinely wrong cell count.
   */
  const expectFlux = (rho: number, u: number, cells: number): number =>
    Math.fround(rho) * Math.fround(u) * cells;

  /** A macro image with uniform (rho, ux, uy, uz) on every cell — shell included, to prove
   *  the shell is excluded by the flags rather than by happening to hold zeros. */
  function uniformMacro(rho: number, ux: number, uy: number, uz: number): Float32Array {
    const macro = new Float32Array(4 * nx * ny * nz);
    for (let i = 0; i < nx * ny * nz; i++) {
      macro[4 * i] = rho;
      macro[4 * i + 1] = ux;
      macro[4 * i + 2] = uy;
      macro[4 * i + 3] = uz;
    }
    return macro;
  }

  it('reports exactly zero on every face for a pure streamwise flow', () => {
    // A uniform x-flow has no wall-normal component anywhere, so every lateral face must read
    // exactly 0 — not "small". This is the null the free-slip arm is expected to approach.
    const r = lateralFlux(uniformMacro(1, 0.05, 0, 0), shellFlags(), nx, ny, nz);
    expect(r.top).toBe(0);
    expect(r.zMin).toBe(0);
    expect(r.zMax).toBe(0);
    expect(r.groundLayerUy).toBe(0);
    expect(r.net).toBe(0);
  });

  /**
   * The ground column is a near-wall INTERIOR quantity, not a boundary flux: a halfway
   * bounce-back wall passes exactly zero mass. Including it in `net` swamped the real signal
   * in phase-3 Stage A — the ground read 57.2 against a total streamwise imbalance of 3.89 —
   * so `net` is the three exchanging faces only, and this pins that.
   */
  it('measures the ground layer but keeps it out of net', () => {
    const rho = 1.25;
    const uy = 0.02;
    const r = lateralFlux(uniformMacro(rho, 0, uy, 0), shellFlags(), nx, ny, nz);
    // Interior x runs 1..nx−2 (the x faces are Inlet/Outlet), interior z runs 1..nz−2.
    const perPlane = (nx - 2) * (nz - 2);
    expect(r.cells.top).toBe(perPlane);
    expect(r.cells.groundLayer).toBe(perPlane);
    // y=ny−2: +y is outward through the lid ⇒ positive.
    expect(r.top).toBeCloseTo(expectFlux(rho, uy, perPlane), 12);
    // y=1: +y is INWARD from the floor ⇒ the outward-positive convention makes it negative.
    expect(r.groundLayerUy).toBeCloseTo(-expectFlux(rho, uy, perPlane), 12);
    // `net` is the lid alone here — the floor term does NOT cancel it, because it is not in
    // the sum. A `net` of 0 would mean the ground had been folded back in.
    expect(r.net).toBeCloseTo(expectFlux(rho, uy, perPlane), 12);
    expect(r.net).not.toBeCloseTo(0, 6);
  });

  it('signs a uniform +z flow as out through zMax and in through zMin', () => {
    const rho = 1;
    const uz = 0.03;
    const r = lateralFlux(uniformMacro(rho, 0, 0, uz), shellFlags(), nx, ny, nz);
    // The z planes span the FLUID rows only: y=0 is Solid, y=ny−1 is the Inlet lid.
    const perPlane = (nx - 2) * (ny - 2);
    expect(r.cells.zMax).toBe(perPlane);
    expect(r.cells.zMin).toBe(perPlane);
    expect(r.zMax).toBeCloseTo(expectFlux(rho, uz, perPlane), 12);
    expect(r.zMin).toBeCloseTo(-expectFlux(rho, uz, perPlane), 12);
    expect(r.net).toBeCloseTo(0, 12);
  });

  it('sums a genuine one-sided leak instead of cancelling it', () => {
    // Fluid leaving through BOTH z faces — the signature the reservoir hypothesis predicts,
    // and the case a sign error would report as zero.
    const flags = shellFlags();
    const macro = uniformMacro(1, 0.05, 0, 0);
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        macro[4 * at(x, y, 1) + 3] = -0.01; // −z at the −z side: outward
        macro[4 * at(x, y, nz - 2) + 3] = +0.01; // +z at the +z side: outward
      }
    const r = lateralFlux(macro, flags, nx, ny, nz);
    const perPlane = (nx - 2) * (ny - 2);
    expect(r.zMin).toBeCloseTo(expectFlux(1, 0.01, perPlane), 12);
    expect(r.zMax).toBeCloseTo(expectFlux(1, 0.01, perPlane), 12);
    expect(r.net).toBeCloseTo(2 * expectFlux(1, 0.01, perPlane), 12);
  });

  it('excludes shell cells and skips poisoned ones without poisoning the sum', () => {
    const flags = shellFlags();
    // A large uy on the Inlet lid must not be counted: the macro pass never writes those cells,
    // and counting them would fabricate a flux out of a boundary value.
    const macro = uniformMacro(1, 0.05, 0, 0);
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) macro[4 * at(x, ny - 1, z) + 2] = 99;
    macro[4 * at(2, 2, 2)] = Number.NaN;
    const r = lateralFlux(macro, flags, nx, ny, nz);
    expect(r.top).toBe(0);
    expect(Number.isFinite(r.net)).toBe(true);
  });

  it('rejects a grid with no interior layer to measure', () => {
    const tiny = new Uint8Array(nx * 2 * nz).fill(CellType.Fluid);
    expect(() => lateralFlux(new Float32Array(4 * nx * 2 * nz), tiny, nx, 2, nz)).toThrow(
      /interior layer/,
    );
  });
});
