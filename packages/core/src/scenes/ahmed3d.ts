import { CellType } from '../lattice.js';
import { AHMED, ahmedBody, type AhmedBodyOptions } from '../geometry/ahmedBody.js';
import { voxelizeSolid } from '../voxel/voxelize.js';
import type { TriangleMesh } from '../geometry/icosphere.js';

/**
 * Ahmed-body run setup (M9 step 2): voxelized body + boundary flags + lattice parameters,
 * built CPU-side so the browser preset and the tests consume the identical scene.
 *
 * SPEC DEVIATION (documented, M9 Status): the milestone's suggested 512×192×160 grid with
 * the body spanning 250 cells (dx ≈ 4.2 mm) has a frontal blockage of (389·288 mm²) /
 * (806·672 mm²) ≈ 21% — the same spec requires ≤ 5%, and a cramped domain "systematically
 * raises Cd" (its own pitfall list). The two constraints cannot both hold at 15.7M cells,
 * so this builder keeps the PHYSICS constraints and lets resolution follow the budget:
 *   - fetch: ≥ 1 body length upstream of the nose, ≥ 2 downstream of the tail (spec);
 *   - blockage: frontal area / cross-section = `blockageCap` (default 5%) with equal
 *     physical margins above and beside the body;
 *   - dx = cbrt(domainVolume / maxCells) — at the default 15.7M budget this lands near
 *     dx ≈ 8.4 mm (body ≈ 124 cells long, height ≈ 34 cells), the honest trade the
 *     validation page must state (under-resolution inflates Cd; ±15% band, not ±5%).
 *
 * Reynolds number is set THROUGH τ, never guessed (M7 rule): Re_L = 4.29×10⁶ (Ahmed 1984,
 * U ≈ 60 m/s) ⇒ ν_lattice = u·L_cells/Re ⇒ τ₀ = 0.5 + 3ν — microscopically above the
 * floor, so LES (+ regularization) is mandatory, exactly as in the M7 Re=10⁴ case.
 *
 * Boundaries: inlet x=0, zero-gradient outlet x=nx−1, NO-SLIP ground y=0 (the experiment's
 * fixed floor — the ground row stays Solid across the inlet/outlet faces so the Outlet
 * never has a Solid upstream neighbor, H4 §10.9), freestream (slip-like) top and sides as
 * in the M7 sphere scenes. The body floats at the scaled 50 mm ground clearance; stilts
 * omitted (see geometry/ahmedBody.ts).
 */

export interface AhmedSceneOptions extends AhmedBodyOptions {
  /** Cell budget the grid is fitted to. Default 15.7M (the M9 target tier). */
  maxCells?: number;
  /** Inlet lattice velocity. Default 0.05 (spec: u ≤ 0.05 for this case). */
  uLattice?: number;
  /** Frontal blockage target (frontal / cross-section). Default 0.05. */
  blockageCap?: number;
  /** Body lengths of clear fetch upstream of the nose / downstream of the tail. */
  upstreamL?: number;
  downstreamL?: number;
  /** Reynolds number on body length. Default 4.29e6 (SAE 840300). */
  Re?: number;
}

export interface AhmedScene {
  nx: number;
  ny: number;
  nz: number;
  flags: Uint8Array;
  /** Meters per cell. */
  dx: number;
  /** Body length in cells (the Cd/convective-time reference length). */
  lengthCells: number;
  uLattice: number;
  nu: number;
  tau: number;
  omega: number;
  Re: number;
  les: boolean;
  /** One convective time L/u in steps. */
  convectiveTimeSteps: number;
  /** Solid cells of the voxelized body (staircase volume diagnostic). */
  bodyVoxels: number;
  /** Projected frontal solid columns (cells²) — the Cd normalization area (M9 pitfall). */
  frontalCells: number;
  /** frontalCells / interior cross-section — must respect blockageCap. */
  blockage: number;
  /** Nose x in cells (fetch diagnostic). */
  noseX: number;
  /** The body mesh in lattice coordinates (preview / GPU-voxelizer parity). */
  mesh: TriangleMesh;
}

const MM = 1e-3;

