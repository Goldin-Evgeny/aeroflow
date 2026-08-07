import { hasMacroscopics } from '../lattice.js';

/**
 * Wall-normal mass flux at the lateral domain faces (M9 force audit, phase 3).
 *
 * ## The question this answers
 *
 * Phase 2 measured a persistent ~1.3% inlet→outlet mass-flux mismatch in the empty Ahmed
 * tunnel while GLOBAL mass drift stayed at ~1.7e-4. Both cannot be true of a closed box: if
 * the domain passes 1.3% less than it takes and its total mass is nevertheless constant, the
 * difference is leaving through some other face. The hypothesis is that the hard-Dirichlet
 * `Inlet` cells on the top and sides are doing it — they clamp the flow to u_in and supply or
 * absorb whatever mass that clamp costs, i.e. they act as an infinite reservoir.
 *
 * `fluxMismatch` establishes that SOMETHING is unaccounted for. This establishes WHERE, and
 * separates the top from the two sides, which the streamwise budget cannot.
 *
 * ## What it is, precisely — and what it is not
 *
 * The outward wall-normal mass flux Σρu_n over the FIRST FLUID LAYER inside each face, not
 * over the face itself. The shell cells carry no macroscopics (the macro pass leaves them at
 * ρ=0 — see `hasMacroscopics`), so there is nothing to sum there; the halfway wall sits half a
 * cell outside the last fluid layer and no readback exists at that plane.
 *
 * **This makes every number here a PROXY, and it carries no acceptance threshold of its own.**
 * Read it as a RELATIVE quantity — one boundary condition against another, on the same grid,
 * at the same step — alongside `fluxMismatch`. Judging health stays the job of the mass-drift,
 * density and Mach bounds, which are absolute and already gated.
 *
 * Sign convention: POSITIVE is outward, i.e. leaving the domain, on every face.
 *
 * ## Why the no-slip ground is EXCLUDED from `net` (measured, 2026-08-07)
 *
 * A halfway bounce-back wall passes exactly zero mass. Σρu_y at y=1 is therefore NOT a
 * through-wall flux — it is interior vertical motion in the near-wall layer, balanced by the
 * flux at y=2 and above, and it does not belong in a boundary budget at all.
 *
 * Including it destroyed the budget. Phase-3 Stage A, 2M empty tunnel, hard-Dirichlet
 * laterals: the streamwise deficit inFlux − outFlux was 3.89, the top and side faces summed
 * to 4.79 (closing it to ~23%, which is what a first-fluid-layer proxy should do), and the
 * ground column read 57.2 — an order of magnitude larger than the entire imbalance it was
 * supposedly part of. The free-slip arm behaved the same way (ground 36.2 against a
 * streamwise imbalance of 0.23). Reported as a `net`, that column swamped a signal that was
 * otherwise decisive: the true lateral leak fell 4.79 → −0.066 between the two arms, a 72×
 * reduction, and the printed `net` moved only 62 → 36.
 *
 * The slip and Dirichlet faces do not have this problem, and the reason is physical rather
 * than incidental. A specular wall makes the normal velocity antisymmetric about itself, so
 * the first fluid layer inherits u_n ≈ 0 (measured: EXACTLY 0 on both z faces of the empty
 * tunnel, over 15 745 cells per plane). A hard-Dirichlet cell prescribes u=(u_in,0,0) but can
 * source or absorb whatever mass that clamp costs, so the layer inside it carries the real
 * throughflow. Both are meaningful; the no-slip wall is the one that is not.
 */
export interface LateralFlux {
  /** Σρu_y at y=ny−2, positive upward (out through the lid). */
  top: number;
  /** −Σρu_z at z=1, positive outward (out through the −z side). */
  zMin: number;
  /** Σρu_z at z=nz−2, positive outward (out through the +z side). */
  zMax: number;
  /**
   * **top + zMin + zMax. The no-slip ground is deliberately NOT in this sum** — see the
   * module docstring. This is the quantity to compare against the streamwise budget
   * (inFlux − outFlux) and the mass accumulation rate; the three together close.
   */
  net: number;
  /**
   * −Σρu_y over the first fluid layer above the no-slip floor (y=1), positive downward.
   *
   * **This is NOT a through-wall mass flux and must never be reported as one.** A halfway
   * bounce-back wall passes exactly zero mass. This is the near-wall layer's own vertical
   * velocity — an interior quantity, balanced by the flux at y=2 and above — kept only
   * because it is a cheap way to see whether the floor layer's behaviour moved between two
   * runs. It is excluded from `net` and from every budget.
   */
  groundLayerUy: number;
  /** Fluid cells summed over, per face — a nonzero flux over zero cells is not a measurement. */
  cells: { top: number; zMin: number; zMax: number; groundLayer: number };
}

/** Σρu·n̂ over one x-normal-free plane, skipping cells the macro pass never wrote. */
function planeFlux(
  macro: Float32Array,
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  plane: { axis: 'y' | 'z'; index: number },
  sign: number,
): { flux: number; cells: number } {
  // Component 2 of the macro quad is u_y, component 3 is u_z.
  const comp = plane.axis === 'y' ? 2 : 3;
  let flux = 0;
  let cells = 0;
  const outerMax = plane.axis === 'y' ? nz : ny;
  for (let outer = 0; outer < outerMax; outer++) {
    for (let x = 0; x < nx; x++) {
      const y = plane.axis === 'y' ? plane.index : outer;
      const z = plane.axis === 'y' ? outer : plane.index;
      const idx = x + nx * (y + ny * z);
      if (!hasMacroscopics(flags[idx])) continue;
      const rho = macro[4 * idx];
      const u = macro[4 * idx + comp];
      // Poisoned cells are skipped rather than propagated, so one NaN cannot turn the whole
      // budget into NaN and hide which face was healthy (same discipline as `fieldStats`).
      if (!Number.isFinite(rho) || !Number.isFinite(u)) continue;
      flux += sign * rho * u;
      cells++;
    }
  }
  return { flux, cells };
}

export function lateralFlux(
  macro: Float32Array,
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
): LateralFlux {
  const n = nx * ny * nz;
  if (macro.length < 4 * n) {
    throw new Error(`lateralFlux: macro has ${macro.length} entries, need ${4 * n}`);
  }
  if (flags.length < n) {
    throw new Error(`lateralFlux: flags has ${flags.length} entries, need ${n}`);
  }
  if (ny < 3 || nz < 3) {
    throw new Error(`lateralFlux: needs ny,nz >= 3 to have an interior layer (got ${ny},${nz})`);
  }

  const top = planeFlux(macro, flags, nx, ny, nz, { axis: 'y', index: ny - 2 }, +1);
  const ground = planeFlux(macro, flags, nx, ny, nz, { axis: 'y', index: 1 }, -1);
  const zMax = planeFlux(macro, flags, nx, ny, nz, { axis: 'z', index: nz - 2 }, +1);
  const zMin = planeFlux(macro, flags, nx, ny, nz, { axis: 'z', index: 1 }, -1);

  return {
    top: top.flux,
    zMin: zMin.flux,
    zMax: zMax.flux,
    // The ground is not a boundary the domain exchanges mass through, so it is not summed.
    net: top.flux + zMin.flux + zMax.flux,
    groundLayerUy: ground.flux,
    cells: { top: top.cells, zMin: zMin.cells, zMax: zMax.cells, groundLayer: ground.cells },
  };
}
