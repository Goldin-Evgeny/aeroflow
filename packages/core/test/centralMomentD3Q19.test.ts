import { describe, expect, it } from 'vitest';
import {
  D3Q19_CENTRAL_EXPONENTS,
  centralMomentAttractorsD3Q19,
  centralMomentMatrixD3Q19,
  centralMomentsD3Q19,
  collideD3Q19Central,
  conservedD3Q19,
  equilibriumD3Q19Central,
  populationsFromCentralMomentsD3Q19,
  streamCollideBoundedD3Q19Central,
  streamCollidePeriodicD3Q19Central,
} from '../src/cpu/centralMomentD3Q19.js';

const maxAbs = (values: ArrayLike<number>): number =>
  Array.from(values).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

describe('D3Q19 central-moment Float64 authority', () => {
  it('has a full 19-moment basis and round-trips manufactured moments', () => {
    expect(D3Q19_CENTRAL_EXPONENTS).toHaveLength(19);
    expect(new Set(D3Q19_CENTRAL_EXPONENTS.map((entry) => entry.join(','))).size).toBe(19);
    const transform = centralMomentMatrixD3Q19(0.07, -0.03, 0.02);
    const populations = Float64Array.from({ length: 19 }, (_, index) => 0.01 + index * 0.001);
    const moments = Float64Array.from(transform, (row) =>
      row.reduce((sum, coefficient, direction) => sum + coefficient * populations[direction], 0),
    );
    const restored = populationsFromCentralMomentsD3Q19(transform, moments);
    expect(maxAbs(restored.map((value, index) => value - populations[index]))).toBeLessThan(2e-15);
  });

  it('constructs Maxwell attractors with the requested conserved state', () => {
    const equilibrium = equilibriumD3Q19Central(1.03, 0.08, -0.02, 0.01);
    const [rho, mx, my, mz] = conservedD3Q19(equilibrium);
    expect(rho).toBeCloseTo(1.03, 13);
    expect(mx / rho).toBeCloseTo(0.08, 13);
    expect(my / rho).toBeCloseTo(-0.02, 13);
    expect(mz / rho).toBeCloseTo(0.01, 13);
    const moments = centralMomentsD3Q19(equilibrium, mx / rho, my / rho, mz / rho);
    const target = centralMomentAttractorsD3Q19(rho);
    expect(maxAbs(moments.map((value, index) => value - target[index]))).toBeLessThan(2e-15);
  });

  it('preserves equilibrium and local collision invariants at Galilean backgrounds', () => {
    for (const velocity of [
      [0, 0, 0],
      [0.05, 0, 0],
      [0.1, -0.03, 0.02],
    ] as const) {
      const populations = equilibriumD3Q19Central(1, velocity[0], velocity[1], velocity[2]);
      const before = populations.slice();
      const result = collideD3Q19Central(populations, { tau0: 0.5000042 });
      expect(result.invariantResidual.maximumAbs).toBeLessThan(2e-15);
      expect(maxAbs(populations.map((value, index) => value - before[index]))).toBeLessThan(2e-15);
      expect(result.rates).toMatchObject({ bulk: 1, nonHydrodynamic: 1 });
    }
  });

  it('relaxes all stress orientations and threads both LES conventions', () => {
    const base = equilibriumD3Q19Central(1, 0.05, 0.01, -0.02);
    for (const pair of [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [11, 12],
      [15, 16],
    ] as const) {
      const populations = base.slice();
      populations[pair[0]] += 1e-5;
      populations[pair[1]] += 1e-5;
      const legacy = collideD3Q19Central(populations.slice(), {
        tau0: 0.5000042,
        lesCs: 0.1,
        lesNorm: 'legacy',
      });
      const spec = collideD3Q19Central(populations.slice(), {
        tau0: 0.5000042,
        lesCs: 0.1,
        lesNorm: 'spec',
      });
      expect(legacy.invariantResidual.maximumAbs).toBeLessThan(2e-15);
      expect(spec.invariantResidual.maximumAbs).toBeLessThan(2e-15);
      expect(legacy.tauEff).toBeGreaterThan(0.5000042);
      expect(spec.tauEff).toBeGreaterThan(0.5000042);
      expect(legacy.tauEff).not.toBe(spec.tauEff);
    }
  });

  it('runs isolated periodic and bounded diagnostic fields', () => {
    const grid = { nx: 4, ny: 3, nz: 2 };
    const cells = grid.nx * grid.ny * grid.nz;
    const equilibrium = equilibriumD3Q19Central(1, 0, 0, 0);
    const source = new Float64Array(cells * 19);
    for (let direction = 0; direction < 19; direction++) {
      source.fill(equilibrium[direction], direction * cells, (direction + 1) * cells);
    }
    const periodic = new Float64Array(source.length);
    let periodicObserved = 0;
    streamCollidePeriodicD3Q19Central(source, periodic, grid, { tau0: 0.8 }, () => {
      periodicObserved++;
    });
    expect(periodicObserved).toBe(cells);
    expect(maxAbs(periodic.map((value, index) => value - source[index]))).toBeLessThan(2e-15);

    const cellType = new Uint8Array(cells);
    cellType[5] = 1;
    const bounded = new Float64Array(source.length);
    let boundedObserved = 0;
    streamCollideBoundedD3Q19Central(source, bounded, { ...grid, cellType }, { tau0: 0.8 }, () => {
      boundedObserved++;
    });
    expect(boundedObserved).toBe(cells - 1);
    expect(maxAbs(bounded.map((value, index) => value - source[index]))).toBeLessThan(2e-15);
  });

  it('rejects invalid configuration and population state', () => {
    expect(() => collideD3Q19Central(new Float64Array(18), { tau0: 0.8 })).toThrow(/19/);
    expect(() => collideD3Q19Central(new Float64Array(19), { tau0: 0.5 })).toThrow(/tau0/);
    expect(() =>
      collideD3Q19Central(equilibriumD3Q19Central(1, 0, 0, 0), {
        tau0: 0.8,
        lesCs: -1,
      }),
    ).toThrow(/lesCs/);
    expect(() => collideD3Q19Central(new Float64Array(19), { tau0: 0.8 })).toThrow(/rho/);
  });
});
