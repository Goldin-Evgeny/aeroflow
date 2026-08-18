import { D3Q19 } from '../lattice3d.js';
import {
  lesKFromCs,
  piNeqNormLegacy,
  piNeqNormSpec,
  smagorinskyTauEff,
  type LesNorm,
} from './collide.js';

/**
 * Independent D3Q19 central-monomial basis. The absent corner velocities leave exactly these
 * 19 linearly independent monomials through mixed fourth order.
 */
export const D3Q19_CENTRAL_EXPONENTS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [2, 0, 0],
  [0, 2, 0],
  [0, 0, 2],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [2, 1, 0],
  [2, 0, 1],
  [1, 2, 0],
  [0, 2, 1],
  [1, 0, 2],
  [0, 1, 2],
  [2, 2, 0],
  [2, 0, 2],
  [0, 2, 2],
] as const;

export type D3Q19CentralExponent = (typeof D3Q19_CENTRAL_EXPONENTS)[number];

export function d3q19CentralMomentIndex(px: number, py: number, pz: number): number {
  const index = D3Q19_CENTRAL_EXPONENTS.findIndex(([x, y, z]) => x === px && y === py && z === pz);
  if (index < 0) throw new Error(`unsupported D3Q19 central moment (${px},${py},${pz})`);
  return index;
}

export interface D3Q19CentralCollisionOptions {
  tau0: number;
  lesCs?: number;
  lesNorm?: LesNorm;
}

export interface D3Q19CentralInvariantResidual {
  mass: number;
  momentumX: number;
  momentumY: number;
  momentumZ: number;
  maximumAbs: number;
}

export interface D3Q19CentralCollisionResult {
  rho: number;
  ux: number;
  uy: number;
  uz: number;
  tauEff: number;
  piNeq: Float64Array;
  rates: { shear: number; bulk: 1; nonHydrodynamic: 1 };
  invariantResidual: D3Q19CentralInvariantResidual;
}

export interface D3Q19PeriodicGrid {
  nx: number;
  ny: number;
  nz: number;
}

export interface D3Q19BoundedGrid extends D3Q19PeriodicGrid {
  /** Direction-major field cell mask: 0 is fluid and any non-zero value is solid. */
  cellType: Uint8Array;
}

export type D3Q19PeriodicObserver = (
  index: number,
  collision: D3Q19CentralCollisionResult,
  postCollision: Float64Array,
) => void;

/** K[p,i] = (cix-ux)^px (ciy-uy)^py (ciz-uz)^pz. */
export function centralMomentMatrixD3Q19(ux: number, uy: number, uz: number): number[][] {
  return D3Q19_CENTRAL_EXPONENTS.map(([px, py, pz]) =>
    Array.from(
      { length: D3Q19.q },
      (_, direction) =>
        (D3Q19.ex[direction] - ux) ** px *
        (D3Q19.ey[direction] - uy) ** py *
        (D3Q19.ez[direction] - uz) ** pz,
    ),
  );
}

/** Maxwell central-moment attractors restricted to the supported D3Q19 basis. */
export function centralMomentAttractorsD3Q19(rho: number): Float64Array {
  return Float64Array.from(D3Q19_CENTRAL_EXPONENTS, ([px, py, pz]) => {
    if (px % 2 === 1 || py % 2 === 1 || pz % 2 === 1) return 0;
    const secondOrderAxes = Number(px === 2) + Number(py === 2) + Number(pz === 2);
    return rho * D3Q19.cs2 ** secondOrderAxes;
  });
}

/** Float64 correctness authority: Gauss-Jordan solve with partial pivoting. */
export function populationsFromCentralMomentsD3Q19(
  transform: number[][],
  moments: ArrayLike<number>,
): Float64Array {
  if (transform.length !== D3Q19.q || moments.length !== D3Q19.q) {
    throw new Error('D3Q19 central transform requires 19 moments');
  }
  const n = D3Q19.q;
  const augmented = transform.map((row, index) => {
    if (row.length !== n) throw new Error('D3Q19 central transform must be square');
    return [...row, moments[index]];
  });
  for (let pivot = 0; pivot < n; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (Math.abs(augmented[best][pivot]) < 1e-14) {
      throw new Error('singular D3Q19 central-moment basis');
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const diagonal = augmented[pivot][pivot];
    for (let column = pivot; column <= n; column++) augmented[pivot][column] /= diagonal;
    for (let row = 0; row < n; row++) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= n; column++) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }
  return Float64Array.from(augmented, (row) => row[n]);
}

