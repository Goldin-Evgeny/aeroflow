import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { mirrorAsymmetryZ } from '../src/analysis/mirrorAsymmetry.js';

/**
 * `mirrorAsymmetryZ` (M9 phase 3c/2M). The empty Ahmed tunnel is exactly mirror-symmetric about
 * its z mid-plane under every boundary combination it can be built with, so a perfectly
 * symmetric field must read exactly zero and any injected asymmetry must be recovered exactly
 * (this is a closed-form reduction, not a numerical tolerance question). Macro is a
 * `Float32Array` — the GPU readback format — so exact-value assertions are checked at `toBe(0)`
 * only where the arithmetic is genuinely exact, and at 6 decimal places (matching
 * `lateralFlux.test.ts`'s discipline) wherever fp32 rounding of a literal like 0.03 is involved.
 */
describe('mirrorAsymmetryZ', () => {
  const nx = 4;
  const ny = 3;
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);

  function fluidFlags(nz: number): Uint8Array {
    return new Uint8Array(nx * ny * nz).fill(CellType.Fluid);
  }

  it('reads exactly zero for a perfectly mirror-symmetric field (even nz)', () => {
    const nz = 6;
    const flags = fluidFlags(nz);
    const macro = new Float32Array(4 * nx * ny * nz);
    for (let z = 0; z < nz; z++) {
      const zm = nz - 1 - z;
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const idx = at(x, y, z);
          macro[4 * idx] = 1 + 0.01 * Math.min(z, zm); // symmetric rho
          macro[4 * idx + 1] = 0.05; // symmetric ux
          macro[4 * idx + 2] = 0.001 * y; // symmetric uy
          macro[4 * idx + 3] = z < nz / 2 ? 0.02 : -0.02; // antisymmetric uz
        }
    }
    const r = mirrorAsymmetryZ(macro, flags, nx, ny, nz);
    expect(r.maxAbsDRho).toBe(0);
    expect(r.maxAbsDu).toBe(0);
    expect(r.rmsDu).toBe(0);
    expect(r.pairedCells).toBe(nx * ny * (nz / 2));
  });

  it('excludes the self-paired mid-plane on odd nz', () => {
    const nz = 7;
    const flags = fluidFlags(nz);
    const macro = new Float32Array(4 * nx * ny * nz); // all zero: trivially symmetric
    const r = mirrorAsymmetryZ(macro, flags, nx, ny, nz);
    expect(r.pairedCells).toBe(nx * ny * Math.floor(nz / 2));
    expect(r.maxAbsDu).toBe(0);
  });

  it('recovers a single injected perturbation exactly', () => {
    const nz = 6;
    const flags = fluidFlags(nz);
    const macro = new Float32Array(4 * nx * ny * nz); // symmetric baseline: all zero
    const idx = at(1, 1, 1);
    macro[4 * idx + 1] = 0.03; // ux perturbation only at one cell
    const r = mirrorAsymmetryZ(macro, flags, nx, ny, nz);
    expect(r.maxAbsDu).toBeCloseTo(0.03, 6);
    expect(r.maxAbsDRho).toBe(0);
    // Only one of the (nz/2) pairs at this (x,y) column is perturbed; RMS is diluted by the rest.
    const pairedCells = nx * ny * (nz / 2);
    expect(r.rmsDu).toBeCloseTo(Math.sqrt((0.03 * 0.03) / pairedCells), 6);
  });

  it('flags a broken uz antisymmetry (a mirrored flow moving the same way, not oppositely)', () => {
    const nz = 4;
    const flags = fluidFlags(nz);
    const macro = new Float32Array(4 * nx * ny * nz);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        // uz should be antisymmetric (+0.01 / -0.01); make it symmetric instead (+0.01 / +0.01).
        macro[4 * at(x, y, 0) + 3] = 0.01;
        macro[4 * at(x, y, nz - 1) + 3] = 0.01;
      }
    const r = mirrorAsymmetryZ(macro, flags, nx, ny, nz);
    // dUzSym = uz(z) + uz(mirror) = 0.02, not the 0 a true antisymmetric pair would give.
    expect(r.maxAbsDu).toBeCloseTo(0.02, 6);
  });

  it('skips shell cells on either side of the pair and does not let one poisoned cell hide the rest', () => {
    const nz = 6;
    const flags = fluidFlags(nz);
    // Mark one z=0 cell as a boundary; its z=5 mirror must then also be excluded from pairing.
    const shellIdx = at(0, 0, 0);
    flags[shellIdx] = CellType.Inlet;
    const macro = new Float32Array(4 * nx * ny * nz);
    macro[4 * at(0, 0, nz - 1) + 1] = 99; // would-be mirror partner, must not be counted
    macro[4 * at(2, 2, 2) + 1] = Number.NaN; // poisoned cell elsewhere
    // Real, measurable perturbation, away from both the shell cell and the NaN cell.
    macro[4 * at(3, 1, 0) + 1] = 0.04;
    const r = mirrorAsymmetryZ(macro, flags, nx, ny, nz);
    expect(Number.isFinite(r.maxAbsDu)).toBe(true);
    expect(r.maxAbsDu).toBeCloseTo(0.04, 6);
    // Total pairs minus the one shell-adjacent pair and the one NaN-poisoned pair.
    expect(r.pairedCells).toBe(nx * ny * (nz / 2) - 2);
  });

  it('rejects arrays smaller than the declared grid', () => {
    const nz = 4;
    expect(() => mirrorAsymmetryZ(new Float32Array(1), fluidFlags(nz), nx, ny, nz)).toThrow(
      /macro has/,
    );
    expect(() =>
      mirrorAsymmetryZ(new Float32Array(4 * nx * ny * nz), new Uint8Array(1), nx, ny, nz),
    ).toThrow(/flags has/);
  });
});
