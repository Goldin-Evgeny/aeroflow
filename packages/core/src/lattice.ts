/**
 * D2Q9 lattice constants.
 *
 * Direction ordering (used identically in the CPU reference solver and all WGSL kernels —
 * do not change one without the other):
 *
 *   6 2 5
 *   3 0 1
 *   7 4 8
 *
 * i:  0      1      2      3      4      5      6      7      8
 * e:  (0,0) (1,0)  (0,1) (-1,0) (0,-1) (1,1) (-1,1) (-1,-1) (1,-1)
 * w:  4/9   1/9    1/9   1/9    1/9    1/36  1/36   1/36    1/36
 */
export const D2Q9 = {
  q: 9,
  ex: [0, 1, 0, -1, 0, 1, -1, -1, 1] as const,
  ey: [0, 0, 1, 0, -1, 1, 1, -1, -1] as const,
  w: [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const,
  /** opp[i] = index of the direction opposite to i (for bounce-back). */
  opp: [0, 3, 4, 1, 2, 7, 8, 5, 6] as const,
  /** Lattice speed of sound squared: c_s² = 1/3. */
  cs2: 1 / 3,
} as const;

/** Cell type flags, shared between CPU reference and GPU kernels. */
export enum CellType {
  Fluid = 0,
  Solid = 1,
  Inlet = 2,
  Outlet = 3,
  /**
   * Specular (free-slip) wall — shell cells on whole domain faces only (M10, H11).
   * CPU-only until the WGSL kernels gain the H11 §8 port; keep the value synchronized
   * by hand with the shader constants when that lands.
   */
  FreeSlip = 4,
  /**
   * Flux-imposing velocity inlet (M10, H12): equilibrium at the +x fluid neighbor's
   * previous density and the prescribed u(z) — x=0 face only. Plain `Inlet` (fixed
   * ρ=1) is untouched; every validated M2–M9 scene depends on its exact semantics.
   * CPU-only until the WGSL port (H12 §6).
   */
  VelocityInlet = 5,
}

/**
 * BGK equilibrium distribution for direction i:
 *   f_i^eq = w_i · ρ · (1 + 3(e_i·u) + 4.5(e_i·u)² − 1.5|u|²)
 */
export function equilibrium(i: number, rho: number, ux: number, uy: number): number {
  const eu = D2Q9.ex[i] * ux + D2Q9.ey[i] * uy;
  const usq = ux * ux + uy * uy;
  return D2Q9.w[i] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * usq);
}
