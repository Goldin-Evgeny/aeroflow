import { CellType, isSolid } from '../lattice.js';
import { D3Q19 } from '../lattice3d.js';

/**
 * Free-slip pull resolution (docs/handoff/H11-free-slip.md §3) — the ONE helper both
 * CPU solvers call so their arithmetic is identical (the bit-identity gate depends on
 * byte-equal results). Given a fluid cell pulling direction `i` whose source is a
 * FreeSlip shell cell, walk the reflection loop: per configured face the source sits
 * on, undo that axis' displacement and negate that component of the direction. The
 * loop resolves slip∩slip edges in two iterations (double mirror); a final Solid
 * source (slip∩solid edge) signals the plain-bounce-back fallback (H11 §3.1).
 */

export interface FreeSlipFaces {
  yMin?: boolean;
  yMax?: boolean;
  zMin?: boolean;
  zMax?: boolean;
}

export interface ResolvedPull {
  /** Final source coordinates (valid only when fallback is false). */
  sx: number;
  sy: number;
  sz: number;
  /** Direction J whose post-collision output to read at the source. */
  dir: number;
  /** True → slip∩solid edge: apply plain local bounce-back of the ORIGINAL direction. */
  fallback: boolean;
}

const { ey, ez, reflectY, reflectZ } = D3Q19;

/**
 * @param sx0..sz0  the pull SOURCE cell (already periodic-wrapped by the caller — the
 *                  resolver never recomputes it, so wrapped and shell layouts agree).
 * @param i         the pulled direction (e_i points from the source toward the puller).
 */
export function resolveFreeSlipPull(
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  faces: FreeSlipFaces,
  sx0: number,
  sy0: number,
  sz0: number,
  i: number,
): ResolvedPull {
  const sx = sx0; // x faces are never free-slip (§3.2) — the x component never reflects
  let sy = sy0;
  let sz = sz0;
  let dir = i;
  for (let pass = 0; pass < 3; pass++) {
    const flag = flags[sx + nx * (sy + ny * sz)];
    if (flag !== CellType.FreeSlip) {
      return { sx, sy, sz, dir, fallback: isSolid(flag) };
    }
    let reflected = false;
    // Undo the displacement BEFORE negating (H11 pitfall 2): S_k += (e_J)_k, then flip.
    if (((sy === 0 && faces.yMin) || (sy === ny - 1 && faces.yMax)) && ey[dir] !== 0) {
      sy += ey[dir];
      dir = reflectY[dir];
      reflected = true;
    }
    if (((sz === 0 && faces.zMin) || (sz === nz - 1 && faces.zMax)) && ez[dir] !== 0) {
      sz += ez[dir];
      dir = reflectZ[dir];
      reflected = true;
    }
    if (!reflected) {
      throw new Error(
        `resolveFreeSlipPull: FreeSlip source (${sx},${sy},${sz}) not on a configured ` +
          `face reachable by direction ${i} — flags/config mismatch`,
      );
    }
  }
  throw new Error('resolveFreeSlipPull: reflection did not resolve in 3 passes');
}

/**
 * Constructor-time validation shared by both solvers (H11 §3.2): FreeSlip cells only on
 * configured y/z faces, and never directly upstream (−x) of an Outlet (the outlet's
 * zero-gradient copy would read a passive cell's scratch — same class as H4 §10.9).
 */
export function validateFreeSlip(
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  faces: FreeSlipFaces,
): void {
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const flag = flags[at(x, y, z)];
        if (flag === CellType.FreeSlip) {
          const onConfigured =
            (y === 0 && faces.yMin) ||
            (y === ny - 1 && faces.yMax) ||
            (z === 0 && faces.zMin) ||
            (z === nz - 1 && faces.zMax);
          if (!onConfigured) {
            throw new Error(
              `FreeSlip cell at (${x},${y},${z}) is not on a configured free-slip face`,
            );
          }
        }
        if (flag === CellType.Outlet && x > 0 && flags[at(x - 1, y, z)] === CellType.FreeSlip) {
          throw new Error(
            `Outlet at (${x},${y},${z}) has a FreeSlip upstream neighbor — keep the ` +
              `outlet face's slip-adjacent ring FreeSlip instead (H11 §3.2)`,
          );
        }
      }
    }
  }
}
