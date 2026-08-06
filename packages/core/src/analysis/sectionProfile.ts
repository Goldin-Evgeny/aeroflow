import { isSolid } from '../lattice.js';

/**
 * Cross-section flow statistics on a y–z plane (M9 acceptance-1 diagnostics).
 *
 * Why this exists: a drag coefficient normalized by the *commanded* inlet velocity is only
 * meaningful if the flow actually reaches it. `CellType.Inlet` is an equilibrium BC, not a
 * flux-imposing one — M10 measured a frictionless duct fed from rest settling at
 * **0.660·u_in**, which is why the AIJ scenes were migrated to the H12 `VelocityInlet`. The
 * Ahmed scene was not. Before attributing a Cd miss to physics, measure what the approach
 * flow is doing.
 *
 * A single point probe cannot answer that: the section carries a developing ground boundary
 * layer, so a probe's answer depends entirely on where it sits. These statistics report the
 * section two ways — a whole-section mass-flux average, and a core average that excludes the
 * boundary layer by a stated rule — so the two can be compared rather than conflated.
 *
 * **The acceptance coefficient stays normalized by the commanded velocity.** Everything here
 * is diagnostic. Renormalizing a verdict onto whichever velocity flatters it would be
 * exactly the tolerance-shopping hard rule 3 forbids.
 */
export interface SectionStats {
  /** Station index along x. */
  x: number;
  fluidCells: number;
  /** Σρ / N — mean density over the section's fluid cells. */
  meanRho: number;
  /** Σu_x / N — plain area average, boundary layer included. */
  areaMeanUx: number;
  /** Σρu_x — the section's streamwise mass flux (lattice units). */
  massFlux: number;
  /** Σρu_x / Σρ — mass-flux-weighted mean velocity, the bulk velocity. */
  bulkUx: number;
  /** Population standard deviation of u_x over the section. */
  stdUx: number;
  /** stdUx / |areaMeanUx| — 0 for a perfectly uniform section. */
  nonUniformity: number;
  /**
   * Mean u_x over the CORE only, excluding the developing ground boundary layer by the
   * classical δ₉₉ rule (see `yCore`). This is the closest thing the section has to a
   * freestream velocity.
   */
  coreMeanUx: number;
  coreCells: number;
  /**
   * Lowest y whose layer-mean u_x first reaches 99% of the section's maximum layer-mean —
   * the δ₉₉ boundary-layer edge. Cells at y ≥ yCore form the core. −1 when no layer
   * qualifies (no fluid, or a section with no positive flow).
   */
  yCore: number;
  /** yCore − (lowest fluid y): boundary-layer thickness in cells, −1 if undefined. */
  blThicknessCells: number;
}

/**
 * Statistics of one y–z cross-section at station `x`.
 *
 * `macro` is the interleaved [rho, ux, uy, uz] readback (`Lbm3D.readMacro()`), length 4·N.
 * Solid cells — including `BodySolid` — are excluded via `isSolid`, so a station that clips
 * geometry still reports over fluid only.
 */
export function sectionStats(
  macro: Float32Array,
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  x: number,
): SectionStats {
  if (x < 0 || x >= nx) throw new Error(`sectionStats: station x=${x} outside [0, ${nx})`);

  // Layer sums (per y, across z) drive the δ₉₉ core rule; the flat sums drive the rest.
  const layerSum = new Float64Array(ny);
  const layerCount = new Int32Array(ny);
  let fluidCells = 0;
  let sumRho = 0;
  let sumUx = 0;
  let sumUxSq = 0;
  let sumRhoUx = 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const idx = x + nx * (y + ny * z);
      if (isSolid(flags[idx])) continue;
      const rho = macro[4 * idx];
      const ux = macro[4 * idx + 1];
      fluidCells++;
      sumRho += rho;
      sumUx += ux;
      sumUxSq += ux * ux;
      sumRhoUx += rho * ux;
      layerSum[y] += ux;
      layerCount[y]++;
    }
  }

  if (fluidCells === 0) {
    return {
      x,
      fluidCells: 0,
      meanRho: NaN,
      areaMeanUx: NaN,
      massFlux: 0,
      bulkUx: NaN,
      stdUx: NaN,
      nonUniformity: NaN,
      coreMeanUx: NaN,
      coreCells: 0,
      yCore: -1,
      blThicknessCells: -1,
    };
  }

  const areaMeanUx = sumUx / fluidCells;
  const variance = Math.max(0, sumUxSq / fluidCells - areaMeanUx * areaMeanUx);
  const stdUx = Math.sqrt(variance);

  // δ₉₉: walk up from the ground to the first layer reaching 99% of the peak layer mean.
  // Using the peak rather than the top layer keeps the rule well-defined when the section
  // also has a free-slip lid whose layer can slightly exceed the interior.
  let peak = -Infinity;
  let lowestFluidY = -1;
  for (let y = 0; y < ny; y++) {
    if (layerCount[y] === 0) continue;
    if (lowestFluidY < 0) lowestFluidY = y;
    const m = layerSum[y] / layerCount[y];
    if (m > peak) peak = m;
  }
  let yCore = -1;
  if (peak > 0) {
    for (let y = 0; y < ny; y++) {
      if (layerCount[y] === 0) continue;
      if (layerSum[y] / layerCount[y] >= 0.99 * peak) {
        yCore = y;
        break;
      }
    }
  }

  let coreSum = 0;
  let coreCells = 0;
  if (yCore >= 0) {
    for (let y = yCore; y < ny; y++) {
      coreSum += layerSum[y];
      coreCells += layerCount[y];
    }
  }

  return {
    x,
    fluidCells,
    meanRho: sumRho / fluidCells,
    areaMeanUx,
    massFlux: sumRhoUx,
    bulkUx: sumRhoUx / sumRho,
    stdUx,
    nonUniformity: areaMeanUx === 0 ? NaN : stdUx / Math.abs(areaMeanUx),
    coreMeanUx: coreCells > 0 ? coreSum / coreCells : NaN,
    coreCells,
    yCore,
    blThicknessCells: yCore >= 0 && lowestFluidY >= 0 ? yCore - lowestFluidY : -1,
  };
}

/**
 * The three stations M9's inlet diagnosis needs: near the inlet, midway to the body, and
 * shortly upstream of the nose. Clamped into the interior and de-duplicated, so a short
 * fetch degrades to fewer stations rather than probing the inlet plane itself (whose values
 * are the BC, not the flow).
 *
 * `noseX` is the body's nose station; `margin` keeps the last station clear of the nose's
 * own blockage-induced stagnation rise.
 */
export function upstreamStations(noseX: number, margin = 3): number[] {
  const near = 2;
  const justUpstream = Math.max(near, noseX - margin);
  const mid = Math.max(near, Math.round(noseX / 2));
  return [...new Set([near, mid, justUpstream])].sort((a, b) => a - b);
}
