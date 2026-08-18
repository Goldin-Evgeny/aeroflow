import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { D3Q19 } from '../src/lattice3d.js';
import { D3Q19_SPEC, equilibrium3, makeCollideContext } from '../src/cpu/collide.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { reconstructPressureOutlet3D } from '../src/cpu/outlet3d.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { type FreeSlipFaces } from '../src/cpu/freeslip.js';
import {
  boundaryMassByClass3D,
  type BoundaryMassBudget,
} from '../src/analysis/boundaryMassBudget.js';

const NX = 10;
const NY = 8;
const NZ = 7;
const at = (x: number, y: number, z: number): number => x + NX * (y + NY * z);

function sceneFlags(withBody = true): Uint8Array {
  const flags = new Uint8Array(NX * NY * NZ);
  for (let z = 0; z < NZ; z++) {
    for (let x = 0; x < NX; x++) {
      flags[at(x, 0, z)] = CellType.Solid;
      flags[at(x, NY - 1, z)] = CellType.FreeSlip;
    }
  }
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      flags[at(x, y, 0)] = CellType.FreeSlip;
      flags[at(x, y, NZ - 1)] = CellType.FreeSlip;
    }
  }
  for (let z = 1; z < NZ - 1; z++) {
    for (let y = 1; y < NY - 1; y++) {
      flags[at(0, y, z)] = CellType.VelocityInlet;
      flags[at(NX - 1, y, z)] = CellType.Outlet;
    }
  }
  for (let z = 0; z < NZ; z++) flags[at(0, NY - 1, z)] = CellType.Inlet;
  for (let y = 1; y < NY; y++) {
    flags[at(0, y, 0)] = CellType.Inlet;
    flags[at(0, y, NZ - 1)] = CellType.Inlet;
  }
  if (withBody) {
    flags[at(4, 2, 3)] = CellType.BodySolid;
    flags[at(5, 3, 3)] = CellType.BodySolid;
  }
  return flags;
}

function solidSideEmptyTunnelFlags(): Uint8Array {
  const flags = new Uint8Array(NX * NY * NZ);
  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        if (y === 0 || y === NY - 1 || z === 0 || z === NZ - 1) {
          flags[at(x, y, z)] = CellType.Solid;
        } else if (x === 0) {
          flags[at(x, y, z)] = CellType.VelocityInlet;
        } else if (x === NX - 1) {
          flags[at(x, y, z)] = CellType.Outlet;
        }
      }
    }
  }
  return flags;
}

function fluidMass(populations: Float64Array, flags: Uint8Array): number {
  const n = flags.length;
  let mass = 0;
  for (let idx = 0; idx < n; idx++) {
    if (flags[idx] !== CellType.Fluid) continue;
    for (let i = 0; i < D3Q19.q; i++) mass += populations[i * n + idx];
  }
  return mass;
}

/** The gate-5 scalar. `boundaryMassByClass3D` accumulates `total` in the same loop and
 *  operation order the inlined version used, so the closure numbers are unchanged. */
function signedBoundaryMassSource(
  populations: Float64Array,
  flags: Uint8Array,
  freeSlip: FreeSlipFaces,
): number {
  return boundaryMassByClass3D(populations, flags, NX, NY, NZ, freeSlip).total;
}

const commonOptions = () => ({
  nx: NX,
  ny: NY,
  nz: NZ,
  omega: 1 / 0.7,
  flags: sceneFlags(),
  inletVelocity: 0.035,
  collision: 'trt' as const,
  conserveMass: true,
  freeSlip: { yMax: true, zMin: true, zMax: true },
});

