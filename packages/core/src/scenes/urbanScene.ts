import { CellType } from '../lattice.js';
import { latticeUnits, type UnitMapping } from '../units.js';
import { voxelizeSolid } from '../voxel/voxelize.js';
import type { TriangleMesh } from '../geometry/icosphere.js';
import type { UrbanDomainPlan } from './urbanDomain.js';

export interface WindAlignedPoint {
  /** Physical simulation meters downstream from the shared benchmark origin. */
  x: number;
  /** Physical simulation meters above ground. */
  y: number;
  /** Physical simulation meters to flow-right from the shared benchmark origin. */
  z: number;
}

export interface UrbanSceneOptions {
  /** Wind-aligned physical-meter mesh. Must be watertight for solid voxelization. */
  mesh: TriangleMesh;
  plan: UrbanDomainPlan;
  /** Uref in physical m/s under the benchmark's documented convention. */
  uRefMps: number;
  /** U/Uref at every lattice y row, or a factory once ny/dx are known. */
  inflowNormalized:
    Float32Array | Float64Array | ((ny: number, dx: number) => Float32Array | Float64Array);
  /** Maximum actual inlet velocity in lattice units. Default 0.08; must be <= 0.1. */
  maxLatticeVelocity?: number;
  physViscosity?: number;
}

export interface UrbanSceneSetup {
  nx: number;
  ny: number;
  nz: number;
  /** Wind-aligned mesh transformed into domain lattice coordinates. */
  mesh: TriangleMesh;
  plan: UrbanDomainPlan;
  /** Lattice inlet profile, indexed by y. */
  profile: Float64Array;
  /** Lattice velocity representing one unit of U/Uref. */
  latticePerNormalized: number;
  mapping: UnitMapping;
  convectiveTimeSteps: number;
  /** Map a wind-aligned physical point to continuous lattice cell coordinates. */
  pointToLattice(point: WindAlignedPoint): { x: number; y: number; z: number };
}

export interface UrbanScene extends UrbanSceneSetup {
  flags: Uint8Array;
  geometryVoxels: number;
}

export interface UrbanBoundaryResult {
  flags: Uint8Array;
  geometryVoxels: number;
}

/** Shared physical-to-lattice transform for urban mesh vertices. */
export function toUrbanLatticePositions(
  positions: ArrayLike<number>,
  plan: UrbanDomainPlan,
): Float32Array {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error('toUrbanLatticePositions: positions must contain xyz triplets');
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      if (!Number.isFinite(value)) {
        throw new Error(`toUrbanLatticePositions: non-finite vertex at index ${i / 3}`);
      }
      out[i + axis] = (value + plan.geometryOffset[axis]) / plan.dx - 0.5;
    }
  }
  return out;
}

/** Shared physical-to-lattice transform for benchmark probes. */
export function urbanPointToLattice(
  point: WindAlignedPoint,
  plan: UrbanDomainPlan,
): { x: number; y: number; z: number } {
  if (![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new Error('urbanPointToLattice: point must be finite');
  }
  return {
    x: (point.x + plan.geometryOffset[0]) / plan.dx - 0.5,
    y: (point.y + plan.geometryOffset[1]) / plan.dx - 0.5,
    z: (point.z + plan.geometryOffset[2]) / plan.dx - 0.5,
  };
}

/** Prepare the unit mapping, inlet profile, and lattice-space mesh shared by CPU/GPU. */
export function prepareUrbanScene(opts: UrbanSceneOptions): UrbanSceneSetup {
  const { plan } = opts;
  const { nx, ny, nz } = plan.grid;
  const maxLatticeVelocity = opts.maxLatticeVelocity ?? 0.08;
  if (!(opts.uRefMps > 0) || !(maxLatticeVelocity > 0 && maxLatticeVelocity <= 0.1)) {
    throw new Error('urbanScene: Uref must be positive and max lattice velocity in (0, 0.1]');
  }
  if (opts.mesh.indices.length === 0 || opts.mesh.indices.length % 3 !== 0) {
    throw new Error('urbanScene: mesh must contain indexed triangles');
  }

  const normalized =
    typeof opts.inflowNormalized === 'function'
      ? opts.inflowNormalized(ny, plan.dx)
      : opts.inflowNormalized;
  if (normalized.length !== ny) {
    throw new Error(`urbanScene: inflow length ${normalized.length} != ny ${ny}`);
  }
  let maxNormalized = 0;
  for (let y = 0; y < ny; y++) {
    const value = normalized[y];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`urbanScene: invalid normalized inflow at y=${y}`);
    }
    maxNormalized = Math.max(maxNormalized, value);
  }
  if (maxNormalized <= 0) throw new Error('urbanScene: inflow must have a positive maximum');

  const latticePerNormalized = maxLatticeVelocity / maxNormalized;
  const profile = Float64Array.from(normalized, (value) => value * latticePerNormalized);
  const mapping = latticeUnits({
    physLength: plan.maxBuildingHeight,
    physVelocity: opts.uRefMps,
    physViscosity: opts.physViscosity,
    cells: plan.maxBuildingHeight / plan.dx,
    uLattice: latticePerNormalized,
    les: true,
  });

  const latticePositions = toUrbanLatticePositions(opts.mesh.positions, plan);
  return {
    nx,
    ny,
    nz,
    mesh: { positions: latticePositions, indices: opts.mesh.indices },
    plan,
    profile,
    latticePerNormalized,
    mapping,
    convectiveTimeSteps: Math.round(plan.maxBuildingHeight / plan.dx / latticePerNormalized),
    pointToLattice: (point) => urbanPointToLattice(point, plan),
  };
}

