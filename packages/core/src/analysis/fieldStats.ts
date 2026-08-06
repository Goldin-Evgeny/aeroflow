import { hasMacroscopics } from '../lattice.js';

/**
 * Whole-field stability statistics (M9 step 7 — the Cs sensitivity test).
 *
 * Why this exists: the Ahmed run enables H13 mass conservation (`conserveMass: true`) and runs
 * at τ₀ = 0.500144 at Re 1e5, i.e. a hair above the stability floor — and NOTHING measured
 * whether either held. The only in-run health check was `Number.isFinite(cd)`, which fires
 * after divergence has already happened and says nothing about the state that preceded it.
 *
 * That gap matters specifically for a Cs sweep. Lowering the Smagorinsky constant removes the
 * dissipation the scene documentation calls mandatory at this τ₀, so the three outcomes are
 * "clean", "diverged", and — the one that would otherwise be silently misread as a data point —
 * **"survived, but marginal"**: mass drifting, density excursions widening, Ma climbing. A rung
 * that finishes is not thereby a valid measurement, and these numbers are what distinguishes
 * the two.
 *
 * Reduces the same `readMacro()` image `sectionStats` consumes, over the same
 * `hasMacroscopics` predicate, so the two agree by construction about which cells count.
 */
export interface FieldStats {
  /**
   * Cells the macro pass actually populates (`CellType.Fluid`) — the population every other
   * figure here is taken over. NOT "non-solid": see `hasMacroscopics`.
   */
  fluidCells: number;
  /** Σρ over fluid cells. */
  totalMass: number;
  /**
   * Signed relative mass drift. The worker always initializes uniform ρ=1 (`sim.reset(1,0,0,0)`),
   * so the reference mass is exactly `fluidCells` and no baseline needs storing or restoring —
   * this stays correct across checkpoint/resume and across device-loss recovery.
   *
   * Only interpretable when `nonFiniteCells === 0`: poisoned cells are excluded from both the
   * sum and the count, so on a partly-diverged field this reports the drift of the surviving
   * region, not of the domain.
   */
  massDriftRel: number;
  rhoMin: number;
  rhoMax: number;
  rhoMean: number;
  /** Max |u| over fluid cells (lattice units). */
  uMax: number;
  /** Max Mach number, |u|/c_s with c_s = 1/√3 — the compressibility-error indicator. */
  machMax: number;
  /**
   * Cells whose ρ or velocity is NaN/±Infinity. Counted, never propagated: a single poisoned
   * cell must not turn every other statistic into NaN, because then the report cannot say
   * WHERE the field was still healthy.
   */
  nonFiniteCells: number;
}

/** 1/c_s = √3 in lattice units (c_s² = 1/3 on every lattice used here). */
const INV_CS = Math.sqrt(3);

export function fieldStats(
  macro: Float32Array,
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
): FieldStats {
  const n = nx * ny * nz;
  if (macro.length < 4 * n) {
    throw new Error(`fieldStats: macro has ${macro.length} entries, need ${4 * n}`);
  }
  if (flags.length < n) {
    throw new Error(`fieldStats: flags has ${flags.length} entries, need ${n}`);
  }

  let fluidCells = 0;
  let totalMass = 0;
  let rhoMin = Number.POSITIVE_INFINITY;
  let rhoMax = Number.NEGATIVE_INFINITY;
  let uSqMax = 0;
  let nonFiniteCells = 0;

  for (let i = 0; i < n; i++) {
    // `hasMacroscopics`, NOT `isSolid`: the boundary shell (Inlet/Outlet/FreeSlip) is non-solid
    // but the macro pass leaves it at ρ = 0, so counting it fabricates mass loss and a ρ_min
    // of zero on a healthy field. See the predicate's docstring for the measured symptom.
    if (!hasMacroscopics(flags[i])) continue;
    const rho = macro[4 * i];
    const ux = macro[4 * i + 1];
    const uy = macro[4 * i + 2];
    const uz = macro[4 * i + 3];
    // Skip poisoned cells rather than folding them in: Σ with a NaN is NaN, and a report that
    // is uniformly NaN cannot distinguish "one bad cell" from "the whole field is gone".
    if (
      !Number.isFinite(rho) ||
      !Number.isFinite(ux) ||
      !Number.isFinite(uy) ||
      !Number.isFinite(uz)
    ) {
      nonFiniteCells++;
      continue;
    }
    fluidCells++;
    totalMass += rho;
    if (rho < rhoMin) rhoMin = rho;
    if (rho > rhoMax) rhoMax = rho;
    const uSq = ux * ux + uy * uy + uz * uz;
    if (uSq > uSqMax) uSqMax = uSq;
  }

  if (fluidCells === 0) {
    return {
      fluidCells: 0,
      totalMass: 0,
      massDriftRel: Number.NaN,
      rhoMin: Number.NaN,
      rhoMax: Number.NaN,
      rhoMean: Number.NaN,
      uMax: Number.NaN,
      machMax: Number.NaN,
      nonFiniteCells,
    };
  }

  const uMax = Math.sqrt(uSqMax);
  return {
    fluidCells,
    totalMass,
    massDriftRel: (totalMass - fluidCells) / fluidCells,
    rhoMin,
    rhoMax,
    rhoMean: totalMass / fluidCells,
    uMax,
    machMax: uMax * INV_CS,
    nonFiniteCells,
  };
}
