import { axisBoundaryDistance, summarize, type StrainSummary } from './strainComparison.js';

/**
 * The zero-strain freestream eddy-viscosity probe
 * (openspec/changes/discriminate-near-floor-instability, design.md D3).
 *
 * In the freestream interior of an EMPTY domain the analytic strain rate is exactly zero, so
 * the analytically correct eddy viscosity there is exactly zero and every non-zero value the
 * closure produces is wholly numerical artifact. That makes this the strongest oracle
 * available for near-floor subgrid behaviour: no acceptance band is involved, no benchmark
 * fixture, no convergence argument, and the correct answer does not move with resolution.
 *
 * It only holds where the analytic strain really is zero. Cells within the boundary-influence
 * distance of an inlet, an outlet or a wall have genuine strain, and including them would
 * measure the boundary layer and report it as artifact — so `exclusionDistance` is a stated,
 * reported parameter of the measurement rather than a hidden constant, and the excluded counts
 * come back with the result so the selection is auditable.
 *
 * This probe says nothing about a domain that contains a body: there the strain is not zero
 * and there is no analytic answer to compare against.
 */

export interface FreestreamEddyViscosityInput {
  nx: number;
  ny: number;
  nz: number;
  /** The solver's OWN per-cell τ_eff (`Solver3D.tauEffRecord`), never a re-derivation. */
  tauEff: ArrayLike<number>;
  /** 1 where the cell was collided (Fluid), 0 elsewhere — `strainComparison`'s convention. */
  evaluated: ArrayLike<number>;
  /** The bare relaxation time τ₀, so ν_mol = (τ₀ − ½)/3 and ν_t = (τ_eff − τ₀)/3. */
  tau0: number;
  /**
   * Cells this close to a domain face on ANY axis are excluded. Must be ≥ 1: the face shell
   * itself is never fluid, and its immediate neighbour carries the boundary's own strain.
   */
  exclusionDistance?: number;
  /** Fully periodic oracles have no boundary shell and therefore select every evaluated cell. */
  selection?: 'wall-bounded' | 'fully-periodic';
}

export interface FreestreamEddyViscosity {
  selection: 'wall-bounded' | 'fully-periodic';
  /** Echoed back so a recorded result states the selection it was measured under. */
  exclusionDistance: number;
  tau0: number;
  /** ν_mol = (τ₀ − ½)/3, the denominator of the reported ratio. */
  molecularViscosity: number;
  totalCells: number;
  evaluatedCells: number;
  /** Evaluated cells dropped for sitting within `exclusionDistance` of a face. */
  excludedByBoundaryDistance: number;
  /** Surviving cells whose τ_eff was non-finite or below τ₀ (the closure cannot go negative). */
  invalidCells: number;
  survivingCells: number;
  /** ν_t/ν_mol over the surviving freestream selection. The analytic answer is 0 everywhere. */
  ratio: StrainSummary;
  /** Fraction of surviving cells whose ν_t/ν_mol exceeds 1 — subgrid outweighing molecular. */
  fractionAboveMolecular: number;
  /** ν_t/ν_mol binned by distance to the nearest face, to show whether the artifact is
   *  boundary-driven or fills the interior. Same binning as `strainComparison`. */
  byBoundaryDistance: Array<{ distance: number; cells: number; meanRatio: number }>;
}

