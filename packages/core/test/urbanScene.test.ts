import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import type { TriangleMesh } from '../src/geometry/icosphere.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { bounds3, planUrbanDomain } from '../src/scenes/urbanDomain.js';
import {
  toUrbanLatticePositions,
  urbanPointToLattice,
  urbanScene,
} from '../src/scenes/urbanScene.js';

function appendBox(
  positions: number[],
  indices: number[],
  min: [number, number, number],
  max: [number, number, number],
): void {
  const base = positions.length / 3;
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  positions.push(
    x0,
    y0,
    z0,
    x1,
    y0,
    z0,
    x1,
    y1,
    z0,
    x0,
    y1,
    z0,
    x0,
    y0,
    z1,
    x1,
    y0,
    z1,
    x1,
    y1,
    z1,
    x0,
    y1,
    z1,
  );
  for (const index of [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2,
    6, 1, 6, 5,
  ]) {
    indices.push(base + index);
  }
}

function twoBuildings(): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  appendBox(positions, indices, [-2, 0, -2], [2, 4, 2]);
  appendBox(positions, indices, [4, 0, 3], [6, 2, 5]);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function build(maxCells = 200_000) {
  const mesh = twoBuildings();
  const bounds = bounds3(mesh.positions);
  const plan = planUrbanDomain({
    geometryBounds: bounds,
    maxBuildingHeight: 4,
    probeHeight: 1,
    maxCells,
    padding: { upstreamH: 1, downstreamH: 1, lateralH: 1, topH: 1 },
  });
  const scene = urbanScene({
    mesh,
    plan,
    uRefMps: 5,
    inflowNormalized: (ny, dx) =>
      Float64Array.from({ length: ny }, (_, y) => Math.pow(((y + 0.5) * dx) / 4, 0.25)),
  });
  return { mesh, plan, scene };
}

describe('urbanScene CPU oracle', () => {
  it('co-registers physical geometry and probes in the same lattice frame', () => {
    const { plan, scene } = build();
    const at = (x: number, y: number, z: number): number =>
      scene.flags[x + scene.nx * (y + scene.ny * z)];
    const inside = scene.pointToLattice({ x: 0, y: 2, z: 0 });
    expect(at(Math.round(inside.x), Math.round(inside.y), Math.round(inside.z))).toBe(
      CellType.Solid,
    );
    const upstream = urbanPointToLattice({ x: -4, y: 2, z: 0 }, plan);
    expect(at(Math.round(upstream.x), Math.round(upstream.y), Math.round(upstream.z))).toBe(
      CellType.Fluid,
    );
    expect(scene.geometryVoxels).toBeGreaterThan(0);
  });

  it('lays the H11/H12 shell and preserves every VelocityInlet precondition', () => {
    const { scene } = build();
    const at = (x: number, y: number, z: number): number =>
      scene.flags[x + scene.nx * (y + scene.ny * z)];
    expect(at(0, 3, Math.floor(scene.nz / 2))).toBe(CellType.VelocityInlet);
    expect(at(0, scene.ny - 1, 3)).toBe(CellType.Inlet);
    expect(at(0, 3, 0)).toBe(CellType.Inlet);
    expect(at(0, 0, 3)).toBe(CellType.Solid);
    expect(at(scene.nx - 1, 3, Math.floor(scene.nz / 2))).toBe(CellType.Outlet);
    expect(at(3, scene.ny - 1, 3)).toBe(CellType.FreeSlip);
    expect(at(3, 3, 0)).toBe(CellType.FreeSlip);
    for (let z = 1; z < scene.nz - 1; z++)
      for (let y = 1; y < scene.ny - 1; y++) {
        if (at(0, y, z) === CellType.VelocityInlet) expect(at(1, y, z)).toBe(CellType.Fluid);
      }
  });

  it('reserves Mach headroom for the profile maximum and derives tau through latticeUnits', () => {
    const { plan, scene } = build();
    expect(Math.max(...scene.profile)).toBeCloseTo(0.08, 12);
    expect(scene.mapping.uLattice).toBeCloseTo(scene.latticePerNormalized, 12);
    expect(scene.mapping.dx).toBeCloseTo(plan.dx, 12);
    expect(scene.mapping.tau).toBeGreaterThan(0.5);
    expect(scene.mapping.stable).toBe(true); // LES-enabled unit mapping
    expect(scene.convectiveTimeSteps).toBeGreaterThan(0);
  });

  it('maps mesh bounds through the same half-cell convention as probes', () => {
    const { mesh, plan } = build();
    const lattice = toUrbanLatticePositions(mesh.positions, plan);
    const physical = bounds3(mesh.positions);
    const transformed = bounds3(lattice);
    expect(transformed.min[0]).toBeCloseTo(
      (physical.min[0] + plan.geometryOffset[0]) / plan.dx - 0.5,
      5,
    );
    expect(transformed.min[1]).toBeCloseTo(-0.5, 5);
    expect(transformed.size[0]).toBeCloseTo(physical.size[0] / plan.dx, 4);
  });

  it('rejects malformed profile and Mach settings before voxelization', () => {
    const mesh = twoBuildings();
    const plan = planUrbanDomain({
      geometryBounds: bounds3(mesh.positions),
      maxBuildingHeight: 4,
      probeHeight: 1,
      maxCells: 50_000,
      padding: { upstreamH: 1, downstreamH: 1, lateralH: 1, topH: 1 },
    });
    expect(() =>
      urbanScene({ mesh, plan, uRefMps: 5, inflowNormalized: new Float64Array(2) }),
    ).toThrow(/inflow length/);
    expect(() =>
      urbanScene({
        mesh,
        plan,
        uRefMps: 5,
        inflowNormalized: new Float64Array(plan.grid.ny).fill(1),
        maxLatticeVelocity: 0.11,
      }),
    ).toThrow(/lattice velocity/);
  });

  it('runs naive and Esoteric Pull bit-identically on the assembled urban scene', () => {
    const { scene } = build(25_000);
    const common = {
      nx: scene.nx,
      ny: scene.ny,
      nz: scene.nz,
      omega: scene.mapping.omega,
      flags: scene.flags,
      collision: 'trt' as const,
      regularize: true,
      les: { cs: 0.1 },
      inletProfile: { axis: 'y' as const, ux: scene.profile },
      freeSlip: { yMax: true, zMin: true, zMax: true },
    };
    const naive = new Solver3D(common);
    const esoteric = new EsotericPull3D(common);
    naive.step(5);
    esoteric.step(5);
    const expected = naive.snapshotPostCollision();
    const actual = esoteric.snapshotCanonical();
    const n = scene.nx * scene.ny * scene.nz;
    for (let slot = 0; slot < expected.length; slot++) {
      if (scene.flags[slot % n] === CellType.Fluid) expect(actual[slot]).toBe(expected[slot]);
    }
  });
});
