import { describe, expect, it } from 'vitest';
import { sphereMask } from '../src/geometry/sphere.js';
import { CellType } from '../src/lattice.js';

/**
 * M7 step 1 acceptance: the analytic sphere mask must approximate a true sphere (voxel
 * count → (4/3)πr³ as r grows) and be exactly reflection-symmetric about its center — an
 * asymmetric mask would show as spurious time-averaged lift on the drag sphere (M7 pitfall).
 */
describe('sphereMask', () => {
  const countSolid = (m: Uint8Array): number => {
    let n = 0;
    for (let i = 0; i < m.length; i++) if (m[i] === CellType.Solid) n++;
    return n;
  };

  it.each([12, 24])('voxel count is within 2%% of (4/3)πr³ for r=%i', (r) => {
    const n = 4 * r + 1; // ample margin around a center-placed sphere
    const c = 2 * r; // integer center
    const mask = sphereMask(n, n, n, c, c, c, r);
    const analytic = (4 / 3) * Math.PI * r * r * r;
    const rel = Math.abs(countSolid(mask) - analytic) / analytic;
    expect(rel).toBeLessThanOrEqual(0.02);
  });

  // Explicit timeout: ~5 s of work that trips the 5 s default when the M10 fetch/inlet
  // tests load all cores in parallel (observed 2026-07-18) — a scheduling margin, not a
  // tolerance change.
  it('is symmetric under reflection about the center in x, y, z', { timeout: 30_000 }, () => {
    const r = 16;
    const n = 4 * r + 1;
    const c = 2 * r;
    const mask = sphereMask(n, n, n, c, c, c, r);
    const at = (x: number, y: number, z: number) => mask[x + n * (y + n * z)];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const v = at(x, y, z);
          // Reflect each axis through the integer center (2c − i stays in-bounds for i∈[0,4r]).
          expect(at(2 * c - x, y, z)).toBe(v);
          expect(at(x, 2 * c - y, z)).toBe(v);
          expect(at(x, y, 2 * c - z)).toBe(v);
        }
  });

  it('marks a cell solid iff its center is strictly inside (halfway-BB convention)', () => {
    const r = 5;
    const n = 21;
    const c = 10;
    const mask = sphereMask(n, n, n, c, c, c, r);
    const at = (x: number, y: number, z: number) => mask[x + n * (y + n * z)];
    expect(at(c, c, c)).toBe(CellType.Solid); // center: distance 0 < r
    expect(at(c + r - 1, c, c)).toBe(CellType.Solid); // distance r−1 < r
    expect(at(c + r, c, c)).toBe(CellType.Fluid); // distance exactly r is NOT inside (strict <)
    expect(at(c + r + 1, c, c)).toBe(CellType.Fluid); // outside
  });
});
