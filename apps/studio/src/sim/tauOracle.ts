import {
  CellType,
  D3Q19,
  D3Q19_SPEC,
  equilibrium3,
  isSolid,
  piNeq,
  piNeqNorm,
  smagorinskyTauEff,
} from '@aeroflow/core';
import type { Lbm3D } from './lbm3d';

/**
 * τ_eff oracle (M9 step 6) — reconstruct the kernel's per-cell effective relaxation time on
 * the CPU, from the GPU's own DDF image.
 *
 * **Why a readback and not a GPU pass.** The kernel already computes τ_eff every step
 * (`stream_collide_3d.wgsl`, the LES block) and throws it away, because there is nowhere to
 * put it: the macro output is split four ways to fit D1's measured 2.000 GiB/binding and
 * 16 storage-buffers/stage caps, and a fifth plane costs 4 B/cell plus one permanent binding
 * on every device, forever, for a diagnostic. The DDF readback path already exists for
 * checkpointing, already streams in bounded chunks, and already carries a formal bit-exactness
 * proof (M9 acceptance 3: 0 / 9,961,472 raw byte mismatches). Reusing it costs nothing at
 * runtime and gives a *reference* answer rather than a second GPU implementation to trust.
 *
 * **What must be reproduced exactly, or the numbers are fiction.** Three things:
 *
 *  1. **The shifted FP16 storage.** `st()` writes `f16(v − w_i)` and `ld()` returns
 *     `f32(raw) + w_i`. The shift keeps the stored value near zero where half-precision has
 *     its resolution (H5 §2). Reading the raw image without adding `w_i` back yields
 *     populations that are wrong by up to 1/3 and a τ_eff that is pure noise.
 *  2. **Esoteric Pull parity.** At even parity a fluid cell reads its own slot for the
 *     `+e_a` half of each pair and the neighbour's for `−e_a`; at odd parity the two swap
 *     (H4 §3). Gathering at the wrong parity produces a plausible-looking field built from
 *     half-streamed populations. `Lbm3D.currentParity` is the authority.
 *  3. **The plane→buffer routing.** Plane i lives in split buffer ⌊i/perBuffer⌋ at local
 *     plane i mod perBuffer. Getting this wrong reads a different direction, which is exactly
 *     the class of error that looks like physics.
 *
 * The τ_eff formula itself is NOT reimplemented here: `piNeq`, `piNeqNorm` and
 * `smagorinskyTauEff` are the same functions `collideCell` calls, so the oracle cannot drift
 * from the solver it is measuring.
 *
 * The field this produces is the τ_eff the **next** step will collide with — the gather is
 * the one `stream_collide` performs at the current parity. In a statistically steady flow
 * that is the quantity of interest; it is not an average over time.
 */

/** half bits → f32, exact, via a 256 KiB lookup table built once (no Math.pow in the loop). */
const HALF_TO_FLOAT = (() => {
  const out = new Float32Array(65536);
  const bits = new Uint32Array(1);
  const asFloat = new Float32Array(bits.buffer);
  for (let h = 0; h < 65536; h++) {
    const sign = (h & 0x8000) << 16;
    let exp = (h >> 10) & 0x1f;
    let mant = h & 0x3ff;
    let word: number;
    if (exp === 0) {
      if (mant === 0) {
        word = sign; // ±0
      } else {
        // Subnormal half → normal float. These carry real information in the shifted store
        // (values sit near zero by construction), so flushing them would bias τ_eff.
        exp = 1;
        while ((mant & 0x400) === 0) {
          mant <<= 1;
          exp--;
        }
        mant &= 0x3ff;
        word = sign | ((exp + 127 - 15) << 23) | (mant << 13);
      }
    } else if (exp === 0x1f) {
      word = sign | 0x7f800000 | (mant << 13); // Inf / NaN
    } else {
      word = sign | ((exp + 127 - 15) << 23) | (mant << 13);
    }
    bits[0] = word >>> 0;
    out[h] = asFloat[0];
  }
  return out;
})();

/** Largest single mapped readback, in bytes. Matches the checkpoint path's chunk budget. */
const CHUNK_BYTES = 64 * 1024 * 1024;

