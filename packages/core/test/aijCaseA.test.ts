import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { AIJ_CASE_A, caseAScene, type CaseAScene } from '../src/scenes/aijCaseA.js';
import {
  ConvergingAverager,
  PointTimeAverager,
  interpolateInflowToLattice,
  sampleTrilinear,
  scoreCaseA,
  validateAijCaseAData,
} from '../src/validation/aijCaseA.js';
import { AIJ_DATA_PAPER, AIJ_DISCLAIMER } from '../src/validation/aijAttribution.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { ablProfileLattice } from '../src/abl.js';

/**
 * M10 steps 5–6 CPU coverage: Case A scene geometry/BC layout invariants, the fixture
 * utilities (interpolation is exact for piecewise-linear data; trilinear sampling is
 * exact for a trilinear field; averaging window/drift arithmetic hand-checked), and a
 * short H4 bit-identity run of the assembled scene (the scene wires VelocityInlet +
 * free-slip + profile — the exact code path the GPU kernel is a transliteration of).
 */

/** Minimal well-formed RAW fixture (the on-disk shape), for the loader tests. */
function rawFixtureStub() {
  return {
    source: 's',
    attribution: {
      dataPaper: AIJ_DATA_PAPER,
      caseSources: ['Meng & Hibi (1998)'],
      processing: 'test fixture',
      disclaimer: AIJ_DISCLAIMER,
    },
    uRef: 'u',
    uRefMps: 4,
    bMeters: 0.08,
    inflow: [
      { zOverB: 1, U: 3 },
      { zOverB: 2, U: 4 },
    ],
    planes: [
      {
        name: 'vertical-centerplane',
        points: [{ xOverB: 1, yOverB: 0, zOverB: 0.125, U: 3, V: 0, W: 4 }],
      },
      {
        name: 'horizontal-0.125b',
        points: [{ xOverB: 0, yOverB: 0, zOverB: 0.125, U: 4, V: 0, W: 0 }],
      },
      {
        name: 'horizontal-1.25b',
        points: [{ xOverB: 0, yOverB: 0, zOverB: 1.25, U: 4, V: 0, W: 0 }],
      },
    ],
  };
}

function tinyProfile(ny: number): Float64Array {
  const { profile } = ablProfileLattice(
    { kind: 'power', uRef: 6, zRef: 10, alpha: 0.25 },
    ny,
    1,
    0.01,
  );
  return Float64Array.from(profile);
}

function buildTiny(windDeg = 0, emptyDomain = false): CaseAScene {
  // cellsPerB=4 keeps the grid tiny; domain ratios still follow the builder's rules.
  // ny must be known to size the profile: 3H = 6b = 24 cells at cellsPerB=4.
  return caseAScene({
    cellsPerB: 4,
    windDeg,
    emptyDomain,
    inflowNormalized: tinyProfile(24),
  });
}

