export const STRAIN_SCALE_COMPONENTS = ['xy', 'xz', 'yz'] as const;
export type StrainScaleComponent = (typeof STRAIN_SCALE_COMPONENTS)[number];

export const STRAIN_GRADIENT_CONTRIBUTIONS = [
  'duxDy',
  'duyDx',
  'duxDz',
  'duzDx',
  'duyDz',
  'duzDy',
] as const;
export type StrainGradientContribution = (typeof STRAIN_GRADIENT_CONTRIBUTIONS)[number];

export const STRAIN_WAVELENGTH_BANDS = ['>16', '8-16', '4-8', '2-4'] as const;
export type StrainWavelengthBand = (typeof STRAIN_WAVELENGTH_BANDS)[number];

type Axis = 0 | 1 | 2;

export interface StrainScaleAnalysisInput {
  nx: number;
  ny: number;
  nz: number;
  evaluated: ArrayLike<number>;
  ux: ArrayLike<number>;
  uy: ArrayLike<number>;
  uz: ArrayLike<number>;
  select?: (idx: number) => boolean;
}

export interface StrainSpectralMode {
  /** Null denotes the windowed DC term; affine trend energy is reported separately. */
  wavelengthCells: number | null;
  cyclesPerCell: number;
  energy: number;
}

export interface StrainSpectralBand {
  energy: number;
  fraction: number;
}

export interface StrainContributionSpectrum {
  derivativeAxis: 'x' | 'y' | 'z';
  lines: number;
  samples: number;
  shortLinesRejected: number;
  trendEnergy: number;
  residualEnergy: number;
  totalEnergy: number;
  modes: StrainSpectralMode[];
  bands: Record<StrainWavelengthBand, StrainSpectralBand>;
}

export interface StrainStencilScale {
  radius: 1 | 2 | 4;
  samples: number;
  rms: number;
  energyRatioToH: number;
  throughOriginSlopeVsH: number;
  pearsonVsH: number;
  normalizedRmsDifferenceVsH: number;
}

export interface StrainScaleSignal {
  stencils: StrainStencilScale[];
}

export interface StrainScaleSpatialBin {
  /** Lattice coordinate along this profile axis. */
  coordinateCells: number;
  samples: number;
  /** Sum of S_h^2 in this plane/line bin. */
  hEnergy: number;
  /** Sum of (S_h - S_2h)^2: a local short-wave/stencil-disagreement proxy. */
  highPassEnergy: number;
  /** Fraction of the component's domain-wide S_h^2 carried by this bin. */
  hEnergyFraction: number;
  /** Fraction of the component's domain-wide proxy energy carried by this bin. */
  highPassEnergyFraction: number;
  /** Local (S_h - S_2h)^2 / S_h^2; not a Fourier band fraction. */
  highPassToHEnergyRatio: number;
}

export interface StrainScaleSpatialLocalization {
  method: string;
  limitations: string;
  x: StrainScaleSpatialBin[];
  y: StrainScaleSpatialBin[];
  z: StrainScaleSpatialBin[];
}

export interface StrainComponentScale extends StrainScaleSignal {
  contributions: readonly [StrainGradientContribution, StrainGradientContribution];
  /** 2 E[a b] / E[(a+b)^2] at h. This cross energy has no unique 1-D spectral allocation. */
  crossTermFraction: number;
  /** Energy mixture of the two directional contribution spectra, excluding their cross term. */
  contributionEnergySpectrum: Record<StrainWavelengthBand, StrainSpectralBand>;
  /** Coordinate profiles of the local h-versus-2h disagreement energy. */
  shortWaveLocalization: StrainScaleSpatialLocalization;
}

export interface StrainScaleAnalysis {
  selectedCells: number;
  commonStencilCells: number;
  rejectedIncompleteStencil: number;
  maxStencilRadius: 4;
  minimumSpectralLineLength: number;
  spectralMethod: string;
  spectralLimitations: string;
  contributions: Record<
    StrainGradientContribution,
    StrainScaleSignal & {
      spectrum: StrainContributionSpectrum;
    }
  >;
  components: Record<StrainScaleComponent, StrainComponentScale>;
}

