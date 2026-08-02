import { describe, expect, it } from 'vitest';
import {
  bindingCapForCells,
  bytesPerCell,
  deviceBindingCap,
  gridFits,
  planDdfLayout,
  storageBindingsNeeded,
  Q,
  MACRO_COMPONENT_BYTES_PER_CELL,
  DEFAULT_BINDING_BYTES,
  MAX_DDF_BUFFERS,
  maxAddressableCells,
} from '../src/gpu/ddfLayout';

/**
 * Acceptance criterion #1 (M6): bytesPerCell from ACTUAL allocation sizes
 * ≤ 93 B/cell (FP32) and ≤ 55 B/cell (FP16). Numbers per the Lehmann 2022
 * Esoteric-Pull memory analysis (19×4/2 DDF + 1 flag + 16 macro).
 */
describe('ddfLayout — per-cell budget (acceptance #1)', () => {
  it('FP32 hits 93 B/cell at 256³', () => {
    const layout = planDdfLayout(256, 256, 256, 'fp32');
    // 256³ is a multiple of 4 ⇒ no alignment padding ⇒ exactly nominal.
    expect(bytesPerCell(layout)).toBe(93);
  });

  it('FP16 hits 55 B/cell at 256³', () => {
    const layout = planDdfLayout(256, 256, 256, 'fp16');
    expect(bytesPerCell(layout)).toBe(55);
  });

  it('stays within budget across the benchmark ladder', () => {
    for (const n of [128, 192, 256]) {
      expect(bytesPerCell(planDdfLayout(n, n, n, 'fp32'))).toBeLessThanOrEqual(93);
      expect(bytesPerCell(planDdfLayout(n, n, n, 'fp16'))).toBeLessThanOrEqual(55);
    }
  });
});

describe('ddfLayout — buffer grouping', () => {
  it('covers all 19 directions exactly once, contiguously', () => {
    const layout = planDdfLayout(256, 256, 256, 'fp32');
    const seen = layout.ddfBuffers.flatMap((b) => b.directions);
    expect(seen).toEqual([...Array(Q).keys()]); // 0..18 in order
  });

  it('keeps every DDF binding ≤ the default 1 GiB cap at 256³ FP32', () => {
    const layout = planDdfLayout(256, 256, 256, 'fp32');
    for (const b of layout.ddfBuffers) {
      expect(b.bytes).toBeLessThanOrEqual(DEFAULT_BINDING_BYTES);
    }
    // 256³ FP32: plane = 64 MiB, ~16 planes/GiB ⇒ 2 buffers.
    expect(layout.ddfBuffers.length).toBeGreaterThanOrEqual(2);
  });

  it('uses a uniform stride the shader can route by division (#5)', () => {
    // The kernel's ld/st route plane → (buffer = plane/perBuffer, local = plane%perBuffer).
    // That is only correct if every buffer but the last holds exactly perBuffer planes,
    // grouped contiguously. Force a 6-plane cap on 32³ FP32 ⇒ 4 buffers (6+6+6+1).
    const planeBytes = 32 * 32 * 32 * 4;
    const layout = planDdfLayout(32, 32, 32, 'fp32', 6 * planeBytes);
    expect(layout.ddfBuffers.length).toBe(4);
    const perBuffer = layout.ddfBuffers[0].directions.length;
    expect(perBuffer).toBe(6);
    layout.ddfBuffers.forEach((b, k) => {
      // All but the last are full; the last carries the remainder.
      if (k < layout.ddfBuffers.length - 1) expect(b.directions.length).toBe(perBuffer);
      b.directions.forEach((plane, local) => {
        expect(Math.floor(plane / perBuffer)).toBe(k); // buffer index by division
        expect(plane % perBuffer).toBe(local); // local slot by modulo
      });
    });
  });

  it('respects a smaller negotiated binding cap', () => {
    // 128 MiB spec-default cap: 128³ FP32 plane = 8 MiB ⇒ 16 planes/binding ⇒ 2 buffers.
    const cap = 128 * 1024 * 1024;
    const layout = planDdfLayout(128, 128, 128, 'fp32', cap);
    for (const b of layout.ddfBuffers) expect(b.bytes).toBeLessThanOrEqual(cap);
  });

  it('throws when a single plane exceeds the cap', () => {
    // 256³ FP32 plane = 64 MiB > 32 MiB cap.
    expect(() => planDdfLayout(256, 256, 256, 'fp32', 32 * 1024 * 1024)).toThrow(/plane/);
  });
});

