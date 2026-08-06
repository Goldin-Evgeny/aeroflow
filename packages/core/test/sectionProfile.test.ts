import { describe, expect, it } from 'vitest';
import { CellType, sectionStats, upstreamStations } from '../src/index.js';

/**
 * M9 acceptance-1 diagnostics. These are analytic checks on constructed sections — the
 * point of the module is to report the approach flow honestly, so its own arithmetic is
 * pinned against hand-computable cases rather than against a simulation.
 */
describe('sectionStats', () => {
  const nx = 4;
  const ny = 6;
  const nz = 5;
  const idx = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  // The macro readback is Float32Array, so 0.05 is stored as 0.05000000074505806. Expected
  // values go through Math.fround for the same reason the solver's own tests do: the check
  // is on this module's arithmetic, not on f32's ability to represent a decimal.
  const f = Math.fround;

  /** Uniform section at (rho, ux), with y=0 solid ground. */
  function build(uxOf: (y: number) => number, rhoOf: (y: number) => number = () => 1) {
    const flags = new Uint8Array(nx * ny * nz);
    const macro = new Float32Array(4 * nx * ny * nz);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const i = idx(x, y, z);
          if (y === 0) {
            flags[i] = CellType.Solid;
            continue;
          }
          macro[4 * i] = rhoOf(y);
          macro[4 * i + 1] = uxOf(y);
        }
      }
    }
    return { flags, macro };
  }

  it('reduces to the plain velocity on a uniform section, with zero non-uniformity', () => {
    const { flags, macro } = build(() => 0.05);
    const s = sectionStats(macro, flags, nx, ny, nz, 1);

    // 5 fluid layers (y=1..5) × 5 z = 25 cells; the ground row is excluded.
    expect(s.fluidCells).toBe((ny - 1) * nz);
    expect(s.areaMeanUx).toBeCloseTo(f(0.05), 12);
    expect(s.bulkUx).toBeCloseTo(f(0.05), 12);
    expect(s.meanRho).toBeCloseTo(1, 12);
    expect(s.stdUx).toBeCloseTo(0, 12);
    expect(s.nonUniformity).toBeCloseTo(0, 12);
    // Every layer is at the peak, so the core starts at the first fluid layer and the
    // boundary layer is zero cells thick.
    expect(s.yCore).toBe(1);
    expect(s.blThicknessCells).toBe(0);
    expect(s.coreMeanUx).toBeCloseTo(f(0.05), 12);
    expect(s.massFlux).toBeCloseTo(f(0.05) * (ny - 1) * nz, 10);
  });

  it('excludes a sheared near-ground layer from the core by the δ99 rule', () => {
    // y=1,2 are retarded (a "boundary layer"); y=3..5 are at freestream 0.05.
    const { flags, macro } = build((y) => (y === 1 ? 0.01 : y === 2 ? 0.03 : 0.05));
    const s = sectionStats(macro, flags, nx, ny, nz, 1);

    // Core is y=3..5 only: 3 layers × 5 z.
    expect(s.yCore).toBe(3);
    expect(s.coreCells).toBe(3 * nz);
    expect(s.coreMeanUx).toBeCloseTo(f(0.05), 12);
    expect(s.blThicknessCells).toBe(2); // yCore(3) − lowest fluid y(1)

    // The whole-section average is dragged down by the boundary layer — which is exactly
    // why the core figure is reported separately.
    expect(s.areaMeanUx).toBeCloseTo((f(0.01) + f(0.03) + f(0.05) * 3) / 5, 12);
    expect(s.areaMeanUx).toBeLessThan(s.coreMeanUx);
    expect(s.nonUniformity).toBeGreaterThan(0);
  });

  it('weights the bulk velocity by mass, so denser layers count for more', () => {
    // Uniform ux ⇒ bulk == area mean regardless of density weighting.
    const uniform = sectionStats(
      build(
        () => 0.05,
        (y) => 1 + 0.1 * y,
      ).macro,
      build(
        () => 0.05,
        (y) => 1 + 0.1 * y,
      ).flags,
      nx,
      ny,
      nz,
      1,
    );
    expect(uniform.bulkUx).toBeCloseTo(uniform.areaMeanUx, 12);

    // Fast layers made denser ⇒ mass-flux average exceeds the plain area average.
    const { flags, macro } = build(
      (y) => (y <= 2 ? 0.01 : 0.05),
      (y) => (y <= 2 ? 1 : 2),
    );
    const s = sectionStats(macro, flags, nx, ny, nz, 1);
    expect(s.bulkUx).toBeGreaterThan(s.areaMeanUx);
    // Hand-computed: Σρu = 5·(2·0.01 + 3·2·0.05)=5·0.32=1.6 ; Σρ = 5·(2·1+3·2)=40
    const flux = nz * (2 * f(0.01) * 1 + 3 * 2 * f(0.05));
    expect(s.massFlux).toBeCloseTo(flux, 10);
    expect(s.bulkUx).toBeCloseTo(flux / 40, 12);
  });

  it('ignores BodySolid cells as well as Solid ones', () => {
    const { flags, macro } = build(() => 0.05);
    // Bury a body voxel in the section; its macro slot holds stale zeros.
    flags[idx(1, 3, 2)] = CellType.BodySolid;
    const s = sectionStats(macro, flags, nx, ny, nz, 1);
    expect(s.fluidCells).toBe((ny - 1) * nz - 1);
    // Had the body cell been counted, its zero velocity would have pulled the mean below
    // the uniform value.
    expect(s.areaMeanUx).toBeCloseTo(f(0.05), 12);
  });

  it('reports a fully solid section without throwing', () => {
    const flags = new Uint8Array(nx * ny * nz).fill(CellType.Solid);
    const macro = new Float32Array(4 * nx * ny * nz);
    const s = sectionStats(macro, flags, nx, ny, nz, 2);
    expect(s.fluidCells).toBe(0);
    expect(s.massFlux).toBe(0);
    expect(s.yCore).toBe(-1);
    expect(Number.isNaN(s.bulkUx)).toBe(true);
  });

  it('rejects an out-of-range station rather than reading garbage', () => {
    const { flags, macro } = build(() => 0.05);
    expect(() => sectionStats(macro, flags, nx, ny, nz, nx)).toThrow(/outside/);
    expect(() => sectionStats(macro, flags, nx, ny, nz, -1)).toThrow(/outside/);
  });
});

describe('upstreamStations', () => {
  it('gives near-inlet, midway, and just-upstream-of-nose stations', () => {
    expect(upstreamStations(100)).toEqual([2, 50, 97]);
  });

  it('collapses duplicates and never probes the inlet plane on a short fetch', () => {
    const s = upstreamStations(4);
    expect(s[0]).toBeGreaterThanOrEqual(2);
    expect(new Set(s).size).toBe(s.length);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
  });
});
