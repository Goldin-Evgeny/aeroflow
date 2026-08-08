import { describe, expect, it } from 'vitest';
import { CellType, isSolid } from '../src/lattice.js';
import { D3Q19 } from '../src/lattice3d.js';
import { D3Q19_SPEC, equilibrium3, makeCollideContext } from '../src/cpu/collide.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { reconstructPressureOutlet3D } from '../src/cpu/outlet3d.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { resolveFreeSlipPull, type FreeSlipFaces } from '../src/cpu/freeslip.js';

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

function signedBoundaryMassSource(
  populations: Float64Array,
  flags: Uint8Array,
  freeSlip: FreeSlipFaces,
): number {
  const n = flags.length;
  let flux = 0;
  for (let z = 1; z < NZ - 1; z++) {
    for (let y = 1; y < NY - 1; y++) {
      for (let x = 1; x < NX - 1; x++) {
        const idx = at(x, y, z);
        if (flags[idx] !== CellType.Fluid) continue;
        for (let i = 0; i < D3Q19.q; i++) {
          const sx = x - D3Q19.ex[i];
          const sy = y - D3Q19.ey[i];
          const sz = z - D3Q19.ez[i];
          const source = at(sx, sy, sz);
          if (flags[source] === CellType.Fluid) continue;

          const outgoing = populations[D3Q19.opp[i] * n + idx];
          let incoming = populations[i * n + source];
          if (isSolid(flags[source])) {
            incoming = outgoing;
          } else if (flags[source] === CellType.FreeSlip) {
            const redirect = resolveFreeSlipPull(flags, NX, NY, NZ, freeSlip, sx, sy, sz, i);
            incoming = redirect.fallback
              ? outgoing
              : populations[redirect.dir * n + at(redirect.sx, redirect.sy, redirect.sz)];
          }
          flux += incoming - outgoing;
        }
      }
    }
  }
  return flux;
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
    { timeout: 30_000 },
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
});
