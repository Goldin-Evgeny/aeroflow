import { D3Q27 } from '../lattice3d.js';
import { piNeqNorm, smagorinskyTauEff } from './collide.js';

/** Audited tensor-product central-moment ordering: index = 9*px + 3*py + pz. */
export const D3Q27_CENTRAL_EXPONENTS = Object.freeze(
  Array.from(
    { length: D3Q27.q },
    (_, moment) => [Math.floor(moment / 9), Math.floor((moment % 9) / 3), moment % 3] as const,
  ),
);

export const d3q27CentralMomentIndex = (px: number, py: number, pz: number): number =>
  px * 9 + py * 3 + pz;

export interface D3Q27CentralCollisionOptions {
  /** Base relaxation time. The audited shear rate is 1/tauEff and requires tau0 > 0.5. */
  tau0: number;
  /** Smagorinsky constant. Zero disables SGS without changing the collision formulation. */
  lesCs?: number;
}

export interface D3Q27CentralCollisionResult {
  rho: number;
  ux: number;
  uy: number;
  uz: number;
  tauEff: number;
  /** Pre-collision central/raw non-equilibrium stress [xx, yy, zz, xy, xz, yz]. */
  piNeq: Float64Array;
}

export interface D3Q27PeriodicGrid {
  nx: number;
  ny: number;
  nz: number;
}

export type D3Q27PeriodicObserver = (
  index: number,
  collision: D3Q27CentralCollisionResult,
  postCollision: Float64Array,
) => void;

/** K[p,i] = (cix-ux)^px (ciy-uy)^py (ciz-uz)^pz. */
export function centralMomentMatrixD3Q27(ux: number, uy: number, uz: number): number[][] {
  const velocity = [ux, uy, uz];
  return D3Q27_CENTRAL_EXPONENTS.map(([px, py, pz]) =>
    D3Q27.velocities.map(
      ([ex, ey, ez]) =>
        (ex - velocity[0]) ** px * (ey - velocity[1]) ** py * (ez - velocity[2]) ** pz,
    ),
  );
}

/** Audited Maxwell central-moment attractors for the D3Q27 tensor product. */
export function centralMomentAttractorsD3Q27(rho: number): Float64Array {
  return Float64Array.from(D3Q27_CENTRAL_EXPONENTS, ([px, py, pz]) => {
    if (px === 1 || py === 1 || pz === 1) return 0;
    const secondOrderAxes = Number(px === 2) + Number(py === 2) + Number(pz === 2);
    return rho * D3Q27.cs2 ** secondOrderAxes;
  });
}

/**
 * Audited inverse central-moment transform: Float64 Gauss-Jordan elimination with partial
 * pivoting. An explicit/factorized inverse would be an optimization and is intentionally not
 * substituted into this correctness authority.
 */
