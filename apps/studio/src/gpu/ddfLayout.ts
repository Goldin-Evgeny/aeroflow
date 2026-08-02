/**
 * DDF buffer layout planner for the 3D D3Q19 solver (M6, step 6).
 *
 * The 19 direction planes are stored SoA direction-major (`slot = i·N + idx`,
 * `idx = x + Nx·(y + Ny·z)`) and split across several `GPUBuffer`s so that every storage
 * binding stays ≤ the device's negotiated `maxStorageBufferBindingSize` (2 GiB on the
 * desktop reference box, ~1 GiB on iOS): a 256³ FP32 lattice is 19 × 67 MB ≈ 1.27 GB of
 * DDFs, which no single binding is guaranteed to hold.
 *
 * The per-binding cap — not device VRAM — is what bounds the largest runnable lattice.
 * `maxAddressableCells()` states that ceiling and names which binding hits it first;
 * docs/decisions/D1-resolution-wall.md carries the measured consequences.
 *
 * Per-cell byte budget (Lehmann 2022 Esoteric-Pull analysis; FluidX3D README figures
 * for corroboration only — numbers, never source):
 *   FP32 = 19×4 DDF + 1 flag + 16 macro = 93 B/cell
 *   FP16 = 19×2 DDF + 1 flag + 16 macro = 55 B/cell
 * `bytesPerCell()` sums ACTUAL allocation sizes (acceptance criterion #1).
 */

export type Precision = 'fp32' | 'fp16';

/** Native storage width of one DDF value. FP16 = the `shader-f16` path (2 B). */
export function ddfBytes(precision: Precision): number {
  return precision === 'fp16' ? 2 : 4;
}

/** DDF direction count (D3Q19). */
export const Q = 19;

/** Macro output components: rho, ux, uy, uz, each stored in its own f32 binding. */
export const MACRO_COMPONENTS = 4;
export const MACRO_COMPONENT_BYTES_PER_CELL = 4;
/** Total macro allocation across all four component buffers. */
export const MACRO_BYTES_PER_CELL = MACRO_COMPONENTS * MACRO_COMPONENT_BYTES_PER_CELL;

/**
 * Per-binding cap assumed when the device's real limit is unknown — a caller that has a
 * `GPUDevice` should pass `deviceBindingCap(caps)` instead.
 *
 * This used to be a hard `min()` clamp applied on top of the negotiated limit, for iOS
 * portability. That was measurably self-defeating: the negotiated value already IS the
 * device's own answer (iOS reports ~1 GiB by itself), so clamping only shrank what desktop
 * could address. Lifted 2026-07-27 per docs/decisions/D1-resolution-wall.md §3, once a real
 * reading confirmed the desktop reference box grants 2 GiB and 16 storage bindings.
 */
export const DEFAULT_BINDING_BYTES = 1024 * 1024 * 1024;

/**
 * The per-binding cap a device actually supports for a whole-bound storage buffer: a buffer
 * must satisfy BOTH limits, and they are not always equal.
 */
export function deviceBindingCap(caps: {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
}): number {
  return Math.min(caps.maxStorageBufferBindingSize, caps.maxBufferSize);
}

/**
 * Maximum DDF storage buffers the kernel can bind. `Lbm3D` throws above this, so any
 * feasibility predicate must apply the SAME cap — see `gridFits`/`maxAddressableCells`.
 *
 * Together with the binding cap this — not device VRAM — is what bounds the largest
 * runnable lattice. Raising it means more storage bindings per shader stage: check
 * `maxStorageBuffersPerShaderStage` against `storageBindingsNeeded()` first.
 */
export const MAX_DDF_BUFFERS = 4;

/** Per-cell momentum-exchange force (vec3f at 16 B stride), allocated only when forces are on. */
export const CELL_FORCE_BYTES_PER_CELL = 16;

/**
 * Fixed storage bindings the kernel always holds besides the DDF group: flags, four macro
 * components, and the outlet snapshot. Binding 0 is a uniform and does not count against
 * the storage limit.
 */
const FIXED_STORAGE_BINDINGS = 6;

/** Optional kernel features that add storage bindings (and, for forces, per-cell bytes). */
export interface KernelBindings {
  /** Momentum-exchange collection adds `cellForce` — one binding at 16 B/cell. */
  forces?: boolean;
  /** ABL inlet adds `inletProfile` + `velInletRho` — two small, non-per-cell bindings. */
  abl?: boolean;
}

