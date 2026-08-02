import { describe, expect, it } from 'vitest';
import {
  clearCheckpoints,
  latestCheckpoint,
  restoreCheckpoint,
  saveCheckpoint,
} from '../src/sim/checkpoint';
import type { Lbm3D } from '../src/sim/lbm3d';

/**
 * Checkpoint orchestration emulation (M9 step 4) — same de-risking pattern as
 * voxelEmu/kernel3dEmu: exercise the real checkpoint.ts logic headlessly against
 * (a) a minimal in-memory IndexedDB fake implementing exactly the request/transaction
 * surface checkpoint.ts touches, and (b) a fake Lbm3D whose "GPU buffers" are byte
 * arrays. What the browser session still has to verify is only the WebGPU readback and
 * real-IDB behavior; every branch of the orchestration (slot double-buffering, chunk
 * round-trip, torn-save abort, incomplete-checkpoint detection, meta validation) is
 * proven here.
 */

// --- Minimal IndexedDB fake (the subset checkpoint.ts uses) --------------------------
type Stored = Map<string, unknown>;

function fakeRequest<T>(result: () => T): IDBRequest<T> {
  const req = {
    result: undefined as T,
    error: null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  queueMicrotask(() => {
    try {
      req.result = result();
      req.onsuccess?.();
    } catch (e) {
      (req as { error: unknown }).error = e;
      req.onerror?.();
    }
  });
  return req as unknown as IDBRequest<T>;
}

function fakeDb(data: Stored = new Map()): IDBDatabase & { data: Stored } {
  const store = {
    put: (value: unknown, key: string) =>
      fakeRequest(() => {
        data.set(key, value);
        return key;
      }),
    get: (key: string) => fakeRequest(() => data.get(key)),
    clear: () => fakeRequest(() => data.clear()),
  };
  return {
    data,
    transaction: () => ({ objectStore: () => store }),
  } as unknown as IDBDatabase & { data: Stored };
}

// --- Fake sim: "GPU buffers" are Uint8Arrays ----------------------------------------
function fakeSim(sizes: number[], fill: number): Lbm3D & { bufs: Uint8Array[] } {
  const bufs = sizes.map((s, k) => {
    const b = new Uint8Array(s);
    for (let i = 0; i < s; i++) b[i] = (fill + 7 * k + i) & 0xff;
    return b;
  });
  const sim = {
    nx: 8,
    ny: 4,
    nz: 4,
    precision: 'fp16' as const,
    totalSteps: 100,
    currentParity: 0 as 0 | 1,
    bufs,
    ddfBufferSizes: () => sizes.slice(),
    readDdfChunk: (b: number, off: number, len: number) =>
      Promise.resolve(bufs[b].slice(off, off + len).buffer),
    writeDdfChunk: (b: number, off: number, bytes: ArrayBuffer) =>
      bufs[b].set(new Uint8Array(bytes), off),
    restoreStepState(parity: 0 | 1, steps: number) {
      sim.currentParity = parity;
      sim.totalSteps = steps;
    },
  };
  return sim as unknown as Lbm3D & { bufs: Uint8Array[] };
}

const SIZES = [96, 40]; // two split buffers, chunkBytes 32 ⇒ 3+2 chunks, last ones short

describe('checkpoint orchestration (emulated IDB + sim)', () => {
  it('round-trips bytes, parity, steps, and force history exactly', async () => {
    const db = fakeDb();
    const src = fakeSim(SIZES, 3);
    const saved = await saveCheckpoint(db, src, {
      sceneId: 'emu',
      sceneOptions: { maxCells: 42 },
      forceHistory: {
        sampleIntervalSteps: 2,
        convectiveTimeSteps: 10,
        capacity: 8,
        totalPushed: 3,
        cumulativeSum: [6, 0, 0],
        samples: [1, 0, 0, 1, 2, 0, 0, 1.5, 3, 0, 0, 2],
      },
      runState: { samples: 3 },
      chunkBytes: 32,
    });
    expect(saved.slot).toBe('A');
    expect(saved.bytes).toBe(96 + 40);

    const dst = fakeSim(SIZES, 200); // different contents; restore must overwrite all
    const meta = await restoreCheckpoint(db, dst);
    expect(meta).not.toBeNull();
    expect(dst.bufs[0]).toEqual(src.bufs[0]);
    expect(dst.bufs[1]).toEqual(src.bufs[1]);
    expect(dst.totalSteps).toBe(100);
    expect(dst.currentParity).toBe(0);
    expect(meta?.forceHistory?.cumulativeSum).toEqual([6, 0, 0]);
    expect(meta?.runState).toEqual({ samples: 3 });
    expect(meta?.sceneOptions).toEqual({ maxCells: 42 });
  });

  it('double-buffers slots and keeps the previous checkpoint until the next completes', async () => {
    const db = fakeDb();
    const sim = fakeSim(SIZES, 1);
    expect(
      (await saveCheckpoint(db, sim, { sceneId: 's', sceneOptions: null, chunkBytes: 32 })).slot,
    ).toBe('A');
    sim.totalSteps = 102;
    expect(
      (await saveCheckpoint(db, sim, { sceneId: 's', sceneOptions: null, chunkBytes: 32 })).slot,
    ).toBe('B');
    sim.totalSteps = 104;
    expect(
      (await saveCheckpoint(db, sim, { sceneId: 's', sceneOptions: null, chunkBytes: 32 })).slot,
    ).toBe('A');
    expect((await latestCheckpoint(db))?.totalSteps).toBe(104);
    // Slot B still holds the complete previous checkpoint (torn-save insurance).
    expect(db.data.get('B/meta')).toMatchObject({ totalSteps: 102 });
  });

  it('aborts a save when the sim steps mid-save (torn checkpoint)', async () => {
    const db = fakeDb();
    const sim = fakeSim(SIZES, 9);
    let reads = 0;
    const realRead = sim.readDdfChunk.bind(sim);
    (sim as { readDdfChunk: typeof sim.readDdfChunk }).readDdfChunk = (b, off, len) => {
      if (++reads === 3) sim.totalSteps += 2; // "the loop stepped during the save"
      return realRead(b, off, len);
    };
    await expect(
      saveCheckpoint(db, sim, { sceneId: 's', sceneOptions: null, chunkBytes: 32 }),
    ).rejects.toThrow('torn');
    // latest was never flipped — restore still sees nothing.
    expect(await latestCheckpoint(db)).toBeNull();
  });

  it('fails restore loudly on missing chunks and on config mismatch', async () => {
    const db = fakeDb();
    const sim = fakeSim(SIZES, 5);
    await saveCheckpoint(db, sim, { sceneId: 's', sceneOptions: null, chunkBytes: 32 });

    db.data.delete('A/ddf/1/1'); // simulate partial eviction
    await expect(restoreCheckpoint(db, fakeSim(SIZES, 0))).rejects.toThrow('incomplete');

    const wrongLayout = fakeSim([96, 44], 0);
    await expect(restoreCheckpoint(db, wrongLayout)).rejects.toThrow('layout');
  });

  it('restore returns null with no checkpoint; clearCheckpoints removes everything', async () => {
    const db = fakeDb();
    expect(await restoreCheckpoint(db, fakeSim(SIZES, 0))).toBeNull();
    const sim = fakeSim(SIZES, 5);
    await saveCheckpoint(db, sim, { sceneId: 's', sceneOptions: null, chunkBytes: 32 });
    await clearCheckpoints(db);
    expect(db.data.size).toBe(0);
    expect(await restoreCheckpoint(db, sim)).toBeNull();
  });
});
