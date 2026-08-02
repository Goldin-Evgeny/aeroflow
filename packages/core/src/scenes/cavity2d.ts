import { CellType } from '../lattice.js';

/**
 * Canonical lid-driven cavity scene (M3 step 3). Builds the flags,
 * the per-cell moving-wall velocity field, and the derived lattice parameters so the CPU
 * reference and the GPU kernel consume the *identical* scene.
 *
 * Geometry: `(H+2)²` cells — an `H×H` fluid interior inside a one-cell solid rim. The
 * **whole top row, including both corners**, carries the lid velocity. That corner
 * convention is the one the Ghia comparison numbers were derived under and the one the
 * 32² parity scene uses; mixing conventions between CPU and GPU breaks parity even though
 * both look physically fine (M3.md pitfall "Corner cells").
 *
 * Moving-wall BC: this solver marks lid cells `Solid` and carries the velocity in a
 * separate `wallVelocity` array rather than a `MovingWall` cell type. A fluid cell that
 * bounces a population off a solid neighbour adds `6·w_i·(e_i·u_wall[neighbour])` — the
 * Ladd halfway correction, transliterated identically in `Solver2D` and `lbm2d.wgsl`.
 * (M3.md step 1 suggested a `CellType.MovingWall = 4` instead; the shipped design keeps
 * the cell-type enum untouched and was validated to 1e-6 CPU↔GPU parity on the `cav:*`
 * panel rows. Deviation recorded in M3.md Status.)
 *
 * Physics: `ν = uLid·H/Re`, `τ = 3ν + 0.5`. Keep `uLid = 0.1` — raising it changes ν and τ
 * together and pushes Mach error up (M3.md pitfall "τ and uLid drift").
 * Spec sanity checks: Re=100/H=256 → ν=0.256, τ=1.268; Re=1000/H=512 → ν=0.0512, τ=0.6536.
 */

export interface CavitySceneOptions {
  /** Fluid interior side length in cells. The domain is (H+2)². */
  H: number;
  /** Reynolds number based on the cavity side H. Default 100. */
  Re?: number;
  /** Lid velocity in lattice units. Default 0.1 — do not exceed. */
  uLid?: number;
}

export interface CavityScene {
  nx: number;
  ny: number;
  /** Fluid interior side length (the Re normalization length). */
  H: number;
  flags: Uint8Array;
  /** Per-cell moving-wall velocity, length 2·nx·ny (x,y interleaved). */
  wallVelocity: Float64Array;
  uLid: number;
  nu: number;
  tau: number;
  omega: number;
  Re: number;
}

export function cavityScene2D(opts: CavitySceneOptions): CavityScene {
  const H = opts.H;
  const Re = opts.Re ?? 100;
  const uLid = opts.uLid ?? 0.1;
  if (!Number.isInteger(H) || H < 2 || H % 2 !== 0) {
    // Even H keeps the geometric centre between two node columns, which is what the
    // centreline extraction averages over.
    throw new Error(`cavityScene2D: H must be an even integer ≥ 2, got ${H}`);
  }

  const nx = H + 2;
  const ny = H + 2;
  const n = nx * ny;
  const idx = (x: number, y: number) => y * nx + x;

  const flags = new Uint8Array(n);
  const wallVelocity = new Float64Array(2 * n);
  for (let x = 0; x < nx; x++) {
    flags[idx(x, 0)] = CellType.Solid; // floor
    flags[idx(x, ny - 1)] = CellType.Solid; // lid (whole top row, incl. corners)
    wallVelocity[2 * idx(x, ny - 1)] = uLid;
  }
  for (let y = 0; y < ny; y++) {
    flags[idx(0, y)] = CellType.Solid; // left / right walls
    flags[idx(nx - 1, y)] = CellType.Solid;
  }

  const nu = (uLid * H) / Re;
  const tau = 3 * nu + 0.5;
  return { nx, ny, H, flags, wallVelocity, uLid, nu, tau, omega: 1 / tau, Re };
}
