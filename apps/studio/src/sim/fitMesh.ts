import { AIR_KINEMATIC_VISCOSITY, latticeUnits, type UnitMapping } from '@aeroflow/core';
import type { MeshBounds } from './meshImport';

/**
 * Auto-scaling wizard math (M8 step 6), kept pure and headless-testable; scaleWizard UI in
 * ui/import3d.ts renders these numbers and the one-click fixes.
 *
 * Given the mesh's physical bounding box, a characteristic length, and the wind speed,
 * fit the mesh into a lattice domain: flow along +x, padding per the M4/M7 blockage
 * guidance (≥2 characteristic lengths upstream, ≥6 downstream, ≥2 lateral; blockage ≤5%),
 * resolution chosen to spend the device-tier cell budget. All unit conversions go through
 * `latticeUnits()` (repo convention — never duplicate the math).
 */

export interface FitOptions {
  /** Physical bbox size in METERS (after unit scale), [sx, sy, sz]; flow is +x. */
  bboxSize: [number, number, number];
  /** Characteristic length in meters (wizard default: bbox height, i.e. sy). */
  charLen: number;
  /** Wind speed in m/s. */
  windSpeed: number;
  physViscosity?: number;
  /** Target lattice velocity (Mach control). Default 0.05. */
  uLattice?: number;
  les?: boolean;
  /** Cell budget from the device tier (M6 limits panel). Default 16.7M (256³-class). */
  maxCells?: number;
  /** Padding in characteristic lengths. Defaults: upstream 2, downstream 6, lateral 2. */
  padding?: { upstream?: number; downstream?: number; lateral?: number };
}

export interface FitWarning {
  code: 'tau-floor' | 'mach' | 'blockage' | 'resolution';
  message: string;
  /** One-click remedy the UI offers (wizard warns, never blocks — M8 step 6). */
  fix?: 'enable-les' | 'reduce-u';
}

export interface DomainFit {
  grid: { nx: number; ny: number; nz: number };
  totalCells: number;
  /** Meters per cell (== mapping.dx). */
  dx: number;
  cellsPerCharLen: number;
  mapping: UnitMapping;
  /** Lattice coordinates of the mesh bbox MIN corner (fractional cells). */
  meshOffset: [number, number, number];
  /** Mesh-bbox frontal area over domain cross-section — an upper bound on true blockage. */
  blockage: number;
  warnings: FitWarning[];
}

export const DEFAULT_MAX_CELLS = 16_700_000;

export function fitMeshToDomain(opts: FitOptions): DomainFit {
  const [sx, sy, sz] = opts.bboxSize;
  const L = opts.charLen;
  if (!(L > 0) || !(sx >= 0) || !(sy >= 0) || !(sz >= 0)) {
    throw new Error('fitMeshToDomain: bbox and characteristic length must be positive');
  }
  const up = opts.padding?.upstream ?? 2;
  const down = opts.padding?.downstream ?? 6;
  const lat = opts.padding?.lateral ?? 2;
  const maxCells = opts.maxCells ?? DEFAULT_MAX_CELLS;

  // Physical domain box, then the cell size that spends the budget.
  const domX = sx + (up + down) * L;
  const domY = sy + 2 * lat * L;
  const domZ = sz + 2 * lat * L;
  let dx = Math.cbrt((domX * domY * domZ) / maxCells);
  const dims = (): { nx: number; ny: number; nz: number } => ({
    nx: Math.max(8, Math.ceil(domX / dx)),
    ny: Math.max(8, Math.ceil(domY / dx)),
    nz: Math.max(8, Math.ceil(domZ / dx)),
  });
  // Ceiling each dimension can push the product past the budget; nudge dx up until it fits.
  let grid = dims();
  while (grid.nx * grid.ny * grid.nz > maxCells) {
    dx *= 1.005;
    grid = dims();
  }

  const cellsPerCharLen = L / dx;
  const mapping = latticeUnits({
    physLength: L,
    physVelocity: opts.windSpeed,
    physViscosity: opts.physViscosity ?? AIR_KINEMATIC_VISCOSITY,
    cells: cellsPerCharLen,
    uLattice: opts.uLattice ?? 0.05,
    les: opts.les ?? false,
  });

  const blockage = (sy * sz) / (domY * domZ);
  const warnings: FitWarning[] = [];
  if (mapping.tau < 0.505 && !opts.les) {
    warnings.push({
      code: 'tau-floor',
      message:
        `τ = ${mapping.tau.toFixed(5)} sits on the stability floor (high Re drives ` +
        `ν_lattice → 0); plain collision will diverge within a few hundred steps`,
      fix: 'enable-les',
    });
  }
  if (mapping.uLattice > 0.1) {
    warnings.push({
      code: 'mach',
      message: `lattice u = ${mapping.uLattice} exceeds 0.1 — compressibility error grows as O(Ma²)`,
      fix: 'reduce-u',
    });
  }
  if (blockage > 0.05) {
    warnings.push({
      code: 'blockage',
      message: `frontal blockage ${(blockage * 100).toFixed(1)}% exceeds 5% — confinement will inflate drag; increase lateral padding or the cell budget`,
    });
  }
  if (cellsPerCharLen < 24) {
    warnings.push({
      code: 'resolution',
      message: `${cellsPerCharLen.toFixed(1)} cells per characteristic length (< 24) — staircase resolution will over-predict drag; raise the cell budget or shrink padding`,
    });
  }

  return {
    grid,
    totalCells: grid.nx * grid.ny * grid.nz,
    dx,
    cellsPerCharLen,
    mapping,
    meshOffset: [(up * L) / dx, (lat * L) / dx, (lat * L) / dx],
    blockage,
    warnings,
  };
}

/**
 * Physical → lattice transform for the voxelizer (1 unit = 1 cell): translate the mesh
 * bbox min to `fit.meshOffset` and scale by 1/dx. Pre-transforming on the CPU keeps the
 * WGSL surface kernel free of matrix math (M8 step 2).
 */
export function toLatticeSpace(
  positions: Float32Array,
  bounds: MeshBounds,
  fit: DomainFit,
): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      out[i + a] = (positions[i + a] - bounds.min[a]) / fit.dx + fit.meshOffset[a];
    }
  }
  return out;
}
