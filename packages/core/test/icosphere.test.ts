import { describe, expect, it } from 'vitest';
import { icosphere } from '../src/geometry/icosphere.js';

/**
 * Icosphere generator invariants. A subdivided icosahedron has V = 10·4^s + 2 vertices and
 * F = 20·4^s faces (Euler characteristic 2, every subdivision quadruples faces); every
 * vertex lies exactly on the sphere by construction. The s=7 case (163,842 vertices) is the
 * regression guard for the midpoint-cache key packing: with the old 65536 multiplier, keys
 * collide once vertex indices pass 65,535, merging unrelated edges and dropping vertices —
 * exactly the regime the M8 1M-triangle voxelization benchmark mesh (s=8) lives in.
 */
describe('icosphere', () => {
  it('has the exact icosahedral-subdivision vertex/face counts up to subdiv 7', () => {
    for (const s of [0, 1, 2, 3, 5, 7]) {
      const mesh = icosphere(s, 1, 0, 0, 0);
      expect(mesh.positions.length / 3, `vertices at subdiv ${s}`).toBe(10 * 4 ** s + 2);
      expect(mesh.indices.length / 3, `faces at subdiv ${s}`).toBe(20 * 4 ** s);
    }
  });

  it('places every vertex on the sphere (subdiv 7, past the old cache-key range)', () => {
    const r = 12.5;
    const [cx, cy, cz] = [3, -4, 5.5];
    const mesh = icosphere(7, r, cx, cy, cz);
    let worst = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const d = Math.hypot(
        mesh.positions[i] - cx,
        mesh.positions[i + 1] - cy,
        mesh.positions[i + 2] - cz,
      );
      worst = Math.max(worst, Math.abs(d - r));
    }
    expect(worst).toBeLessThan(1e-5 * r);
  });

  it('references every vertex and no out-of-range index (subdiv 7)', () => {
    const mesh = icosphere(7, 1, 0, 0, 0);
    const nVerts = mesh.positions.length / 3;
    const used = new Uint8Array(nVerts);
    let outOfRange = 0;
    for (const idx of mesh.indices) {
      if (idx >= nVerts) outOfRange++;
      else used[idx] = 1;
    }
    expect(outOfRange).toBe(0);
    expect(used.every((u) => u === 1)).toBe(true);
  });
});