describe('caseAScene geometry + boundary layout', () => {
  it('respects the AIJ domain rules and the spec geometry', () => {
    const s = buildTiny();
    expect(s.bCells).toBe(4);
    expect(s.hCells).toBe(8); // H = 2b
    expect(s.dx).toBeCloseTo(AIJ_CASE_A.b / 4, 12);
    expect(s.ny).toBe(24); // 3H
    // Fetch: ≥5H upstream of the footprint, ≥10H downstream.
    const upstream = s.centerX - s.bCells / 2;
    const downstream = s.nx - (s.centerX + s.bCells / 2);
    expect(upstream).toBeGreaterThanOrEqual(5 * s.hCells - 1);
    expect(downstream).toBeGreaterThanOrEqual(10 * s.hCells - 1);
    expect(s.blockage).toBeLessThanOrEqual(0.035); // voxelized silhouette near the 3% cap
    expect(s.buildingCells).toBe(4 * 4 * 8);
    // τ near the floor ⇒ LES-mandatory regime, but finite and > 0.5.
    expect(s.tau).toBeGreaterThan(0.5);
    expect(s.tau).toBeLessThan(0.6);
  });

  it('lays the H12-validated shell: VelocityInlet interior, Inlet edges, Outlet, free-slip, ground', () => {
    const s = buildTiny();
    const at = (x: number, y: number, z: number): number => x + s.nx * (y + s.ny * z);
    expect(s.flags[at(0, 5, Math.floor(s.nz / 2))]).toBe(CellType.VelocityInlet);
    expect(s.flags[at(0, s.ny - 1, 3)]).toBe(CellType.Inlet); // top edge ring
    expect(s.flags[at(0, 5, 0)]).toBe(CellType.Inlet); // z-edge ring
    expect(s.flags[at(0, 0, 5)]).toBe(CellType.Solid); // ground wins the corner
    expect(s.flags[at(s.nx - 1, 5, Math.floor(s.nz / 2))]).toBe(CellType.Outlet);
    expect(s.flags[at(10, 0, 5)]).toBe(CellType.Solid); // ground
    expect(s.flags[at(10, s.ny - 1, 5)]).toBe(CellType.FreeSlip); // top
    expect(s.flags[at(10, 5, 0)]).toBe(CellType.FreeSlip); // side
    // Every VelocityInlet cell has a Fluid +x neighbor (H12 precondition).
    for (let z = 0; z < s.nz; z++)
      for (let y = 0; y < s.ny; y++) {
        if (s.flags[at(0, y, z)] === CellType.VelocityInlet) {
          expect(s.flags[at(1, y, z)]).toBe(CellType.Fluid);
        }
      }
  });

  it('rotating the dial 90° preserves the footprint cell count; 45° widens the silhouette', () => {
    const s0 = buildTiny(0);
    const s90 = buildTiny(90);
    expect(s90.buildingCells).toBe(s0.buildingCells); // square footprint, axis-aligned again
    const s45 = buildTiny(45);
    // Rotated square seen from the inlet: width b√2 — the domain grows to hold blockage.
    expect(s45.nz).toBeGreaterThan(s0.nz);
    expect(s45.buildingCells).toBeGreaterThan(0);
  });

  it('emptyDomain drops the building and only the building', () => {
    const s = buildTiny(0, true);
    expect(s.buildingCells).toBe(0);
    const at = (x: number, y: number, z: number): number => x + s.nx * (y + s.ny * z);
    for (let y = 1; y < s.ny - 1; y++)
      expect(s.flags[at(Math.round(s.centerX), y, Math.round(s.centerZ))]).toBe(CellType.Fluid);
  });

  it('profile is rescaled so its maximum equals uLattice', () => {
    const s = buildTiny();
    expect(Math.max(...s.profile)).toBeCloseTo(s.uLattice, 12);
  });

  it('pointToLattice maps the building center and the measurement plane correctly', () => {
    const s = buildTiny();
    const p = s.pointToLattice({ x: 0, y: 0, z: AIJ_CASE_A.measurementZ });
    expect(p.x).toBeCloseTo(s.centerX - 0.5, 12);
    expect(p.z).toBeCloseTo(s.centerZ - 0.5, 12);
    // 0.125·b at cellsPerB=4 ⇒ 0.5 cells up ⇒ node coordinate 0.0 (first fluid node
    // center sits at height 0.5·dx exactly).
    expect(p.y).toBeCloseTo(0.0, 12);
  });
});