export function freestreamEddyViscosity(
  input: FreestreamEddyViscosityInput,
): FreestreamEddyViscosity {
  const { nx, ny, nz, tauEff, evaluated, tau0 } = input;
  const selection = input.selection ?? 'wall-bounded';
  const exclusionDistance = input.exclusionDistance ?? (selection === 'fully-periodic' ? 0 : 1);
  const n = nx * ny * nz;
  if (tauEff.length !== n || evaluated.length !== n) {
    throw new Error(`freestreamEddyViscosity: every field must contain nx*ny*nz=${n} values`);
  }
  if (!(tau0 > 0.5)) throw new Error('freestreamEddyViscosity: tau0 must be greater than 0.5');
  if (
    !Number.isInteger(exclusionDistance) ||
    exclusionDistance < (selection === 'fully-periodic' ? 0 : 1)
  ) {
    throw new Error(
      `freestreamEddyViscosity: exclusionDistance must be an integer ≥ ${selection === 'fully-periodic' ? 0 : 1}`,
    );
  }

  const molecularViscosity = (tau0 - 0.5) / 3;
  const ratios = new Float64Array(n);
  const distances = new Int32Array(n);
  let evaluatedCells = 0;
  let excludedByBoundaryDistance = 0;
  let invalidCells = 0;
  let write = 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = x + nx * (y + ny * z);
        if (evaluated[idx] !== 1) continue;
        evaluatedCells++;
        const distance = Math.min(
          axisBoundaryDistance(x, nx),
          axisBoundaryDistance(y, ny),
          axisBoundaryDistance(z, nz),
        );
        if (distance < exclusionDistance) {
          excludedByBoundaryDistance++;
          continue;
        }
        const tau = tauEff[idx];
        // τ_t ≥ 0 by construction (`smagorinskyTauEff` has no clamp and needs none), so a
        // τ_eff below τ₀ means the record was never written or the run went non-finite.
        // Counting it rather than coercing it keeps a broken input from reading as zero artifact.
        if (!Number.isFinite(tau) || tau < tau0) {
          invalidCells++;
          continue;
        }
        ratios[write] = (tau - tau0) / 3 / molecularViscosity;
        distances[write] = distance;
        write++;
      }
    }
  }

  if (write === 0) {
    // Task 3.3: an empty selection is a harness error, never a zero reading. "No artifact
    // measured" and "nothing was measured" are opposite results, and silently returning 0
    // here would let a mis-sized scene be recorded as a clean freestream.
    throw new Error(
      `freestreamEddyViscosity: no cells survived selection on a ${nx}×${ny}×${nz} grid ` +
        `(${evaluatedCells} evaluated, ${excludedByBoundaryDistance} within ` +
        `exclusionDistance=${exclusionDistance} of a face, ${invalidCells} invalid) — ` +
        'the scene is too small for this exclusion distance, or τ_eff was never recorded',
    );
  }

  const surviving = ratios.subarray(0, write);
  let aboveMolecular = 0;
  for (let i = 0; i < write; i++) if (surviving[i] > 1) aboveMolecular++;

  const binCells = new Map<number, { cells: number; sum: number }>();
  for (let i = 0; i < write; i++) {
    const bin = binCells.get(distances[i]) ?? { cells: 0, sum: 0 };
    bin.cells++;
    bin.sum += surviving[i];
    binCells.set(distances[i], bin);
  }

  return {
    selection,
    exclusionDistance,
    tau0,
    molecularViscosity,
    totalCells: n,
    evaluatedCells,
    excludedByBoundaryDistance,
    invalidCells,
    survivingCells: write,
    ratio: summarize(surviving),
    fractionAboveMolecular: aboveMolecular / write,
    byBoundaryDistance: [...binCells.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([distance, bin]) => ({
        distance,
        cells: bin.cells,
        meanRatio: bin.sum / bin.cells,
      })),
  };
}

export interface BoundaryInfluenceObservation {
  readonly step: number;
  /** Conservative number of face-adjacent layers carrying resolved strain. */
  readonly distance: number;
  readonly influencedCells: number;
  readonly strainTolerance: number;
}

export interface BoundaryInfluenceInput {
  nx: number;
  ny: number;
  nz: number;
  evaluated: ArrayLike<number>;
  ux: ArrayLike<number>;
  uy: ArrayLike<number>;
  uz: ArrayLike<number>;
  step: number;
  /** Declared absolute resolved-strain floor; fixed before inspecting the window. */
  strainTolerance: number;
}

