import type { ForceHistoryState } from '@aeroflow/core';
import type { Precision } from '../gpu/ddfLayout';

/**
 * Checkpoint record layout + chunking plan (M9 step 4), kept pure and vitest-testable;
 * `checkpoint.ts` owns the IndexedDB I/O and `Lbm3D.readDdfChunk/writeDdfChunk` the GPU
 * side. Layout: one object store, double-buffered slots (save to the inactive slot, flip
 * the `latest` pointer last), chunked DDF records keyed `slot/ddf/bufIndex/chunkIndex` —
 * single huge `put()` calls fail on some browsers (M9 pitfall), and meta-written-last
 * makes a torn save invisible to restore.
 */

export const CHECKPOINT_DB = 'aeroflow';
export const CHECKPOINT_STORE = 'checkpoints';
export const CHECKPOINT_VERSION = 1;
/** ≤ 256 MiB respects spec-default copy/staging limits (M9 pitfall); 64 MiB is friendlier. */
export const DEFAULT_CHUNK_BYTES = 64 * 1024 * 1024;

export type CheckpointSlot = 'A' | 'B';
export const LATEST_KEY = 'latest';

export interface CheckpointMeta {
  version: number;
  /** Scene identity + options blob the page uses to rebuild the identical sim. */
  sceneId: string;
  sceneOptions: unknown;
  nx: number;
  ny: number;
  nz: number;
  precision: Precision;
  parity: 0 | 1;
  totalSteps: number;
  /** Byte length of each DDF split buffer at save time (restore validates against it). */
  ddfBufferSizes: number[];
  chunkBytes: number;
  forceHistory: ForceHistoryState | null;
  /** Scene-owned JSON-safe state (for example M11 velocity averages). */
  runState?: unknown;
  savedAt: number;
  /** Wall-clock ms the save took (progress panel diagnostic). */
  saveMs: number;
}

export interface ChunkRef {
  bufIndex: number;
  chunkIndex: number;
  offset: number;
  length: number;
}

/** Split one buffer into ≤ chunkBytes pieces, 4-byte aligned (WebGPU copy requirement). */
export function planChunks(byteLength: number, chunkBytes = DEFAULT_CHUNK_BYTES): ChunkRef[] {
  if (byteLength < 0 || byteLength % 4 !== 0) {
    throw new Error(`planChunks: byteLength ${byteLength} must be a non-negative multiple of 4`);
  }
  if (chunkBytes < 4 || chunkBytes % 4 !== 0) {
    throw new Error(`planChunks: chunkBytes ${chunkBytes} must be a positive multiple of 4`);
  }
  const chunks: ChunkRef[] = [];
  for (let offset = 0, i = 0; offset < byteLength; offset += chunkBytes, i++) {
    chunks.push({
      bufIndex: -1,
      chunkIndex: i,
      offset,
      length: Math.min(chunkBytes, byteLength - offset),
    });
  }
  return chunks;
}

/** All chunk refs for a set of DDF buffers (bufIndex filled in). */
export function planAllChunks(bufferSizes: number[], chunkBytes = DEFAULT_CHUNK_BYTES): ChunkRef[] {
  return bufferSizes.flatMap((size, bufIndex) =>
    planChunks(size, chunkBytes).map((c) => ({ ...c, bufIndex })),
  );
}

export const metaKey = (slot: CheckpointSlot): string => `${slot}/meta`;
export const chunkKey = (slot: CheckpointSlot, c: ChunkRef): string =>
  `${slot}/ddf/${c.bufIndex}/${c.chunkIndex}`;

/** Double-buffer: always save into the slot `latest` does NOT point to. */
export function saveSlotFor(latest: CheckpointSlot | undefined): CheckpointSlot {
  return latest === 'A' ? 'B' : 'A';
}

/** Restore-side validation: the meta must match the freshly built sim exactly. */
export function validateMetaAgainst(
  meta: CheckpointMeta,
  sim: { nx: number; ny: number; nz: number; precision: Precision },
  ddfBufferSizes: number[],
  expectedSceneId?: string,
): void {
  if (meta.version !== CHECKPOINT_VERSION) {
    throw new Error(`checkpoint version ${meta.version} ≠ ${CHECKPOINT_VERSION}`);
  }
  if (meta.nx !== sim.nx || meta.ny !== sim.ny || meta.nz !== sim.nz) {
    throw new Error(
      `checkpoint grid ${meta.nx}×${meta.ny}×${meta.nz} ≠ sim ${sim.nx}×${sim.ny}×${sim.nz}`,
    );
  }
  if (meta.precision !== sim.precision) {
    throw new Error(`checkpoint precision ${meta.precision} ≠ sim ${sim.precision}`);
  }
  if (expectedSceneId !== undefined && meta.sceneId !== expectedSceneId) {
    throw new Error(`checkpoint scene ${meta.sceneId} ≠ expected ${expectedSceneId}`);
  }
  if (
    meta.ddfBufferSizes.length !== ddfBufferSizes.length ||
    meta.ddfBufferSizes.some((s, i) => s !== ddfBufferSizes[i])
  ) {
    throw new Error(
      `checkpoint DDF layout [${meta.ddfBufferSizes}] ≠ sim [${ddfBufferSizes}] ` +
        `(different binding-size negotiation? restore on the device tier that saved it)`,
    );
  }
  if (meta.totalSteps % 2 !== meta.parity) {
    throw new Error(`checkpoint corrupt: parity ${meta.parity} vs totalSteps ${meta.totalSteps}`);
  }
}
