import { CellType } from '../lattice.js';
import { sphereMask } from '../geometry/sphere.js';

/**
 * Canonical 3D sphere-drag scenes (M7). Builds the flag array and the derived lattice
 * parameters so the CPU reference and the GPU kernel consume the *identical* scene.
 * Spec: M7 steps 7–8 (the suggested-grid table).
 *
 * Boundaries. Inlet at x=0, zero-gradient outflow at x=Nx−1. The four lateral faces are,
 * by default, **free-stream velocity inlets** (`lateralBC: 'freestream'`): the Inlet BC
 * prescribes equilibrium at u=(u_lattice, 0, 0), whose component *normal* to a lateral
 * face is zero — so the boundary injects the free stream tangentially with no through-flux,
 * a slip-like far field that approximates unbounded flow far better than a no-slip wall and
 * (unlike a solid shell) contributes nothing to the force, keeping the sphere the only
 * solid → total force == sphere force (H2 §2, no per-cell mask). The `'wall'` option uses a
 * no-slip solid shell instead (matches M6's demo3d), but then the shell drag pollutes the
 * total and a force mask would be required — kept only for A/B experiments. The `'freeslip'`
 * option (H11 specular reflection) is the true slip far field: it removes the confinement
 * that both `'freestream'` and `'wall'` impose, so at Re=10⁴ it is the lever for the M7
 * over-band Cd (the note in SPHERE_CASES). FreeSlip cells are not Solid, so — like
 * `'freestream'` — the sphere stays the only solid and total force == sphere force. The
 * outlet is placed strictly interior so no Outlet has a FreeSlip upstream neighbor
 * (validateFreeSlip / H11 §3.2), mirroring the AIJ Case A shell.
 *
 * Physics. Reynolds number is set **through τ**, never guessed (M7 pitfall): ν = u·D/Re,
 * τ₀ = 3ν + 0.5, ω = 1/τ₀. At Re=10⁴ τ₀ ≈ 0.50108 sits on the stability floor, so LES must
 * be on for that case (the Smagorinsky τ_t is what regularizes it).
 *
 * The sphere is centred at x = ⌊Nx/3⌋ (≥ 2/3 of the domain downstream for the wake) and on
 * the y/z mid-plane (ny−1)/2, (nz−1)/2 — the half-integer centre makes the staircase sphere
 * exactly symmetric under y- and z-reflection, so Fy and Fz time-average to ≈ 0 (a free
 * `opp[]`/direction-table correctness check, M7 pitfall).
 */

export type LateralBC = 'freestream' | 'wall' | 'freeslip';

/** The four lateral faces are all free-slip in the `'freeslip'` scene (no ground). */
export const SPHERE_FREESLIP_FACES = {
  yMin: true,
  yMax: true,
  zMin: true,
  zMax: true,
} as const;

export interface Sphere3DCaseSpec {
  /** Case label (matches the acceptance table). */
  name: string;
  /** Reynolds number based on diameter. */
  Re: number;
  /** Sphere diameter in cells. */
  D: number;
  nx: number;
  ny: number;
  nz: number;
  /** Lattice inflow velocity (Mach control). */
  uLattice: number;
  /** Whether Smagorinsky LES is required for stability (Re=10⁴). */
  les: boolean;
}

/**
 * The three ladder cases (M7 acceptance table). Grids are the spec's suggestion; scale down
 * a tier on memory-short devices, keeping ≥ 24 cells/D and ≤ 3 % blockage, and record it.
 *
 * Blockage note: πR²/(Ny·Nz) is 2.76 % (Re=100), 3.14 % (Re=1000), 4.91 % (Re=10⁴). The
 * Re=10⁴ case keeps the spec's D=48 despite the 4.9 % blockage because **resolution, not
 * blockage, dominates its error**: a measured D=36 variant (2.76 % blockage) read Cd=0.618
 * vs D=48's 0.549 — LOWER blockage gave HIGHER drag, because the coarser sphere is more
 * under-resolved. At Re=10⁴ the boundary layer (~D/100) is unresolved regardless, so more
 * cells/D is the lever that brings Cd down. Getting fully into [0.38,0.50] needs either a
 * larger domain (more cells/D at low blockage) or a free-slip far field (less confinement).
 */
export const SPHERE_CASES = {
  Re100: {
    name: 'Sphere Re=100',
    Re: 100,
    D: 24,
    nx: 256,
    ny: 128,
    nz: 128,
    uLattice: 0.05,
    les: false,
  },
  Re1000: {
    name: 'Sphere Re=1000',
    Re: 1000,
    D: 32,
    nx: 320,
    ny: 160,
    nz: 160,
    uLattice: 0.05,
    les: false,
  },
  Re10000: {
    name: 'Sphere Re=10⁴',
    Re: 10000,
    D: 48,
    nx: 448,
    ny: 192,
    nz: 192,
    uLattice: 0.075,
    les: true,
  },
} as const satisfies Record<string, Sphere3DCaseSpec>;

