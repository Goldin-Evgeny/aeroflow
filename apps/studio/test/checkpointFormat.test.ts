import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_VERSION,
  chunkKey,
  metaKey,
  planAllChunks,
  planChunks,
  saveSlotFor,
  validateMetaAgainst,
  type CheckpointMeta,
} from '../src/sim/checkpointFormat';

/**
 * Checkpoint record layout (M9 step 4), the pure half: chunk plans must tile each buffer
 * exactly (no gap, no overlap, 4-byte aligned), keys must be collision-free across
 * buffers/slots, and restore validation must reject every mismatch the GPU side cannot
 * detect on its own. The IndexedDB/GPU halves are browser-verified via the ?ahmed page.
 */
describe('planChunks', () => {
  it('tiles the buffer exactly with the last chunk short', () => {
    const chunks = planChunks(100, 32);
    expect(chunks.map((c) => [c.offset, c.length])).toEqual([
      [0, 32],
      [32, 32],
      [64, 32],
      [96, 4],
    ]);
    expect(chunks.reduce((s, c) => s + c.length, 0)).toBe(100);
  });

  it('handles empty and exact-multiple sizes', () => {
    expect(planChunks(0, 32)).toEqual([]);
    const exact = planChunks(64, 32);
    expect(exact).toHaveLength(2);
    expect(exact[1]).toMatchObject({ offset: 32, length: 32 });
  });

  it('rejects unaligned sizes (WebGPU copies are 4-byte aligned)', () => {
    expect(() => planChunks(101, 32)).toThrow('multiple of 4');
    expect(() => planChunks(100, 30)).toThrow('multiple of 4');
    expect(() => planChunks(-4, 32)).toThrow();
  });

  it('planAllChunks assigns buffer indices and unique keys', () => {
    const all = planAllChunks([64, 40], 32);
    expect(all.map((c) => chunkKey('A', c))).toEqual([
      'A/ddf/0/0',
      'A/ddf/0/1',
      'A/ddf/1/0',
      'A/ddf/1/1',
    ]);
    const keys = new Set([
      ...all.map((c) => chunkKey('A', c)),
      ...all.map((c) => chunkKey('B', c)),
    ]);
    expect(keys.size).toBe(8); // no collisions across slots either
    expect(metaKey('A')).not.toBe(metaKey('B'));
  });
});

describe('saveSlotFor', () => {
  it('always picks the inactive slot (first save goes to A)', () => {
    expect(saveSlotFor(undefined)).toBe('A');
    expect(saveSlotFor('A')).toBe('B');
    expect(saveSlotFor('B')).toBe('A');
  });
});

describe('validateMetaAgainst', () => {
  const meta: CheckpointMeta = {
    version: CHECKPOINT_VERSION,
    sceneId: 'ahmed',
    sceneOptions: {},
    nx: 64,
    ny: 32,
    nz: 32,
    precision: 'fp32',
    parity: 1,
    totalSteps: 101,
    ddfBufferSizes: [64 * 32 * 32 * 19 * 4],
    chunkBytes: 1024,
    forceHistory: null,
    savedAt: 0,
    saveMs: 0,
  };
  const sim = { nx: 64, ny: 32, nz: 32, precision: 'fp32' as const };

  it('accepts a matching sim', () => {
    expect(() => validateMetaAgainst(meta, sim, meta.ddfBufferSizes)).not.toThrow();
  });

  it('rejects grid, precision, layout, version, and parity mismatches', () => {
    expect(() => validateMetaAgainst({ ...meta, nx: 65 }, sim, meta.ddfBufferSizes)).toThrow(
      'grid',
    );
    expect(() =>
      validateMetaAgainst({ ...meta, precision: 'fp16' }, sim, meta.ddfBufferSizes),
    ).toThrow('precision');
    expect(() => validateMetaAgainst(meta, sim, [meta.ddfBufferSizes[0] / 2])).toThrow('layout');
    expect(() => validateMetaAgainst(meta, sim, [meta.ddfBufferSizes[0], 4])).toThrow('layout');
    expect(() => validateMetaAgainst({ ...meta, version: 99 }, sim, meta.ddfBufferSizes)).toThrow(
      'version',
    );
    expect(() =>
      validateMetaAgainst({ ...meta, totalSteps: 100 }, sim, meta.ddfBufferSizes),
    ).toThrow('parity');
    expect(() => validateMetaAgainst(meta, sim, meta.ddfBufferSizes, 'urban-E-0')).toThrow('scene');
  });
});
