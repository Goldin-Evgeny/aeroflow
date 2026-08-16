/**
 * Atmospheric-boundary-layer inlet profiles (M10 step 1).
 *
 * Two standard wind-engineering inflow shapes (Tominaga et al. 2008, AIJ guidelines):
 *   power law  u(z) = uRef · (z/zRef)^α        (α ≈ 0.25 for urban terrain)
 *   log law    u(z) = (u✳/κ) · ln((z+z0)/z0)   (the +z0 form avoids the z→0 singularity)
 *
 * `ablProfileLattice` samples either profile at the true physical height of each ABSOLUTE
 * lattice row (`latticeRowHeight`, docs/PHYSICS.md §7.1): with the no-slip ground Solid at
 * row 0 and halfway bounce-back, the wall plane sits at row 0.5, so row y's height is
 * (y−0.5)·dx, not (y+0.5)·dx — row 0 itself (the solid ground) maps to a negative height,
 * which is fine and deliberate: `powerLawProfile`/`logLawProfile` both return 0 for z≤0,
 * and row 0's profile entry is never read (no Inlet/VelocityInlet cell sits on the ground
 * row). The power law grows without bound above zRef, so the LATTICE Mach clamp (0.1) is
 * applied per-node and REPORTED — a silent clamp would flatten the profile top and quietly
 * change the benchmark inflow.
 */

/**
 * The physical height of lattice row `y` above the halfway-bounce-back wall plane, when a
 * no-slip wall occupies row 0 (docs/PHYSICS.md §7.1, normative). The SINGLE definition of
 * this mapping — inlet profiles, AIJ probe placement (`scenes/aijCaseA.ts`), and inflow
 * interpolation (`validation/aijCaseA.ts`) must all use this rather than each keeping an
 * independent copy (fix-confirmed-physics-defects, wall-height-convention).
 */
export function latticeRowHeight(y: number, dx: number): number {
  return (y - 0.5) * dx;
}

/** Inverse of `latticeRowHeight`: the lattice row (possibly fractional) at physical height `z`. */
export function heightToLatticeRow(z: number, dx: number): number {
  return z / dx + 0.5;
}

export interface AblSpec {
  kind: 'power' | 'log';
  /** Reference velocity (m/s) at zRef — power law; for 'log' only used by callers' UI. */
  uRef: number;
  /** Reference height (m). */
  zRef: number;
  /** Power-law exponent. Default 0.25 (AIJ urban inflow). */
  alpha?: number;
  /** Log-law roughness length (m). */
  z0?: number;
  /** Log-law friction velocity (m/s). */
  uStar?: number;
}

/** Power-law ABL profile; 0 at and below ground. */
export function powerLawProfile(z: number, zRef: number, uRef: number, alpha = 0.25): number {
  if (z <= 0) return 0;
  return uRef * Math.pow(z / zRef, alpha);
}

/** Log-law ABL profile in the singularity-free (z+z0)/z0 form; 0 at and below ground. */
export function logLawProfile(z: number, z0: number, uStar: number, kappa = 0.41): number {
  if (z <= 0) return 0;
  return (uStar / kappa) * Math.log((z + z0) / z0);
}

export const LATTICE_MACH_LIMIT = 0.1;

export interface AblLatticeProfile {
  /** Lattice inlet velocity per absolute lattice row y (height `latticeRowHeight(y, dx)`), length nCells. */
  profile: Float32Array;
  /** True if any node hit the 0.1 lattice Mach clamp (report it — never silent). */
  clamped: boolean;
}

/**
 * Sample an ABL spec onto the lattice height axis.
 *
 * @param spec    profile shape + SI parameters.
 * @param nCells  number of fluid-node layers along the height axis.
 * @param dx      meters per cell.
 * @param uScale  lattice-per-physical velocity factor (= uLattice/physVelocity from
 *                `latticeUnits()` — all SI↔lattice conversion goes through that mapping).
 */
export function ablProfileLattice(
  spec: AblSpec,
  nCells: number,
  dx: number,
  uScale: number,
): AblLatticeProfile {
  if (nCells <= 0 || dx <= 0 || uScale <= 0) {
    throw new Error('ablProfileLattice: nCells, dx, uScale must be positive');
  }
  const profile = new Float32Array(nCells);
  let clamped = false;
  for (let k = 0; k < nCells; k++) {
    const z = latticeRowHeight(k, dx);
    const u =
      spec.kind === 'power'
        ? powerLawProfile(z, spec.zRef, spec.uRef, spec.alpha ?? 0.25)
        : logLawProfile(z, spec.z0 ?? 0.01, spec.uStar ?? 0.5);
    let lattice = u * uScale;
    if (lattice > LATTICE_MACH_LIMIT) {
      lattice = LATTICE_MACH_LIMIT;
      clamped = true;
    }
    profile[k] = lattice;
  }
  return { profile, clamped };
}
