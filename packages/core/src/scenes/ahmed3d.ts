import { CellType } from '../lattice.js';
import { AHMED, ahmedBody, type AhmedBodyOptions } from '../geometry/ahmedBody.js';
import { validateFreeSlip } from '../cpu/freeslip.js';
import { voxelizeSolid } from '../voxel/voxelize.js';
import type { TriangleMesh } from '../geometry/icosphere.js';
import type { Outlet3D } from '../cpu/outlet3d.js';

/**
 * Ahmed-body run setup (M9 step 2): voxelized body + boundary flags + lattice parameters,
 * built CPU-side so the browser preset and the tests consume the identical scene.
 *
 * SPEC DEVIATION (documented, M9 Status): the milestone's suggested 512×192×160 grid with
 * the body spanning 250 cells (dx ≈ 4.2 mm) has a frontal blockage of (389·288 mm²) /
 * (806·672 mm²) ≈ 21% — the same spec requires ≤ 5%, and a cramped domain "systematically
 * raises Cd" (its own pitfall list). The two constraints cannot both hold at 15.7M cells,
 * so this builder keeps the PHYSICS constraints and lets resolution follow the budget:
 *   - fetch: ≥ 1 body length upstream of the nose, ≥ 2 downstream of the tail (spec);
 *   - blockage: frontal area / cross-section = `blockageCap` (default 5%) with equal
 *     physical margins above and beside the body;
 *   - dx = cbrt(domainVolume / maxCells) — at the default 15.7M budget this lands near
 *     dx ≈ 8.4 mm (body ≈ 124 cells long, height ≈ 34 cells), the honest trade the
 *     validation page must state (under-resolution inflates Cd; ±15% band, not ±5%).
 *
 * Reynolds number is set THROUGH τ, never guessed (M7 rule): Re_L = 4.29×10⁶ (Ahmed 1984,
 * U ≈ 60 m/s) ⇒ ν_lattice = u·L_cells/Re ⇒ τ₀ = 0.5 + 3ν — microscopically above the
 * floor, so LES (+ regularization) is mandatory, exactly as in the M7 Re=10⁴ case.
 *
 * Boundaries: inlet x=0, zero-gradient outlet x=nx−1, NO-SLIP ground y=0 (the experiment's
 * fixed floor — the ground row stays Solid across the inlet/outlet faces so the Outlet
 * never has a Solid upstream neighbor, H4 §10.9). The TOP AND SIDES are selectable, see
 * `lateralBC`. The body floats at the scaled 50 mm ground clearance; stilts omitted (see
 * geometry/ahmedBody.ts).
 */

/**
 * Top/side far-field closure (M9 force audit, phase 3).
 *
 * `'freestream'` — hard-Dirichlet `Inlet` cells on the top and both z faces, prescribing
 * equilibrium at u=(u_lattice, 0, 0). The component NORMAL to each of those faces is zero, so
 * it reads as a slip-like far field; this is what every Ahmed number on record was measured
 * with, and it stays the default so those runs remain reproducible.
 *
 * `'freeslip'` — H11 specular reflection, which is what the M9 specification actually calls
 * for. The distinction is not cosmetic. A hard-Dirichlet cell CLAMPS the flow to u_in and
 * supplies or absorbs whatever mass that takes, so it is an infinite reservoir: phase 2
 * measured a grid-independent ~1.3% inlet→outlet flux mismatch that global mass conservation
 * nevertheless absorbed, which is only possible because the lateral cells are sourcing it.
 * Specular reflection has zero normal flux by construction and exerts no tangential force, so
 * it confines the flow without either feeding it or dragging on it.
 *
 * No `'wall'` variant, unlike the sphere scenes (`sphere3d.ts` LateralBC): this domain already
 * has a no-slip surface — the ground — and a no-slip lid is not a far field anyone would run.
 */
export type AhmedLateralBC = 'freestream' | 'freeslip';

