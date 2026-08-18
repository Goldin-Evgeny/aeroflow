import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { type FreeSlipFaces } from '../src/cpu/freeslip.js';
import {
  boundaryInfluenceDistance,
  freestreamEddyViscosity,
  wallBoundedAnalyticZero,
} from '../src/analysis/freestreamEddyViscosity.js';
import {
  periodicOraclePerturbedControl,
  periodicUniformFlowOracle,
} from '../src/analysis/periodicFreestreamOracle.js';

/**
 * near-floor-collision-diagnostics: subgrid activity is measurable against an analytic zero.
 *
 * Task 3.4 is deliberately first — the instrument is validated against a field whose answer is
 * known before it is used to measure a field whose answer is not. A probe that reports a
 * plausible-looking artifact on a manufactured zero would have manufactured the finding.
 */

const TAU0 = 0.5000005;

describe('freestream eddy-viscosity probe — instrument validation (task 3.4)', () => {
  /**
   * A manufactured uniform flow: zero strain everywhere, so τ_eff = τ₀ in every cell and the
   * correct ν_t/ν_mol is exactly zero. This is not a solver run — it is the probe fed a field
   * whose eddy viscosity is zero by construction.
   */
  it('reports exactly zero on a manufactured zero-strain field', () => {
    const nx = 12;
    const ny = 10;
    const nz = 9;
    const n = nx * ny * nz;
    const tauEff = new Float64Array(n).fill(TAU0);
    const evaluated = new Uint8Array(n);
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) evaluated[x + nx * (y + ny * z)] = 1;
      }
    }

    const probe = freestreamEddyViscosity({
      nx,
      ny,
      nz,
      tauEff,
      evaluated,
      tau0: TAU0,
      exclusionDistance: 2,
    });

    expect(probe.survivingCells).toBeGreaterThan(0);
    expect(probe.invalidCells).toBe(0);
    expect(probe.ratio.max).toBe(0);
    expect(probe.ratio.mean).toBe(0);
    expect(probe.fractionAboveMolecular).toBe(0);
  });

  /** A single seeded cell must show up at exactly its analytic ratio and nowhere else. */
  it('recovers a known non-zero ratio from a single seeded cell', () => {
    const nx = 12;
    const ny = 10;
    const nz = 9;
    const n = nx * ny * nz;
    const nuMol = (TAU0 - 0.5) / 3;
    const targetRatio = 42;
    const tauEff = new Float64Array(n).fill(TAU0);
    const evaluated = new Uint8Array(n);
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) evaluated[x + nx * (y + ny * z)] = 1;
      }
    }
    const seeded = 5 + nx * (5 + ny * 4);
    tauEff[seeded] = TAU0 + 3 * targetRatio * nuMol;

    const probe = freestreamEddyViscosity({
      nx,
      ny,
      nz,
      tauEff,
      evaluated,
      tau0: TAU0,
      exclusionDistance: 2,
    });

    expect(probe.ratio.max).toBeCloseTo(targetRatio, 6);
    expect(probe.ratio.p50).toBe(0);
    expect(probe.fractionAboveMolecular).toBeCloseTo(1 / probe.survivingCells, 12);
  });

  /** Task 3.2/D3: cells near a face carry real strain and must not be counted as artifact. */
  it('excludes cells within the exclusion distance and reports the excluded count', () => {
    const nx = 12;
    const ny = 10;
    const nz = 9;
    const n = nx * ny * nz;
    const tauEff = new Float64Array(n).fill(TAU0);
    const evaluated = new Uint8Array(n);
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) evaluated[x + nx * (y + ny * z)] = 1;
      }
    }
    // A large artifact planted at distance 1 — inside the shell, outside the selection.
    tauEff[1 + nx * (1 + ny * 1)] = TAU0 + 1;

    const tight = freestreamEddyViscosity({
      nx,
      ny,
      nz,
      tauEff,
      evaluated,
      tau0: TAU0,
      exclusionDistance: 1,
    });
    const wide = freestreamEddyViscosity({
      nx,
      ny,
      nz,
      tauEff,
      evaluated,
      tau0: TAU0,
      exclusionDistance: 2,
    });

    expect(tight.ratio.max).toBeGreaterThan(0); // distance-1 cell is inside a distance-1 selection
    expect(wide.ratio.max).toBe(0); // and outside a distance-2 one
    expect(wide.excludedByBoundaryDistance).toBeGreaterThan(tight.excludedByBoundaryDistance);
    expect(wide.survivingCells + wide.excludedByBoundaryDistance + wide.invalidCells).toBe(
      wide.evaluatedCells,
    );
  });

  /** Task 3.3: an empty selection is a harness error, never "zero artifact measured". */
  it('throws rather than reporting zero when nothing survives selection', () => {
    const nx = 5;
    const ny = 5;
    const nz = 5;
    const n = nx * ny * nz;
    const evaluated = new Uint8Array(n);
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) evaluated[x + nx * (y + ny * z)] = 1;
      }
    }
    expect(() =>
      freestreamEddyViscosity({
        nx,
        ny,
        nz,
        tauEff: new Float64Array(n).fill(TAU0),
        evaluated,
        tau0: TAU0,
        exclusionDistance: 3,
      }),
    ).toThrow(/no cells survived selection/);
  });
});