/**
 * Pull every DDF split buffer to the host, in bounded chunks. Returns one typed array per
 * buffer, still in storage form — shifted and half-precision if `precision === 'fp16'`.
 */
async function readDdfImage(sim: Lbm3D): Promise<(Uint16Array | Float32Array)[]> {
  const sizes = sim.ddfBufferSizes();
  const out: (Uint16Array | Float32Array)[] = [];
  for (let b = 0; b < sizes.length; b++) {
    const size = sizes[b];
    const bytes = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
      // Copy length must stay a multiple of 4 (WebGPU copyBufferToBuffer alignment).
      const length = Math.min(CHUNK_BYTES, size - offset);
      const chunk = await sim.readDdfChunk(b, offset, length);
      bytes.set(new Uint8Array(chunk), offset);
    }
    out.push(
      sim.precision === 'fp16'
        ? new Uint16Array(bytes.buffer, 0, size >> 1)
        : new Float32Array(bytes.buffer, 0, size >> 2),
    );
  }
  return out;
}

export interface TauFieldResult {
  /** τ_eff per cell. Only cells with `evaluated[idx] === 1` hold a meaningful value. */
  tauEff: Float32Array;
  /**
   * 1 where τ_eff was reconstructed, 0 everywhere else. Use this — not the flag array — as
   * the statistics mask, so excluded cells cannot leak into a percentile.
   */
  evaluated: Uint8Array;
  /**
   * Moments of the gathered (post-streaming, pre-collision) populations, per cell.
   *
   * These are what makes the oracle checkable. Collision conserves ρ and ρu, so the moments
   * of the populations this gather assembled at step k are exactly the moments the kernel's
   * own `write_macro` reports after step k+1. Any error in the −w_i shift, the step parity or
   * the plane→buffer routing corrupts them by O(1), so agreeing to FP32 round-off is strong
   * evidence the reconstruction is faithful — and it needs no CPU/GPU trajectory comparison,
   * which chaos would invalidate over any useful number of steps.
   */
  rho: Float32Array;
  ux: Float32Array;
  uy: Float32Array;
  uz: Float32Array;
  /** Cells actually evaluated. */
  fluidCells: number;
  /**
   * Fluid cells skipped because a neighbour is FreeSlip. The kernel resolves those links
   * through `freeSlipRead`'s parity-aware specular redirection (H11 §5), which this oracle
   * deliberately does not reimplement: a second, unverified copy of the trickiest addressing
   * in the shader is a worse outcome than a documented hole. The hole is one cell deep on the
   * lateral and top faces only — the ground is `Solid` and the body is `BodySolid`, so the
   * boundary-layer and wake statistics are untouched. Reported so its size stays visible.
   */
  freeSlipAdjacentSkipped: number;
  tau0: number;
  lesK: number;
  parity: 0 | 1;
  totalSteps: number;
  /** Non-finite τ_eff encountered; any non-zero value invalidates the snapshot. */
  nonFinite: number;
}

/**
 * Reconstruct the τ_eff field for the current GPU state.
 *
 * Peak host memory is the DDF image (q·n·2 B at fp16 — ~304 MB for the 8M Ahmed tier) plus
 * one f32 per cell for the output (~32 MB). The gather is O(19) per cell in scalar JS, so
 * expect tens of seconds at 8M cells; this is a diagnostic, not a per-step cost.
 */