describe('ddfLayout — gridFits', () => {
  it('accepts 256³ under generous limits, rejects under spec defaults', () => {
    const big = 4 * 1024 * 1024 * 1024;
    expect(gridFits(256, 256, 256, 'fp32', big, big)).toBe(true);
    // Spec-default 128 MiB binding: 256³ plane (64 MiB) fits a binding but…
    // choose a stricter check: 512³ FP32 plane = 512 MiB > 128 MiB binding.
    expect(gridFits(512, 512, 512, 'fp32', 128 * 1024 * 1024, big)).toBe(false);
  });

  /**
   * `gridFits` must agree with what `Lbm3D` actually accepts. A plane fitting one binding
   * is necessary but not sufficient — the 19 planes must also group into
   * ≤ MAX_DDF_BUFFERS bindings. Before this was enforced, `gridFits` reported the M11
   * Case C grid as feasible and the run failed later, at solver construction.
   */
  it('rejects grids whose planes cannot group into ≤ MAX_DDF_BUFFERS bindings', () => {
    const big = 8 * 1024 * 1024 * 1024;
    const cap = DEFAULT_BINDING_BYTES;
    // M11 Case C V14: 183 M cells FP16 ⇒ plane 366 MB (fits a 1 GiB binding) but only 2
    // planes per binding ⇒ ceil(19/2) = 10 buffers ⇒ over the buffer-count cap. Ample
    // maxBufferSize does not rescue it — this is a per-BINDING limit.
    const cells = 183_000_000;
    const layout = planDdfLayout(cells, 1, 1, 'fp16', cap);
    expect(layout.ddfBuffers.length).toBeGreaterThan(MAX_DDF_BUFFERS);
    expect(gridFits(cells, 1, 1, 'fp16', cap, big)).toBe(false);
  });

  it('checks each split macro component against the binding cap', () => {
    const big = 8 * 1024 * 1024 * 1024;
    const cap = DEFAULT_BINDING_BYTES;
    // This grid was rejected when rho/u shared one 16 B/cell binding. Four scalar bindings
    // cost 4 B/cell each, so the DDF group now sets the ceiling and 80 M cells fit.
    const cells = 80_000_000;
    expect(planDdfLayout(cells, 1, 1, 'fp16', cap).ddfBuffers.length).toBeLessThanOrEqual(
      MAX_DDF_BUFFERS,
    );
    expect(cells * MACRO_COMPONENT_BYTES_PER_CELL).toBeLessThan(cap);
    expect(gridFits(cells, 1, 1, 'fp16', cap, big)).toBe(true);
  });

  it('agrees with planDdfLayout at the ceiling and one cell past it', () => {
    const big = 8 * 1024 * 1024 * 1024;
    // Swept across caps so the agreement is a property of the model, not of one number.
    for (const cap of [DEFAULT_BINDING_BYTES, 2 * 1024 ** 3, 128 * 1024 * 1024]) {
      for (const precision of ['fp32', 'fp16'] as const) {
        const ceiling = maxAddressableCells(precision, cap);
        expect(planDdfLayout(ceiling, 1, 1, precision, cap).ddfBuffers.length).toBeLessThanOrEqual(
          MAX_DDF_BUFFERS,
        );
        expect(gridFits(ceiling, 1, 1, precision, cap, big)).toBe(true);
        // One cell more must tip it over — the ceiling is exact, not conservative.
        expect(gridFits(ceiling + 1, 1, 1, precision, cap, big)).toBe(false);
      }
    }
  });
});

/**
 * The largest runnable lattice is bounded by storage BINDINGS, not device VRAM. After the
 * four-way macro split, DDF storage loses first in both precisions:
 *
 *   FP32 — DDF-bound: ceil(19/4)=5 planes × 4 B = 20 B/cell of binding ⇒ 53.7 M at 1 GiB
 *   FP16 — DDF-bound: ceil(19/4)=5 planes × 2 B = 10 B/cell of binding ⇒ 107.4 M at 1 GiB
 *
 * A 24 GB card is already far larger than this, so a bigger GPU buys nothing until the
 * binding cap is raised. These figures are quoted in the resolution-wall decision record
 * (docs/decisions/D1-resolution-wall.md) — if this test changes, update that record.
 */
