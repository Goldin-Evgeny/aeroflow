import { describe, expect, it } from 'vitest';
import { quarantineRun, type QuarantineTarget } from '../src/sim/ahmedRun';
import {
  clearCheckpoints,
  latestCheckpoint,
  restoreCheckpoint,
  saveCheckpoint,
} from '../src/sim/checkpoint';
import type { Lbm3D } from '../src/sim/lbm3d';

/**
 * The diverged-run teardown (M9 step 7 — the Cs sweep).
 *
 * A Cs ladder is only a controlled comparison if every rung starts from the same fresh state.
 * A rung at reduced Cs is EXPECTED to diverge, and a diverging run has two ways to leak into
 * its successor: the unconditional 5-minute auto-save can persist NaN DDFs to IndexedDB (which
 * survives navigation), and its ~0.5 GB of DDF buffers may not be collected before the next
 * rung asks for its own allocation — an OOM there would read as a physics result.
 *
 * Emulated headlessly against the same fakes checkpointEmu uses: a minimal in-memory IDB
 * implementing exactly the surface checkpoint.ts touches, and a fake sim whose "GPU buffers"
 * are byte arrays. The real `clearCheckpoints` runs against the real record layout, so
 * "the checkpoint is gone" is proven by the same code path the worker takes, not by a spy.
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

const SIZES = [96, 40];

/** A fake sim that records its own destruction, so "destroyed" is observable. */
function fakeSim(fill: number): Lbm3D & { bufs: Uint8Array[]; destroyed: boolean } {
  const bufs = SIZES.map((s, k) => {
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
    destroyed: false,
    ddfBufferSizes: () => SIZES.slice(),
    readDdfChunk: (b: number, off: number, len: number) =>
      Promise.resolve(bufs[b].slice(off, off + len).buffer),
    writeDdfChunk: (b: number, off: number, bytes: ArrayBuffer) =>
      bufs[b].set(new Uint8Array(bytes), off),
    restoreStepState(parity: 0 | 1, steps: number) {
      sim.currentParity = parity;
      sim.totalSteps = steps;
    },
    destroy() {
      sim.destroyed = true;
    },
  };
  return sim as unknown as Lbm3D & { bufs: Uint8Array[]; destroyed: boolean };
}

function fakeDevice(): { destroy(): void; destroyed: boolean } {
  const d = {
    destroyed: false,
    destroy() {
      d.destroyed = true;
    },
  };
  return d;
}

/** A run that has just saved a checkpoint — i.e. the state a diverging rung leaves behind. */
async function divergedRun(): Promise<{
  target: QuarantineTarget;
  db: IDBDatabase & { data: Stored };
  sim: ReturnType<typeof fakeSim>;
  device: ReturnType<typeof fakeDevice>;
}> {
  const db = fakeDb();
  // NaN-filled DDFs are what an auto-save during divergence actually persists; the fake
  // stores raw bytes, so the fill value only stands in for "poison from the failed rung".
  const sim = fakeSim(0xff);
  const device = fakeDevice();
  await saveCheckpoint(db, sim, {
    sceneId: 'ahmed-rung',
    sceneOptions: { maxCells: 42 },
    chunkBytes: 32,
  });
  expect(await latestCheckpoint(db)).not.toBeNull(); // precondition: there IS state to leak
  return { target: { db, sim, gpu: { device } }, db, sim, device };
}

describe('quarantineRun — a diverged rung cleans up after itself', () => {
  it('clears the checkpoint the failed run persisted', async () => {
    const { target, db } = await divergedRun();

    await quarantineRun(target, clearCheckpoints);

    expect(await latestCheckpoint(db)).toBeNull();
    expect(db.data.size).toBe(0);
  });

  it('destroys the sim and the GPU device', async () => {
    const { target, sim, device } = await divergedRun();

    await quarantineRun(target, clearCheckpoints);

    expect(sim.destroyed).toBe(true);
    expect(device.destroyed).toBe(true);
  });

  it('leaves the next rung nothing to resume from', async () => {
    const { target, db } = await divergedRun();

    await quarantineRun(target, clearCheckpoints);

    // The next rung builds a FRESH sim and tries to resume. It must find nothing and start
    // clean — not silently inherit the previous rung's poisoned DDFs, which is precisely how
    // one diverged rung would contaminate every rung after it.
    const next = fakeSim(3);
    const before = next.bufs.map((b) => b.slice());
    expect(await restoreCheckpoint(db, next)).toBeNull();
    expect(next.bufs[0]).toEqual(before[0]);
    expect(next.bufs[1]).toEqual(before[1]);
    expect(next.totalSteps).toBe(100); // untouched: restoreStepState never ran
  });

  it('completes every teardown step even when the first one throws', async () => {
    // The likeliest way to reach quarantine is a LOST device, and a lost device throws from
    // exactly these calls. One try block around all three would let the first failure skip
    // the rest, leaving the GPU allocation the teardown exists to release.
    const { target, sim, device } = await divergedRun();
    const failingClear = (): Promise<void> => Promise.reject(new Error('IDB is gone'));

    await expect(quarantineRun(target, failingClear)).resolves.toBeUndefined();

    expect(sim.destroyed).toBe(true);
    expect(device.destroyed).toBe(true);
  });

  it('still destroys the device when sim.destroy() throws, and never rethrows', async () => {
    const { target, device, db } = await divergedRun();
    target.sim = {
      destroy() {
        throw new Error('sim already gone');
      },
    };

    // Must not replace the physics error message with a teardown one.
    await expect(quarantineRun(target, clearCheckpoints)).resolves.toBeUndefined();

    expect(device.destroyed).toBe(true);
    expect(await latestCheckpoint(db)).toBeNull();
  });
});
