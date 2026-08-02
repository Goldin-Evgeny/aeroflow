import { describe, expect, it } from 'vitest';
import { interpolateMacroPointReadback, planMacroPointReadback } from '../src/sim/macroPoints';

describe('macro point readback', () => {
  it('deduplicates corner cells and exactly samples a trilinear field', () => {
    const nx = 3;
    const ny = 3;
    const nz = 3;
    const points = [
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 1.25, y: 0.25, z: 1.5 },
    ];
    const plan = planMacroPointReadback(points, nx, ny, nz);
    expect(plan.cellIndices.length).toBeLessThan(points.length * 8);

    const cellMacros = new Float32Array(plan.cellIndices.length * 4);
    for (let slot = 0; slot < plan.cellIndices.length; slot++) {
      const index = plan.cellIndices[slot];
      const x = index % nx;
      const y = Math.floor(index / nx) % ny;
      const z = Math.floor(index / (nx * ny));
      cellMacros.set([1, x + 2 * y + 3 * z, 2 * x - y + z, x + y - 2 * z], slot * 4);
    }
    const sampled = interpolateMacroPointReadback(cellMacros, plan);
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const { x, y, z } = points[pointIndex];
      expect(Array.from(sampled.slice(pointIndex * 4, pointIndex * 4 + 4))).toEqual([
        1,
        x + 2 * y + 3 * z,
        2 * x - y + z,
        x + y - 2 * z,
      ]);
    }
  });

  it('clamps out-of-grid points and rejects malformed inputs', () => {
    const plan = planMacroPointReadback([{ x: -5, y: 8, z: 1 }], 3, 3, 3);
    const cells = new Float32Array(plan.cellIndices.length * 4);
    for (let slot = 0; slot < plan.cellIndices.length; slot++) {
      cells.fill(plan.cellIndices[slot], slot * 4, slot * 4 + 4);
    }
    const sampled = interpolateMacroPointReadback(cells, plan);
    expect(sampled[0]).toBe(15); // clamped cell (x=0,y=2,z=1)
    expect(() => planMacroPointReadback([{ x: NaN, y: 0, z: 0 }], 3, 3, 3)).toThrow(/non-finite/);
    expect(() => interpolateMacroPointReadback(new Float32Array(0), plan)).toThrow(/values/);
  });
});