describe('fixture utilities', () => {
  it('interpolateInflowToLattice is exact on piecewise-linear data and clamps the ends', () => {
    const inflow = [
      { z: 0.01, u: 0.4 },
      { z: 0.03, u: 0.8 },
      { z: 0.07, u: 1.0 },
    ];
    const prof = interpolateInflowToLattice(inflow, 8, 0.01); // nodes at 0.005, 0.015 …
    expect(prof[0]).toBeCloseTo(0.2, 12); // below first sample: linear to 0 at ground
    expect(prof[1]).toBeCloseTo(0.5, 12); // between 0.01 and 0.03: 0.4 + 0.25·0.4... hand: t=(0.015-0.01)/0.02=0.25 → 0.4+0.25·0.4=0.5
    expect(prof[2]).toBeCloseTo(0.7, 12); // z=0.025 → t=0.75 → 0.7
    expect(prof[7]).toBeCloseTo(1.0, 12); // above the last sample: held
  });

  it('sampleTrilinear reproduces a trilinear field exactly', () => {
    const nx = 4,
      ny = 3,
      nz = 3;
    const f = new Float64Array(nx * ny * nz);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) f[x + nx * (y + ny * z)] = 2 * x - 3 * y + 5 * z + 1;
    expect(sampleTrilinear(f, nx, ny, nz, 1.25, 0.5, 1.75)).toBeCloseTo(
      2 * 1.25 - 3 * 0.5 + 5 * 1.75 + 1,
      12,
    );
    // Clamped outside the grid.
    expect(sampleTrilinear(f, nx, ny, nz, -1, 0, 0)).toBeCloseTo(1, 12);
  });

  it('PointTimeAverager: window means and drift, hand-computed', () => {
    const a = new PointTimeAverager(2, 2);
    expect(a.stats()).toBeNull();
    a.add([1, 10]);
    a.add([3, 10]); // window 1 means: [2, 10]
    expect(a.stats()!.means[0]).toBeCloseTo(2, 12);
    expect(a.stats()!.drift).toBe(Infinity);
    a.add([2, 11]);
    a.add([2, 11]); // window 2 means: [2, 11] → drift = max(0, 1/10) = 0.1
    const s = a.stats()!;
    expect(s.windows).toBe(2);
    expect(s.means[1]).toBeCloseTo(11, 12);
    expect(s.drift).toBeCloseTo(0.1, 12);
  });

  it('drift is dominated by small-magnitude points; driftScaled is not', () => {
    // Reproduces the M10 2026-07-20 fetch pathology in miniature: point 0 is a near-wall
    // node whose mean is ~0, point 1 carries the physical scale. Point 0 moves by a
    // trivial absolute amount but 100% of its own magnitude, pinning `drift` high while
    // the field is settled — which is why the steadiness predicate never fired.
    const a = new PointTimeAverager(2, 1);
    a.add([1e-6, 1.0]);
    a.add([2e-6, 1.001]);
    const s = a.stats()!;
    expect(s.drift).toBeCloseTo(1.0, 9); // 100% — from a 1e-6 absolute change
    expect(s.driftIndex).toBe(0); // the near-wall node, not the physical one
    // Normalized by the largest CURRENT mean (1.001): 0.001/1.001, three orders of
    // magnitude below `drift` for the identical pair of windows.
    expect(s.driftScaled).toBeCloseTo(0.001 / 1.001, 12);
  });

  it('ConvergingAverager: discards the transient and averages only later samples', () => {
    // transientSteps=100, checkpoint=50. Samples at steps 50 (transient) then 150,200.
    const a = new ConvergingAverager(1, 100, 50);
    a.add([999], 50); // in the transient window — must be ignored entirely
    a.add([2.0], 150);
    a.add([4.0], 200);
    const s = a.stats()!;
    expect(a.samples).toBe(2); // the step-50 sample was discarded
    expect(s.means[0]).toBeCloseTo(3.0, 12); // mean of 2 and 4, NOT polluted by 999
  });

  it('ConvergingAverager: cumulative mean converges on a noisy signal (driftScaled → small)', () => {
    // A point whose instantaneous value oscillates ±0.5 around 1.0 with slow drift. A
    // windowed averager keeps fluctuating window-to-window; the cumulative mean settles.
    const a = new ConvergingAverager(1, 0, 200);
    let driftAtFirst = 0;
    let driftAtLast = 0;
    for (let step = 1; step <= 8000; step++) {
      const v = 1.0 + 0.5 * Math.sin(step / 7); // zero-mean oscillation about 1.0
      a.add([v], step);
      const s = a.stats();
      if (s && s.windows === 2) driftAtFirst = s.driftScaled;
      if (s) driftAtLast = s.driftScaled;
    }
    const s = a.stats()!;
    expect(s.means[0]).toBeCloseTo(1.0, 1); // cumulative mean ≈ the true mean
    expect(driftAtLast).toBeLessThan(0.01); // converged: checkpoint-to-checkpoint change tiny
    expect(driftAtLast).toBeLessThan(driftAtFirst); // and it SHRANK as N grew (the whole point)
  });

  it('ConvergingAverager: first checkpoint is one interval after the transient ends', () => {
    const a = new ConvergingAverager(1, 100, 50);
    a.add([1], 120); // post-transient but before transient+checkpoint(150) → no checkpoint yet
    expect(a.stats()).toBeNull();
    a.add([1], 160); // now past 150 → first checkpoint
    a.add([1], 210); // past 200 → second checkpoint, drift now defined
    expect(a.stats()!.windows).toBe(2);
  });

  it('scoreCaseA: the spec 3-of-4 case gives q = 0.75 and rows mark the miss', () => {
    const points = [
      { x: 0, y: 0, z: 0.01, u: 1.0 },
      { x: 1, y: 0, z: 0.01, u: 0.5 },
      { x: 2, y: 0, z: 0.01, u: 0.2 },
      { x: 3, y: 0, z: 0.01, u: 0.8 },
    ];
    const sim = [1.1, 0.55, 0.5, 0.79]; // third misses (|0.5−0.2| = 0.3 > 0.25)
    const { q, r, rows } = scoreCaseA(points, sim);
    expect(q).toBeCloseTo(0.75, 12);
    expect(rows.filter((row) => !row.hit)).toHaveLength(1);
    expect(rows[2].hit).toBe(false);
    expect(r).toBeGreaterThan(0.5);
  });

  it('validateAijCaseAData rejects malformed raw fixtures', () => {
    expect(() => validateAijCaseAData({})).toThrow(/fixture/);
    expect(() =>
      validateAijCaseAData({
        ...rawFixtureStub(),
        inflow: [
          { zOverB: 0.1, U: NaN },
          { zOverB: 1, U: 4 },
        ],
      }),
    ).toThrow(/non-finite inflow/);
    // A raw fixture missing a scored plane must fail loud rather than score a subset.
    expect(() =>
      validateAijCaseAData({
        ...rawFixtureStub(),
        planes: [{ name: 'horizontal-1.25b', points: [] }],
      }),
    ).toThrow(/missing scored plane/);
  });

  it('validateAijCaseAData converts raw b-units + m/s into meters + normalized speed', () => {
    const d = validateAijCaseAData(rawFixtureStub());
    // b = 0.08, uRef = 4 m/s: z/b = 2 → 0.16 m; U = 4 → 1.0.
    expect(d.inflow[1].z).toBeCloseTo(0.16, 12);
    expect(d.inflow[1].u).toBeCloseTo(1, 12);
    expect(d.uRefMps).toBe(4);
    expect(d.bMeters).toBe(0.08);
    // Point speed is |(U,V,W)| / uRef: |(3,0,4)| = 5 → 1.25.
    expect(d.points).toHaveLength(2);
    expect(d.points[0].u).toBeCloseTo(1.25, 12);
    expect(d.points[0].x).toBeCloseTo(0.08, 12);
    // Only the two scored planes are included; 1.25b is carried but not scored.
    expect(d.points[1].z).toBeCloseTo(0.125 * 0.08, 12);
  });
});

