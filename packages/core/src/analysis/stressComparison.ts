export const STRESS_COMPONENTS = ['xx', 'yy', 'zz', 'xy', 'xz', 'yz'] as const;
export type StressComponent = (typeof STRESS_COMPONENTS)[number];

export interface StressLinearComparison {
  samples: number;
  pearsonCorrelation: number;
  spearmanRankCorrelation: number;
  throughOriginSlope: number;
  unconstrainedSlope: number;
  unconstrainedIntercept: number;
  /** RMS(y - slope*x) / RMS(y), using the through-origin slope. */
  normalizedRmsResidual: number;
  /** Equal non-zero signs; exact zeros are omitted from the denominator. */
  signAgreementRate: number;
  signAgreementSamples: number;
}

export interface StressResidualBin {
  distance: number;
  cells: number;
  meanResidualNorm: number;
  /** Frobenius RMS residual divided by Frobenius RMS Pi_neq in this bin. */
  normalizedRmsResidual: number;
}

export interface StressTensorComparison {
  selectedCells: number;
  tensorCells: number;
  rejectedIncompleteStencil: number;
  invalidCells: number;
  components: Record<StressComponent, StressLinearComparison>;
  /** Regression over the full symmetric tensor; off-diagonal entries count twice. */
  global: StressLinearComparison;
  trace: {
    hydrodynamic: StressLinearComparison;
    /** Pi_neq trace against -div(u), before the positive rho/tau/cs2 scale factor. */
    negativeDivergence: StressLinearComparison;
  };
  /** Regression over the traceless symmetric tensor; off-diagonal entries count twice. */
  deviatoric: StressLinearComparison;
  /** Full-tensor residual after fitting `global.throughOriginSlope`. */
  residualByBoundaryDistance: {
    x: StressResidualBin[];
    y: StressResidualBin[];
    z: StressResidualBin[];
  };
}

export interface StressTensorComparisonInput {
  nx: number;
  ny: number;
  nz: number;
  evaluated: ArrayLike<number>;
  rho: ArrayLike<number>;
  ux: ArrayLike<number>;
  uy: ArrayLike<number>;
  uz: ArrayLike<number>;
  tauEff: ArrayLike<number>;
  /** Interleaved `[xx, yy, zz, xy, xz, yz]` for each cell. */
  piNeq: ArrayLike<number>;
  cs2: number;
  select?: (idx: number) => boolean;
}

function pearson(left: Float64Array, right: Float64Array): number {
  if (left.length !== right.length || left.length < 2) return Number.NaN;
  let leftMean = 0;
  let rightMean = 0;
  for (let i = 0; i < left.length; i++) {
    leftMean += left[i];
    rightMean += right[i];
  }
  leftMean /= left.length;
  rightMean /= right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i] - leftMean;
    const b = right[i] - rightMean;
    covariance += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
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

function linearComparison(left: Float64Array, right: Float64Array): StressLinearComparison {
  if (left.length !== right.length || left.length === 0) {
    return {
      samples: 0,
      pearsonCorrelation: Number.NaN,
      spearmanRankCorrelation: Number.NaN,
      throughOriginSlope: Number.NaN,
      unconstrainedSlope: Number.NaN,
      unconstrainedIntercept: Number.NaN,
      normalizedRmsResidual: Number.NaN,
      signAgreementRate: Number.NaN,
      signAgreementSamples: 0,
    };
  }
  let sumLeft = 0;
  let sumRight = 0;
  let sumLeft2 = 0;
  let sumProduct = 0;
  let signAgreement = 0;
  let signSamples = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    sumLeft += a;
    sumRight += b;
    sumLeft2 += a * a;
    sumProduct += a * b;
    if (a !== 0 && b !== 0) {
      signSamples++;
      if (a * b > 0) signAgreement++;
    }
  }
  const throughOriginSlope = sumLeft2 > 0 ? sumProduct / sumLeft2 : Number.NaN;
  const leftMean = sumLeft / left.length;
  const rightMean = sumRight / right.length;
  let covariance = 0;
  let variance = 0;
  let squaredResidual = 0;
  let squaredRight = 0;
  for (let i = 0; i < left.length; i++) {
    covariance += (left[i] - leftMean) * (right[i] - rightMean);
    variance += (left[i] - leftMean) ** 2;
    const residual = right[i] - throughOriginSlope * left[i];
    squaredResidual += residual * residual;
    squaredRight += right[i] * right[i];
  }
  const unconstrainedSlope = variance > 0 ? covariance / variance : Number.NaN;
  return {
    samples: left.length,
    pearsonCorrelation: pearson(left, right),
    spearmanRankCorrelation: spearman(left, right),
    throughOriginSlope,
    unconstrainedSlope,
    unconstrainedIntercept: rightMean - unconstrainedSlope * leftMean,
    normalizedRmsResidual:
      squaredRight > 0 ? Math.sqrt(squaredResidual / squaredRight) : Number.NaN,
    signAgreementRate: signSamples > 0 ? signAgreement / signSamples : Number.NaN,
    signAgreementSamples: signSamples,
  };
}

