export interface StrainSummary {
  cells: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface StrainResidualBin {
  distance: number;
  cells: number;
  meanResidual: number;
  meanAbsoluteResidual: number;
}

export interface StrainComparison {
  selectedCells: number;
  stencilCells: number;
  rejectedIncompleteStencil: number;
  invalidCells: number;
  finiteDifference: StrainSummary;
  piImplied: StrainSummary;
  pearsonCorrelation: number;
  spearmanRankCorrelation: number;
  /** Median of |S|_Pi / |S|_FD over cells with non-zero finite-difference strain. */
  medianRatioSlope: number;
  meanAbsoluteResidual: number;
  rootMeanSquareResidual: number;
  relativeL1Residual: number;
  residualByBoundaryDistance: {
    x: StrainResidualBin[];
    y: StrainResidualBin[];
    z: StrainResidualBin[];
  };
  densityWeighted: {
    finiteDifference: StrainSummary;
    pearsonCorrelation: number;
    spearmanRankCorrelation: number;
    medianRatioSlope: number;
    relativeL1Residual: number;
  };
}

export interface StrainComparisonInput {
  nx: number;
  ny: number;
  nz: number;
  tauEff: ArrayLike<number>;
  evaluated: ArrayLike<number>;
  ux: ArrayLike<number>;
  uy: ArrayLike<number>;
  uz: ArrayLike<number>;
  rho: ArrayLike<number>;
  tau0: number;
  lesK: number;
  /**
   * Which Π^neq norm `tauEff` was computed under — see collide.ts's `LesNorm`. The
   * closure-to-strain inversion below depends on this: 'legacy' inverts to
   * `|S| = 6·τ_t/lesK`, 'spec' to `|S| = 6√2·τ_t/lesK` (fix-confirmed-physics-defects,
   * les-subgrid-closure — get this wrong and the audit's reported ratio moves by √2 for a
   * bookkeeping reason having nothing to do with the field being audited). Default
   * `'legacy'` matches `makeCollideContext`'s default, so a caller that doesn't pass
   * `tauEff` through a `'spec'` run gets the same inversion as before this option existed.
   */
  lesNorm?: 'spec' | 'legacy';
  select?: (idx: number) => boolean;
}

function pearson(left: Float64Array, right: Float64Array): number {
  if (left.length !== right.length || left.length < 2) return Number.NaN;
  let sumLeft = 0;
  let sumRight = 0;
  let sumLeft2 = 0;
  let sumRight2 = 0;
  let sumProduct = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    sumLeft += a;
    sumRight += b;
    sumLeft2 += a * a;
    sumRight2 += b * b;
    sumProduct += a * b;
  }
  const covariance = left.length * sumProduct - sumLeft * sumRight;
  const leftVariance = left.length * sumLeft2 - sumLeft * sumLeft;
  const rightVariance = left.length * sumRight2 - sumRight * sumRight;
  if (!(leftVariance > 0 && rightVariance > 0)) return Number.NaN;
  return Math.max(-1, Math.min(1, covariance / Math.sqrt(leftVariance * rightVariance)));
}

function averageRank(sorted: Float64Array, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  const first = low;
  high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return 0.5 * (first + low - 1);
}

function spearman(left: Float64Array, right: Float64Array): number {
  if (left.length !== right.length || left.length < 2) return Number.NaN;
  const sortedLeft = Float64Array.from(left).sort();
  const sortedRight = Float64Array.from(right).sort();
  const leftRanks = new Float64Array(left.length);
  const rightRanks = new Float64Array(right.length);
  for (let i = 0; i < left.length; i++) {
    leftRanks[i] = averageRank(sortedLeft, left[i]);
    rightRanks[i] = averageRank(sortedRight, right[i]);
  }
  return pearson(leftRanks, rightRanks);
}

function medianRatio(left: Float64Array, right: Float64Array): number {
  const ratios = new Float64Array(left.length);
  let count = 0;
  for (let i = 0; i < left.length; i++) {
    if (left[i] > 1e-12) ratios[count++] = right[i] / left[i];
  }
  const sorted = ratios.subarray(0, count).sort();
  return count > 0 ? sorted[Math.floor((count - 1) / 2)] : Number.NaN;
}

function relativeL1(left: Float64Array, right: Float64Array, slope: number): number {
  let residual = 0;
  let magnitude = 0;
  for (let i = 0; i < left.length; i++) {
    residual += Math.abs(right[i] - slope * left[i]);
    magnitude += Math.abs(right[i]);
  }
  return magnitude > 0 ? residual / magnitude : Number.NaN;
}

