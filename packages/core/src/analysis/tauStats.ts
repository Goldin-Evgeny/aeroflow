import { viscosityFromTau } from '../cpu/collide.js';

/**
 * Statistics over a per-cell τ_eff field (M9 step 6).
 *
 * The question these answer is narrow and specific: **is the nominal Reynolds number still
 * controlling the physics?** The Ahmed ladder goes Re-independent above ~1e5 (Cd 3.70 → 3.89
 * → 3.99 over a 43× Re range) exactly where τ₀ reaches ~0.5001, and the ground boundary layer
 * swells from 6 to 43 cells across the same step. Both are *consistent with* the subgrid model
 * having taken over from molecular viscosity, and neither establishes it.
 *
 * What establishes it is the ratio ν_LES/ν_mol, cell by cell and region by region:
 *
 *   ν = (τ − ½)/3   ⇒   ν_mol = (τ₀ − ½)/3,  ν_LES = (τ_eff − τ₀)/3
 *
 * At Re 1e4 the scene runs τ₀ = 0.501439 ⇒ ν_mol ≈ 4.80e-4. At Re 1e5, τ₀ = 0.500144 ⇒
 * ν_mol ≈ 4.80e-5. Ten times smaller — so the *same* absolute eddy viscosity is ten times
 * more dominant at the higher Re. If ν_LES ≫ ν_mol over most of the domain, the effective
 * Reynolds number is set by the model and the grid, not by the number in the UI, and every
 * "Re 1e5 / 1e6 / 4.29e6" label on the ladder describes an input that no longer reaches the
 * physics. That is a falsifiable claim and this module is how it gets tested.
 *
 * **Nothing here clamps or floors anything.** `smagorinskyTauEff` yields τ_eff = τ₀ + τ_t
 * with τ_t ≥ 0, so τ₀ is itself the lower bound — "cells at the floor" below means cells
 * where the LES is contributing nothing, not cells where a limiter fired. There is no
 * limiter, in the CPU reference or in the WGSL kernel.
 */
export interface TauStats {
  /** Cells included by the mask. Zero ⇒ every statistic below is NaN. */
  cells: number;
  /** Base relaxation time — the same for every cell; ν_mol derives from it. */
  tau0: number;
  /** ν_mol = (τ₀ − ½)/3, in lattice units. */
  nuMolecular: number;

  tauMin: number;
  tauMean: number;
  tauMax: number;
  /** τ_eff at p1, p5, p25, p50, p75, p90, p95, p99, p99.9 — in that order. */
  tauPercentiles: number[];

  /** ν_LES/ν_mol = (τ_eff − τ₀)/(τ₀ − ½), at the same nine percentiles. */
  nuRatioPercentiles: number[];
  nuRatioMean: number;
  nuRatioMax: number;

  /**
   * Fraction of masked cells where the LES contributes ≤1% of the molecular viscosity —
   * i.e. τ_eff is at its floor τ₀ for all practical purposes.
   */
  atFloorFraction: number;
  /** Fraction where ν_LES exceeds ν_mol: the model is the dominant dissipation. */
  lesDominantFraction: number;
  /** Fraction where ν_LES exceeds 10·ν_mol: nominal Re is essentially not in play. */
  lesOverwhelmingFraction: number;
}

/** The nine percentile positions every percentile array in this module reports. */
export const TAU_PERCENTILES = [1, 5, 25, 50, 75, 90, 95, 99, 99.9] as const;

/** Nearest-rank percentile on an ascending-sorted array. */
function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  const i = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[i];
}

const emptyStats = (tau0: number): TauStats => ({
  cells: 0,
  tau0,
  nuMolecular: viscosityFromTau(tau0),
  tauMin: Number.NaN,
  tauMean: Number.NaN,
  tauMax: Number.NaN,
  tauPercentiles: TAU_PERCENTILES.map(() => Number.NaN),
  nuRatioPercentiles: TAU_PERCENTILES.map(() => Number.NaN),
  nuRatioMean: Number.NaN,
  nuRatioMax: Number.NaN,
  atFloorFraction: Number.NaN,
  lesDominantFraction: Number.NaN,
  lesOverwhelmingFraction: Number.NaN,
});