function tensorSamples(values: Float64Array, cells: number, deviatoric: boolean): Float64Array {
  const out = new Float64Array(cells * 9);
  let write = 0;
  for (let cell = 0; cell < cells; cell++) {
    const base = 6 * cell;
    const traceThird = deviatoric ? (values[base] + values[base + 1] + values[base + 2]) / 3 : 0;
    out[write++] = values[base] - traceThird;
    out[write++] = values[base + 1] - traceThird;
    out[write++] = values[base + 2] - traceThird;
    for (let component = 3; component < 6; component++) {
      out[write++] = values[base + component];
      out[write++] = values[base + component];
    }
  }
  return out;
}

function boundaryProfile(
  size: number,
  coordinates: Int32Array,
  residualNorm: Float64Array,
  residualSquared: Float64Array,
  referenceSquared: Float64Array,
): StressResidualBin[] {
  const binCount = Math.floor((size - 1) / 2) + 1;
  const cells = new Uint32Array(binCount);
  const normSums = new Float64Array(binCount);
  const squaredSums = new Float64Array(binCount);
  const referenceSums = new Float64Array(binCount);
  for (let i = 0; i < coordinates.length; i++) {
    const distance = Math.min(coordinates[i], size - 1 - coordinates[i]);
    cells[distance]++;
    normSums[distance] += residualNorm[i];
    squaredSums[distance] += residualSquared[i];
    referenceSums[distance] += referenceSquared[i];
  }
  const result: StressResidualBin[] = [];
  for (let distance = 0; distance < binCount; distance++) {
    if (cells[distance] === 0) continue;
    result.push({
      distance,
      cells: cells[distance],
      meanResidualNorm: normSums[distance] / cells[distance],
      normalizedRmsResidual:
        referenceSums[distance] > 0
          ? Math.sqrt(squaredSums[distance] / referenceSums[distance])
          : Number.NaN,
    });
  }
  return result;
}