describe('assembled Case A scene runs with H4 bit-identity (Float64)', () => {
  it('naive vs Esoteric Pull agree exactly for 40 steps', { timeout: 60_000 }, () => {
    const s = buildTiny();
    const common = {
      nx: s.nx,
      ny: s.ny,
      nz: s.nz,
      omega: s.omega,
      flags: s.flags,
      collision: 'trt' as const,
      regularize: true,
      les: { cs: 0.1 },
      inletProfile: { axis: 'y' as const, ux: s.profile },
      freeSlip: { yMax: true, zMin: true, zMax: true },
    };
    const naive = new Solver3D(common);
    const eso = new EsotericPull3D(common);
    naive.step(40);
    eso.step(40);
    const a = naive.snapshotPostCollision();
    const b = eso.snapshotCanonical();
    const n = s.nx * s.ny * s.nz;
    for (let slot = 0; slot < 19 * n; slot++) {
      if (a[slot] !== b[slot] && s.flags[slot % n] === CellType.Fluid) {
        throw new Error(`bit-identity broken at slot ${slot}`);
      }
    }
    // And the flow is alive and finite at the measurement plane behind the building.
    const m = naive.macroscopics();
    const p = s.pointToLattice({ x: 2 * AIJ_CASE_A.b, y: 0, z: AIJ_CASE_A.measurementZ });
    const u = sampleTrilinear(m.ux, s.nx, s.ny, s.nz, p.x, p.y, p.z);
    expect(Number.isFinite(u)).toBe(true);
  });
});