export function centralMomentsD3Q19(
  populations: ArrayLike<number>,
  ux: number,
  uy: number,
  uz: number,
): Float64Array {
  if (populations.length !== D3Q19.q) throw new Error('D3Q19 requires 19 populations');
  const transform = centralMomentMatrixD3Q19(ux, uy, uz);
  return Float64Array.from(transform, (row) =>
    row.reduce((sum, coefficient, direction) => sum + coefficient * populations[direction], 0),
  );
}

export function equilibriumD3Q19Central(
  rho: number,
  ux: number,
  uy: number,
  uz: number,
): Float64Array {
  if (!(rho > 0) || ![rho, ux, uy, uz].every(Number.isFinite)) {
    throw new Error('D3Q19 central equilibrium requires finite rho > 0 and velocity');
  }
  return populationsFromCentralMomentsD3Q19(
    centralMomentMatrixD3Q19(ux, uy, uz),
    centralMomentAttractorsD3Q19(rho),
  );
}

export function conservedD3Q19(populations: ArrayLike<number>): [number, number, number, number] {
  if (populations.length !== D3Q19.q) throw new Error('D3Q19 requires 19 populations');
  let rho = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let direction = 0; direction < D3Q19.q; direction++) {
    const value = populations[direction];
    rho += value;
    mx += D3Q19.ex[direction] * value;
    my += D3Q19.ey[direction] * value;
    mz += D3Q19.ez[direction] * value;
  }
  return [rho, mx, my, mz];
}

export function collideD3Q19Central(
  populations: Float64Array,
  options: D3Q19CentralCollisionOptions,
): D3Q19CentralCollisionResult {
  if (populations.length !== D3Q19.q) {
    throw new Error(`D3Q19 collision requires ${D3Q19.q} populations, got ${populations.length}`);
  }
  const lesCs = options.lesCs ?? 0;
  const lesNorm = options.lesNorm ?? 'legacy';
  if (!(options.tau0 > 0.5) || !Number.isFinite(options.tau0)) {
    throw new Error('tau0 must be finite and > 0.5');
  }
  if (!(lesCs >= 0) || !Number.isFinite(lesCs)) {
    throw new Error('lesCs must be finite and >= 0');
  }
  const before = conservedD3Q19(populations);
  const [rho, mx, my, mz] = before;
  if (!(rho > 0) || !Number.isFinite(rho)) {
    throw new Error('D3Q19 collision requires finite rho > 0');
  }
  const ux = mx / rho;
  const uy = my / rho;
  const uz = mz / rho;
  const transform = centralMomentMatrixD3Q19(ux, uy, uz);
  const moments = centralMomentsD3Q19(populations, ux, uy, uz);
  const equilibrium = centralMomentAttractorsD3Q19(rho);
  const xx = d3q19CentralMomentIndex(2, 0, 0);
  const yy = d3q19CentralMomentIndex(0, 2, 0);
  const zz = d3q19CentralMomentIndex(0, 0, 2);
  const xy = d3q19CentralMomentIndex(1, 1, 0);
  const xz = d3q19CentralMomentIndex(1, 0, 1);
  const yz = d3q19CentralMomentIndex(0, 1, 1);
  const piNeq = Float64Array.of(
    moments[xx] - equilibrium[xx],
    moments[yy] - equilibrium[yy],
    moments[zz] - equilibrium[zz],
    moments[xy],
    moments[xz],
    moments[yz],
  );
  const lesK = lesKFromCs(lesCs);
  const qNorm = lesNorm === 'spec' ? piNeqNormSpec(piNeq) : piNeqNormLegacy(piNeq);
  const tauEff = lesK === 0 ? options.tau0 : smagorinskyTauEff(options.tau0, lesK, qNorm, rho);
  const shear = 1 / tauEff;

  const post = new Float64Array(equilibrium);
  for (const exponent of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const) {
    const index = d3q19CentralMomentIndex(exponent[0], exponent[1], exponent[2]);
    post[index] = moments[index];
  }
  const trace = equilibrium[xx] + equilibrium[yy] + equilibrium[zz];
  const differenceXy = (1 - shear) * (moments[xx] - moments[yy]);
  const differenceYz = (1 - shear) * (moments[yy] - moments[zz]);
  post[xx] = (trace + 2 * differenceXy + differenceYz) / 3;
  post[yy] = (trace - differenceXy + differenceYz) / 3;
  post[zz] = (trace - differenceXy - 2 * differenceYz) / 3;
  for (const index of [xy, xz, yz]) {
    post[index] = moments[index] + shear * (equilibrium[index] - moments[index]);
  }

  populations.set(populationsFromCentralMomentsD3Q19(transform, post));
  const after = conservedD3Q19(populations);
  const residual = after.map((value, index) => value - before[index]) as [
    number,
    number,
    number,
    number,
  ];
  const invariantResidual: D3Q19CentralInvariantResidual = {
    mass: residual[0],
    momentumX: residual[1],
    momentumY: residual[2],
    momentumZ: residual[3],
    maximumAbs: Math.max(...residual.map(Math.abs)),
  };
  return {
    rho,
    ux,
    uy,
    uz,
    tauEff,
    piNeq,
    rates: { shear, bulk: 1, nonHydrodynamic: 1 },
    invariantResidual,
  };
}