/**
 * Reduce a τ_eff field over the cells `select` accepts.
 *
 * `tauEff` is indexed by cell; entries for cells the mask rejects are never read, so a
 * caller may leave non-fluid cells uninitialized. `tau0` must be the scene's base relaxation
 * time — every ν ratio below is relative to it.
 */
export function tauStats(
  tauEff: ArrayLike<number>,
  tau0: number,
  select: (idx: number) => boolean,
): TauStats {
  const nuMol = viscosityFromTau(tau0);
  if (!(nuMol > 0)) {
    // τ₀ ≤ ½ is unphysical (negative viscosity) and makes every ratio below meaningless.
    // makeCollideContext already rejects it; fail loudly rather than emit silent Infinities.
    throw new Error(`tauStats: tau0 ${tau0} must be > 0.5`);
  }

  // Two passes rather than one push-into-a-JS-array pass: at the 8M Ahmed tier the whole
  // domain region holds ~7M values, and building a boxed intermediate before copying it into
  // a Float64Array doubles the peak allocation for no benefit.
  let count = 0;
  for (let idx = 0; idx < tauEff.length; idx++) {
    if (select(idx)) count++;
  }
  if (count === 0) return emptyStats(tau0);

  const values = new Float64Array(count);
  let w = 0;
  for (let idx = 0; idx < tauEff.length && w < count; idx++) {
    if (select(idx)) values[w++] = tauEff[idx];
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let atFloor = 0;
  let dominant = 0;
  let overwhelming = 0;
  let ratioSum = 0;
  let ratioMax = -Infinity;

  const ratios = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const t = values[i];
    sum += t;
    if (t < min) min = t;
    if (t > max) max = t;
    // ν_LES/ν_mol = ((τ_eff−τ₀)/3) / ((τ₀−½)/3); the /3 cancels exactly.
    const ratio = (t - tau0) / (tau0 - 0.5);
    ratios[i] = ratio;
    ratioSum += ratio;
    if (ratio > ratioMax) ratioMax = ratio;
    if (ratio <= 0.01) atFloor++;
    if (ratio > 1) dominant++;
    if (ratio > 10) overwhelming++;
  }

  values.sort();
  ratios.sort();
  const n = values.length;

  return {
    cells: n,
    tau0,
    nuMolecular: nuMol,
    tauMin: min,
    tauMean: sum / n,
    tauMax: max,
    tauPercentiles: TAU_PERCENTILES.map((p) => percentile(values, p)),
    nuRatioPercentiles: TAU_PERCENTILES.map((p) => percentile(ratios, p)),
    nuRatioMean: ratioSum / n,
    nuRatioMax: ratioMax,
    atFloorFraction: atFloor / n,
    lesDominantFraction: dominant / n,
    lesOverwhelmingFraction: overwhelming / n,
  };
}

/** A named region of the domain, so every Re is reported over identical masks. */
export interface TauRegion {
  name: string;
  select: (idx: number) => boolean;
}

/**
 * Build the M9 region set for a scene of the given extents.
 *
 * The regions are defined purely from geometry (nose/tail/height in cells) so that the Re 1e4
 * and Re 1e5 snapshots are reduced over **byte-identical masks** — comparing τ_eff between
 * two runs is only meaningful if the cells being compared are the same cells. `isFluid`
 * decides membership, so solid, inlet and outlet cells never enter a statistic.
 */
