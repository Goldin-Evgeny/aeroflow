/**
 * Physical ↔ lattice unit mapping.
 *
 * LBM works in lattice units where dx = dt = 1 and density ≈ 1. To simulate a physical
 * problem we pick:
 *   - a characteristic physical length L (m) resolved by `cells` lattice cells,
 *   - a characteristic physical velocity U (m/s) mapped to a lattice velocity uLattice,
 *   - the physical kinematic viscosity ν (m²/s; air ≈ 1.5e-5).
 *
 * Then:
 *   dx  = L / cells                     (m per cell)
 *   dt  = uLattice · dx / U             (s per timestep)
 *   ν_lattice = ν · dt / dx²
 *   τ   = 3·ν_lattice + 0.5             (BGK relaxation time; must stay > 0.5)
 *   Re  = U·L/ν  =  uLattice·cells/ν_lattice   (identical in both unit systems)
 *
 * Constraints:
 *   - uLattice ≤ ~0.1 keeps compressibility error O(Ma²) small (c_s = 1/√3).
 *   - τ very close to 0.5 (ν_lattice → 0, i.e. high Re) is unstable without an LES
 *     subgrid model — `stable` reflects the plain-BGK envelope only.
 */

export const AIR_KINEMATIC_VISCOSITY = 1.5e-5; // m²/s at ~20 °C

export interface UnitMappingInput {
  /** Characteristic physical length in meters (e.g. cylinder diameter, building height). */
  physLength: number;
  /** Characteristic physical velocity in m/s (e.g. wind speed). */
  physVelocity: number;
  /** Kinematic viscosity in m²/s. Defaults to air. */
  physViscosity?: number;
  /** Number of lattice cells resolving physLength. */
  cells: number;
  /** Target lattice velocity (Mach control). Defaults to 0.05. */
  uLattice?: number;
  /**
   * Whether the Smagorinsky LES subgrid model is active (M5). With LES, τ_eff is raised
   * per cell to keep the collision stable as ν_lattice → 0, so the `stable` flag no
   * longer requires τ₀ comfortably above 0.5 — only the Mach limit remains. Default false.
   */
  les?: boolean;
}

export interface UnitMapping {
  dx: number;
  dt: number;
  uLattice: number;
  nuLattice: number;
  tau: number;
  omega: number;
  Re: number;
  /**
   * True if the flow is expected to run stably. Without LES this is the plain-BGK
   * envelope (τ₀ comfortably above 0.5 AND u below the Mach limit). With LES the τ₀
   * floor is lifted (the subgrid model supplies the missing dissipation), leaving only
   * the Mach limit.
   */
  stable: boolean;
}

/** Air density in kg/m³ at 20 °C, 1 atm — the default fluid for `forceToNewtons()`. */
export const AIR_DENSITY = 1.204;

/**
 * Convert a lattice-unit momentum-exchange force to newtons (M8 step 7).
 *
 * Derivation: force = mass · acceleration = [ρ]·[L]³ · [L]/[T]² = [ρ]·[L]⁴·[T]⁻², so one
 * lattice force unit equals ρ_phys/ρ_lattice · dx⁴/dt² newtons (ρ_lattice = 1 by the LBM
 * convention; a lattice cell of unit density carries mass ρ_phys·dx³ kg, and unit lattice
 * acceleration is dx/dt² m/s²). The exponent pair is the classic silent-wrongness spot —
 * dx³/dt² and dx⁴/dt are both dimensionally wrong (M8 pitfalls) — so the unit test
 * cross-checks against the hand computation F = ½·ρ·Cd·A·U².
 */
export function forceToNewtons(
  forceLattice: number,
  mapping: Pick<UnitMapping, 'dx' | 'dt'>,
  physDensity = AIR_DENSITY,
): number {
  return (forceLattice * physDensity * mapping.dx ** 4) / mapping.dt ** 2;
}

export function latticeUnits(input: UnitMappingInput): UnitMapping {
  const { physLength, physVelocity, cells } = input;
  const physViscosity = input.physViscosity ?? AIR_KINEMATIC_VISCOSITY;
  const uLattice = input.uLattice ?? 0.05;
  if (physLength <= 0 || physVelocity <= 0 || physViscosity <= 0 || cells <= 0) {
    throw new Error('latticeUnits: all inputs must be positive');
  }
  if (uLattice <= 0 || uLattice > 0.3) {
    throw new Error('latticeUnits: uLattice must be in (0, 0.3]; recommended ≤ 0.1');
  }
  const dx = physLength / cells;
  const dt = (uLattice * dx) / physVelocity;
  const nuLattice = (physViscosity * dt) / (dx * dx);
  const tau = 3 * nuLattice + 0.5;
  const Re = (physVelocity * physLength) / physViscosity;
  return {
    dx,
    dt,
    uLattice,
    nuLattice,
    tau,
    omega: 1 / tau,
    Re,
    stable: uLattice <= 0.1 && (input.les === true || tau > 0.505),
  };
}