/**
 * Storage bindings the 3D kernel needs simultaneously, to compare against the device's
 * `maxStorageBuffersPerShaderStage`. The worst case (4 DDF buffers + forces + ABL) is **13**,
 * which is above the WebGPU spec default of 8 — the app requests the adapter's advertised
 * maximum, so a device that only offers the default cannot run the forces+ABL configuration
 * at all. `Lbm3D` checks this up front rather than failing opaquely at pipeline creation.
 */
export function storageBindingsNeeded(numDdfBuffers: number, k: KernelBindings = {}): number {
  return numDdfBuffers + FIXED_STORAGE_BINDINGS + (k.forces ? 1 : 0) + (k.abl ? 2 : 0);
}

/** Round a byte count up to a 4-byte boundary (WebGPU buffer size alignment). */
function align4(bytes: number): number {
  return Math.ceil(bytes / 4) * 4;
}

export interface DdfBufferPlan {
  /** Logical direction indices [0..18] whose planes live in this buffer, in order. */
  directions: number[];
  /** Total allocated byte size of the buffer. */
  bytes: number;
}

export interface DdfLayout {
  nx: number;
  ny: number;
  nz: number;
  /** Cell count Nx·Ny·Nz. */
  cells: number;
  precision: Precision;
  /** DDF planes grouped into 4–8 buffers, each ≤ the binding cap. */
  ddfBuffers: DdfBufferPlan[];
  /** Byte size of the packed cell-flag buffer (4 cells per u32 word). */
  flagsBytes: number;
  /** Total byte size of the four macro output buffers (rho + ux/uy/uz, f32). */
  macroBytes: number;
  /** Sum of every allocation above (DDF + flags + macro). */
  totalBytes: number;
}

/** Packed flags: one byte per cell, 4 cells per u32 word ⇒ ceil(N/4) words. */
export function flagsBytes(cells: number): number {
  return align4(Math.ceil(cells / 4) * 4);
}

/**
 * Plan the DDF/flag/macro buffers for an Nx×Ny×Nz D3Q19 lattice.
 *
 * @param maxBindingBytes the device's per-binding cap — pass `deviceBindingCap(caps)`.
 *        Defaults to the conservative `DEFAULT_BINDING_BYTES` when the device is unknown.
 * @throws if a single direction plane already exceeds the effective binding cap (the
 *         grid is simply too large for this device — the caller should skip it).
 */
export function planDdfLayout(
  nx: number,
  ny: number,
  nz: number,
  precision: Precision,
  maxBindingBytes: number = DEFAULT_BINDING_BYTES,
): DdfLayout {
  const cells = nx * ny * nz;
  const planeBytes = align4(cells * ddfBytes(precision));
  const cap = maxBindingBytes;

  if (planeBytes > cap) {
    throw new Error(
      `single DDF plane (${planeBytes} B) exceeds the binding cap (${cap} B) for ${nx}³-class grid`,
    );
  }

  // Greedy contiguous packing: fill a buffer with whole planes until the next would
  // overflow the cap, then start a new buffer. Contiguous direction ranges keep the
  // shader's buffer-selection arithmetic a simple division.
  const perBuffer = Math.max(1, Math.floor(cap / planeBytes));
  const ddfBuffers: DdfBufferPlan[] = [];
  for (let start = 0; start < Q; start += perBuffer) {
    const directions: number[] = [];
    for (let i = start; i < Math.min(start + perBuffer, Q); i++) directions.push(i);
    ddfBuffers.push({ directions, bytes: directions.length * planeBytes });
  }

  const fb = flagsBytes(cells);
  const mb = align4(cells * MACRO_BYTES_PER_CELL);
  const ddfTotal = ddfBuffers.reduce((s, b) => s + b.bytes, 0);

  return {
    nx,
    ny,
    nz,
    cells,
    precision,
    ddfBuffers,
    flagsBytes: fb,
    macroBytes: mb,
    totalBytes: ddfTotal + fb + mb,
  };
}

/**
 * Per-cell byte cost from ACTUAL allocation sizes (acceptance criterion #1). Slightly
 * above the nominal 93/55 for small grids due to alignment padding; ~exact at 256³.
 */
