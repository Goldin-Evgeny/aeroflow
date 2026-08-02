import { enuVectorToWindFrame, type EnuVector } from '../geometry/windFrame.js';

export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface UrbanDomainPadding {
  /** Clear fetch before the wind-aligned geometry bounds. Default 5 Hmax (AIJ). */
  upstreamH?: number;
  /** Clear fetch after the wind-aligned geometry bounds. Default 10 Hmax (AIJ). */
  downstreamH?: number;
  /** Clearance on each lateral side. Default 5 Hmax. */
  lateralH?: number;
  /** Clearance above the tallest building. Default 5 Hmax. */
  topH?: number;
}

export interface UrbanDomainOptions {
  /** Wind-aligned physical bounds in simulation meters: x downstream, y up, z right. */
  geometryBounds: Bounds3;
  /** Highest building above the ground plane, in the same physical meters. */
  maxBuildingHeight: number;
  /** Published probe height above the ground plane, in the same physical meters. */
  probeHeight: number;
  /** Maximum lattice cells available to this run. */
  maxCells: number;
  padding?: UrbanDomainPadding;
  /** Conservative geometry-AABB frontal blockage cap. Default 3%. */
  blockageCap?: number;
  /** Best-practice minimum cells across Hmax. Default 10. */
  minCellsPerBuildingHeight?: number;
}

export interface UrbanDomainCheck {
  code: 'probe-height' | 'building-resolution' | 'blockage';
  pass: boolean;
  message: string;
}

export interface UrbanDomainPlan {
  /** Physical domain dimensions in meters, [streamwise, vertical, lateral]. */
  domainSize: [number, number, number];
  grid: { nx: number; ny: number; nz: number };
  totalCells: number;
  /** Uniform lattice spacing in simulation meters. */
  dx: number;
  /** Highest building above the ground plane, in simulation meters. */
  maxBuildingHeight: number;
  /** Translation applied after wind alignment, before division by dx. */
  geometryOffset: [number, number, number];
  /** Continuous lattice coordinate of the probe plane; first fluid-node center is 0. */
  probeLatticeY: number;
  cellsPerBuildingHeight: number;
  /** Conservative wind-aligned geometry-AABB frontal blockage. */
  blockage: number;
  /** Finest spacing required by the third-cell and Hmax-resolution rules. */
  requiredDx: number;
  /** Cell count required at `requiredDx` for this same physical domain. */
  requiredCells: number;
  checks: UrbanDomainCheck[];
  acceptanceReady: boolean;
}

function finiteTriplet(values: ArrayLike<number>, offset: number): EnuVector {
  const east = values[offset];
  const north = values[offset + 1];
  const up = values[offset + 2];
  if (![east, north, up].every(Number.isFinite)) {
    throw new Error(`windAlignEnuPositions: non-finite vertex at index ${offset / 3}`);
  }
  return { east, north, up };
}

/**
 * Rotate ENU mesh vertices into the solver frame after subtracting a local ENU origin.
 * Subtraction happens in JavaScript f64 before the result is stored as f32, avoiding the
 * precision loss that would come from casting large UTM coordinates before translation.
 */
export function windAlignEnuPositions(
  positions: ArrayLike<number>,
  origin: EnuVector,
  windFromDegrees: number,
): Float32Array {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error('windAlignEnuPositions: positions must contain xyz triplets');
  }
  if (![origin.east, origin.north, origin.up].every(Number.isFinite)) {
    throw new Error('windAlignEnuPositions: origin must be finite');
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const point = finiteTriplet(positions, i);
    const aligned = enuVectorToWindFrame(
      {
        east: point.east - origin.east,
        north: point.north - origin.north,
        up: point.up - origin.up,
      },
      windFromDegrees,
    );
    out[i] = aligned.x;
    out[i + 1] = aligned.y;
    out[i + 2] = aligned.z;
  }
  return out;
}

