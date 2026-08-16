import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { wakeProbe, type AhmedWakeGeometry } from '../src/analysis/wakeProbe.js';

/**
 * `wakeProbe` (M9 phase 3). Every case here is a synthetic field with a hand-computable
 * answer — a planted reverse-flow block, an antisymmetric vortex pair, a one-sided one — so
 * the probe is checked against arithmetic rather than against a simulation it would otherwise
 * be co-validated with.
 *
 * The ω_x sign convention (ω_x = ∂u_z/∂y − ∂u_y/∂z) matters more than the magnitudes: the
 * C-pillar asymmetry ratio is built on the two halves cancelling, so a sign error would turn a
 * healthy symmetric pair into a maximally asymmetric one and vice versa.
 */
describe('wakeProbe', () => {
  const nx = 24;
  const ny = 12;
  const nz = 11; // odd, so z=5 is exactly the symmetry plane
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);

  const geom: AhmedWakeGeometry = {
    nx,
    ny,
    nz,
    noseX: 4,
    bodyLength: 8,
    bodyHeight: 6,
    slantStartX: 10,
    slantShellCells: 2,
    wakeBodyLengths: 1,
  };
  const tailX = geom.noseX + geom.bodyLength; // 12

  /** Ahmed-like shell plus a rectangular body occupying y=1..bodyHeight over the slant range. */
  function scene(): Uint8Array {
    const flags = new Uint8Array(nx * ny * nz).fill(CellType.Fluid);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        flags[at(x, y, 0)] = CellType.Inlet;
        flags[at(x, y, nz - 1)] = CellType.Inlet;
      }
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) flags[at(x, ny - 1, z)] = CellType.Inlet;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, 0, z)] = CellType.Solid;
    for (let z = 0; z < nz; z++)
      for (let y = 1; y < ny; y++) {
        flags[at(0, y, z)] = CellType.Inlet;
        flags[at(nx - 1, y, z)] = CellType.Outlet;
      }
    // A flat-roofed body spanning z=3..7, roof at y=4, from the nose to the base.
    for (let z = 3; z <= 7; z++)
      for (let y = 1; y <= 4; y++)
        for (let x = geom.noseX; x < tailX; x++) flags[at(x, y, z)] = CellType.BodySolid;
    return flags;
  }

  function macroOf(fill: (x: number, y: number, z: number) => [number, number, number, number]) {
    const macro = new Float32Array(4 * nx * ny * nz);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const i = at(x, y, z);
          const [rho, ux, uy, uz] = fill(x, y, z);
          macro[4 * i] = rho;
          macro[4 * i + 1] = ux;
          macro[4 * i + 2] = uy;
          macro[4 * i + 3] = uz;
        }
    return macro;
  }

  it('reports an attached, vortex-free, non-recirculating flow as exactly that', () => {
    const r = wakeProbe(
      macroOf(() => [1, 0.05, 0, 0]),
      scene(),
      geom,
    );
    expect(r.baseReverseFraction).toBe(0);
    expect(r.slantReverseFraction).toBe(0);
    expect(r.recircLengthCells).toBe(0);
    expect(r.recircLengthBodyLengths).toBe(0);
    expect(r.gammaLeft).toBeCloseTo(0, 12);
    expect(r.gammaRight).toBeCloseTo(0, 12);
    expect(r.meanAbsOmegaX).toBeCloseTo(0, 12);
    // Controls: the boxes are non-empty, so the zeros above are measurements, not empty sums.
    expect(r.baseCells).toBeGreaterThan(0);
    expect(r.slantCells).toBeGreaterThan(0);
    expect(r.vorticityCells).toBeGreaterThan(0);
  });

  it('measures the recirculation bubble length from the base, stopping where it closes', () => {
    const flags = scene();
    // Reverse flow on the centreline for exactly 5 cells behind the base, then forward again —
    // plus an isolated negative cell further downstream that must NOT extend the bubble.
    const macro = macroOf(() => [1, 0.05, 0, 0]);
    const zMid = Math.round((nz - 1) / 2);
    const probeY = Math.round(6 / 2);
    for (let k = 0; k < 5; k++) macro[4 * at(tailX + k, probeY, zMid) + 1] = -0.01;
    macro[4 * at(tailX + 7, probeY, zMid) + 1] = -0.01;
    const r = wakeProbe(macro, flags, geom);
    expect(r.recircLengthCells).toBe(5);
    expect(r.recircLengthBodyLengths).toBeCloseTo(5 / 8, 12);
  });

  it('counts reverse flow over the base box and the slant shell separately', () => {
    const flags = scene();
    const macro = macroOf(() => [1, 0.05, 0, 0]);
    // Reverse the whole slant shell (the two fluid layers above the roof at y=4) and leave the
    // base wake forward — separation ON the slant with no bubble behind it.
    for (let z = 3; z <= 7; z++)
      for (let x = geom.slantStartX; x < tailX; x++)
        for (let k = 1; k <= 2; k++) macro[4 * at(x, 4 + k, z) + 1] = -0.02;
    const r = wakeProbe(macro, flags, geom);
    expect(r.slantReverseFraction).toBe(1);
    expect(r.slantCells).toBe(5 * (tailX - geom.slantStartX) * 2);
    // The two regions are DISJOINT in x by construction — the slant shell lives over the body
    // (x < tailX), the base box strictly behind it (x >= tailX). Separation on the slant with
    // an attached base wake is a real Ahmed state, and the probe must be able to report it
    // rather than smearing one region's reverse flow into the other's fraction.
    expect(r.baseReverseFraction).toBe(0);
    expect(r.baseCells).toBeGreaterThan(0);
  });

  it('reads a counter-rotating vortex pair as antisymmetric: asymmetry ≈ 0', () => {
    // u_z = s(z)·(y − yc) with s = −1 left of the mid-plane and +1 right of it gives
    // ∂u_z/∂y = ∓1, i.e. equal and opposite ω_x either side. u_y = 0 so ∂u_y/∂z drops out
    // except at the seam, which the mid-plane column is excluded from.
    const zMid = Math.round((nz - 1) / 2);
    const macro = macroOf((_x, y, z) => {
      const s = z < zMid ? -1 : z > zMid ? 1 : 0;
      return [1, 0.05, 0, 0.001 * s * (y - 3)];
    });
    const r = wakeProbe(macro, scene(), geom);
    expect(r.gammaLeft).toBeLessThan(0);
    expect(r.gammaRight).toBeGreaterThan(0);
    expect(r.cPillarAsymmetry).toBeLessThan(0.05);
    expect(r.meanAbsOmegaX).toBeGreaterThan(0);
  });

  it('reads a one-sided vortex as maximally asymmetric: asymmetry ≈ 1', () => {
    const zMid = Math.round((nz - 1) / 2);
    const macro = macroOf((_x, y, z) => [1, 0.05, 0, z < zMid ? 0.001 * (y - 3) : 0]);
    const r = wakeProbe(macro, scene(), geom);
    expect(r.gammaRight).toBeCloseTo(0, 9);
    expect(Math.abs(r.gammaLeft)).toBeGreaterThan(0);
    expect(r.cPillarAsymmetry).toBeCloseTo(1, 6);
  });

  it('gets the ω_x sign right for each term independently', () => {
    // ω_x = ∂u_z/∂y − ∂u_y/∂z. A pure +∂u_z/∂y must read positive; a pure +∂u_y/∂z negative.
    const a = wakeProbe(
      macroOf((_x, y) => [1, 0, 0, 0.001 * y]),
      scene(),
      geom,
    );
    expect(a.gammaLeft + a.gammaRight).toBeGreaterThan(0);
    const b = wakeProbe(
      macroOf((_x, _y, z) => [1, 0, 0.001 * z, 0]),
      scene(),
      geom,
    );
    expect(b.gammaLeft + b.gammaRight).toBeLessThan(0);
  });

  it('never differences across a boundary or through the body', () => {
    // Huge values on every non-fluid cell. A one-sided difference reaching into the shell or
    // the body would swamp the interior signal; the result must stay at the interior's scale.
    const flags = scene();
    const macro = macroOf((x, y, z) => {
      const f = flags[at(x, y, z)];
      return f === CellType.Fluid ? [1, 0.05, 0, 0] : [1, 1e6, 1e6, 1e6];
    });
    const r = wakeProbe(macro, flags, geom);
    expect(r.peakAbsOmegaX).toBeCloseTo(0, 9);
    expect(r.vorticityCells).toBeGreaterThan(0);
  });
});
