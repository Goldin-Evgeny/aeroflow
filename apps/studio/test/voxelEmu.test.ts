import { describe, expect, it } from 'vitest';
import { CellType, icosphere, voxelizeSolid, triBoxOverlap } from '@aeroflow/core';

/**
 * TS emulation of the WGSL voxelization pipeline (the M6 debugging playbook: prove the
 * GPU algorithm headlessly before touching the GPU). Re-implements what the shaders do —
 * the u32 bitmask scatter (word = idx >> 5, bit = idx & 31: the atomicOr-indexing
 * pitfall in M8), face seeding, and ITERATIVE frontier propagation
 * (vs. the CPU reference's BFS) — and checks the final mask equals `voxelizeSolid()`
 * exactly. The ?voxparity browser harness then only has to catch WebGPU-specific bugs
 * (bindings, dispatch, atomics), not algorithm/indexing mistakes.
 */

interface Grid {
  nx: number;
  ny: number;
  nz: number;
}

/** Emulates voxelize_surface.wgsl: per-triangle cell-AABB scan + SAT into a u32 bitmask. */
function emuSurfaceBits(positions: Float32Array, indices: Uint32Array, grid: Grid): Uint32Array {
  const { nx, ny, nz } = grid;
  const bits = new Uint32Array(Math.ceil((nx * ny * nz) / 32));
  const v0 = [0, 0, 0];
  const v1 = [0, 0, 0];
  const v2 = [0, 0, 0];
  for (let t = 0; t < indices.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = indices[3 * t + k];
      const dst = k === 0 ? v0 : k === 1 ? v1 : v2;
      dst[0] = positions[3 * vi];
      dst[1] = positions[3 * vi + 1];
      dst[2] = positions[3 * vi + 2];
    }
    const x0 = Math.max(0, Math.ceil(Math.min(v0[0], v1[0], v2[0]) - 0.5));
    const x1 = Math.min(nx - 1, Math.floor(Math.max(v0[0], v1[0], v2[0]) + 0.5));
    const y0 = Math.max(0, Math.ceil(Math.min(v0[1], v1[1], v2[1]) - 0.5));
    const y1 = Math.min(ny - 1, Math.floor(Math.max(v0[1], v1[1], v2[1]) + 0.5));
    const z0 = Math.max(0, Math.ceil(Math.min(v0[2], v1[2], v2[2]) - 0.5));
    const z1 = Math.min(nz - 1, Math.floor(Math.max(v0[2], v1[2], v2[2]) + 0.5));
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (triBoxOverlap(v0, v1, v2, x, y, z)) {
            const idx = x + nx * (y + ny * z);
            bits[idx >> 5] |= 1 << (idx & 31); // the WGSL atomicOr word/bit convention
          }
        }
  }
  return bits;
}

/** Emulates voxelize_fill.wgsl: seed + repeated full-grid propagate sweeps to fixpoint. */
function emuFill(surfaceBits: Uint32Array, grid: Grid): Uint32Array {
  const { nx, ny, nz } = grid;
  const exterior = new Uint32Array(surfaceBits.length);
  const isSet = (b: Uint32Array, idx: number): boolean => (b[idx >> 5] & (1 << (idx & 31))) !== 0;
  const set = (b: Uint32Array, idx: number): void => {
    b[idx >> 5] |= 1 << (idx & 31);
  };
  // seed: every non-surface face cell
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const onFace =
          x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1;
        const idx = x + nx * (y + ny * z);
        if (onFace && !isSet(surfaceBits, idx)) set(exterior, idx);
      }
  // propagate: one thread per cell per pass, until a pass changes nothing
  let passes = 0;
  for (;;) {
    let changed = 0;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const idx = x + nx * (y + ny * z);
          if (isSet(surfaceBits, idx) || isSet(exterior, idx)) continue;
          const reached =
            (x > 0 && isSet(exterior, idx - 1)) ||
            (x < nx - 1 && isSet(exterior, idx + 1)) ||
            (y > 0 && isSet(exterior, idx - nx)) ||
            (y < ny - 1 && isSet(exterior, idx + nx)) ||
            (z > 0 && isSet(exterior, idx - nx * ny)) ||
            (z < nz - 1 && isSet(exterior, idx + nx * ny));
          if (reached) {
            set(exterior, idx);
            changed++;
          }
        }
    passes++;
    if (changed === 0) break;
    if (passes > 64 * (nx + ny + nz)) throw new Error('emuFill: no convergence');
  }
  return exterior;
}

function emuVoxelize(positions: Float32Array, indices: Uint32Array, grid: Grid): Uint8Array {
  const surface = emuSurfaceBits(positions, indices, grid);
  const exterior = emuFill(surface, grid);
  const n = grid.nx * grid.ny * grid.nz;
  const mask = new Uint8Array(n);
  for (let idx = 0; idx < n; idx++) {
    const ext = (exterior[idx >> 5] & (1 << (idx & 31))) !== 0;
    mask[idx] = ext ? CellType.Fluid : CellType.Solid;
  }
  return mask;
}

describe('WGSL voxelization pipeline emulation (bitmask + iterative fill)', () => {
  it('reproduces the CPU reference mask exactly on the T-VOX-SPHERE mesh', () => {
    const grid = { nx: 32, ny: 32, nz: 32 };
    const { positions, indices } = icosphere(3, 10.3, 15.5, 15.5, 15.5);
    const cpu = voxelizeSolid(positions, indices, grid);
    const emu = emuVoxelize(positions, indices, grid);
    expect(Buffer.compare(Buffer.from(emu), Buffer.from(cpu))).toBe(0);
  });

  it('reproduces the CPU mask on a dirty mesh (one triangle removed, hole seals)', () => {
    const grid = { nx: 32, ny: 32, nz: 32 };
    const { positions, indices } = icosphere(3, 10.3, 15.5, 15.5, 15.5);
    const dirty = indices.slice(3);
    const cpu = voxelizeSolid(positions, dirty, grid);
    const emu = emuVoxelize(positions, dirty, grid);
    expect(Buffer.compare(Buffer.from(emu), Buffer.from(cpu))).toBe(0);
    // and the ≤2-cell hole must have sealed: deep-interior cells stay solid
    const at = (x: number, y: number, z: number) => cpu[x + 32 * (y + 32 * z)];
    expect(at(15, 15, 15)).toBe(CellType.Solid);
  });

  it('bitmask word/bit indexing round-trips across word boundaries', () => {
    // idx 31 → word 0 bit 31; idx 32 → word 1 bit 0 — the swap corrupts distant cells.
    const bits = new Uint32Array(2);
    for (const idx of [31, 32]) bits[idx >> 5] |= 1 << (idx & 31);
    expect(bits[0]).toBe(0x80000000); // bit 31 set in word 0
    expect(bits[1]).toBe(1); // bit 0 set in word 1
  });
});