export function ahmedTauRegions(opts: {
  nx: number;
  ny: number;
  /** Nose station in cells. */
  noseX: number;
  /** Body length in cells; the tail sits at noseX + bodyLength. */
  bodyLength: number;
  /** Top of the body in cells above the ground (ground clearance + body height). */
  bodyHeight: number;
  /**
   * First cell of the 25° slant. Taken from the geometry (L − slantChord·cos α), not
   * approximated as a fraction of the body — the slant is where the separation that decides
   * the literature Cd lives, and a mask that starts in the wrong place would attribute roof
   * flow to it.
   */
  slantStartX: number;
  /** Upstream diagnostic stations — the same x used for the δ99 profiles. */
  stations: readonly number[];
  isFluid: (idx: number) => boolean;
}): TauRegion[] {
  const { nx, ny, noseX, bodyLength, bodyHeight, slantStartX, stations, isFluid } = opts;
  const at = (idx: number): { x: number; y: number; z: number } => {
    const x = idx % nx;
    const y = Math.floor(idx / nx) % ny;
    const z = Math.floor(idx / (nx * ny));
    return { x, y, z };
  };
  const tailX = noseX + bodyLength;
  const regions: TauRegion[] = [
    { name: 'whole domain', select: isFluid },
    {
      // The ground layer the δ99 measurement lives in. If the boundary-layer swelling is an
      // LES artefact rather than physics, this is where ν_LES/ν_mol shows it first.
      name: 'ground layer (y < 8)',
      select: (i) => isFluid(i) && at(i).y < 8,
    },
    {
      name: `ground band (y < ${bodyHeight})`,
      select: (i) => isFluid(i) && at(i).y < bodyHeight,
    },
    {
      // Upstream of the nose and above the ground band: nominally undisturbed freestream.
      // ν_LES should be near zero here; if it is not, the model is firing on nothing.
      name: 'approach freestream',
      select: (i) => {
        const { x, y } = at(i);
        return isFluid(i) && x < noseX && y >= bodyHeight;
      },
    },
    {
      name: 'around body',
      select: (i) => {
        const { x, y } = at(i);
        return isFluid(i) && x >= noseX && x <= tailX && y < 2 * bodyHeight;
      },
    },
    {
      // Where the 25° separation lives, and where the literature Cd is decided.
      name: 'slant',
      select: (i) => {
        const { x, y } = at(i);
        return isFluid(i) && x >= slantStartX && x <= tailX && y < 2 * bodyHeight;
      },
    },
    {
      name: 'near wake (≤1 body length aft)',
      select: (i) => {
        const { x, y } = at(i);
        return isFluid(i) && x > tailX && x <= tailX + bodyLength && y < 2 * bodyHeight;
      },
    },
  ];
  for (const sx of stations) {
    regions.push({ name: `station x=${sx}`, select: (i) => isFluid(i) && at(i).x === sx });
  }
  return regions;
}

/** Per-y-layer τ_eff reduction at one x station — the vertical profile behind δ99. */
export interface TauLayer {
  y: number;
  cells: number;
  tauMean: number;
  tauMax: number;
  nuRatioMean: number;
}

/**
 * τ_eff averaged per ground-parallel layer at station `x`, from y=0 up to `maxY` (exclusive).
 * Read alongside the δ99 velocity profile at the same station: a boundary layer that thickens
 * because of eddy viscosity shows a ν_LES/ν_mol that rises with it, layer for layer.
 */
export function tauLayersAt(
  tauEff: ArrayLike<number>,
  tau0: number,
  nx: number,
  ny: number,
  nz: number,
  x: number,
  maxY: number,
  isFluid: (idx: number) => boolean,
): TauLayer[] {
  const nuDenom = tau0 - 0.5;
  const layers: TauLayer[] = [];
  const top = Math.min(maxY, ny);
  for (let y = 0; y < top; y++) {
    let cells = 0;
    let sum = 0;
    let max = -Infinity;
    let ratioSum = 0;
    for (let z = 0; z < nz; z++) {
      const idx = x + nx * (y + ny * z);
      if (!isFluid(idx)) continue;
      const t = tauEff[idx];
      cells++;
      sum += t;
      if (t > max) max = t;
      ratioSum += (t - tau0) / nuDenom;
    }
    layers.push({
      y,
      cells,
      tauMean: cells ? sum / cells : Number.NaN,
      tauMax: cells ? max : Number.NaN,
      nuRatioMean: cells ? ratioSum / cells : Number.NaN,
    });
  }
  return layers;
}