/** Pull-stream then collide one fully periodic two-copy D3Q19 field. */
export function streamCollidePeriodicD3Q19Central(
  source: Float64Array,
  destination: Float64Array,
  grid: D3Q19PeriodicGrid,
  options: D3Q19CentralCollisionOptions,
  observe?: D3Q19PeriodicObserver,
): void {
  const { nx, ny, nz } = grid;
  if (![nx, ny, nz].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('periodic D3Q19 dimensions must be positive integers');
  }
  const cells = nx * ny * nz;
  const length = D3Q19.q * cells;
  if (source === destination) throw new Error('periodic D3Q19 source and destination must differ');
  if (source.length !== length || destination.length !== length) {
    throw new Error(`periodic D3Q19 field requires ${length} values per buffer`);
  }
  const gathered = new Float64Array(D3Q19.q);
  const index = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const cell = index(x, y, z);
        for (let direction = 0; direction < D3Q19.q; direction++) {
          const sx = (x - D3Q19.ex[direction] + nx) % nx;
          const sy = (y - D3Q19.ey[direction] + ny) % ny;
          const sz = (z - D3Q19.ez[direction] + nz) % nz;
          gathered[direction] = source[direction * cells + index(sx, sy, sz)];
        }
        const collision = collideD3Q19Central(gathered, options);
        for (let direction = 0; direction < D3Q19.q; direction++) {
          destination[direction * cells + cell] = gathered[direction];
        }
        observe?.(cell, collision, gathered);
      }
    }
  }
}

/**
 * Pull-stream then collide an enclosed diagnostic field. A link whose source is outside the
 * domain or solid uses halfway bounce-back from the destination cell's opposite population.
 * Solid cells are copied verbatim. This intentionally small adapter is for bounded CPU evidence;
 * shipped inlet/outlet scene construction remains on Solver3D and the production collision.
 */
export function streamCollideBoundedD3Q19Central(
  source: Float64Array,
  destination: Float64Array,
  grid: D3Q19BoundedGrid,
  options: D3Q19CentralCollisionOptions,
  observe?: D3Q19PeriodicObserver,
): void {
  const { nx, ny, nz, cellType } = grid;
  if (![nx, ny, nz].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('bounded D3Q19 dimensions must be positive integers');
  }
  const cells = nx * ny * nz;
  const length = D3Q19.q * cells;
  if (source === destination) throw new Error('bounded D3Q19 source and destination must differ');
  if (source.length !== length || destination.length !== length || cellType.length !== cells) {
    throw new Error(`bounded D3Q19 field requires ${length} populations and ${cells} cell flags`);
  }
  const gathered = new Float64Array(D3Q19.q);
  const index = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const cell = index(x, y, z);
        if (cellType[cell] !== 0) {
          for (let direction = 0; direction < D3Q19.q; direction++) {
            destination[direction * cells + cell] = source[direction * cells + cell];
          }
          continue;
        }
        for (let direction = 0; direction < D3Q19.q; direction++) {
          const sx = x - D3Q19.ex[direction];
          const sy = y - D3Q19.ey[direction];
          const sz = z - D3Q19.ez[direction];
          const outside = sx < 0 || sx >= nx || sy < 0 || sy >= ny || sz < 0 || sz >= nz;
          const sourceCell = outside ? -1 : index(sx, sy, sz);
          gathered[direction] =
            outside || cellType[sourceCell] !== 0
              ? source[D3Q19.opp[direction] * cells + cell]
              : source[direction * cells + sourceCell];
        }
        const collision = collideD3Q19Central(gathered, options);
        for (let direction = 0; direction < D3Q19.q; direction++) {
          destination[direction * cells + cell] = gathered[direction];
        }
        observe?.(cell, collision, gathered);
      }
    }
  }
}