export function populationsFromCentralMomentsD3Q27(
  transform: number[][],
  moments: ArrayLike<number>,
): Float64Array {
  const n = transform.length;
  const augmented = transform.map((row, index) => [...row, moments[index]]);
  for (let pivot = 0; pivot < n; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (Math.abs(augmented[best][pivot]) < 1e-14) {
      throw new Error('singular D3Q27 central-moment basis');
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

export function equilibriumD3Q27Central(
  rho: number,
  ux: number,
  uy: number,
  uz: number,
): Float64Array {
  return populationsFromCentralMomentsD3Q27(
    centralMomentMatrixD3Q27(ux, uy, uz),
    centralMomentAttractorsD3Q27(rho),
  );
}

export function conservedD3Q27(populations: ArrayLike<number>): [number, number, number, number] {
  let rho = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let direction = 0; direction < D3Q27.q; direction++) {
    const value = populations[direction];
    rho += value;
    mx += D3Q27.ex[direction] * value;
    my += D3Q27.ey[direction] * value;
    mz += D3Q27.ez[direction] * value;
  }
  return [rho, mx, my, mz];
}

/**
 * Production Float64 authority for the M9-audited D3Q27 central-moment collision.
 *
 * Mathematics is intentionally identical to the accepted test-local operator:
 * - density and the three first central moments are conserved;
 * - diagonal deviatoric and off-diagonal second moments relax at 1/tauEff;
 * - trace/bulk and every higher moment are set to their attractors at unit rate;
 * - Hou/Smagorinsky uses the shared production 18*sqrt(2)*Cs^2 formula;
 * - the Float64 density residual is deposited in rest direction 13 only.
 */
export function collideD3Q27Central(
  populations: Float64Array,
  options: D3Q27CentralCollisionOptions,
): D3Q27CentralCollisionResult {
  if (populations.length !== D3Q27.q) {
    throw new Error(`D3Q27 collision requires ${D3Q27.q} populations, got ${populations.length}`);
  }
  const { tau0 } = options;
  const lesCs = options.lesCs ?? 0;
  if (!(tau0 > 0.5) || !Number.isFinite(tau0)) throw new Error('tau0 must be finite and > 0.5');
  if (!(lesCs >= 0) || !Number.isFinite(lesCs)) throw new Error('lesCs must be finite and >= 0');

  const [rho, mx, my, mz] = conservedD3Q27(populations);
  if (!(rho > 0) || !Number.isFinite(rho))
    throw new Error('D3Q27 collision requires finite rho > 0');
  const ux = mx / rho;
  const uy = my / rho;
  const uz = mz / rho;
  const transform = centralMomentMatrixD3Q27(ux, uy, uz);
  const moments = new Float64Array(D3Q27.q);
  for (let moment = 0; moment < D3Q27.q; moment++) {
    for (let direction = 0; direction < D3Q27.q; direction++) {
      moments[moment] += transform[moment][direction] * populations[direction];
    }
  }

  const equilibrium = centralMomentAttractorsD3Q27(rho);
  const piNeq = Float64Array.of(
    moments[d3q27CentralMomentIndex(2, 0, 0)] - equilibrium[d3q27CentralMomentIndex(2, 0, 0)],
    moments[d3q27CentralMomentIndex(0, 2, 0)] - equilibrium[d3q27CentralMomentIndex(0, 2, 0)],
    moments[d3q27CentralMomentIndex(0, 0, 2)] - equilibrium[d3q27CentralMomentIndex(0, 0, 2)],
    moments[d3q27CentralMomentIndex(1, 1, 0)],
    moments[d3q27CentralMomentIndex(1, 0, 1)],
    moments[d3q27CentralMomentIndex(0, 1, 1)],
  );
  const lesK = 18 * Math.SQRT2 * lesCs * lesCs;
  const tauEff = lesK === 0 ? tau0 : smagorinskyTauEff(tau0, lesK, piNeqNorm(piNeq), rho);

  const post = new Float64Array(equilibrium);
  const conserved = [
    d3q27CentralMomentIndex(0, 0, 0),
    d3q27CentralMomentIndex(1, 0, 0),
    d3q27CentralMomentIndex(0, 1, 0),
    d3q27CentralMomentIndex(0, 0, 1),
  ];
  for (const moment of conserved) post[moment] = moments[moment];

  const xx = d3q27CentralMomentIndex(2, 0, 0);
  const yy = d3q27CentralMomentIndex(0, 2, 0);
  const zz = d3q27CentralMomentIndex(0, 0, 2);
  const trace = equilibrium[xx] + equilibrium[yy] + equilibrium[zz];
  const omega = 1 / tauEff;
  const differenceXy = (1 - omega) * (moments[xx] - moments[yy]);
  const differenceYz = (1 - omega) * (moments[yy] - moments[zz]);
  post[xx] = (trace + 2 * differenceXy + differenceYz) / 3;
  post[yy] = (trace - differenceXy + differenceYz) / 3;
  post[zz] = (trace - differenceXy - 2 * differenceYz) / 3;
  for (const moment of [
    d3q27CentralMomentIndex(1, 1, 0),
    d3q27CentralMomentIndex(1, 0, 1),
    d3q27CentralMomentIndex(0, 1, 1),
  ]) {
    post[moment] = moments[moment] + omega * (equilibrium[moment] - moments[moment]);
  }

  populations.set(populationsFromCentralMomentsD3Q27(transform, post));
  let rhoOut = 0;
  for (const value of populations) rhoOut += value;
  populations[D3Q27.rest] += rho - rhoOut;
  return { rho, ux, uy, uz, tauEff, piNeq };
}

/**
 * Pull-stream then collide one fully-periodic D3Q27 field. Storage is direction-major:
 * populations[direction * (nx*ny*nz) + cell]. Source and destination must be distinct.
 */
export function streamCollidePeriodicD3Q27(
  source: Float64Array,
  destination: Float64Array,
  grid: D3Q27PeriodicGrid,
  options: D3Q27CentralCollisionOptions,
  observe?: D3Q27PeriodicObserver,
): void {
  const { nx, ny, nz } = grid;
  if (![nx, ny, nz].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('periodic D3Q27 dimensions must be positive integers');
  }
  const cells = nx * ny * nz;
  const expectedLength = D3Q27.q * cells;
  if (source === destination) throw new Error('periodic D3Q27 source and destination must differ');
  if (source.length !== expectedLength || destination.length !== expectedLength) {
    throw new Error(`periodic D3Q27 field requires ${expectedLength} values per buffer`);
  }

  const gathered = new Float64Array(D3Q27.q);
  const index = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const cell = index(x, y, z);
        for (let direction = 0; direction < D3Q27.q; direction++) {
          const sourceX = (x - D3Q27.ex[direction] + nx) % nx;
          const sourceY = (y - D3Q27.ey[direction] + ny) % ny;
          const sourceZ = (z - D3Q27.ez[direction] + nz) % nz;
          gathered[direction] = source[direction * cells + index(sourceX, sourceY, sourceZ)];
        }
        const collision = collideD3Q27Central(gathered, options);
        for (let direction = 0; direction < D3Q27.q; direction++) {
          destination[direction * cells + cell] = gathered[direction];
        }
        observe?.(cell, collision, gathered);
      }
    }
  }
}