interface ContributionDefinition {
  name: StrainGradientContribution;
  field: 'ux' | 'uy' | 'uz';
  axis: Axis;
}

const CONTRIBUTIONS: readonly ContributionDefinition[] = [
  { name: 'duxDy', field: 'ux', axis: 1 },
  { name: 'duyDx', field: 'uy', axis: 0 },
  { name: 'duxDz', field: 'ux', axis: 2 },
  { name: 'duzDx', field: 'uz', axis: 0 },
  { name: 'duyDz', field: 'uy', axis: 2 },
  { name: 'duzDy', field: 'uz', axis: 1 },
];

const COMPONENT_CONTRIBUTIONS: Record<
  StrainScaleComponent,
  readonly [StrainGradientContribution, StrainGradientContribution]
> = {
  xy: ['duxDy', 'duyDx'],
  xz: ['duxDz', 'duzDx'],
  yz: ['duyDz', 'duzDy'],
};

const RADII = [1, 2, 4] as const;
const MIN_LINE_LENGTH = 8;

function emptyBands(): Record<StrainWavelengthBand, StrainSpectralBand> {
  return {
    '>16': { energy: 0, fraction: Number.NaN },
    '8-16': { energy: 0, fraction: Number.NaN },
    '4-8': { energy: 0, fraction: Number.NaN },
    '2-4': { energy: 0, fraction: Number.NaN },
  };
}

function bandFor(wavelength: number | null): StrainWavelengthBand {
  if (wavelength === null || wavelength > 16) return '>16';
  if (wavelength > 8) return '8-16';
  if (wavelength > 4) return '4-8';
  return '2-4';
}

function finalizeBands(
  energies: Record<StrainWavelengthBand, StrainSpectralBand>,
  totalEnergy: number,
): Record<StrainWavelengthBand, StrainSpectralBand> {
  for (const band of STRAIN_WAVELENGTH_BANDS) {
    energies[band].fraction = totalEnergy > 0 ? energies[band].energy / totalEnergy : Number.NaN;
  }
  return energies;
}

interface PairAccumulator {
  samples: number;
  sumReference: number;
  sumValue: number;
  sumReference2: number;
  sumValue2: number;
  sumProduct: number;
  sumDifference2: number;
}

interface SpatialAccumulator {
  samples: number;
  hEnergy: number;
  highPassEnergy: number;
}

function pairAccumulator(): PairAccumulator {
  return {
    samples: 0,
    sumReference: 0,
    sumValue: 0,
    sumReference2: 0,
    sumValue2: 0,
    sumProduct: 0,
    sumDifference2: 0,
  };
}

function spatialAccumulators(length: number): SpatialAccumulator[] {
  return Array.from({ length }, () => ({ samples: 0, hEnergy: 0, highPassEnergy: 0 }));
}

function spatialProfile(
  accumulators: SpatialAccumulator[],
  totalHEnergy: number,
  totalHighPassEnergy: number,
): StrainScaleSpatialBin[] {
  return accumulators.flatMap((entry, coordinateCells) =>
    entry.samples === 0
      ? []
      : [
          {
            coordinateCells,
            samples: entry.samples,
            hEnergy: entry.hEnergy,
            highPassEnergy: entry.highPassEnergy,
            hEnergyFraction: totalHEnergy > 0 ? entry.hEnergy / totalHEnergy : Number.NaN,
            highPassEnergyFraction:
              totalHighPassEnergy > 0 ? entry.highPassEnergy / totalHighPassEnergy : Number.NaN,
            highPassToHEnergyRatio:
              entry.hEnergy > 0 ? entry.highPassEnergy / entry.hEnergy : Number.NaN,
          },
        ],
  );
}

