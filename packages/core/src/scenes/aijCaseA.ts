import { CellType } from '../lattice.js';

/**
 * AIJ Case A run setup (M10 step 5): the isolated 1:1:2 square prism (b = 0.08 m,
 * H = 2b = 0.16 m, 1/250 scale — Meng & Hibi wind tunnel), built CPU-side so the
 * browser page and the tests consume the identical scene.
 *
 * Domain follows the AIJ CFD guideline practice:
 * ~5H fetch upstream of the building, ≥10H downstream, lateral/top clearance keeping
 * frontal blockage ≤ ~3%. The grid is parameterized by `cellsPerB` (spec minimum 16 so
 * the 0.125·b measurement plane lands ≥ 2 cells above the ground); tests use tiny values.
 *
 * Axes: repo convention, y-up (ground y = 0, streamwise +x, lateral z). The AIJ data's
 * z-up coordinates are mapped by the fixture loader, not here.
 *
 * Wind direction (demo dial): the GEOMETRY rotates about the building's vertical axis by
 * `windDeg` before rasterization — never the inflow vector, which would break the
 * axis-aligned inlet/outlet/free-slip layout (M10 pitfall). The footprint is a rotated
 * square rasterized analytically (point-in-rotated-rect at cell centers) — no mesh
 * voxelizer needed for a prism.
 *
 * Boundaries (the H12-validated fetch-test layout, abl-fetch.test.ts): no-slip ground
 * y=0; free-slip top and z faces; x=0 interior = VelocityInlet (H12 flux-imposing —
 * the plain equilibrium inlet measurably sags to ~0.61–0.66·u_in and cannot hold the
 * 5% fetch gate); x=0 edges = plain Inlet (VelocityInlet needs a Fluid +x neighbor);
 * x=nx−1 interior = Outlet.
 *
 * Reynolds number is set THROUGH τ (M7 rule): Re_H on building height and the inlet
 * profile's velocity at z = H. The experiment runs at Re_H of order 10⁴ (a few m/s at
 * model scale); the exact value is a tuning knob recorded in Status, and the scored
 * quantities are normalized mean velocities, far less Re-sensitive at these Re than
 * forces would be. LES + regularization are mandatory: τ₀ sits near the floor.
 */

/** Case A geometry constants (model scale, meters). */
export const AIJ_CASE_A = {
  /** Building footprint width b. */
  b: 0.08,
  /** Building height H = 2b. */
  H: 0.16,
  /** Geometric scale of the wind-tunnel model. */
  scale: 250,
  /** Measurement plane height: 2.5 m full scale = 0.01 m model = 0.125·b. */
  measurementZ: 0.01,
} as const;

export interface CaseASceneOptions {
  /** Cells across the building width b. Spec minimum 16; default 16. */
  cellsPerB?: number;
  /** Wind-direction dial (degrees): rotates the BUILDING about its vertical axis. */
  windDeg?: number;
  /** Omit the building (empty-domain fetch check, step 7). */
  emptyDomain?: boolean;
  /** Building heights of clear fetch upstream / downstream. Defaults 5 / 10 (AIJ). */
  upstreamH?: number;
  downstreamH?: number;
  /** Frontal blockage cap (building frontal area / domain cross-section). Default 3%. */
  blockageCap?: number;
  /** Domain height in building heights H. Default 3 (clearance above the prism). */
  domainHeightH?: number;
  /**
   * Inlet profile in NORMALIZED velocity (u/u_ref, any consistent convention) at the
   * lattice node heights — length must equal ny; build it with `ablProfileLattice` (demo)
   * or `interpolateInflowToLattice` (measured AIJ inflow — mandatory for scoring). The
   * scene scales it so its maximum equals `uLattice`. A factory form `(ny, dx) =>`
   * profile is accepted because ny is derived from the domain rules above — callers
   * generally cannot know it up front.
   */
  inflowNormalized:
    Float64Array | Float32Array | ((ny: number, dx: number) => Float64Array | Float32Array);
  /** Lattice velocity at the profile maximum. Default 0.08 (< the 0.1 Mach limit). */
  uLattice?: number;
  /** Reynolds number on H and u(H). Default 2.4e4 (order of the experiment). */
  Re?: number;
}

export interface CaseAScene {
  nx: number;
  ny: number;
  nz: number;
  flags: Uint8Array;
  /** Meters per cell (model scale). */
  dx: number;
  bCells: number;
  hCells: number;
  /** Lattice inlet profile (length ny), scaled so max = uLattice. */
  profile: Float64Array;
  /**
   * Lattice velocity per unit of the input's NORMALIZED velocity (= uLattice / max of
   * `inflowNormalized`). Divide simulated lattice speeds by this to compare against the
   * dataset's normalized means — using any other reference silently destroys the hit
   * rate (M10 pitfall).
   */
  latticePerNormalized: number;
  uLattice: number;
  tau: number;
  omega: number;
  Re: number;
  /** Building-center lattice coordinates (x, z) and footprint rotation (deg). */
  centerX: number;
  centerZ: number;
  windDeg: number;
  buildingCells: number;
  /** Voxelized frontal silhouette / interior cross-section. */
  blockage: number;
  /** Convective time H/u(H) in steps. */
  convectiveTimeSteps: number;
  /** Continuous lattice y for a physical height z (halfway bounce-back: y = z/dx − 0.5). */
  heightToY(z: number): number;
  /**
   * Map a DATA-convention point (model-scale meters: origin building center on ground,
   * x streamwise, y lateral, z up) to continuous lattice cell coordinates (repo y-up).
   */
  pointToLattice(p: { x: number; y: number; z: number }): { x: number; y: number; z: number };
}