function summarize(values: Float64Array): StrainSummary {
  if (values.length === 0) {
    return {
      cells: 0,
      min: Number.NaN,
      mean: Number.NaN,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
      max: Number.NaN,
    };
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    sum += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const sorted = Float64Array.from(values).sort();
  const percentile = (p: number): number => {
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
  };
  return {
    cells: values.length,
    min,
    mean: sum / values.length,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    max,
  };
}

function boundaryProfile(
  size: number,
  coordinates: Int32Array,
  residuals: Float64Array,
): StrainResidualBin[] {
  const binCount = Math.floor((size - 1) / 2) + 1;
  const cells = new Uint32Array(binCount);
  const sums = new Float64Array(binCount);
  const absoluteSums = new Float64Array(binCount);
  for (let i = 0; i < residuals.length; i++) {
    const distance = Math.min(coordinates[i], size - 1 - coordinates[i]);
    cells[distance]++;
    sums[distance] += residuals[i];
    absoluteSums[distance] += Math.abs(residuals[i]);
  }
  const result: StrainResidualBin[] = [];
  for (let distance = 0; distance < binCount; distance++) {
    if (cells[distance] === 0) continue;
    result.push({
      distance,
      cells: cells[distance],
      meanResidual: sums[distance] / cells[distance],
      meanAbsoluteResidual: absoluteSums[distance] / cells[distance],
    });
  }
  return result;
}

/**
 * Compare centered finite-difference strain with the leading-order strain implied by the
 * implemented Smagorinsky quadratic. All quantities are in lattice units.
 */
export function compareStrain(input: StrainComparisonInput): StrainComparison {
  const { nx, ny, nz, tauEff, evaluated, ux, uy, uz, rho, tau0, lesK, lesNorm = 'legacy' } = input;
  const piInversionFactor = lesNorm === 'spec' ? 6 * Math.SQRT2 : 6;
  const n = nx * ny * nz;
  const fields = [tauEff, evaluated, ux, uy, uz, rho];
  if (fields.some((field) => field.length !== n)) {
    throw new Error(`compareStrain: every field must contain nx*ny*nz=${n} values`);
  }
  if (!(nx >= 3 && ny >= 3 && nz >= 3)) {
    throw new Error('compareStrain: every grid dimension must be at least 3');
  }
  if (!(tau0 > 0.5)) throw new Error('compareStrain: tau0 must be greater than 0.5');
  if (!(lesK > 0)) throw new Error('compareStrain: lesK must be positive');

  const select = input.select ?? (() => true);
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const hasStencil = (idx: number): boolean =>
    evaluated[idx - 1] === 1 &&
    evaluated[idx + 1] === 1 &&
    evaluated[idx - nx] === 1 &&
    evaluated[idx + nx] === 1 &&
    evaluated[idx - nx * ny] === 1 &&
    evaluated[idx + nx * ny] === 1;

  let selectedCells = 0;
  let stencilCells = 0;
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const idx = at(x, y, z);
        if (evaluated[idx] !== 1 || !select(idx)) continue;
        selectedCells++;
        if (hasStencil(idx)) stencilCells++;
      }
    }
  }

  const fdValues = new Float64Array(stencilCells);
  const densityFdValues = new Float64Array(stencilCells);
  const piValues = new Float64Array(stencilCells);
  const xCoordinates = new Int32Array(stencilCells);
  const yCoordinates = new Int32Array(stencilCells);
  const zCoordinates = new Int32Array(stencilCells);
  let invalidCells = 0;
  let write = 0;

  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const idx = at(x, y, z);
        if (evaluated[idx] !== 1 || !select(idx) || !hasStencil(idx)) continue;

        const duxDx = (ux[idx + 1] - ux[idx - 1]) / 2;
        const duyDx = (uy[idx + 1] - uy[idx - 1]) / 2;
        const duzDx = (uz[idx + 1] - uz[idx - 1]) / 2;
        const duxDy = (ux[idx + nx] - ux[idx - nx]) / 2;
        const duyDy = (uy[idx + nx] - uy[idx - nx]) / 2;
        const duzDy = (uz[idx + nx] - uz[idx - nx]) / 2;
        const plane = nx * ny;
        const duxDz = (ux[idx + plane] - ux[idx - plane]) / 2;
        const duyDz = (uy[idx + plane] - uy[idx - plane]) / 2;
        const duzDz = (uz[idx + plane] - uz[idx - plane]) / 2;
        const sxy = 0.5 * (duxDy + duyDx);
        const sxz = 0.5 * (duxDz + duzDx);
        const syz = 0.5 * (duyDz + duzDy);
        const fd = Math.sqrt(
          2 *
            (duxDx * duxDx +
              duyDy * duyDy +
              duzDz * duzDz +
              2 * (sxy * sxy + sxz * sxz + syz * syz)),
        );
        const cellRho = rho[idx];
        const momentumDerivative = (component: ArrayLike<number>, offset: number): number =>
          (rho[idx + offset] * component[idx + offset] -
            rho[idx - offset] * component[idx - offset]) /
          (2 * cellRho);
        const dRhoUxDx = momentumDerivative(ux, 1);
        const dRhoUyDx = momentumDerivative(uy, 1);
        const dRhoUzDx = momentumDerivative(uz, 1);
        const dRhoUxDy = momentumDerivative(ux, nx);
        const dRhoUyDy = momentumDerivative(uy, nx);
        const dRhoUzDy = momentumDerivative(uz, nx);
        const dRhoUxDz = momentumDerivative(ux, plane);
        const dRhoUyDz = momentumDerivative(uy, plane);
        const dRhoUzDz = momentumDerivative(uz, plane);
        const densitySxy = 0.5 * (dRhoUxDy + dRhoUyDx);
        const densitySxz = 0.5 * (dRhoUxDz + dRhoUzDx);
        const densitySyz = 0.5 * (dRhoUyDz + dRhoUzDy);
        const densityFd = Math.sqrt(
          2 *
            (dRhoUxDx * dRhoUxDx +
              dRhoUyDy * dRhoUyDy +
              dRhoUzDz * dRhoUzDz +
              2 * (densitySxy * densitySxy + densitySxz * densitySxz + densitySyz * densitySyz)),
        );
        const pi = (piInversionFactor * (tauEff[idx] - tau0)) / lesK;
        if (
          !(cellRho > 0) ||
          !Number.isFinite(fd) ||
          !Number.isFinite(densityFd) ||
          !Number.isFinite(pi) ||
          pi < 0
        ) {
          invalidCells++;
          continue;
        }
        fdValues[write] = fd;
        densityFdValues[write] = densityFd;
        piValues[write] = pi;
        xCoordinates[write] = x;
        yCoordinates[write] = y;
        zCoordinates[write] = z;
        write++;
      }
    }
  }

  const finiteDifference = fdValues.subarray(0, write);
  const densityFiniteDifference = densityFdValues.subarray(0, write);
  const piImplied = piValues.subarray(0, write);
  const xs = xCoordinates.subarray(0, write);
  const ys = yCoordinates.subarray(0, write);
  const zs = zCoordinates.subarray(0, write);

  const pearsonCorrelation = pearson(finiteDifference, piImplied);
  const spearmanRankCorrelation = spearman(finiteDifference, piImplied);
  const medianRatioSlope = medianRatio(finiteDifference, piImplied);
  const densityMedianRatioSlope = medianRatio(densityFiniteDifference, piImplied);

  const residuals = new Float64Array(write);
  let absoluteResidual = 0;
  let squaredResidual = 0;
  let piMagnitude = 0;
  for (let i = 0; i < write; i++) {
    const residual = piImplied[i] - medianRatioSlope * finiteDifference[i];
    residuals[i] = residual;
    absoluteResidual += Math.abs(residual);
    squaredResidual += residual * residual;
    piMagnitude += Math.abs(piImplied[i]);
  }

  return {
    selectedCells,
    stencilCells: write,
    rejectedIncompleteStencil: selectedCells - stencilCells,
    invalidCells,
    finiteDifference: summarize(finiteDifference),
    piImplied: summarize(piImplied),
    pearsonCorrelation,
    spearmanRankCorrelation,
    medianRatioSlope,
    meanAbsoluteResidual: write ? absoluteResidual / write : Number.NaN,
    rootMeanSquareResidual: write ? Math.sqrt(squaredResidual / write) : Number.NaN,
    relativeL1Residual: piMagnitude > 0 ? absoluteResidual / piMagnitude : Number.NaN,
    residualByBoundaryDistance: {
      x: boundaryProfile(nx, xs, residuals),
      y: boundaryProfile(ny, ys, residuals),
      z: boundaryProfile(nz, zs, residuals),
    },
    densityWeighted: {
      finiteDifference: summarize(densityFiniteDifference),
      pearsonCorrelation: pearson(densityFiniteDifference, piImplied),
      spearmanRankCorrelation: spearman(densityFiniteDifference, piImplied),
      medianRatioSlope: densityMedianRatioSlope,
      relativeL1Residual: relativeL1(densityFiniteDifference, piImplied, densityMedianRatioSlope),
    },
  };
}