/** Compare reconstructed pre-collision Pi_neq directly with -2*rho*cs2*tau_eff*S_FD. */
export function compareStressTensors(input: StressTensorComparisonInput): StressTensorComparison {
  const { nx, ny, nz, evaluated, rho, ux, uy, uz, tauEff, piNeq, cs2 } = input;
  const n = nx * ny * nz;
  if ([evaluated, rho, ux, uy, uz, tauEff].some((field) => field.length !== n)) {
    throw new Error(`compareStressTensors: every cell field must contain nx*ny*nz=${n} values`);
  }
  if (piNeq.length !== 6 * n) {
    throw new Error(`compareStressTensors: piNeq must contain 6*nx*ny*nz=${6 * n} values`);
  }
  if (!(nx >= 3 && ny >= 3 && nz >= 3)) {
    throw new Error('compareStressTensors: every grid dimension must be at least 3');
  }
  if (!(cs2 > 0)) throw new Error('compareStressTensors: cs2 must be positive');

  const select = input.select ?? (() => true);
  const plane = nx * ny;
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const hasStencil = (idx: number): boolean =>
    evaluated[idx - 1] === 1 &&
    evaluated[idx + 1] === 1 &&
    evaluated[idx - nx] === 1 &&
    evaluated[idx + nx] === 1 &&
    evaluated[idx - plane] === 1 &&
    evaluated[idx + plane] === 1;

  let selectedCells = 0;
  let stencilCandidates = 0;
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const idx = at(x, y, z);
        if (evaluated[idx] !== 1 || !select(idx)) continue;
        selectedCells++;
        if (hasStencil(idx)) stencilCandidates++;
      }
    }
  }

  const hydro = new Float64Array(6 * stencilCandidates);
  const reconstructed = new Float64Array(6 * stencilCandidates);
  const divergence = new Float64Array(stencilCandidates);
  const xs = new Int32Array(stencilCandidates);
  const ys = new Int32Array(stencilCandidates);
  const zs = new Int32Array(stencilCandidates);
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
        const duxDz = (ux[idx + plane] - ux[idx - plane]) / 2;
        const duyDz = (uy[idx + plane] - uy[idx - plane]) / 2;
        const duzDz = (uz[idx + plane] - uz[idx - plane]) / 2;
        const strain = [
          duxDx,
          duyDy,
          duzDz,
          0.5 * (duxDy + duyDx),
          0.5 * (duxDz + duzDx),
          0.5 * (duyDz + duzDy),
        ];
        const cellRho = rho[idx];
        const cellTau = tauEff[idx];
        const factor = -2 * cellRho * cs2 * cellTau;
        let valid = cellRho > 0 && cellTau > 0.5 && Number.isFinite(factor);
        const base = 6 * write;
        const piBase = 6 * idx;
        for (let component = 0; component < 6; component++) {
          const predicted = factor * strain[component];
          const actual = piNeq[piBase + component];
          valid &&= Number.isFinite(predicted) && Number.isFinite(actual);
          hydro[base + component] = predicted;
          reconstructed[base + component] = actual;
        }
        if (!valid) {
          invalidCells++;
          continue;
        }
        divergence[write] = duxDx + duyDy + duzDz;
        xs[write] = x;
        ys[write] = y;
        zs[write] = z;
        write++;
      }
    }
  }

  const hydroValues = hydro.subarray(0, 6 * write);
  const reconstructedValues = reconstructed.subarray(0, 6 * write);
  const componentEntries = STRESS_COMPONENTS.map((name, component) => {
    const predicted = new Float64Array(write);
    const actual = new Float64Array(write);
    for (let cell = 0; cell < write; cell++) {
      predicted[cell] = hydroValues[6 * cell + component];
      actual[cell] = reconstructedValues[6 * cell + component];
    }
    return [name, linearComparison(predicted, actual)] as const;
  });
  const components = Object.fromEntries(componentEntries) as Record<
    StressComponent,
    StressLinearComparison
  >;

  const traceHydro = new Float64Array(write);
  const traceReconstructed = new Float64Array(write);
  const negativeDivergence = new Float64Array(write);
  for (let cell = 0; cell < write; cell++) {
    const base = 6 * cell;
    traceHydro[cell] = hydroValues[base] + hydroValues[base + 1] + hydroValues[base + 2];
    traceReconstructed[cell] =
      reconstructedValues[base] + reconstructedValues[base + 1] + reconstructedValues[base + 2];
    negativeDivergence[cell] = -divergence[cell];
  }

  const fullHydro = tensorSamples(hydroValues, write, false);
  const fullReconstructed = tensorSamples(reconstructedValues, write, false);
  const global = linearComparison(fullHydro, fullReconstructed);
  const deviatoric = linearComparison(
    tensorSamples(hydroValues, write, true),
    tensorSamples(reconstructedValues, write, true),
  );

  const residualNorm = new Float64Array(write);
  const residualSquared = new Float64Array(write);
  const referenceSquared = new Float64Array(write);
  for (let cell = 0; cell < write; cell++) {
    const base = 6 * cell;
    let residual2 = 0;
    let reference2 = 0;
    for (let component = 0; component < 6; component++) {
      const multiplicity = component < 3 ? 1 : 2;
      const actual = reconstructedValues[base + component];
      const residual = actual - global.throughOriginSlope * hydroValues[base + component];
      residual2 += multiplicity * residual * residual;
      reference2 += multiplicity * actual * actual;
    }
    residualNorm[cell] = Math.sqrt(residual2);
    residualSquared[cell] = residual2;
    referenceSquared[cell] = reference2;
  }

  return {
    selectedCells,
    tensorCells: write,
    rejectedIncompleteStencil: selectedCells - stencilCandidates,
    invalidCells,
    components,
    global,
    trace: {
      hydrodynamic: linearComparison(traceHydro, traceReconstructed),
      negativeDivergence: linearComparison(negativeDivergence, traceReconstructed),
    },
    deviatoric,
    residualByBoundaryDistance: {
      x: boundaryProfile(
        nx,
        xs.subarray(0, write),
        residualNorm,
        residualSquared,
        referenceSquared,
      ),
      y: boundaryProfile(
        ny,
        ys.subarray(0, write),
        residualNorm,
        residualSquared,
        referenceSquared,
      ),
      z: boundaryProfile(
        nz,
        zs.subarray(0, write),
        residualNorm,
        residualSquared,
        referenceSquared,
      ),
    },
  };
}