export function caseAScene(opts: CaseASceneOptions): CaseAScene {
  const cellsPerB = opts.cellsPerB ?? 16;
  const windDeg = opts.windDeg ?? 0;
  const upstreamH = opts.upstreamH ?? 5;
  const downstreamH = opts.downstreamH ?? 10;
  const cap = opts.blockageCap ?? 0.03;
  const heightH = opts.domainHeightH ?? 3;
  const u = opts.uLattice ?? 0.08;
  const Re = opts.Re ?? 2.4e4;

  const { b, H } = AIJ_CASE_A;
  const dx = b / cellsPerB;
  const bCells = cellsPerB;
  const hCells = Math.round(H / dx);

  // Rotated-footprint extents (the same square seen from the inflow widens with θ).
  const rad = (windDeg * Math.PI) / 180;
  const ext = b * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)));

  const domX = upstreamH * H + ext + downstreamH * H;
  const domY = heightH * H;
  // Width from the blockage cap: frontal (rotated width × H) / (width × height) ≤ cap,
  // with at least 1.5H clearance each side of the footprint.
  const domZ = Math.max((ext * H) / (cap * domY), ext + 3 * H);
  const nx = Math.round(domX / dx);
  const ny = Math.round(domY / dx);
  const nz = Math.round(domZ / dx);

  const inflow =
    typeof opts.inflowNormalized === 'function'
      ? opts.inflowNormalized(ny, dx)
      : opts.inflowNormalized;
  if (inflow.length !== ny) {
    throw new Error(`caseAScene: inflowNormalized length ${inflow.length} ≠ ny ${ny}`);
  }
  let max = 0;
  for (const v of inflow) max = Math.max(max, v);
  if (max <= 0) throw new Error('caseAScene: inflow profile must have a positive maximum');
  const profile = new Float64Array(ny);
  for (let k = 0; k < ny; k++) profile[k] = (inflow[k] / max) * u;

  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const flags = new Uint8Array(nx * ny * nz).fill(CellType.Fluid);

  // Shell in precedence order (the abl-fetch layout): free-slip top + z faces, solid
  // ground (wins shared edges), then the x faces — VelocityInlet strictly interior at
  // x=0 (needs a Fluid +x neighbor), plain Inlet on the x=0 edge ring, Outlet interior
  // at x=nx−1 (never with a Solid upstream neighbor, H4 §10.9).
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) flags[at(x, ny - 1, z)] = CellType.FreeSlip;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      flags[at(x, y, 0)] = CellType.FreeSlip;
      flags[at(x, y, nz - 1)] = CellType.FreeSlip;
    }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, 0, z)] = CellType.Solid;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) flags[at(0, y, z)] = CellType.VelocityInlet;
  for (let z = 0; z < nz; z++) flags[at(0, ny - 1, z)] = CellType.Inlet;
  for (let y = 1; y < ny; y++) {
    flags[at(0, y, 0)] = CellType.Inlet;
    flags[at(0, y, nz - 1)] = CellType.Inlet;
  }
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) flags[at(nx - 1, y, z)] = CellType.Outlet;

  // Building: rotated-square footprint about (centerX, centerZ), full height H.
  const centerX = (upstreamH * H + ext / 2) / dx;
  const centerZ = nz / 2;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const half = b / 2 / dx;
  let buildingCells = 0;
  if (!opts.emptyDomain) {
    const reach = Math.ceil(ext / 2 / dx) + 1;
    const x0 = Math.max(1, Math.floor(centerX - reach));
    const x1 = Math.min(nx - 2, Math.ceil(centerX + reach));
    const z0 = Math.max(1, Math.floor(centerZ - reach));
    const z1 = Math.min(nz - 2, Math.ceil(centerZ + reach));
    const yTop = Math.min(ny - 2, hCells);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        // Cell center in the building frame (rotate by −θ).
        const px = x + 0.5 - centerX;
        const pz = z + 0.5 - centerZ;
        const lx = px * cos + pz * sin;
        const lz = -px * sin + pz * cos;
        if (Math.abs(lx) > half || Math.abs(lz) > half) continue;
        for (let y = 1; y <= yTop; y++) flags[at(x, y, z)] = CellType.Solid;
        buildingCells += yTop;
      }
    if (buildingCells === 0) throw new Error('caseAScene: building rasterized to zero cells');
  }

  // Voxelized frontal silhouette over interior columns (the honest blockage figure).
  let frontal = 0;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        if (flags[at(x, y, z)] === CellType.Solid) {
          frontal++;
          break;
        }
      }

  // τ through Re_H on the profile's velocity at z = H (M7 rule: never guess ν).
  const yAtH = Math.min(ny - 1, Math.round(H / dx - 0.5));
  const uH = profile[yAtH];
  const nu = (uH * hCells) / Re;
  const tau = 3 * nu + 0.5;

  return {
    nx,
    ny,
    nz,
    flags,
    dx,
    bCells,
    hCells,
    profile,
    latticePerNormalized: u / max,
    uLattice: u,
    tau,
    omega: 1 / tau,
    Re,
    centerX,
    centerZ,
    windDeg,
    buildingCells,
    blockage: frontal / ((ny - 2) * (nz - 2)),
    convectiveTimeSteps: Math.round(hCells / uH),
    heightToY: (z: number) => z / dx - 0.5,
    pointToLattice: (p) => ({
      // Cell centers sit at integer indices + 0.5 in the rasterizer above; continuous
      // cell coordinates for sampleTrilinear put centers AT integers, hence the −0.5.
      x: centerX + p.x / dx - 0.5,
      y: p.z / dx - 0.5,
      z: centerZ + p.y / dx - 0.5,
    }),
  };
}