describe('fully periodic dynamic analytic-zero oracle', () => {
  for (const lesNorm of ['legacy', 'spec'] as const) {
    it(`selects every cell and preserves uniform flow under the ${lesNorm} convention`, () => {
      const oracle = periodicUniformFlowOracle({ lesNorm, size: 6, steps: 64 });
      expect(oracle.precision).toBe('float64-cpu');
      expect(oracle.analyticStrain).toBe(0);
      expect(oracle.selectedCells).toBe(6 ** 3);
      expect(oracle.subgridActivity.selection).toBe('fully-periodic');
      expect(oracle.subgridActivity.excludedByBoundaryDistance).toBe(0);
      expect(oracle.subgridActivity.invalidCells).toBe(0);
      expect(oracle.maximumVelocityDeviation).toBeLessThan(1e-12);
      expect(oracle.subgridActivity.ratio.max).toBeLessThan(1e-8);
    });
  }

  it('responds to a seeded periodic-field perturbation through the identical selector', () => {
    const control = periodicOraclePerturbedControl({ size: 6, targetRatio: 42 });
    expect(control.selection).toBe('fully-periodic');
    expect(control.survivingCells).toBe(6 ** 3);
    expect(control.ratio.max).toBeCloseTo(42, 6);
    expect(control.fractionAboveMolecular).toBeCloseTo(1 / 6 ** 3, 12);
  });
});

describe('time-valid wall-bounded analytic-zero selection', () => {
  it('measures boundary influence from resolved strain and records it over time', () => {
    const nx = 9;
    const ny = 9;
    const nz = 9;
    const n = nx * ny * nz;
    const evaluated = new Uint8Array(n).fill(1);
    const ux = new Float64Array(n);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) ux[1 + nx * (y + ny * z)] = 0.1;
    }
    const observation = boundaryInfluenceDistance({
      nx,
      ny,
      nz,
      evaluated,
      ux,
      uy: new Float64Array(n),
      uz: new Float64Array(n),
      step: 100,
      strainTolerance: 1e-12,
    });
    expect(observation).toMatchObject({ step: 100, strainTolerance: 1e-12 });
    expect(observation.influencedCells).toBeGreaterThan(0);
    expect(observation.distance).toBeGreaterThanOrEqual(2);
  });

  it('uses the largest influence distance in the selected window', () => {
    const size = 7;
    const n = size ** 3;
    const result = wallBoundedAnalyticZero({
      nx: size,
      ny: size,
      nz: size,
      tauEff: new Float64Array(n).fill(TAU0),
      evaluated: new Uint8Array(n).fill(1),
      tau0: TAU0,
      window: { startStep: 100, endStep: 200 },
      boundaryInfluence: [
        { step: 50, distance: 5, influencedCells: 1, strainTolerance: 0 },
        { step: 100, distance: 2, influencedCells: 10, strainTolerance: 0 },
        { step: 150, distance: 3, influencedCells: 20, strainTolerance: 0 },
      ],
    });
    expect(result.state).toBe('available');
    expect(result.largestSupportedDistance).toBe(3);
    if (result.state === 'available') {
      expect(result.measurement.exclusionDistance).toBe(3);
      expect(result.measurement.survivingCells).toBe(1);
    }
  });

  it('returns unavailable and retains the raw sample as boundary-contaminated diagnostics', () => {
    const size = 5;
    const n = size ** 3;
    const tauEff = new Float64Array(n).fill(TAU0);
    const nuMol = (TAU0 - 0.5) / 3;
    tauEff[2 + size * (2 + size * 2)] = TAU0 + 3 * 42 * nuMol;
    const result = wallBoundedAnalyticZero({
      nx: size,
      ny: size,
      nz: size,
      tauEff,
      evaluated: new Uint8Array(n).fill(1),
      tau0: TAU0,
      window: { startStep: 0, endStep: 20_000 },
      boundaryInfluence: [
        { step: 0, distance: 1, influencedCells: 0, strainTolerance: 0 },
        { step: 20_000, distance: 3, influencedCells: 125, strainTolerance: 0 },
      ],
    });
    expect(result.state).toBe('unavailable');
    if (result.state === 'unavailable') {
      expect(result.reason).toBe('no-cells-outside-boundary-influence');
      expect(result.boundaryContaminated.ratio.max).toBeCloseTo(42, 6);
      expect(result.boundaryContaminated.survivingCells).toBe(3 ** 3);
    }
  });
});