/** Overlay the exact H11/H12 shell on a CPU- or GPU-produced geometry mask. */
export function urbanBoundaryFlags(
  geometryMask: Uint8Array,
  grid: { nx: number; ny: number; nz: number },
): UrbanBoundaryResult {
  const { nx, ny, nz } = grid;
  if (geometryMask.length !== nx * ny * nz) {
    throw new Error(
      `urbanBoundaryFlags: mask length ${geometryMask.length} != grid cells ${nx * ny * nz}`,
    );
  }
  const flags = Uint8Array.from(geometryMask);
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  let geometryVoxels = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (flags[at(x, y, z)] !== CellType.Solid) continue;
        geometryVoxels++;
        if (x === 0 || x === nx - 1 || y === ny - 1 || z === 0 || z === nz - 1) {
          throw new Error(`urbanBoundaryFlags: geometry voxel (${x},${y},${z}) touches the shell`);
        }
      }
  if (geometryVoxels === 0) throw new Error('urbanBoundaryFlags: geometry voxelized to zero cells');

  // H11 free-slip top and lateral faces.
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) flags[at(x, ny - 1, z)] = CellType.FreeSlip;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      flags[at(x, y, 0)] = CellType.FreeSlip;
      flags[at(x, y, nz - 1)] = CellType.FreeSlip;
    }
  // No-slip ground wins shared shell edges.
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, 0, z)] = CellType.Solid;
  // H12 VelocityInlet strictly inside the x=0 face; plain Inlet on its edge ring.
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) flags[at(0, y, z)] = CellType.VelocityInlet;
  for (let z = 0; z < nz; z++) flags[at(0, ny - 1, z)] = CellType.Inlet;
  for (let y = 1; y < ny; y++) {
    flags[at(0, y, 0)] = CellType.Inlet;
    flags[at(0, y, nz - 1)] = CellType.Inlet;
  }
  // H4 zero-gradient outlet only on the strict interior; shell edges keep their BC.
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) flags[at(nx - 1, y, z)] = CellType.Outlet;

  // Every VelocityInlet must retain the Fluid +x neighbor required by H12.
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) {
      if (flags[at(0, y, z)] === CellType.VelocityInlet && flags[at(1, y, z)] !== CellType.Fluid) {
        throw new Error(`urbanBoundaryFlags: VelocityInlet (${y},${z}) lacks a Fluid +x neighbor`);
      }
    }

  return { flags, geometryVoxels };
}

/**
 * Build the CPU correctness oracle for one wind-aligned urban direction.
 *
 * Geometry is voxelized before the shared boundary shell is overlaid. The GPU runner
 * uses the same setup and shell with the M8 voxelizer between them.
 */
export function urbanScene(opts: UrbanSceneOptions): UrbanScene {
  const setup = prepareUrbanScene(opts);
  const geometryMask = voxelizeSolid(setup.mesh.positions, setup.mesh.indices, setup.plan.grid);
  const { flags, geometryVoxels } = urbanBoundaryFlags(geometryMask, setup.plan.grid);
  return {
    ...setup,
    flags,
    geometryVoxels,
  };
}
