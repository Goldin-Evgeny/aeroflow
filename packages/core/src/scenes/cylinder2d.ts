import { CellType } from '../lattice.js';

/**
 * Canonical 2D circular-cylinder vortex-shedding scene (M4). Builds the flag + mask
 * arrays and the derived lattice parameters so the CPU reference and the GPU kernel
 * consume the *identical* scene. Spec: M4 step 4.
 *
 * Geometry (fixed by the acceptance gate — do not shrink D below 25):
 *   nx = 1536, ny = 512, periodicY. D = 25 → blockage D/ny = 4.9 % (≤ 5 %),
 *   ≥ 25 cells/diameter. Centre cx = nx/4 = 384 (¾ domain of wake run-out),
 *   cy = 256.5 — the half-cell offset breaks symmetry so shedding onsets promptly.
 * Column x=0 is Inlet, x=nx−1 is Outlet (pressure).
 *
 * Physics: uLattice = 0.05, ν = uLattice·D/Re, τ = 3ν + 0.5. TRT (Λ = 3/16); at
 * Re = 200 τ ≈ 0.519 sits near the 0.5 stability floor, so TRT — not BGK — is required.
 */

export interface CylinderSceneOptions {
  /** Reynolds number based on diameter. Default 100. */
  Re?: number;
  nx?: number;
  ny?: number;
  /** Cylinder diameter in cells. Default 25. */
  diameter?: number;
  /** Lattice inflow velocity (Mach control). Default 0.05. */
  uLattice?: number;
  /** Symmetry-breaking y-offset of the centre. Default 0.5 (→ cy = ny/2 + 0.5). */
  cyOffset?: number;
}

export interface CylinderScene {
  nx: number;
  ny: number;
  flags: Uint8Array;
  /** Per-cell obstacle mask (1 on the cylinder's solid cells) for maskedForce. */
  forceMask: Uint8Array;
  periodicY: true;
  /** Cylinder diameter in cells (normalization length for Cd/Cl/St). */
  diameter: number;
  uLattice: number;
  nu: number;
  tau: number;
  omega: number;
  Re: number;
  cx: number;
  cy: number;
}

export function cylinderScene(opts: CylinderSceneOptions = {}): CylinderScene {
  const Re = opts.Re ?? 100;
  const nx = opts.nx ?? 1536;
  const ny = opts.ny ?? 512;
  const D = opts.diameter ?? 25;
  const uLattice = opts.uLattice ?? 0.05;
  const cyOffset = opts.cyOffset ?? 0.5;

  const cx = nx / 4;
  const cy = ny / 2 + cyOffset;
  const r2 = (D / 2) * (D / 2);

  const n = nx * ny;
  const flags = new Uint8Array(n);
  const forceMask = new Uint8Array(n);

  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const idx = y * nx + x;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        flags[idx] = CellType.Solid;
        forceMask[idx] = 1;
      }
    }
  }
  // Inlet / outlet columns (override any solid — cylinder never touches the edges).
  for (let y = 0; y < ny; y++) {
    flags[y * nx] = CellType.Inlet;
    forceMask[y * nx] = 0;
    flags[y * nx + nx - 1] = CellType.Outlet;
    forceMask[y * nx + nx - 1] = 0;
  }

  const nu = (uLattice * D) / Re;
  const tau = 3 * nu + 0.5;
  return {
    nx,
    ny,
    flags,
    forceMask,
    periodicY: true,
    diameter: D,
    uLattice,
    nu,
    tau,
    omega: 1 / tau,
    Re,
    cx,
    cy,
  };
}