/** Measure how far non-zero resolved strain has propagated inward from a domain face. */
export function boundaryInfluenceDistance(
  input: BoundaryInfluenceInput,
): BoundaryInfluenceObservation {
  const { nx, ny, nz, evaluated, ux, uy, uz, step, strainTolerance } = input;
  const n = nx * ny * nz;
  if ([evaluated, ux, uy, uz].some((field) => field.length !== n)) {
    throw new Error(`boundaryInfluenceDistance: every field must contain nx*ny*nz=${n} values`);
  }
  if (!(strainTolerance >= 0) || !Number.isFinite(strainTolerance)) {
    throw new Error('boundaryInfluenceDistance: strainTolerance must be finite and non-negative');
  }
  let distance = 1;
  let influencedCells = 0;
  const plane = nx * ny;
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const idx = x + nx * (y + ny * z);
        if (
          evaluated[idx] !== 1 ||
          evaluated[idx - 1] !== 1 ||
          evaluated[idx + 1] !== 1 ||
          evaluated[idx - nx] !== 1 ||
          evaluated[idx + nx] !== 1 ||
          evaluated[idx - plane] !== 1 ||
          evaluated[idx + plane] !== 1
        ) {
          continue;
        }
        const gradientSquared =
          ((ux[idx + 1] - ux[idx - 1]) / 2) ** 2 +
          ((ux[idx + nx] - ux[idx - nx]) / 2) ** 2 +
          ((ux[idx + plane] - ux[idx - plane]) / 2) ** 2 +
          ((uy[idx + 1] - uy[idx - 1]) / 2) ** 2 +
          ((uy[idx + nx] - uy[idx - nx]) / 2) ** 2 +
          ((uy[idx + plane] - uy[idx - plane]) / 2) ** 2 +
          ((uz[idx + 1] - uz[idx - 1]) / 2) ** 2 +
          ((uz[idx + nx] - uz[idx - nx]) / 2) ** 2 +
          ((uz[idx + plane] - uz[idx - plane]) / 2) ** 2;
        if (Math.sqrt(gradientSquared) <= strainTolerance) continue;
        influencedCells++;
        distance = Math.max(
          distance,
          Math.min(
            axisBoundaryDistance(x, nx),
            axisBoundaryDistance(y, ny),
            axisBoundaryDistance(z, nz),
          ) + 1,
        );
      }
    }
  }
  return { step, distance, influencedCells, strainTolerance };
}

export interface WallBoundedAnalyticZeroInput extends Omit<
  FreestreamEddyViscosityInput,
  'exclusionDistance' | 'selection'
> {
  window: { startStep: number; endStep: number };
  boundaryInfluence: readonly BoundaryInfluenceObservation[];
}

export type WallBoundedAnalyticZeroResult =
  | {
      state: 'available';
      window: { startStep: number; endStep: number };
      boundaryInfluence: readonly BoundaryInfluenceObservation[];
      largestSupportedDistance: number;
      measurement: FreestreamEddyViscosity;
    }
  | {
      state: 'unavailable';
      reason: 'no-cells-outside-boundary-influence';
      window: { startStep: number; endStep: number };
      boundaryInfluence: readonly BoundaryInfluenceObservation[];
      largestSupportedDistance: number;
      boundaryContaminated: FreestreamEddyViscosity;
    };

/** Select a wall-bounded window from its largest observed influence distance. */
export function wallBoundedAnalyticZero(
  input: WallBoundedAnalyticZeroInput,
): WallBoundedAnalyticZeroResult {
  const observations = input.boundaryInfluence.filter(
    (sample) => sample.step >= input.window.startStep && sample.step <= input.window.endStep,
  );
  if (observations.length === 0) {
    throw new Error('wallBoundedAnalyticZero: measurement window has no influence observations');
  }
  const largestSupportedDistance = Math.max(...observations.map((sample) => sample.distance));
  const common = {
    nx: input.nx,
    ny: input.ny,
    nz: input.nz,
    tauEff: input.tauEff,
    evaluated: input.evaluated,
    tau0: input.tau0,
  };
  try {
    return {
      state: 'available',
      window: input.window,
      boundaryInfluence: observations,
      largestSupportedDistance,
      measurement: freestreamEddyViscosity({
        ...common,
        selection: 'wall-bounded',
        exclusionDistance: largestSupportedDistance,
      }),
    };
  } catch (error) {
    if (!(error instanceof Error) || !/no cells survived selection/.test(error.message))
      throw error;
    return {
      state: 'unavailable',
      reason: 'no-cells-outside-boundary-influence',
      window: input.window,
      boundaryInfluence: observations,
      largestSupportedDistance,
      boundaryContaminated: freestreamEddyViscosity({
        ...common,
        selection: 'wall-bounded',
        exclusionDistance: 1,
      }),
    };
  }
}
