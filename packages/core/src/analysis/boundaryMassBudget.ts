import { CellType, isSolid } from '../lattice.js';
import { D3Q19 } from '../lattice3d.js';
import { resolveFreeSlipPull, type FreeSlipFaces } from '../cpu/freeslip.js';

/**
 * The signed fluid-mass ledger of every boundary link, decomposed by boundary class.
 *
 * ## What this measures
 *
 * For each Fluid cell and each direction `i` whose pull SOURCE is not Fluid, one step
 * transports `incoming − outgoing` units of mass into the fluid domain, where `outgoing`
 * is the canonical population the fluid cell would have sent along `opp(i)` and `incoming`
 * is whatever the boundary rule puts back. Summed over every such link and accumulated over
 * time, this is exactly `ΔM` over `CellType.Fluid` cells — that is the H14 §4 gate-5
 * closure, and `total` here is the quantity that gate checks.
 *
 * ## Why the decomposition exists
 *
 * Closure alone is an ACCOUNTING result. This function and the solver apply the same
 * boundary transformation, so agreement is guaranteed by construction whenever the two are
 * consistent; it establishes that the mass change is entirely boundary-transported (ruling
 * out interior collision roundoff and H13) but says nothing about whether any individual
 * boundary is behaving. Attributing a residual needs the sum split by WHICH boundary
 * supplied it, which is what the per-class fields are for.
 *
 * The free-slip class is split on geometry rather than flag, because the argument that it is
 * mass-neutral only holds where the reflection is a bijection. Specular reflection sends the
 * pair `(fluid cell, incoming direction)` to `(mirrored cell, reflected direction)`; summed
 * over the interior of a flat face that map is onto the face's own outgoing set and the total
 * telescopes to exactly zero. It stops being onto wherever the face ENDS: a tangential
 * redirect from a diagonal direction steps one cell along the face, so at a slip∩slip or
 * slip∩solid intersection, and at the inlet and outlet planes that terminate the face in x,
 * the image can land outside the fluid layer. Those are the cells that can carry a genuine
 * source, and they are a small minority — pooled into one free-slip total they would be
 * averaged away by the flat-face population, so they are counted apart.
 *
 * Read `freeSlipFace + freeSlipEdge + freeSlipInletRing + freeSlipOutletRing` first: if that
 * total is at roundoff, free-slip is neutral and no geometric reading is needed. The split
 * only matters once the total is not.
 *
 * Float64 and allocation-free per call; the caller accumulates across steps.
 */
export interface BoundaryMassBudget {
  /** H12 `VelocityInlet` cells — equilibrium at the prescribed u and the upstream ρ. */
  velocityInlet: number;
  /** Plain `Inlet` cells: the x=0 edge ring H12 §2 leaves alone, and freestream laterals. */
  inlet: number;
  /** `Outlet` cells — H4 zero-gradient copy or the H14 fixed-density reconstruction. */
  outlet: number;
  /** `Solid`/`BodySolid` bounce-back. Exactly zero by construction (incoming = outgoing). */
  solid: number;
  /** FreeSlip sources in the interior of ONE face — where the flat-face bijection holds. */
  freeSlipFace: number;
  /** FreeSlip sources on a face intersection (slip∩slip or slip∩solid edges and corners). */
  freeSlipEdge: number;
  /** FreeSlip sources on the inlet plane (x=0), where a tangential redirect can leave the face. */
  freeSlipInletRing: number;
  /** FreeSlip sources on the outlet plane's slip-adjacent ring (H11 §3.2). */
  freeSlipOutletRing: number;
  /** Sum of the classes above — the H14 §4 gate-5 quantity. */
  total: number;
}

const { q, ex, ey, ez, opp } = D3Q19;

/**
 * @param populations post-collision DDFs, `[i * n + idx]` layout (`snapshotPostCollision()`).
 * @param freeSlip    the SAME face set the solver was constructed with — a mismatch makes
 *                    the redirect resolve differently from the one the solver applied and
 *                    the ledger stops closing.
 */
export function boundaryMassByClass3D(
  populations: Float64Array,
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  freeSlip: FreeSlipFaces,
): BoundaryMassBudget {
  const n = nx * ny * nz;
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const budget: BoundaryMassBudget = {
    velocityInlet: 0,
    inlet: 0,
    outlet: 0,
    solid: 0,
    freeSlipFace: 0,
    freeSlipEdge: 0,
    freeSlipInletRing: 0,
    freeSlipOutletRing: 0,
    total: 0,
  };

  // Fluid cells are interior by the shell precondition both solvers validate, so no pull
  // source is ever out of bounds and no bounds test is needed inside the direction loop.
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const idx = at(x, y, z);
        if (flags[idx] !== CellType.Fluid) continue;
        for (let i = 0; i < q; i++) {
          const sx = x - ex[i];
          const sy = y - ey[i];
          const sz = z - ez[i];
          const source = at(sx, sy, sz);
          const sourceFlag = flags[source];
          if (sourceFlag === CellType.Fluid) continue;

          const outgoing = populations[opp[i] * n + idx];
          let incoming = populations[i * n + source];
          if (isSolid(sourceFlag)) {
            incoming = outgoing;
          } else if (sourceFlag === CellType.FreeSlip) {
            const redirect = resolveFreeSlipPull(flags, nx, ny, nz, freeSlip, sx, sy, sz, i);
            incoming = redirect.fallback
              ? outgoing
              : populations[redirect.dir * n + at(redirect.sx, redirect.sy, redirect.sz)];
          }
          const contribution = incoming - outgoing;
          budget.total += contribution;

          switch (sourceFlag) {
            case CellType.VelocityInlet:
              budget.velocityInlet += contribution;
              break;
            case CellType.Inlet:
              budget.inlet += contribution;
              break;
            case CellType.Outlet:
              budget.outlet += contribution;
              break;
            case CellType.FreeSlip: {
              // The x ends terminate every y/z face, so they are tested first: a cell there
              // is on the ring regardless of how many slip faces it also touches. Then a
              // y/z face intersection. What is left is the flat-face interior.
              const faces =
                (sy === 0 ? 1 : 0) +
                (sy === ny - 1 ? 1 : 0) +
                (sz === 0 ? 1 : 0) +
                (sz === nz - 1 ? 1 : 0);
              if (sx === 0) budget.freeSlipInletRing += contribution;
              else if (sx === nx - 1) budget.freeSlipOutletRing += contribution;
              else if (faces > 1) budget.freeSlipEdge += contribution;
              else budget.freeSlipFace += contribution;
              break;
            }
            default:
              budget.solid += contribution;
              break;
          }
        }
      }
    }
  }
  return budget;
}