export function ahmedScene(opts: AhmedSceneOptions = {}): AhmedScene {
  const maxCells = opts.maxCells ?? 15_700_000;
  const u = opts.uLattice ?? 0.05;
  const cap = opts.blockageCap ?? 0.05;
  const upstreamL = opts.upstreamL ?? 1;
  const downstreamL = opts.downstreamL ?? 2;
  const Re = opts.Re ?? 4.29e6;
  const clearance = (opts.groundClearance ?? AHMED.groundClearance) * MM;

  // Physical domain (meters). Cross-section: equal margins m beside and above the body,
  // sized so bbox-frontal/cross-section hits the cap: (W+2m)(C+H+m) = W·H/cap.
  const L = AHMED.length * MM;
  const W = AHMED.width * MM;
  const H = AHMED.height * MM;
  const topOfBody = clearance + H;
  const domX = (upstreamL + 1 + downstreamL) * L;
  // The blockage that matters is the VOXELIZED silhouette (the Cd area, M9 pitfall), which
  // the conservative staircase inflates by ~1.5 cells per dimension — significant at
  // budget-constrained dx. Solve margin/dx as a fixed point: cross-section from the
  // inflated frontal estimate, dx from the budget, re-estimate (converges in 2 passes).
  let dx = 0;
  let domY = 0;
  let domZ = 0;
  for (let pass = 0; pass < 3; pass++) {
    const frontal = (W + 1.5 * dx) * (H + 1.5 * dx);
    const targetCross = frontal / cap;
    // 2m² + (2·topOfBody + W)m + W·topOfBody − targetCross = 0
    const b = 2 * topOfBody + W;
    const margin = (-b + Math.sqrt(b * b + 8 * (targetCross - W * topOfBody))) / 4;
    domY = topOfBody + margin;
    domZ = W + 2 * margin;
    dx = Math.cbrt((domX * domY * domZ) / maxCells);
  }

  const nx = Math.round(domX / dx);
  const ny = Math.round(domY / dx);
  const nz = Math.round(domZ / dx);

  // Voxelize the body on a tight sub-grid (counts are domain-independent), then paste.
  const bodyMm = ahmedBody({ ...opts, groundClearance: 0 }); // clearance re-applied in cells
  const tightNx = Math.ceil(AHMED.length / (dx / MM)) + 3;
  const tightNy = Math.ceil(AHMED.height / (dx / MM)) + 3;
  const tightNz = Math.ceil(AHMED.width / (dx / MM)) + 3;
  const lattice = new Float32Array(bodyMm.positions.length);
  for (let i = 0; i < bodyMm.positions.length; i += 3) {
    lattice[i] = bodyMm.positions[i] / (dx / MM) + 1;
    lattice[i + 1] = bodyMm.positions[i + 1] / (dx / MM) + 1;
    lattice[i + 2] = (bodyMm.positions[i + 2] + AHMED.width / 2) / (dx / MM) + 1;
  }
  const tight = { nx: tightNx, ny: tightNy, nz: tightNz };
  const tightMask = voxelizeSolid(lattice, bodyMm.indices, tight);

  const flags = new Uint8Array(nx * ny * nz).fill(CellType.Fluid);
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  // Freestream sides and top, then the solid ground (ground wins every shared edge), then
  // inlet/outlet columns for y ≥ 1 so the ground row stays Solid on both x faces.
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      flags[at(x, y, 0)] = CellType.Inlet;
      flags[at(x, y, nz - 1)] = CellType.Inlet;
    }
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) flags[at(x, ny - 1, z)] = CellType.Inlet;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, 0, z)] = CellType.Solid;
  for (let z = 0; z < nz; z++)
    for (let y = 1; y < ny; y++) {
      flags[at(0, y, z)] = CellType.Inlet;
      flags[at(nx - 1, y, z)] = CellType.Outlet;
    }

  // Paste the body: nose at upstreamL body lengths, clearance above the ground plane.
  const noseX = Math.round((upstreamL * L) / dx);
  const clearanceCells = Math.round(clearance / dx);
  const oz = Math.round((nz - tightNz) / 2);
  let bodyVoxels = 0;
  for (let z = 0; z < tightNz; z++)
    for (let y = 0; y < tightNy; y++)
      for (let x = 0; x < tightNx; x++) {
        if (tightMask[x + tightNx * (y + tightNy * z)] !== CellType.Solid) continue;
        const gx = noseX + x - 1;
        const gy = clearanceCells + y - 1;
        const gz = oz + z;
        if (gx <= 0 || gx >= nx - 1 || gy <= 0 || gy >= ny - 1 || gz <= 0 || gz >= nz - 1) {
          throw new Error(`ahmedScene: body voxel (${gx},${gy},${gz}) touches the shell`);
        }
        flags[at(gx, gy, gz)] = CellType.Solid;
        bodyVoxels++;
      }

  // Frontal projection over interior columns (excludes the ground/shell rows).
  let frontalCells = 0;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        if (flags[at(x, y, z)] === CellType.Solid) {
          frontalCells++;
          break;
        }
      }
    }

  // Body mesh in DOMAIN lattice coordinates (tight cell x maps to noseX + x − 1).
  const domainMesh = new Float32Array(lattice.length);
  for (let i = 0; i < lattice.length; i += 3) {
    domainMesh[i] = lattice[i] + noseX - 1;
    domainMesh[i + 1] = lattice[i + 1] + clearanceCells - 1;
    domainMesh[i + 2] = lattice[i + 2] + oz;
  }

  const lengthCells = AHMED.length / (dx / MM);
  const nu = (u * lengthCells) / Re;
  const tau = 3 * nu + 0.5;
  return {
    nx,
    ny,
    nz,
    flags,
    dx,
    lengthCells,
    uLattice: u,
    nu,
    tau,
    omega: 1 / tau,
    Re,
    les: true,
    convectiveTimeSteps: Math.round(lengthCells / u),
    bodyVoxels,
    frontalCells,
    blockage: frontalCells / ((ny - 2) * (nz - 2)),
    noseX,
    mesh: { positions: domainMesh, indices: bodyMm.indices },
  };
}