/**
 * The faces the `'freeslip'` scene reflects specularly — top and both sides, NEVER yMin.
 *
 * y=0 is the experiment's fixed no-slip floor and stays `Solid`. That asymmetry is the whole
 * physical point of the Ahmed case (the ground boundary layer and the underbody flow are
 * first-order contributors to its wake), and it is why this constant exists separately from
 * `SPHERE_FREESLIP_FACES`, which slips all four lateral faces because that scene has no ground.
 */
export const AHMED_FREESLIP_FACES = { yMax: true, zMin: true, zMax: true } as const;

/**
 * Inlet formulation on the x=0 face (M9 force audit, phase 3b).
 *
 * `'equilibrium'` — plain `CellType.Inlet`, emitting f^eq(ρ=1, u_in). What every Ahmed
 * number on record was measured with, so it stays the default. It is **not a velocity BC**
 * (H12 §1): only the populations it sends carry u_in, and a standing density discontinuity
 * at the interface absorbs any momentum mismatch.
 *
 * `'velocity'` — H12 `CellType.VelocityInlet`, emitting f^eq(ρ_up, u_in) at the +x neighbour's
 * previous post-collision density. Removing the interface density jump is what forces u → u_in.
 *
 * ## Why this option exists
 *
 * Phase 3 Stage A measured the two deviations from the M9 spec compensating for each other.
 * The spec asks for a "uniform velocity inlet" AND "free-slip top and sides"; the scene had
 * neither. With hard-Dirichlet lateral cells the equilibrium inlet looks fine — the approach
 * flow reaches 99% of commanded — because those cells clamp u = u_in throughout and mask it.
 * Switch the far field to the free-slip the spec asks for and the mask comes off: the flow
 * settles at 0.645·u_in and the box pressurizes to ρ ≈ 1.055, still climbing, exactly the
 * attractor H12 §1 documented at 0.660·u_in.
 *
 * So the lateral BC cannot be A/B'd honestly while the inlet is the equilibrium one — the two
 * arms would run at different effective Reynolds numbers. This option makes the inlet a
 * controlled variable so the 2×2 can separate them.
 *
 * **Selecting `'velocity'` does not make a run an acceptance run.** Which formulation the
 * acceptance configuration uses is a decision for docs/VALIDATION.md, informed by the
 * experiment, not by whichever arm produces a better Cd.
 */
export type AhmedInletBC = 'equilibrium' | 'velocity';

export interface AhmedSceneOptions extends AhmedBodyOptions {
  /** Cell budget the grid is fitted to. Default 15.7M (the M9 target tier). */
  maxCells?: number;
  /** Inlet lattice velocity. Default 0.05 (spec: u ≤ 0.05 for this case). */
  uLattice?: number;
  /** Frontal blockage target (frontal / cross-section). Default 0.05. */
  blockageCap?: number;
  /** Body lengths of clear fetch upstream of the nose / downstream of the tail. */
  upstreamL?: number;
  downstreamL?: number;
  /** Reynolds number on body length. Default 4.29e6 (SAE 840300). */
  Re?: number;
  /**
   * Build the tunnel WITHOUT the body — the empty-tunnel control (M9 force audit, phase 2).
   *
   * Everything else is unchanged, deliberately: the domain is still sized from the body's
   * dimensions, blockage cap and fetch rule, so this is the acceptance tunnel with the body
   * removed rather than a different, emptier box. That is the whole point — it isolates what
   * the BOUNDARIES and the τ₀ regime do from what the body does.
   *
   * `bodyVoxels` and `frontalCells` come out 0, so `blockage` is 0 and no Cd is defined. A
   * consumer must therefore NOT ask the solver for body force: `Lbm3D` refuses `forces: true`
   * with no `BodySolid` cell, and that invariant is left exactly as it is — the control simply
   * does not request a force it has no body to measure.
   */
  omitBody?: boolean;
  /**
   * Top/side far-field closure. Default `'freestream'` — see `AhmedLateralBC`.
   *
   * The default is deliberate and load-bearing: every Ahmed Cd on record was measured with the
   * hard-Dirichlet far field, and a silent switch would invalidate all of them at once. The
   * phase-3 A/B opts IN.
   */
  lateralBC?: AhmedLateralBC;
  /**
   * Inlet formulation on x=0. Default `'equilibrium'` — see `AhmedInletBC`. Like `lateralBC`,
   * the phase-3b experiment opts IN; the historical configuration is what you get by default.
   */
  inletBC?: AhmedInletBC;
  /**
   * Outlet formulation on x=nx−1. Default `'zero-gradient'` (H4) — every Ahmed number on
   * record, including every prior Cd, was measured with it, so it stays the default exactly
   * like `lateralBC`/`inletBC`. `'pressure'` opts into H14's D3Q19 fixed-density outlet
   * (`docs/handoff/H14-pressure-outlet.md`), validated so far only on the empty tunnel
   * (Gate 3, 2M cells) — this is what lets that validated outlet reach a body-present run at
   * all; it does not itself decide which configuration V11 accepts.
   */
  outlet?: Outlet3D;
}