/** Bounds of solver-frame xyz triplets. */
export function bounds3(positions: ArrayLike<number>): Bounds3 {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error('bounds3: positions must contain xyz triplets');
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      if (!Number.isFinite(value)) throw new Error('bounds3: positions must be finite');
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function gridFor(
  domainSize: readonly number[],
  dx: number,
): { nx: number; ny: number; nz: number } {
  return {
    nx: Math.max(8, Math.ceil(domainSize[0] / dx)),
    ny: Math.max(8, Math.ceil(domainSize[1] / dx)),
    nz: Math.max(8, Math.ceil(domainSize[2] / dx)),
  };
}

function cellCount(grid: { nx: number; ny: number; nz: number }): number {
  return grid.nx * grid.ny * grid.nz;
}

/**
 * Plan a uniform-grid urban wind-tunnel domain for one wind direction.
 *
 * This function reports, rather than conceals, the uniform-grid feasibility wall. In
 * particular, the published pedestrian probe plane may only be used for an acceptance
 * verdict when it lies at the third fluid-node center or higher:
 * `probeHeight / dx - 0.5 >= 2`. A coarse budget still returns a useful plan, but its
 * `acceptanceReady` flag is false and `requiredCells` states the honest minimum budget.
 */
export function planUrbanDomain(opts: UrbanDomainOptions): UrbanDomainPlan {
  const { geometryBounds: bounds } = opts;
  const H = opts.maxBuildingHeight;
  const probeHeight = opts.probeHeight;
  const maxCells = opts.maxCells;
  const cap = opts.blockageCap ?? 0.03;
  const minCellsPerH = opts.minCellsPerBuildingHeight ?? 10;
  const upstreamH = opts.padding?.upstreamH ?? 5;
  const downstreamH = opts.padding?.downstreamH ?? 10;
  const lateralH = opts.padding?.lateralH ?? 5;
  const topH = opts.padding?.topH ?? 5;

  if (
    !(H > 0) ||
    !(probeHeight > 0) ||
    !(maxCells >= 512) ||
    !(cap > 0 && cap < 1) ||
    !(minCellsPerH > 0) ||
    [upstreamH, downstreamH, lateralH, topH].some((value) => value < 0)
  ) {
    throw new Error('planUrbanDomain: invalid height, budget, blockage cap, or padding');
  }
  if (bounds.min[1] < -1e-9 || bounds.max[1] > H + 1e-9) {
    throw new Error('planUrbanDomain: geometry must lie between ground y=0 and Hmax');
  }
  if (bounds.size.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('planUrbanDomain: geometry bounds must be finite and ordered');
  }

  const domainX = bounds.size[0] + (upstreamH + downstreamH) * H;
  const domainY = H + topH * H;
  const clearanceWidth = bounds.size[2] + 2 * lateralH * H;
  const blockageWidth = (bounds.size[1] * bounds.size[2]) / (cap * domainY);
  const domainZ = Math.max(clearanceWidth, blockageWidth);
  const domainSize: [number, number, number] = [domainX, domainY, domainZ];

  let dx = Math.cbrt((domainX * domainY * domainZ) / maxCells);
  let grid = gridFor(domainSize, dx);
  while (cellCount(grid) > maxCells) {
    dx *= 1.005;
    grid = gridFor(domainSize, dx);
  }

  const totalCells = cellCount(grid);
  const probeLatticeY = probeHeight / dx - 0.5;
  const cellsPerBuildingHeight = H / dx;
  const blockage = (bounds.size[1] * bounds.size[2]) / (domainY * domainZ);
  const requiredDx = Math.min(probeHeight / 2.5, H / minCellsPerH);
  const requiredGrid = gridFor(domainSize, requiredDx);
  const requiredCells = cellCount(requiredGrid);
  const checks: UrbanDomainCheck[] = [
    {
      code: 'probe-height',
      pass: probeLatticeY >= 2,
      message:
        `probe plane y=${probeLatticeY.toFixed(2)} lattice nodes ` +
        `(gate: >= 2, third fluid-node center; dx <= ${(probeHeight / 2.5).toFixed(3)} m)`,
    },
    {
      code: 'building-resolution',
      pass: cellsPerBuildingHeight >= minCellsPerH,
      message: `${cellsPerBuildingHeight.toFixed(1)} cells/Hmax ` + `(gate: >= ${minCellsPerH})`,
    },
    {
      code: 'blockage',
      pass: blockage <= cap * (1 + 1e-12),
      message: `${(blockage * 100).toFixed(2)}% AABB blockage (gate: <= ${cap * 100}%)`,
    },
  ];

  return {
    domainSize,
    grid,
    totalCells,
    dx,
    maxBuildingHeight: H,
    geometryOffset: [
      upstreamH * H - bounds.min[0],
      bounds.min[1] === 0 ? 0 : -bounds.min[1],
      (domainZ - bounds.size[2]) / 2 - bounds.min[2],
    ],
    probeLatticeY,
    cellsPerBuildingHeight,
    blockage,
    requiredDx,
    requiredCells,
    checks,
    acceptanceReady: checks.every((check) => check.pass),
  };
}

/** Fail loudly before an under-resolved plan can produce a published verdict. */
export function assertUrbanDomainAcceptanceReady(plan: UrbanDomainPlan): void {
  const failed = plan.checks.filter((check) => !check.pass);
  if (failed.length === 0) return;
  throw new Error(
    `urban domain is not acceptance-ready: ${failed.map((check) => check.message).join('; ')}; ` +
      `same domain requires ${plan.requiredCells.toLocaleString()} cells at dx <= ` +
      `${plan.requiredDx.toFixed(3)} m`,
  );
}