function addPair(accumulator: PairAccumulator, reference: number, value: number): void {
  accumulator.samples++;
  accumulator.sumReference += reference;
  accumulator.sumValue += value;
  accumulator.sumReference2 += reference * reference;
  accumulator.sumValue2 += value * value;
  accumulator.sumProduct += reference * value;
  accumulator.sumDifference2 += (value - reference) ** 2;
}

function stencilSummary(radius: 1 | 2 | 4, accumulator: PairAccumulator): StrainStencilScale {
  const n = accumulator.samples;
  const covariance = n * accumulator.sumProduct - accumulator.sumReference * accumulator.sumValue;
  const referenceVariance =
    n * accumulator.sumReference2 - accumulator.sumReference * accumulator.sumReference;
  const valueVariance = n * accumulator.sumValue2 - accumulator.sumValue * accumulator.sumValue;
  return {
    radius,
    samples: n,
    rms: n > 0 ? Math.sqrt(accumulator.sumValue2 / n) : Number.NaN,
    energyRatioToH:
      accumulator.sumReference2 > 0
        ? accumulator.sumValue2 / accumulator.sumReference2
        : Number.NaN,
    throughOriginSlopeVsH:
      accumulator.sumReference2 > 0
        ? accumulator.sumProduct / accumulator.sumReference2
        : Number.NaN,
    pearsonVsH:
      referenceVariance > 0 && valueVariance > 0
        ? Math.max(-1, Math.min(1, covariance / Math.sqrt(referenceVariance * valueVariance)))
        : Number.NaN,
    normalizedRmsDifferenceVsH:
      accumulator.sumReference2 > 0
        ? Math.sqrt(accumulator.sumDifference2 / accumulator.sumReference2)
        : Number.NaN,
  };
}

/**
 * Quantify directional strain scales without assuming periodicity of the selected region.
 * Each derivative contribution is transformed only along its differentiation axis. Lines are
 * split at invalid cells, least-squares affine-detrended, and Hann-windowed. The windowed mode
 * powers are normalized back to the unwindowed residual energy, while removed affine energy is
 * retained in the >16-cell band. This makes the requested bands exhaustive without turning the
 * approach-window edge into artificial 2-4-cell energy.
 */