const at = (nx: number, ny: number, x: number, y: number, z: number): number =>
  x + nx * (y + ny * z);

/**
 * Task 3.5 — size the probe scene so a freestream interior actually survives exclusion. The
 * ledger scene of `pressureOutlet3d.test.ts` is 10×8×7, which after a distance-2 exclusion has
 * no interior at all in y and z. D3's risk register calls for sizing the probe scene
 * independently of the ledger scene, and this is that sizing, confirmed rather than assumed.
 */
export const PROBE_SCENE = { nx: 24, ny: 16, nz: 14 } as const;
export const PROBE_EXCLUSION = 3;

export function probeTunnelFlags(): Uint8Array {
  const { nx, ny, nz } = PROBE_SCENE;
  const flags = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      flags[at(nx, ny, x, 0, z)] = CellType.Solid; // ground
      flags[at(nx, ny, x, ny - 1, z)] = CellType.FreeSlip;
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      flags[at(nx, ny, x, y, 0)] = CellType.FreeSlip;
      flags[at(nx, ny, x, y, nz - 1)] = CellType.FreeSlip;
    }
  }
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      flags[at(nx, ny, 0, y, z)] = CellType.VelocityInlet;
      flags[at(nx, ny, nx - 1, y, z)] = CellType.Outlet;
    }
  }
  for (let z = 0; z < nz; z++) flags[at(nx, ny, 0, ny - 1, z)] = CellType.Inlet;
  for (let y = 1; y < ny; y++) {
    flags[at(nx, ny, 0, y, 0)] = CellType.Inlet;
    flags[at(nx, ny, 0, y, nz - 1)] = CellType.Inlet;
  }
  return flags;
}

export const PROBE_FREE_SLIP: FreeSlipFaces = { yMax: true, zMin: true, zMax: true };

describe('freestream eddy-viscosity probe — scene sizing (task 3.5)', () => {
  it('leaves a non-trivial freestream interior on the probe tunnel', () => {
    const { nx, ny, nz } = PROBE_SCENE;
    const flags = probeTunnelFlags();
    const solver = new Solver3D({
      nx,
      ny,
      nz,
      omega: 1 / TAU0,
      flags,
      inletVelocity: 0.05,
      collision: 'trt',
      les: { cs: 0.1 },
      regularize: true,
      conserveMass: true,
      outlet: 'pressure',
      freeSlip: PROBE_FREE_SLIP,
    });
    const tauEff = new Float64Array(nx * ny * nz);
    solver.tauEffRecord = tauEff;
    solver.step(50);

    const evaluated = new Uint8Array(nx * ny * nz);
    for (let i = 0; i < flags.length; i++) if (flags[i] === CellType.Fluid) evaluated[i] = 1;

    const probe = freestreamEddyViscosity({
      nx,
      ny,
      nz,
      tauEff,
      evaluated,
      tau0: TAU0,
      exclusionDistance: PROBE_EXCLUSION,
    });

    // "Non-trivial" stated as a number, not a feeling: enough cells for a percentile to mean
    // something, and a genuine interior in every direction.
    expect(probe.survivingCells).toBeGreaterThan(200);
    expect(probe.invalidCells).toBe(0);
    expect(probe.byBoundaryDistance.length).toBeGreaterThanOrEqual(2);
    // Reported, not gated: this is the artifact the factorial goes on to compare across arms.
    expect(Number.isFinite(probe.ratio.p50)).toBe(true);
  });

  /**
   * Why the probe scene is sized independently of the ledger scene. The 10×8×7 ledger tunnel
   * does not throw at this exclusion distance — it survives with 8 cells, a single z-plane two
   * cells thick in y. That is a selection, not a freestream: no percentile of 8 values is
   * meaningful, and a per-boundary-distance profile over one bin cannot show whether an
   * artifact is boundary-driven or fills the interior.
   *
   * Recorded as a measured count rather than an assertion that it "is too small", so the
   * sizing decision can be checked instead of taken on trust.
   */
  it('confirms the 10×8×7 ledger scene leaves only a degenerate 8-cell selection', () => {
    const nx = 10;
    const ny = 8;
    const nz = 7;
    const n = nx * ny * nz;
    const evaluated = new Uint8Array(n);
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) evaluated[x + nx * (y + ny * z)] = 1;
      }
    }
    const probe = freestreamEddyViscosity({
      nx,
      ny,
      nz,
      tauEff: new Float64Array(n).fill(TAU0),
      evaluated,
      tau0: TAU0,
      exclusionDistance: PROBE_EXCLUSION,
    });
    expect(probe.survivingCells).toBe(8);
    expect(probe.byBoundaryDistance.length).toBe(1); // one bin ⇒ no spatial profile at all
    // The probe scene above carries two orders of magnitude more, across ≥ 2 bins.
    expect(probe.survivingCells).toBeLessThan(200);
  });
});