export function bytesPerCell(layout: DdfLayout): number {
  return layout.totalBytes / layout.cells;
}

/** Does an Nx×Ny×Nz grid at `precision` fit within the device's binding + buffer caps? */
export function gridFits(
  nx: number,
  ny: number,
  nz: number,
  precision: Precision,
  maxBindingBytes: number,
  maxBufferBytes: number,
): boolean {
  const cells = nx * ny * nz;
  const planeBytes = align4(cells * ddfBytes(precision));
  const cap = maxBindingBytes;
  if (planeBytes > cap || planeBytes > maxBufferBytes) return false;
  // The plane fitting a binding is necessary but NOT sufficient: the 19 planes must also
  // group into ≤ MAX_DDF_BUFFERS bindings or `Lbm3D` throws at construction. Omitting
  // this check reported grids as feasible that failed at scene build (e.g. the M11
  // Case C 183 M-cell grid: plane 366 MB fits 1 GiB, but needs 10 buffers).
  const perBuffer = Math.max(1, Math.floor(cap / planeBytes));
  if (Math.ceil(Q / perBuffer) > MAX_DDF_BUFFERS) return false;
  // A grouped DDF buffer is `perBuffer` planes, which must be a legal buffer as well as a
  // legal binding (maxBufferSize ≥ maxStorageBufferBindingSize on real devices, but the
  // predicate should not assume it).
  if (Math.min(perBuffer, Q) * planeBytes > maxBufferBytes) return false;
  // Each macro component is a whole-bound scalar f32 buffer. Their combined allocation is
  // still 16 B/cell, but the per-binding cost is only 4 B/cell. Optional cellForce storage
  // is checked by Lbm3D when forces are enabled; this predicate models the base kernel.
  const macroComponentBytes = align4(cells * MACRO_COMPONENT_BYTES_PER_CELL);
  if (macroComponentBytes > cap || macroComponentBytes > maxBufferBytes) return false;
  return true;
}

/**
 * Largest cell count the kernel can address at `precision` — the honest ceiling implied by
 * the effective binding cap, independent of how much VRAM the device has. Answers "would a
 * bigger GPU help?" (it would not, until the cap is raised).
 *
 * Two independent bindings compete for the title of "first to blow the cap":
 *
 * - **DDF planes** — `ceil(19/4) = 5` planes must share one binding, so `5·ddfBytes`/cell.
 *   FP32: 20 B/cell (the binding cost). FP16: 10 B/cell.
 * - **macro component** (ρ, ux, uy, or uz as f32) — 4 B/cell in each whole-bound buffer.
 *
 * DDF storage therefore binds first in both precisions (20 > 4 for FP32, 10 > 4 for FP16).
 * The four-way macro split is what makes the strict M11 Case C grid addressable at the
 * measured 2 GiB cap without changing the 16 B/cell total allocation.
 */
export function maxAddressableCells(
  precision: Precision,
  maxBindingBytes: number = DEFAULT_BINDING_BYTES,
): number {
  // ≤ MAX_DDF_BUFFERS bindings for Q planes needs ceil(Q / perBuffer) ≤ MAX_DDF_BUFFERS,
  // i.e. perBuffer ≥ ceil(Q / MAX_DDF_BUFFERS) planes per binding.
  const minPerBuffer = Math.ceil(Q / MAX_DDF_BUFFERS);
  const byDdf = Math.floor(maxBindingBytes / minPerBuffer / ddfBytes(precision));
  const byMacro = Math.floor(maxBindingBytes / MACRO_COMPONENT_BYTES_PER_CELL);
  return Math.min(byDdf, byMacro);
}

/**
 * Smallest per-binding cap that would admit `cells` at `precision` — the inverse of
 * `maxAddressableCells`, for answering "how big a binding does this grid need?" without
 * search. Used to state the M11 Case C requirement as a number rather than a guess.
 */
export function bindingCapForCells(cells: number, precision: Precision): number {
  const minPerBuffer = Math.ceil(Q / MAX_DDF_BUFFERS);
  return Math.max(
    cells * minPerBuffer * ddfBytes(precision),
    cells * MACRO_COMPONENT_BYTES_PER_CELL,
  );
}