export function analyzeStrainScales(input: StrainScaleAnalysisInput): StrainScaleAnalysis {
  const { nx, ny, nz, evaluated, ux, uy, uz } = input;
  const n = nx * ny * nz;
  if ([evaluated, ux, uy, uz].some((field) => field.length !== n)) {
    throw new Error(`analyzeStrainScales: every field must contain nx*ny*nz=${n} values`);
  }
  if (nx < 9 || ny < 9 || nz < 9) {
    throw new Error('analyzeStrainScales: every grid dimension must be at least 9');
  }
  const select = input.select ?? (() => true);
  const plane = nx * ny;
  const offsets = [1, nx, plane] as const;
  const fields = { ux, uy, uz } as const;
  const valid = new Uint8Array(n);
  let selectedCells = 0;
  let commonStencilCells = 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = x + nx * (y + ny * z);
        if (evaluated[idx] !== 1 || !select(idx)) continue;
        selectedCells++;
        if (x < 4 || x >= nx - 4 || y < 4 || y >= ny - 4 || z < 4 || z >= nz - 4) {
          continue;
        }
        let complete = true;
        for (const offset of offsets) {
          for (const radius of RADII) {
            if (evaluated[idx - radius * offset] !== 1 || evaluated[idx + radius * offset] !== 1) {
              complete = false;
              break;
            }
          }
          if (!complete) break;
        }
        if (!complete) continue;
        valid[idx] = 1;
        commonStencilCells++;
      }
    }
  }

  const derivative = (definition: ContributionDefinition, idx: number, radius: 1 | 2 | 4) => {
    const field = fields[definition.field];
    const offset = offsets[definition.axis] * radius;
    return (field[idx + offset] - field[idx - offset]) / (2 * radius);
  };

  const contributionAccumulators = Object.fromEntries(
    STRAIN_GRADIENT_CONTRIBUTIONS.map((name) => [
      name,
      Object.fromEntries(RADII.map((radius) => [radius, pairAccumulator()])),
    ]),
  ) as Record<StrainGradientContribution, Record<1 | 2 | 4, PairAccumulator>>;
  const componentAccumulators = Object.fromEntries(
    STRAIN_SCALE_COMPONENTS.map((name) => [
      name,
      Object.fromEntries(RADII.map((radius) => [radius, pairAccumulator()])),
    ]),
  ) as Record<StrainScaleComponent, Record<1 | 2 | 4, PairAccumulator>>;
  const componentCross = Object.fromEntries(
    STRAIN_SCALE_COMPONENTS.map((name) => [name, { cross: 0, combined: 0 }]),
  ) as Record<StrainScaleComponent, { cross: number; combined: number }>;
  const componentSpatial = Object.fromEntries(
    STRAIN_SCALE_COMPONENTS.map((name) => [
      name,
      {
        x: spatialAccumulators(nx),
        y: spatialAccumulators(ny),
        z: spatialAccumulators(nz),
        totalHEnergy: 0,
        totalHighPassEnergy: 0,
      },
    ]),
  ) as Record<
    StrainScaleComponent,
    {
      x: SpatialAccumulator[];
      y: SpatialAccumulator[];
      z: SpatialAccumulator[];
      totalHEnergy: number;
      totalHighPassEnergy: number;
    }
  >;

  for (let idx = 0; idx < n; idx++) {
    if (valid[idx] !== 1) continue;
    const x = idx % nx;
    const y = Math.floor(idx / nx) % ny;
    const z = Math.floor(idx / plane);
    const values = Object.fromEntries(
      CONTRIBUTIONS.map((definition) => [
        definition.name,
        RADII.map((radius) => derivative(definition, idx, radius)),
      ]),
    ) as Record<StrainGradientContribution, number[]>;
    for (const name of STRAIN_GRADIENT_CONTRIBUTIONS) {
      const reference = values[name][0];
      for (let r = 0; r < RADII.length; r++) {
        addPair(contributionAccumulators[name][RADII[r]], reference, values[name][r]);
      }
    }
    for (const component of STRAIN_SCALE_COMPONENTS) {
      const [first, second] = COMPONENT_CONTRIBUTIONS[component];
      const referenceFirst = values[first][0];
      const referenceSecond = values[second][0];
      const reference = 0.5 * (referenceFirst + referenceSecond);
      const at2h = 0.5 * (values[first][1] + values[second][1]);
      const hEnergy = reference * reference;
      const highPassEnergy = (reference - at2h) ** 2;
      componentCross[component].cross += 2 * referenceFirst * referenceSecond;
      componentCross[component].combined += (referenceFirst + referenceSecond) ** 2;
      const spatial = componentSpatial[component];
      spatial.totalHEnergy += hEnergy;
      spatial.totalHighPassEnergy += highPassEnergy;
      for (const entry of [spatial.x[x], spatial.y[y], spatial.z[z]]) {
        entry.samples++;
        entry.hEnergy += hEnergy;
        entry.highPassEnergy += highPassEnergy;
      }
      for (let r = 0; r < RADII.length; r++) {
        addPair(
          componentAccumulators[component][RADII[r]],
          reference,
          0.5 * (values[first][r] + values[second][r]),
        );
      }
    }
  }

  const spectralBases = new Map<
    number,
    { window: Float64Array; cosine: Float64Array[]; sine: Float64Array[] }
  >();
  const basisFor = (
    length: number,
  ): { window: Float64Array; cosine: Float64Array[]; sine: Float64Array[] } => {
    const cached = spectralBases.get(length);
    if (cached) return cached;
    const window = Float64Array.from({ length }, (_, j) =>
      length > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (length - 1)) : 1,
    );
    const cosine: Float64Array[] = [];
    const sine: Float64Array[] = [];
    for (let k = 0; k <= Math.floor(length / 2); k++) {
      cosine.push(
        Float64Array.from({ length }, (_, j) => Math.cos((2 * Math.PI * k * j) / length)),
      );
      sine.push(Float64Array.from({ length }, (_, j) => Math.sin((2 * Math.PI * k * j) / length)));
    }
    const basis = { window, cosine, sine };
    spectralBases.set(length, basis);
    return basis;
  };

  const spectrumFor = (definition: ContributionDefinition): StrainContributionSpectrum => {
    const modeEnergies = new Map<
      string,
      { cyclesPerCell: number; wavelengthCells: number | null; energy: number }
    >();
    const bands = emptyBands();
    let lines = 0;
    let samples = 0;
    let shortLinesRejected = 0;
    let trendEnergy = 0;
    let residualEnergy = 0;

    const analyzeLine = (indices: number[]): void => {
      if (indices.length < MIN_LINE_LENGTH) {
        shortLinesRejected++;
        return;
      }
      lines++;
      samples += indices.length;
      const length = indices.length;
      const basis = basisFor(length);
      let sumX = 0;
      let sumX2 = 0;
      let sumY = 0;
      let sumXY = 0;
      const values = new Float64Array(length);
      for (let j = 0; j < length; j++) {
        const value = derivative(definition, indices[j], 1);
        values[j] = value;
        sumX += j;
        sumX2 += j * j;
        sumY += value;
        sumXY += j * value;
      }
      const denominator = length * sumX2 - sumX * sumX;
      const slope = denominator > 0 ? (length * sumXY - sumX * sumY) / denominator : 0;
      const intercept = (sumY - slope * sumX) / length;
      const windowed = new Float64Array(length);
      let lineTrendEnergy = 0;
      let lineResidualEnergy = 0;
      for (let j = 0; j < length; j++) {
        const trend = intercept + slope * j;
        const residual = values[j] - trend;
        lineTrendEnergy += trend * trend;
        lineResidualEnergy += residual * residual;
        windowed[j] = residual * basis.window[j];
      }
      trendEnergy += lineTrendEnergy;
      residualEnergy += lineResidualEnergy;
      bands['>16'].energy += lineTrendEnergy;
      if (!(lineResidualEnergy > 0)) return;

      const powers: Array<{ k: number; power: number }> = [];
      let powerSum = 0;
      for (let k = 0; k <= Math.floor(length / 2); k++) {
        let real = 0;
        let imaginary = 0;
        for (let j = 0; j < length; j++) {
          real += windowed[j] * basis.cosine[k][j];
          imaginary -= windowed[j] * basis.sine[k][j];
        }
        const oneSidedFactor = k === 0 || (length % 2 === 0 && k === length / 2) ? 1 : 2;
        const power = oneSidedFactor * (real * real + imaginary * imaginary);
        powers.push({ k, power });
        powerSum += power;
      }
      if (!(powerSum > 0)) return;
      for (const { k, power } of powers) {
        const energy = lineResidualEnergy * (power / powerSum);
        const cyclesPerCell = k / length;
        const wavelengthCells = k === 0 ? null : length / k;
        const key = cyclesPerCell.toPrecision(12);
        const mode = modeEnergies.get(key);
        if (mode) mode.energy += energy;
        else modeEnergies.set(key, { cyclesPerCell, wavelengthCells, energy });
        bands[bandFor(wavelengthCells)].energy += energy;
      }
    };

    const consume = (indices: number[]): void => {
      let start = 0;
      while (start < indices.length) {
        while (start < indices.length && valid[indices[start]] !== 1) start++;
        let end = start;
        while (end < indices.length && valid[indices[end]] === 1) end++;
        if (end > start) analyzeLine(indices.slice(start, end));
        start = end;
      }
    };

    if (definition.axis === 0) {
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          consume(Array.from({ length: nx }, (_, x) => x + nx * (y + ny * z)));
        }
      }
    } else if (definition.axis === 1) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          consume(Array.from({ length: ny }, (_, y) => x + nx * (y + ny * z)));
        }
      }
    } else {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          consume(Array.from({ length: nz }, (_, z) => x + nx * (y + ny * z)));
        }
      }
    }

    const totalEnergy = trendEnergy + residualEnergy;
    return {
      derivativeAxis: definition.axis === 0 ? 'x' : definition.axis === 1 ? 'y' : 'z',
      lines,
      samples,
      shortLinesRejected,
      trendEnergy,
      residualEnergy,
      totalEnergy,
      modes: [...modeEnergies.values()].sort((a, b) => a.cyclesPerCell - b.cyclesPerCell),
      bands: finalizeBands(bands, totalEnergy),
    };
  };

  const contributionResults = Object.fromEntries(
    CONTRIBUTIONS.map((definition) => {
      const spectrum = spectrumFor(definition);
      return [
        definition.name,
        {
          spectrum,
          stencils: RADII.map((radius) =>
            stencilSummary(radius, contributionAccumulators[definition.name][radius]),
          ),
        },
      ];
    }),
  ) as StrainScaleAnalysis['contributions'];

  const componentResults = {} as StrainScaleAnalysis['components'];
  for (const component of STRAIN_SCALE_COMPONENTS) {
    const [first, second] = COMPONENT_CONTRIBUTIONS[component];
    const firstSpectrum = contributionResults[first].spectrum;
    const secondSpectrum = contributionResults[second].spectrum;
    const mixture = emptyBands();
    for (const band of STRAIN_WAVELENGTH_BANDS) {
      mixture[band].energy = firstSpectrum.bands[band].energy + secondSpectrum.bands[band].energy;
    }
    const mixtureEnergy = firstSpectrum.totalEnergy + secondSpectrum.totalEnergy;
    const spatial = componentSpatial[component];
    componentResults[component] = {
      contributions: [first, second],
      crossTermFraction:
        componentCross[component].combined > 0
          ? componentCross[component].cross / componentCross[component].combined
          : Number.NaN,
      contributionEnergySpectrum: finalizeBands(mixture, mixtureEnergy),
      shortWaveLocalization: {
        method:
          'coordinate profiles of (S_h - S_2h)^2 on the common h/2h/4h mask; fractions are normalized across the selected approach region',
        limitations:
          'This is a local stencil-disagreement proxy, not an orthogonal Fourier 2-4-cell band-pass. Use the directional spectra for wavelength allocation and these profiles only for spatial localization.',
        x: spatialProfile(spatial.x, spatial.totalHEnergy, spatial.totalHighPassEnergy),
        y: spatialProfile(spatial.y, spatial.totalHEnergy, spatial.totalHighPassEnergy),
        z: spatialProfile(spatial.z, spatial.totalHEnergy, spatial.totalHighPassEnergy),
      },
      stencils: RADII.map((radius) =>
        stencilSummary(radius, componentAccumulators[component][radius]),
      ),
    };
  }

  return {
    selectedCells,
    commonStencilCells,
    rejectedIncompleteStencil: selectedCells - commonStencilCells,
    maxStencilRadius: 4,
    minimumSpectralLineLength: MIN_LINE_LENGTH,
    spectralMethod:
      'directional 1-D DFT of h-centered derivative contributions; per-line affine detrend; Hann window; one-sided residual power renormalized to unwindowed residual energy; affine energy assigned to >16 cells',
    spectralLimitations:
      'Wavelengths are directional along each derivative axis, not isotropic 3-D |k|. Component band fractions mix the two contribution energies and cannot uniquely allocate their cross term. A single finite window broadens neighboring bins.',
    contributions: contributionResults,
    components: componentResults,
  };
}