export interface AhmedScene {
  nx: number;
  ny: number;
  nz: number;
  flags: Uint8Array;
  /** Meters per cell. */
  dx: number;
  /** Body length in cells (the Cd/convective-time reference length). */
  lengthCells: number;
  uLattice: number;
  nu: number;
  tau: number;
  omega: number;
  Re: number;
  les: boolean;
  /** One convective time L/u in steps. */
  convectiveTimeSteps: number;
  /** Solid cells of the voxelized body (staircase volume diagnostic). */
  bodyVoxels: number;
  /** Projected frontal solid columns (cells²) — the Cd normalization area (M9 pitfall). */
  frontalCells: number;
  /** frontalCells / interior cross-section — must respect blockageCap. */
  blockage: number;
  /** Nose x in cells (fetch diagnostic). */
  noseX: number;
  /**
   * The far field this scene was BUILT with. Consumers read the free-slip face set off this
   * (`AHMED_FREESLIP_FACES` when `'freeslip'`) rather than re-deriving it, so the solver's
   * `freeSlip` config and the flag array can never disagree — mirrors `Sphere3DScene.lateralBC`.
   */
  lateralBC: AhmedLateralBC;
  /**
   * The inlet formulation this scene was BUILT with. Consumers pass
   * `velocityInlet: scene.inletBC === 'velocity'` to the GPU solver from this, so the flag
   * array and the kernel variant cannot disagree. (The CPU solver needs no opt-in: it keys
   * off `CellType.VelocityInlet` in the flags directly.)
   */
  inletBC: AhmedInletBC;
  /**
   * The outlet formulation this scene was BUILT with. Consumers pass
   * `outlet: scene.outlet` to the solver from this — never a separately-typed literal — so a
   * scene built for H4 can never be silently run through H14 or vice versa.
   */
  outlet: Outlet3D;
  /** The body mesh in lattice coordinates (preview / GPU-voxelizer parity). */
  mesh: TriangleMesh;
}

const MM = 1e-3;

/**
 * The experiment's Reynolds number on body length (Ahmed et al. 1984, SAE 840300 — U ≈
 * 60 m/s over the 1044 mm body). Named because the acceptance verdict is only defined
 * here: Cd 0.285 is a measurement at this Re, so a run at any other Re is a diagnostic,
 * not an acceptance run.
 */
export const AHMED_EXPERIMENTAL_RE = 4.29e6;

