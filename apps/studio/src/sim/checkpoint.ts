import type { Lbm3D } from './lbm3d';
import {
  CHECKPOINT_DB,
  CHECKPOINT_STORE,
  CHECKPOINT_VERSION,
  DEFAULT_CHUNK_BYTES,
  LATEST_KEY,
  chunkKey,
  metaKey,
  planAllChunks,
  saveSlotFor,
  validateMetaAgainst,
  type CheckpointMeta,
  type CheckpointSlot,
} from './checkpointFormat';
import type { ForceHistoryState } from '@aeroflow/core';

/**
 * IndexedDB checkpoint/restore for long GPU runs (M9 step 4). Record layout and all pure
 * logic live in checkpointFormat.ts (tested); this file is the I/O glue. Works on the
 * main thread and in the M9 worker (IndexedDB is available in dedicated workers).
 *
 * Save protocol (torn-save-proof): pick the slot `latest` does NOT point to, stream DDF
 * chunks GPU→IndexedDB one at a time (memory stays ≤ chunkBytes even for ~1 GB of state
 * — never materialize the whole image), write the meta record, then flip `latest`.
 * A crash mid-save leaves `latest` on the previous complete checkpoint.
 *
 * IndexedDB transactions auto-commit when the task queue empties, so every await of GPU
 * work happens OUTSIDE a transaction: one-shot transactions per record.
 */

export function openCheckpointDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CHECKPOINT_DB, CHECKPOINT_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(CHECKPOINT_STORE)) {
        req.result.createObjectStore(CHECKPOINT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
  });
}

/** Best-effort eviction protection; returns whether the browser granted persistence. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

function op<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE, mode);
    const req = run(tx.objectStore(CHECKPOINT_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB operation failed'));
  });
}

const put = (db: IDBDatabase, key: string, value: unknown): Promise<IDBValidKey> =>
  op(db, 'readwrite', (s) => s.put(value, key));
const get = <T>(db: IDBDatabase, key: string): Promise<T | undefined> =>
  op<T | undefined>(db, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);

export interface SaveCheckpointOptions {
  sceneId: string;
  sceneOptions: unknown;
  forceHistory?: ForceHistoryState;
  runState?: unknown;
  chunkBytes?: number;
}

export interface SaveCheckpointResult {
  slot: CheckpointSlot;
  bytes: number;
  ms: number;
}

export async function saveCheckpoint(
  db: IDBDatabase,
  sim: Lbm3D,
  opts: SaveCheckpointOptions,
): Promise<SaveCheckpointResult> {
  const t0 = performance.now();
  const latest = await get<CheckpointSlot>(db, LATEST_KEY);
  const slot = saveSlotFor(latest);
  const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const sizes = sim.ddfBufferSizes();
  // Capture the step bookkeeping BEFORE streaming: the caller must not step the sim
  // during a save (the chunks would tear across steps), and this pins what we claim.
  const parity = sim.currentParity;
  const totalSteps = sim.totalSteps;

  let bytes = 0;
  for (const chunk of planAllChunks(sizes, chunkBytes)) {
    const data = await sim.readDdfChunk(chunk.bufIndex, chunk.offset, chunk.length);
    await put(db, chunkKey(slot, chunk), data);
    bytes += chunk.length;
  }
  if (sim.currentParity !== parity || sim.totalSteps !== totalSteps) {
    throw new Error('saveCheckpoint: sim was stepped during the save — checkpoint torn');
  }

  const meta: CheckpointMeta = {
    version: CHECKPOINT_VERSION,
    sceneId: opts.sceneId,
    sceneOptions: opts.sceneOptions,
    nx: sim.nx,
    ny: sim.ny,
    nz: sim.nz,
    precision: sim.precision,
    parity,
    totalSteps,
    ddfBufferSizes: sizes,
    chunkBytes,
    forceHistory: opts.forceHistory ?? null,
    runState: opts.runState,
    savedAt: Date.now(),
    saveMs: 0,
  };
  meta.saveMs = performance.now() - t0;
  await put(db, metaKey(slot), meta);
  await put(db, LATEST_KEY, slot);
  return { slot, bytes, ms: meta.saveMs };
}

/** Meta of the latest complete checkpoint, or null if none exists. */
export async function latestCheckpoint(db: IDBDatabase): Promise<CheckpointMeta | null> {
  const latest = await get<CheckpointSlot>(db, LATEST_KEY);
  if (!latest) return null;
  return (await get<CheckpointMeta>(db, metaKey(latest))) ?? null;
}

/**
 * Restore the latest checkpoint into a freshly built sim (same scene/config — validated
 * hard). Returns the meta (with the force-history state for the caller to rehydrate),
 * or null when no checkpoint exists. Never partially applies: validation runs before
 * the first byte is written.
 */
export async function restoreCheckpoint(
  db: IDBDatabase,
  sim: Lbm3D,
  expectedSceneId?: string,
): Promise<CheckpointMeta | null> {
  const latest = await get<CheckpointSlot>(db, LATEST_KEY);
  if (!latest) return null;
  const meta = await get<CheckpointMeta>(db, metaKey(latest));
  if (!meta) return null;
  validateMetaAgainst(meta, sim, sim.ddfBufferSizes(), expectedSceneId);

  for (const chunk of planAllChunks(meta.ddfBufferSizes, meta.chunkBytes)) {
    const data = await get<ArrayBuffer>(db, chunkKey(latest, chunk));
    if (!data || data.byteLength !== chunk.length) {
      throw new Error(
        `restoreCheckpoint: chunk ${chunkKey(latest, chunk)} missing or wrong size — ` +
          `checkpoint incomplete (evicted storage?)`,
      );
    }
    sim.writeDdfChunk(chunk.bufIndex, chunk.offset, data);
  }
  sim.restoreStepState(meta.parity, meta.totalSteps);
  return meta;
}

/** Drop all checkpoint records (both slots + pointer). */
export async function clearCheckpoints(db: IDBDatabase): Promise<void> {
  await op(db, 'readwrite', (s) => s.clear());
}
