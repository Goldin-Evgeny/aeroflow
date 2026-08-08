import { hasMacroscopics } from '../lattice.js';

/**
 * z-mirror symmetry residual for the empty Ahmed tunnel (M9 force audit, phase 3c/2M).
 *
 * The scene and every boundary condition it can be built with (`freestream` or `freeslip`
 * laterals, `equilibrium` or `velocity` inlet, `zero-gradient` or `pressure` outlet) are exactly
 * mirror-symmetric about the z mid-plane — there is no geometry, no forcing and no asymmetric
 * boundary anywhere in the empty tunnel. A converged run therefore satisfies
 *
 *   rho(x,y,z)  =  rho(x,y,nz-1-z)
 *   ux(x,y,z)   =  ux(x,y,nz-1-z)
 *   uy(x,y,z)   =  uy(x,y,nz-1-z)
 *   uz(x,y,z)   = -uz(x,y,nz-1-z)      (antisymmetric: mirrored flow moves the other way)
 *
 * to the arithmetic floor. A residual that GROWS over time is not something any existing gate
 * (`BOUNDS`, the mass ledger, the acoustic probe) would catch — all three are scalars reduced
 * over the whole field or a single plane, and a lattice can drift asymmetric while staying mass-
 * conserving, low-Mach and ledger-closed. This is the only place that question is asked.
 *
 * **Diagnostic only — no threshold is invented here.** Read the trend across the harness's
 * window table: a residual that is flat or falling with time is healthy at whatever floor it
 * sits at (FP32 roundoff plus a k-space acoustic asymmetry induced by nz not always being a
 * power of two); a residual that grows window-over-window is the actual pathology, independent
 * of its instantaneous magnitude.
 */
export interface MirrorAsymmetry {
  /** max over paired cells of |delta rho| between z and its mirror nz-1-z. */
  maxAbsDRho: number;
  /** max over paired cells of the mirror-residual velocity vector magnitude
   *  sqrt(dux^2 + duy^2 + duz_sym^2), where duz_sym = uz(z) + uz(mirror) (antisymmetric test). */
  maxAbsDu: number;
  /** RMS of the same per-cell vector magnitude over all paired cells. */
  rmsDu: number;
  /** Fluid-cell pairs actually reduced over (both sides must carry macroscopics). */
  pairedCells: number;
}

/**
 * Reduces over cell pairs `(x, y, z)` / `(x, y, nz-1-z)` for `z` in `[0, floor(nz/2))`. On an
 * odd `nz` this naturally excludes the self-paired mid-plane, whose antisymmetric residual is
 * trivially zero and would otherwise dilute the max/RMS with a run of exact zeros.
 *
 * Cells where either side lacks macroscopics (shell — see `hasMacroscopics`) or carries a
 * non-finite value are skipped rather than propagated, matching `lateralFlux`'s discipline: one
 * poisoned cell must not turn the whole reduction into NaN and hide which region is healthy.
 */
export function mirrorAsymmetryZ(
  macro: Float32Array,
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
): MirrorAsymmetry {
  const n = nx * ny * nz;
  if (macro.length < 4 * n) {
    throw new Error(`mirrorAsymmetryZ: macro has ${macro.length} entries, need ${4 * n}`);
  }
  if (flags.length < n) {
    throw new Error(`mirrorAsymmetryZ: flags has ${flags.length} entries, need ${n}`);
  }

  let maxAbsDRho = 0;
  let maxAbsDu = 0;
  let sumSqDu = 0;
  let pairedCells = 0;

  const half = Math.floor(nz / 2);
  for (let z = 0; z < half; z++) {
    const zm = nz - 1 - z;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = x + nx * (y + ny * z);
        const idxM = x + nx * (y + ny * zm);
        if (!hasMacroscopics(flags[idx]) || !hasMacroscopics(flags[idxM])) continue;

        const rho = macro[4 * idx];
        const ux = macro[4 * idx + 1];
        const uy = macro[4 * idx + 2];
        const uz = macro[4 * idx + 3];
        const rhoM = macro[4 * idxM];
        const uxM = macro[4 * idxM + 1];
        const uyM = macro[4 * idxM + 2];
        const uzM = macro[4 * idxM + 3];
        if (
          !Number.isFinite(rho) ||
          !Number.isFinite(ux) ||
          !Number.isFinite(uy) ||
          !Number.isFinite(uz) ||
          !Number.isFinite(rhoM) ||
          !Number.isFinite(uxM) ||
          !Number.isFinite(uyM) ||
          !Number.isFinite(uzM)
        ) {
          continue;
        }

        const dRho = Math.abs(rho - rhoM);
        const dUx = ux - uxM;
        const dUy = uy - uyM;
        const dUzSym = uz + uzM; // antisymmetric: should cancel under perfect mirror symmetry
        const duSq = dUx * dUx + dUy * dUy + dUzSym * dUzSym;

        if (dRho > maxAbsDRho) maxAbsDRho = dRho;
        const du = Math.sqrt(duSq);
        if (du > maxAbsDu) maxAbsDu = du;
        sumSqDu += duSq;
        pairedCells++;
      }
    }
  }

  return {
    maxAbsDRho,
    maxAbsDu,
    rmsDu: pairedCells > 0 ? Math.sqrt(sumSqDu / pairedCells) : Number.NaN,
    pairedCells,
  };
}