export function ahmedScene(opts: AhmedSceneOptions = {}): AhmedScene {
  const maxCells = opts.maxCells ?? 15_700_000;
  const u = opts.uLattice ?? 0.05;
  const cap = opts.blockageCap ?? 0.05;
  const upstreamL = opts.upstreamL ?? 1;
  const downstreamL = opts.downstreamL ?? 2;
  const Re = opts.Re ?? AHMED_EXPERIMENTAL_RE;
  const clearance = (opts.groundClearance ?? AHMED.groundClearance) * MM;

  // Physical domain (meters). Cross-section: equal margins m beside and above the body,
  // sized so bbox-frontal/cross-section hits the cap: (W+2m)(C+H+m) = W·H/cap.
  const L = AHMED.length * MM;
  const W = AHMED.width * MM;
  const H = AHMED.height * MM;
  const topOfBody = clearance + H;
  const domX = (upstreamL + 1 + downstreamL) * L;
  // The blockage that matters is the VOXELIZED silhouette (the Cd area, M9 pitfall), which
  // the conservative staircase inflates by ~1.5 cells per dimension — significant at
  // budget-constrained dx. Solve margin/dx as a fixed point: cross-section from the
  // inflated frontal estimate, dx from the budget, re-estimate (converges in 2 passes).
  let dx = 0;
  let domY = 0;
  let domZ = 0;
  for (let pass = 0; pass < 3; pass++) {
    const frontal = (W + 1.5 * dx) * (H + 1.5 * dx);
    const targetCross = frontal / cap;
    // 2m² + (2·topOfBody + W)m + W·topOfBody − targetCross = 0
    const b = 2 * topOfBody + W;
    const margin = (-b + Math.sqrt(b * b + 8 * (targetCross - W * topOfBody))) / 4;
    domY = topOfBody + margin;
    domZ = W + 2 * margin;
    dx = Math.cbrt((domX * domY * domZ) / maxCells);
  }

  const nx = Math.round(domX / dx);
  const ny = Math.round(domY / dx);
  const nz = Math.round(domZ / dx);

  // Voxelize the body on a tight sub-grid (counts are domain-independent), then paste.
  const bodyMm = ahmedBody({ ...opts, groundClearance: 0 }); // clearance re-applied in cells
  const tightNx = Math.ceil(AHMED.length / (dx / MM)) + 3;
  const tightNy = Math.ceil(AHMED.height / (dx / MM)) + 3;
  const tightNz = Math.ceil(AHMED.width / (dx / MM)) + 3;
  const lattice = new Float32Array(bodyMm.positions.length);
  for (let i = 0; i < bodyMm.positions.length; i += 3) {
    lattice[i] = bodyMm.positions[i] / (dx / MM) + 1;
    lattice[i + 1] = bodyMm.positions[i + 1] / (dx / MM) + 1;
    lattice[i + 2] = (bodyMm.positions[i + 2] + AHMED.width / 2) / (dx / MM) + 1;
  }
  const tight = { nx: tightNx, ny: tightNy, nz: tightNz };
  const tightMask = voxelizeSolid(lattice, bodyMm.indices, tight);

  const flags = new Uint8Array(nx * ny * nz).fill(CellType.Fluid);
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const lateralBC = opts.lateralBC ?? 'freestream';
  const inletBC = opts.inletBC ?? 'equilibrium';
  const outlet = opts.outlet ?? 'zero-gradient';
  // Both branches share the same precedence, which is what keeps the two arms comparable:
  // lateral faces first, then the no-slip ground (it wins every shared edge — the experiment's
  // floor is not negotiable), then the inlet/outlet x faces for y ≥ 1 so the ground row stays
  // Solid on both of them and no Outlet ever reads a Solid upstream neighbor (H4 §10.9).
  const lateral = lateralBC === 'freeslip' ? CellType.FreeSlip : CellType.Inlet;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      flags[at(x, y, 0)] = lateral;
      flags[at(x, y, nz - 1)] = lateral;
    }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, ny - 1, z)] = lateral;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) flags[at(x, 0, z)] = CellType.Solid;
  for (let z = 0; z < nz; z++) for (let y = 1; y < ny; y++) flags[at(0, y, z)] = CellType.Inlet;
  if (inletBC === 'velocity') {
    // H12 §2: VelocityInlet only on the x=0 face, and only where the +x neighbour is Fluid.
    // The strict interior satisfies that (the body starts a full body length downstream);
    // the edge ring stays plain `Inlet`, exactly as `urbanBoundaryFlags` lays it out, because
    // those cells' +x neighbours are shell. y=0 stays Solid ground and is never overwritten.
    for (let z = 1; z < nz - 1; z++)
      for (let y = 1; y < ny - 1; y++) {
        if (flags[at(1, y, z)] !== CellType.Fluid) continue;
        flags[at(0, y, z)] = CellType.VelocityInlet;
      }
  }
  // The outlet must be STRICTLY INTERIOR on every arm: `validateEsotericPull3DFlags` (H4
  // §10.9 extended) rejects an Outlet on a domain edge/corner in y or z, because its
  // odd-parity snapshot reads crosswise populations that Esoteric-Pull's scatter never
  // writes there. `validateFreeSlip` (H11 §3.2) separately rejects an Outlet with a
  // FreeSlip upstream neighbor. Both land on the same fix: inset the outlet face one row
  // in y and z, exactly as sphereScene and caseAScene do, and leave the ring to whatever
  // the lateral BC would otherwise put there (FreeSlip, or Inlet for freestream/wall).
  // This ring is the only cell set that differs between the arms beyond the three lateral
  // faces themselves, and it is a consequence of scene legality, not a second variable.
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) flags[at(nx - 1, y, z)] = CellType.Outlet;
  if (lateralBC === 'freeslip') {
    // Throw at construction, like the body-touches-shell guard below: a scene whose FreeSlip
    // cells sit off a configured face, or whose outlet reads one, is ill-posed and must not
    // reach a solver. The solvers validate again on their own flags — this is the earlier,
    // cheaper failure, raised while the caller still knows which scene it asked for.
    validateFreeSlip(flags, nx, ny, nz, AHMED_FREESLIP_FACES);
  }

  // Paste the body: nose at upstreamL body lengths, clearance above the ground plane.
  const noseX = Math.round((upstreamL * L) / dx);
  const clearanceCells = Math.round(clearance / dx);
  const oz = Math.round((nz - tightNz) / 2);
  let bodyVoxels = 0;
  for (let z = 0; z < tightNz && !opts.omitBody; z++)
    for (let y = 0; y < tightNy; y++)
      for (let x = 0; x < tightNx; x++) {
        if (tightMask[x + tightNx * (y + tightNy * z)] !== CellType.Solid) continue;
        const gx = noseX + x - 1;
        const gy = clearanceCells + y - 1;
        const gz = oz + z;
        if (gx <= 0 || gx >= nx - 1 || gy <= 0 || gy >= ny - 1 || gz <= 0 || gz >= nz - 1) {
          throw new Error(`ahmedScene: body voxel (${gx},${gy},${gz}) touches the shell`);
        }
        // BodySolid, not Solid: the ground written above is Solid and spans the whole
        // domain footprint, so weighing every solid would report the floor's skin friction
        // as drag (measured at 74.6% of the total — see groundForceContamination.test.ts).
        flags[at(gx, gy, gz)] = CellType.BodySolid;
        bodyVoxels++;
      }

  // Frontal projection over interior columns (excludes the ground/shell rows). Counts the
  // BODY only — it is the Cd normalization area, so it must match what is being weighed.
  let frontalCells = 0;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        if (flags[at(x, y, z)] === CellType.BodySolid) {
          frontalCells++;
          break;
        }
      }
    }

  // Body mesh in DOMAIN lattice coordinates (tight cell x maps to noseX + x − 1).
  const domainMesh = new Float32Array(lattice.length);
  for (let i = 0; i < lattice.length; i += 3) {
    domainMesh[i] = lattice[i] + noseX - 1;
    domainMesh[i + 1] = lattice[i + 1] + clearanceCells - 1;
    domainMesh[i + 2] = lattice[i + 2] + oz;
  }

  const lengthCells = AHMED.length / (dx / MM);
  const nu = (u * lengthCells) / Re;
  const tau = 3 * nu + 0.5;
  return {
    nx,
    ny,
    nz,
    flags,
    dx,
    lengthCells,
    uLattice: u,
    nu,
    tau,
    omega: 1 / tau,
    Re,
    les: true,
    convectiveTimeSteps: Math.round(lengthCells / u),
    bodyVoxels,
    frontalCells,
    blockage: frontalCells / ((ny - 2) * (nz - 2)),
    noseX,
    lateralBC,
    inletBC,
    outlet,
    mesh: { positions: domainMesh, indices: bodyMm.indices },
  };
}