export async function computeTauField(sim: Lbm3D): Promise<TauFieldResult> {
  const { nx, ny, nz, n, flags } = sim;
  const lesK = sim.lesK;
  if (lesK === 0) {
    // With LES off, τ_eff ≡ τ₀ everywhere and there is nothing to measure. Say so rather
    // than return a constant field that looks like a result.
    throw new Error('computeTauField: LES is off for this scene — τ_eff is τ₀ in every cell');
  }
  const tau0 = sim.tau0;
  const perBuffer = sim.planesPerDdfBuffer;
  const planes = await readDdfImage(sim);
  const fp16 = sim.precision === 'fp16';
  const { ex, ey, ez, w, q } = D3Q19;

  /** ld(plane, cell) — 1:1 with the shader's `ld`, including the −w_i storage shift. */
  const ld = (plane: number, cell: number): number => {
    const b = (plane / perBuffer) | 0;
    const slot = (plane % perBuffer) * n + cell;
    const raw = planes[b][slot];
    return fp16 ? HALF_TO_FLOAT[raw as number] + w[plane] : raw;
  };

  const even = sim.currentParity === 0;
  const tauEff = new Float32Array(n);
  const evaluated = new Uint8Array(n);
  const rhoOut = new Float32Array(n);
  const uxOut = new Float32Array(n);
  const uyOut = new Float32Array(n);
  const uzOut = new Float32Array(n);
  const f = new Float64Array(q);
  const feq = new Float64Array(q);
  const p = new Float64Array(6);
  let fluidCells = 0;
  let nonFinite = 0;
  let freeSlipAdjacentSkipped = 0;

  const cellIndex = (x: number, y: number, z: number): number => x + nx * (y + ny * z);

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = cellIndex(x, y, z);
        // Only Fluid cells collide. Inlet/Outlet cells are prescribed (they never reach the
        // LES block), and solid/free-slip cells return early in the kernel.
        if (flags[idx] !== CellType.Fluid) continue;

        f[0] = ld(0, idx);
        let touchesFreeSlip = false;
        for (let a = 1; a < q; a += 2) {
          const b = a + 1;
          const naIdx = cellIndex(x - ex[a], y - ey[a], z - ez[a]);
          const nbIdx = cellIndex(x + ex[a], y + ey[a], z + ez[a]);

          // Bounce-back on a solid neighbour reads the OWN opposite slot at even parity and
          // the neighbour's own slot at odd — mirroring the kernel's `select`, which is
          // `select(falseVal, trueVal, cond)` in WGSL (the opposite order to a ternary).
          const flagA = flags[naIdx];
          if (flagA === CellType.FreeSlip) touchesFreeSlip = true;
          f[a] = isSolid(flagA)
            ? even
              ? ld(b, idx)
              : ld(a, naIdx)
            : even
              ? ld(a, naIdx)
              : ld(b, idx);

          const flagB = flags[nbIdx];
          if (flagB === CellType.FreeSlip) touchesFreeSlip = true;
          f[b] = isSolid(flagB)
            ? even
              ? ld(a, idx)
              : ld(b, nbIdx)
            : even
              ? ld(b, nbIdx)
              : ld(a, idx);
        }
        if (touchesFreeSlip) {
          freeSlipAdjacentSkipped++;
          continue;
        }

        let rho = 0;
        let mx = 0;
        let my = 0;
        let mz = 0;
        for (let i = 0; i < q; i++) {
          const fi = f[i];
          rho += fi;
          mx += ex[i] * fi;
          my += ey[i] * fi;
          mz += ez[i] * fi;
        }
        const ux = mx / rho;
        const uy = my / rho;
        const uz = mz / rho;
        for (let i = 0; i < q; i++) feq[i] = equilibrium3(D3Q19_SPEC, i, rho, ux, uy, uz);

        piNeq(f, feq, D3Q19_SPEC, p);
        const t = smagorinskyTauEff(tau0, lesK, piNeqNorm(p), rho);
        if (!Number.isFinite(t)) nonFinite++;
        tauEff[idx] = t;
        rhoOut[idx] = rho;
        uxOut[idx] = ux;
        uyOut[idx] = uy;
        uzOut[idx] = uz;
        evaluated[idx] = 1;
        fluidCells++;
      }
    }
  }

  return {
    tauEff,
    evaluated,
    rho: rhoOut,
    ux: uxOut,
    uy: uyOut,
    uz: uzOut,
    fluidCells,
    freeSlipAdjacentSkipped,
    tau0,
    lesK,
    parity: sim.currentParity,
    totalSteps: sim.totalSteps,
    nonFinite,
  };
}

/**
 * The mask every τ statistic must use. Driven by `evaluated`, not by the flag array, so the
 * free-slip-adjacent cells the oracle skipped cannot leak into a percentile — and so the
 * Re 1e4 and Re 1e5 snapshots reduce over identical cells, which is the only way comparing
 * them means anything.
 */
export function evaluatedSelector(evaluated: Uint8Array): (idx: number) => boolean {
  return (idx: number) => evaluated[idx] === 1;
}