describe('D3Q19 pressure outlet (H14)', () => {
  it('sets rho=1 while preserving velocity and the non-equilibrium residual', () => {
    const rho = 1.17;
    const velocity = [0.041, -0.006, 0.009] as const;
    const populations = Float64Array.from({ length: D3Q19.q }, (_, i) =>
      equilibrium3(D3Q19_SPEC, i, rho, ...velocity),
    );
    populations[0] -= 2e-4;
    populations[1] += 1e-4;
    populations[2] += 1e-4;
    const residual = Float64Array.from(
      populations,
      (fi, i) => fi - equilibrium3(D3Q19_SPEC, i, rho, ...velocity),
    );

    reconstructPressureOutlet3D(populations, makeCollideContext(D3Q19_SPEC, { tau: 0.7 }));

    let rhoOut = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let i = 0; i < D3Q19.q; i++) {
      rhoOut += populations[i];
      mx += D3Q19.ex[i] * populations[i];
      my += D3Q19.ey[i] * populations[i];
      mz += D3Q19.ez[i] * populations[i];
      expect(populations[i] - equilibrium3(D3Q19_SPEC, i, 1, ...velocity)).toBeCloseTo(
        residual[i],
        15,
      );
    }
    expect(rhoOut).toBeCloseTo(1, 15);
    expect(mx / rhoOut).toBeCloseTo(velocity[0], 15);
    expect(my / rhoOut).toBeCloseTo(velocity[1], 15);
    expect(mz / rhoOut).toBeCloseTo(velocity[2], 15);
  });

  it('keeps omitted outlet mode bit-identical to explicit zero-gradient', () => {
    const options = commonOptions();
    const naiveDefault = new Solver3D(options);
    const naiveExplicit = new Solver3D({ ...options, outlet: 'zero-gradient' });
    const esotericDefault = new EsotericPull3D(options);
    const esotericExplicit = new EsotericPull3D({ ...options, outlet: 'zero-gradient' });

    naiveDefault.step(9);
    naiveExplicit.step(9);
    esotericDefault.step(9);
    esotericExplicit.step(9);

    expect(naiveDefault.snapshotPostCollision()).toEqual(naiveExplicit.snapshotPostCollision());
    expect(esotericDefault.snapshotCanonical()).toEqual(esotericExplicit.snapshotCanonical());
  });

  it('is Float64-exact between naive and Esoteric paths at both parities', () => {
    const options = { ...commonOptions(), outlet: 'pressure' as const };
    const naive = new Solver3D(options);
    const esoteric = new EsotericPull3D(options);
    const fluid = Array.from(options.flags).flatMap((flag, idx) =>
      flag === CellType.Fluid ? [idx] : [],
    );
    const n = NX * NY * NZ;

    // Scan first, assert once per step. Asserting per element is 100·238·19 ≈ 4.5e5 `expect`
    // calls, each building a template message: ~3 s alone, over the 5 s default timeout once
    // the suite runs files in parallel, and enough reporter traffic to trip vitest's
    // `onTaskUpdate` RPC (which it warns can produce false positives). `Object.is` is exactly
    // what `toBe` uses for primitives, so the comparison is bit-identical to before — only
    // the reporting is deferred to the first mismatch.
    for (let step = 1; step <= 100; step++) {
      naive.step();
      esoteric.step();
      const expected = naive.snapshotPostCollision();
      const actual = esoteric.snapshotCanonical();
      let mismatch = '';
      outer: for (const idx of fluid) {
        for (let i = 0; i < D3Q19.q; i++) {
          const k = i * n + idx;
          if (!Object.is(actual[k], expected[k])) {
            mismatch = `step ${step}, direction ${i}, cell ${idx}: ${actual[k]} !== ${expected[k]}`;
            break outer;
          }
        }
      }
      expect(mismatch, mismatch).toBe('');
    }
  });

  it(
    'anchors density from both sides of rho=1 and closes the signed boundary-mass ledger',
    // Timeout convention: abl-fetch.test.ts. Worst 2.737 s (20-worker load, 2026-08-17 UTC);
    // ceil5(max(3*2.737, 2.737+30)) = 35 s.
    { timeout: 35_000 },
    () => {
      const finalMeans: number[] = [];
      for (const initialRho of [0.9, 1.1]) {
        const flags = solidSideEmptyTunnelFlags();
        const solver = new Solver3D({
          ...commonOptions(),
          flags,
          freeSlip: {},
          outlet: 'pressure',
        });
        solver.reset(initialRho);
        const initialMass = fluidMass(solver.snapshotPostCollision(), flags);
        let cumulativeFlux = 0;
        let meanAt1500 = Number.NaN;
        let finalMass = initialMass;

        for (let step = 1; step <= 2000; step++) {
          const before = solver.snapshotPostCollision();
          cumulativeFlux += signedBoundaryMassSource(before, flags, {});
          solver.step();
          finalMass = fluidMass(solver.snapshotPostCollision(), flags);
          if (step === 1500) meanAt1500 = finalMass / (initialMass / initialRho);
        }

        const fluidCells = initialMass / initialRho;
        const finalMean = finalMass / fluidCells;
        finalMeans.push(finalMean);
        const closureError = finalMass - initialMass - cumulativeFlux;
        expect(
          Math.abs(closureError),
          `rho0=${initialRho}, deltaM=${finalMass - initialMass}, ` +
            `cumulativeFlux=${cumulativeFlux}, closure=${closureError}`,
        ).toBeLessThan(1e-10 * fluidCells);
        expect(
          Math.abs(finalMean - meanAt1500),
          `rho0=${initialRho}, tail means ${meanAt1500} -> ${finalMean}`,
        ).toBeLessThan(1e-8);
      }
      expect(Math.abs(finalMeans[0] - finalMeans[1])).toBeLessThan(1e-8);
    },
  );

  it('closes the complete boundary ledger with H11 free-slip intersections', () => {
    const options = { ...commonOptions(), outlet: 'pressure' as const };
    const solver = new Solver3D(options);
    const initialMass = fluidMass(solver.snapshotPostCollision(), options.flags);
    let cumulativeFlux = 0;
    for (let step = 0; step < 100; step++) {
      cumulativeFlux += signedBoundaryMassSource(
        solver.snapshotPostCollision(),
        options.flags,
        options.freeSlip,
      );
      solver.step();
    }
    const finalMass = fluidMass(solver.snapshotPostCollision(), options.flags);
    expect(Math.abs(finalMass - initialMass - cumulativeFlux)).toBeLessThan(1e-10);
  });

  /**
   * The reconstruction imposes Σf = 1 on the value it WRITES. This checks the value that
   * survives a full timestep, which is what actually streams into the fluid on the next one.
   *
   * Only the naive solver is inspected: `EsotericPull3D.snapshotCanonical()` skips non-Fluid
   * cells, so the outlet slot is not observable through it. That is not a coverage gap — the
   * outlet cell's only effect on the simulation is the populations it sends into the fluid,
   * and the 100-step bit-identity case above would diverge immediately if Esoteric's outlet
   * carried anything different.
   */
  it('holds outlet rho at 1 after a full timestep, not just at reconstruction', () => {
    const options = { ...commonOptions(), outlet: 'pressure' as const };
    const solver = new Solver3D(options);
    const n = NX * NY * NZ;
    const outlets = Array.from(options.flags).flatMap((flag, idx) =>
      flag === CellType.Outlet ? [idx] : [],
    );
    expect(outlets.length).toBeGreaterThan(0);

    for (let step = 1; step <= 20; step++) {
      solver.step();
      const f = solver.snapshotPostCollision();
      for (const idx of outlets) {
        let rho = 0;
        for (let i = 0; i < D3Q19.q; i++) rho += f[i * n + idx];
        expect(rho, `step ${step}, outlet cell ${idx}`).toBeCloseTo(1, 12);
      }
    }
  });

  /**
   * E0 (M9 phase 3c): WHERE does the residual empty-tunnel mass come from?
   *
   * Stage A left H14 with a positive post-startup fluid-mass slope on the 250k GPU tunnel.
   * The ledger closed, but closure is an accounting result — it proves the mass arrived
   * through the boundary, not that any boundary is misbehaving. This case runs the same
   * boundary combination in Float64 and splits the ledger by class, so a signed contribution
   * can be attributed rather than inferred.
   *
   * The prime suspect it is built to decide is H11 free-slip: specular reflection is a link
   * bijection in the interior of a flat face, but not necessarily where the face ends. That
   * is a LOCAL, grid-independent property of the redirect map, which is why a 10×8×7 scene
   * can settle it even though it is far too small to reproduce the tunnel's duct pressure
   * drop. What this scene cannot decide is the magnitude of any inlet/outlet convective
   * imbalance, which is a global, geometry-dependent quantity.
   *
   * Reported, not gated: only ledger closure and finiteness are asserted, per H14 §4 gate 4's
   * refusal to invent new tolerances.
   */
  it.each([
    { outlet: 'pressure' as const, initialRho: 1 },
    { outlet: 'pressure' as const, initialRho: 1.05 },
    { outlet: 'zero-gradient' as const, initialRho: 1 },
  ])(
    'decomposes the free-slip empty-tunnel boundary budget ($outlet, rho0=$initialRho)',
    // Timeout convention: abl-fetch.test.ts. Worst 4.459 s (20-worker load, 2026-08-17 UTC);
    // ceil5(max(3*4.459, 4.459+30)) = 35 s.
    { timeout: 35_000 },
    ({ outlet, initialRho }) => {
      const flags = sceneFlags(false);
      const freeSlip: FreeSlipFaces = { yMax: true, zMin: true, zMax: true };
      // Tunnel-matched physics: the acceptance-tier tau0, LES and regularization are the M9
      // empty-tunnel settings, so a source that only appears near tau -> 1/2 is not excluded.
      const solver = new Solver3D({
        nx: NX,
        ny: NY,
        nz: NZ,
        omega: 1 / 0.5000005,
        flags,
        inletVelocity: 0.05,
        collision: 'trt',
        les: { cs: 0.1 },
        regularize: true,
        conserveMass: true,
        outlet,
        freeSlip,
      });
      solver.reset(initialRho);

      const STEPS = 6000;
      const SAMPLE = 500;
      const cumulative: BoundaryMassBudget = {
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
      const keys = Object.keys(cumulative) as Array<keyof BoundaryMassBudget>;
      const initialMass = fluidMass(solver.snapshotPostCollision(), flags);
      const fluidCells = Array.from(flags).filter((f) => f === CellType.Fluid).length;
      const history: string[] = [];
      const means: Array<{ step: number; rhoMean: number }> = [];

      for (let step = 1; step <= STEPS; step++) {
        const before = solver.snapshotPostCollision();
        const budget = boundaryMassByClass3D(before, flags, NX, NY, NZ, freeSlip);
        for (const k of keys) cumulative[k] += budget[k];
        solver.step();
        if (step % SAMPLE === 0) {
          const rhoMean = fluidMass(solver.snapshotPostCollision(), flags) / fluidCells;
          means.push({ step, rhoMean });
          history.push(
            `  step ${String(step).padStart(5)}  rhoMean=${rhoMean.toFixed(9)}  ` +
              keys
                .filter((k) => k !== 'total' && cumulative[k] !== 0)
                .map((k) => `${k}=${cumulative[k].toExponential(3)}`)
                .join(' '),
          );
        }
      }

      const finalPopulations = solver.snapshotPostCollision();
      const finalMass = fluidMass(finalPopulations, flags);
      // Late-time stationarity as a RATE, not a decay-to-zero ratio: this configuration's
      // stable state may carry a finite density offset, so "settled" means the level stops
      // changing, not that it returns to 1 (H14 §8, M9 phase 3c).
      const tail = means.slice(-4);
      const lateSlope =
        (tail[tail.length - 1].rhoMean - tail[0].rhoMean) /
        (tail[tail.length - 1].step - tail[0].step);
      console.log(
        `\nE0 free-slip empty tunnel [${outlet}, rho0=${initialRho}] ` +
          `(${NX}x${NY}x${NZ}, tau0=0.5000005)\n` +
          history.join('\n') +
          `\n  deltaM=${(finalMass - initialMass).toExponential(4)} ` +
          `ledgerTotal=${cumulative.total.toExponential(4)} ` +
          `closure=${(finalMass - initialMass - cumulative.total).toExponential(3)}\n` +
          `  freeSlip total=${(
            cumulative.freeSlipFace +
            cumulative.freeSlipEdge +
            cumulative.freeSlipInletRing +
            cumulative.freeSlipOutletRing
          ).toExponential(4)}` +
          `  late drho/dstep=${lateSlope.toExponential(3)}\n`,
      );

      expect(finalPopulations.every((v) => Number.isFinite(v))).toBe(true);
      expect(
        Math.abs(finalMass - initialMass - cumulative.total),
        `deltaM=${finalMass - initialMass}, ledger=${cumulative.total}`,
      ).toBeLessThan(1e-10 * fluidCells);
      // Three of the four free-slip classes are provably mass-neutral, so they are gated at
      // Float64 roundoff rather than merely reported:
      //  - a flat face's reflection is a bijection onto the face's own outgoing set;
      //  - a slip∩slip edge resolves in two mirrors back onto the pulling cell's OWN opposite
      //    population, an exact involution, so each link contributes identically zero;
      //  - a slip∩solid intersection falls back to plain bounce-back, incoming = outgoing.
      // `freeSlipOutletRing` is deliberately NOT gated: it is a genuine transport path, since
      // the ring redirects into the outlet plane, and it carries real outflow in both outlet
      // modes. A bound there would be inventing a tolerance for legitimate flux.
      const structurallyNeutral =
        cumulative.freeSlipFace + cumulative.freeSlipEdge + cumulative.freeSlipInletRing;
      expect(
        Math.abs(structurallyNeutral),
        `face=${cumulative.freeSlipFace} edge=${cumulative.freeSlipEdge} ` +
          `inletRing=${cumulative.freeSlipInletRing}`,
      ).toBeLessThan(1e-12);
    },
  );
});