describe('ddfLayout — addressable ceiling (cloud/hardware go-no-go)', () => {
  it('pins the FP16 and FP32 ceilings at the 1 GiB binding cap', () => {
    expect(maxAddressableCells('fp16')).toBe(107_374_182);
    expect(maxAddressableCells('fp32')).toBe(53_687_091);
  });

  it('identifies the DDF group as the FP16 binding that fails first', () => {
    const cap = DEFAULT_BINDING_BYTES;
    const byMacro = Math.floor(cap / MACRO_COMPONENT_BYTES_PER_CELL);
    const byDdf = Math.floor(cap / Math.ceil(Q / MAX_DDF_BUFFERS) / 2);
    expect(byDdf).toBeLessThan(byMacro); // 107.4 M < 268.4 M
    expect(maxAddressableCells('fp16')).toBe(byDdf);
  });

  it('caps total allocation near 5.5 GiB — far under a 24 GB card', () => {
    const layout = planDdfLayout(maxAddressableCells('fp16'), 1, 1, 'fp16');
    const giB = layout.totalBytes / 1024 ** 3;
    expect(giB).toBeGreaterThan(5);
    expect(giB).toBeLessThan(6);
  });

  /**
   * **The M11 Case C architectural unblock.** The measured RTX 3090 cap is 2 GiB. Splitting
   * macro into four scalar bindings removes the old 2.727 GiB whole-buffer requirement, so
   * the DDF group now sets a 1.704 GiB requirement and the strict 183 M-cell grid fits.
   */
  it('prices M11 Case C below the 2.0 GiB the reference box grants', () => {
    const caseCcells = 183_000_000;
    const measured3090Cap = 2 * 1024 ** 3; // measured maxStorageBufferBindingSize
    const needed = bindingCapForCells(caseCcells, 'fp16');
    expect(needed / 1024 ** 3).toBeCloseTo(1.704, 3);
    expect(needed).toBeLessThan(measured3090Cap);
    expect(maxAddressableCells('fp16', measured3090Cap)).toBeGreaterThan(caseCcells);
    expect(caseCcells * Math.ceil(Q / MAX_DDF_BUFFERS) * 2).toBe(needed);
    expect(caseCcells * MACRO_COMPONENT_BYTES_PER_CELL).toBeLessThan(needed);
  });

  it('honors the negotiated cap instead of clamping to the 1 GiB default', () => {
    // The clamp was self-imposed for iOS portability, not a WebGPU limit; iOS reports ~1 GiB
    // on its own, so clamping only shrank desktop. Lifted 2026-07-27 (D1 §3).
    const twoGiB = 2 * 1024 ** 3;
    expect(maxAddressableCells('fp16', twoGiB)).toBe(2 * maxAddressableCells('fp16'));
    expect(maxAddressableCells('fp32', twoGiB)).toBe(2 * maxAddressableCells('fp32'));
    // A device that genuinely offers ~1 GiB still gets the ~1 GiB ceiling — nothing about
    // the iOS path changed.
    expect(maxAddressableCells('fp16', DEFAULT_BINDING_BYTES)).toBe(107_374_182);
  });

  it('takes the smaller of the binding and buffer limits', () => {
    // maxBufferSize can be below maxStorageBufferBindingSize; a buffer must satisfy both.
    expect(deviceBindingCap({ maxStorageBufferBindingSize: 4e9, maxBufferSize: 2e9 })).toBe(2e9);
    expect(deviceBindingCap({ maxStorageBufferBindingSize: 1e9, maxBufferSize: 2e9 })).toBe(1e9);
  });
});

/**
 * The kernel's storage-binding COUNT is the other half of the D1 precondition: the worst-case
 * configuration needs 13 simultaneous storage buffers, above the WebGPU spec default of 8.
 * A device offering only the default cannot run forces+ABL at any grid size.
 */
describe('ddfLayout — storage binding count', () => {
  it('needs 13 bindings in the worst case (4 DDF + forces + ABL)', () => {
    expect(storageBindingsNeeded(MAX_DDF_BUFFERS, { forces: true, abl: true })).toBe(13);
  });

  it('exceeds the WebGPU spec default of 8 for the M11 urban configuration', () => {
    // M11 Case C: 4 DDF + flags + four macro components + outlet + two ABL buffers.
    expect(storageBindingsNeeded(4, { abl: true })).toBe(12);
    // The M6 benchmark configuration (no forces, no ABL) uses the full default at 2 DDFs.
    expect(storageBindingsNeeded(2)).toBe(8);
  });

  it('counts only storage buffers — binding 0 is a uniform', () => {
    expect(storageBindingsNeeded(1)).toBe(7); // 1 DDF + flags + 4 macro + outlet
  });
});