export type SphereCaseName = keyof typeof SPHERE_CASES;

export interface Sphere3DScene {
  nx: number;
  ny: number;
  nz: number;
  /** Flag array (idx = x + nx·(y + ny·z)); sphere = Solid, boundaries per lateralBC. */
  flags: Uint8Array;
  /** Sphere diameter in cells (normalization length; frontal area = πR²). */
  D: number;
  radius: number;
  cx: number;
  cy: number;
  cz: number;
  uLattice: number;
  nu: number;
  tau: number;
  omega: number;
  Re: number;
  les: boolean;
  lateralBC: LateralBC;
  /** πR² / (Ny·Nz) — must stay ≤ ~3 % or the confinement inflates Cd (M7 pitfall). */
  blockage: number;
  /** Cells per diameter (= D); < 24 over-predicts drag from the staircase. */
  cellsPerDiameter: number;
  /** One convective time T_c = D / u_lattice, in steps (transient/averaging window unit). */
  convectiveTimeSteps: number;
  /** Number of Solid cells forming the sphere (analytic ≈ (4/3)πR³). */
  sphereVoxels: number;
}

export interface SphereSceneOptions {
  /** Override the lateral boundary condition. Default 'freestream' (recommended). */
  lateralBC?: LateralBC;
}

export function sphereScene(spec: Sphere3DCaseSpec, opts: SphereSceneOptions = {}): Sphere3DScene {
  const { nx, ny, nz, D, uLattice, Re, les } = spec;
  const lateralBC = opts.lateralBC ?? 'freestream';
  const radius = D / 2;
  const cx = Math.floor(nx / 3);
  const cy = (ny - 1) / 2;
  const cz = (nz - 1) / 2;

  // Start from the analytic sphere mask (Solid strictly inside the radius), then overlay
  // boundaries. The sphere is interior (cx ≥ ~Nx/3, radius ≪ domain) so it never touches an
  // edge; the boundary overlay wins on the six faces regardless.
  const flags = sphereMask(nx, ny, nz, cx, cy, cz, radius);
  let sphereVoxels = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i] === CellType.Solid) sphereVoxels++;

  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  if (lateralBC === 'freeslip') {
    // H11 specular-reflection far field. Precedence (mirrors caseAScene): free-slip on all
    // four lateral faces over the FULL x-range, then Inlet spanning the whole x=0 face
    // (inlets have no upstream constraint), then Outlet STRICTLY INTERIOR at x=nx−1 so the
    // outlet-face edge ring stays FreeSlip and no Outlet reads a FreeSlip upstream neighbor
    // (validateFreeSlip / H11 §3.2).
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        flags[at(x, 0, z)] = CellType.FreeSlip;
        flags[at(x, ny - 1, z)] = CellType.FreeSlip;
      }
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        flags[at(x, y, 0)] = CellType.FreeSlip;
        flags[at(x, y, nz - 1)] = CellType.FreeSlip;
      }
    }
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) flags[at(0, y, z)] = CellType.Inlet;
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) flags[at(nx - 1, y, z)] = CellType.Outlet;
    }
  } else {
    const lateral = lateralBC === 'wall' ? CellType.Solid : CellType.Inlet;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        // Inlet / outlet planes span the full face (they take precedence over lateral edges).
        flags[at(0, y, z)] = CellType.Inlet;
        flags[at(nx - 1, y, z)] = CellType.Outlet;
      }
    }
    for (let z = 0; z < nz; z++) {
      for (let x = 1; x < nx - 1; x++) {
        flags[at(x, 0, z)] = lateral;
        flags[at(x, ny - 1, z)] = lateral;
      }
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 1; x < nx - 1; x++) {
        flags[at(x, y, 0)] = lateral;
        flags[at(x, y, nz - 1)] = lateral;
      }
    }
  }

  const nu = (uLattice * D) / Re;
  const tau = 3 * nu + 0.5;
  return {
    nx,
    ny,
    nz,
    flags,
    D,
    radius,
    cx,
    cy,
    cz,
    uLattice,
    nu,
    tau,
    omega: 1 / tau,
    Re,
    les,
    lateralBC,
    blockage: (Math.PI * radius * radius) / (ny * nz),
    cellsPerDiameter: D,
    convectiveTimeSteps: Math.round(D / uLattice),
    sphereVoxels,
  };
}
