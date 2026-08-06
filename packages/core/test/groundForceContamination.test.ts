import { describe, expect, it } from 'vitest';
import { ahmedScene, CellType, EsotericPull3D } from '../src/index.js';

/**
 * M9 acceptance-1 regression: the reported Ahmed drag must measure the *body*, not every
 * solid in the domain.
 *
 * The momentum-exchange force is accumulated by every fluid cell that bounces off a solid
 * neighbour. While the only 3D force scenes were M7's spheres that was harmless — their
 * far-field walls are `FreeSlip`, which is forceless — so nothing distinguished one solid
 * from another. The Ahmed scene is the first with a **no-slip ground**, and that ground is
 * solid across the whole domain footprint (H4 §10.9 keeps it solid across the inlet/outlet
 * faces too), which made it many times larger than the body.
 *
 * Measured before the fix, on this exact scene: **74.6% of the reported streamwise force
 * was the ground**, reported Cd 5.2008 against a body-only 1.3198. Every Ahmed Cd produced
 * before 2026-08-06 — including the 7.6 smoke reading — is that sum, not a drag.
 *
 * The fix tags the body `CellType.BodySolid`, the only flag that contributes force, which
 * is the 3D counterpart of the `forceMask` `scenes/cylinder2d.ts` already builds in 2D.
 * This test pins both halves: the tagging is correct, and it is load-bearing — the ground
 * still carries a force of its own that would come back the moment the tag is dropped.
 *
 * Re is kept low so τ sits well above the floor and the CPU run is stable; the accounting
 * question is independent of Re.
 */
describe('M9: the Ahmed drag accumulator weighs the body, not the ground', () => {
  it(
    'separates body drag from the no-slip ground that dominates the raw accumulator',
    { timeout: 300_000 },
    () => {
      const scene = ahmedScene({ maxCells: 60_000, Re: 1000 });
      const { nx, ny, nz, flags, uLattice } = scene;

      // The scene must tag the body and only the body: the ground is the y=0 layer and the
      // top/sides are FreeSlip, so BodySolid off the ground is exactly the body.
      let bodyCells = 0;
      let groundCells = 0;
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const i = (z * ny + y) * nx + x;
            if (flags[i] === CellType.BodySolid) {
              expect(y).toBeGreaterThan(0); // never tag the ground
              bodyCells++;
            } else if (flags[i] === CellType.Solid) {
              groundCells++;
            }
          }
        }
      }
      expect(bodyCells).toBe(scene.bodyVoxels);
      // The contamination this guards against is only interesting because the ground is the
      // larger surface — if that stopped being true the test would be proving nothing.
      expect(groundCells).toBeGreaterThan(bodyCells);

      const sim = new EsotericPull3D({
        nx,
        ny,
        nz,
        omega: scene.omega,
        flags,
        inletVelocity: uLattice,
        collision: 'trt',
        // The production runner's recipe (sim/ahmedWorker.ts buildSim): τ sits just above
        // the floor even at this reduced Re, so LES + H10 regularization carry stability,
        // and H13 is on for the same reason the long runs enable it.
        les: { cs: 0.1 },
        regularize: true,
        conserveMass: true,
        freeSlip: { yMax: true, zMin: true, zMax: true },
      });
      sim.reset(1, uLattice, 0, 0);

      // An impulsive start puts an acoustic/added-mass transient on both accumulators that
      // is larger than either steady value and can invert their signs, so the flow is
      // carried past it and the comparison is a mean over the last third — the same
      // transient-then-average discipline the acceptance runs use, in miniature.
      const T = scene.convectiveTimeSteps;
      const totalSteps = 15 * T;
      const averageFrom = 10 * T;
      let allSum = 0;
      let bodySum = 0;
      let samples = 0;
      for (let s = 1; s <= totalSteps; s++) {
        sim.step();
        if (s > averageFrom) {
          allSum += sim.force.x;
          bodySum += sim.maskedForce.x;
          samples++;
        }
      }
      const allSolids = allSum / samples;
      const bodyOnly = bodySum / samples;
      expect(Number.isFinite(allSolids)).toBe(true);
      expect(Number.isFinite(bodyOnly)).toBe(true);

      const norm = 0.5 * uLattice * uLattice * scene.frontalCells;
      console.log(
        `\nahmed ${nx}×${ny}×${nz} (${((nx * ny * nz) / 1e3).toFixed(0)}k cells)  ` +
          `body ${bodyCells} voxels vs ground ${groundCells} cells\n` +
          `  every solid (the old, wrong number) Fx=${allSolids.toExponential(4)}  →  Cd ${(allSolids / norm).toFixed(4)}\n` +
          `  body only (what is now reported)    Fx=${bodyOnly.toExponential(4)}  →  Cd ${(bodyOnly / norm).toFixed(4)}\n` +
          `  ground share of the raw accumulator: ${(((allSolids - bodyOnly) / allSolids) * 100).toFixed(1)}%\n`,
      );

      // Past the transient the body must actually be dragged downstream.
      expect(bodyOnly).toBeGreaterThan(0);

      // The tag is load-bearing: the ground still contributes a force of its own, so
      // dropping BodySolid would silently restore the contamination. Deliberately loose —
      // this pins a defect's absence, it is not a physics tolerance, and the share grows
      // with domain size and Re.
      const groundShare = (allSolids - bodyOnly) / allSolids;
      expect(groundShare).toBeGreaterThan(0.25);
    },
  );
});
