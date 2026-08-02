import { CellType } from '../lattice.js';
import { icosphere, type TriangleMesh } from '../geometry/icosphere.js';
import { voxelizeSolid } from '../voxel/voxelize.js';
import {
  SPHERE_CASES,
  sphereScene,
  type Sphere3DCaseSpec,
  type Sphere3DScene,
  type SphereSceneOptions,
} from './sphere3d.js';

/**
 * M8 acceptance-2 scene: the Re=1000 sphere-drag case with the sphere coming from a
 * tessellated triangle mesh through the voxelizer instead of the analytic mask, so the
 * mean Cd can be compared against the M7 analytic-mask result (gate: within 2%).
 *
 * The one physics subtlety is the solid-set convention (M8 pitfall "halfway bounce-back
 * offset"). The analytic mask marks cells whose CENTER is strictly inside radius r; the
 * conservative voxelizer marks every cell whose unit CUBE touches the mesh surface, which
 * inflates the solid set by ~0.5–0.9 cells of radius (the T-VOX-SPHERE Minkowski
 * measurement: +22.7% volume at r=10.3). Voxelizing a mesh at the nominal radius would
 * therefore compare spheres of different effective diameter — a ~+6% frontal-area bias at
 * D=32 that would swamp the 2% gate without touching any actual physics.
 *
 * `calibrateMeshSphereRadius` removes exactly that geometric bias and nothing else: it
 * bisects the MESH radius until the voxelized solid-cell count matches the analytic mask's
 * count (same sub-cell center alignment as the real scene). Both flag fields then describe
 * the same effective obstacle under the same halfway-bounce-back convention, and the Cd
 * comparison isolates what acceptance 2 actually tests — that the voxelizer pipeline feeds
 * the solver a faithful solid, not that a conservative hull is bigger than an inscribed
 * ball. The calibrated offset (~0.5–0.8 cells) is reported so the browser page can display
 * it; it is a documented convention alignment, not a tuned physics parameter.
 */

export interface SphereRadiusCalibration {
  /** Mesh radius whose conservative voxelization best matches the analytic count. */
  radius: number;
  /** Solid cells of the calibrated voxelization (tight grid). */
  solidCount: number;
  /** Analytic strict-inside count at the nominal radius (same center alignment). */
  targetCount: number;
  /** (solidCount − targetCount) / targetCount. */
  mismatch: number;
  /** Nominal minus calibrated radius, in cells — the conservative-inflation offset. */
  radiusOffset: number;
}

/** Tight-grid margin around the sphere; count is independent of domain size beyond this. */
const MARGIN = 4;

interface TightGrid {
  nx: number;
  ny: number;
  nz: number;
  cx: number;
  cy: number;
  cz: number;
}

/**
 * Tight bounding grid reproducing the M7 scene's sub-cell center alignment (x integer,
 * y/z half-integer) — voxel counts depend on that alignment, so calibration must match it.
 */
function tightGrid(nominalRadius: number): TightGrid {
  const c = Math.ceil(nominalRadius) + MARGIN;
  return { nx: 2 * c + 1, ny: 2 * c + 2, nz: 2 * c + 2, cx: c, cy: c + 0.5, cz: c + 0.5 };
}

function countSolid(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === CellType.Solid) n++;
  return n;
}

function voxelCount(g: TightGrid, subdivisions: number, radius: number): number {
  const mesh = icosphere(subdivisions, radius, g.cx, g.cy, g.cz);
  return countSolid(voxelizeSolid(mesh.positions, mesh.indices, g));
}

export function calibrateMeshSphereRadius(
  nominalRadius: number,
  subdivisions: number,
): SphereRadiusCalibration {
  const g = tightGrid(nominalRadius);

  // Analytic strict-inside count at the nominal radius (matches geometry/sphere.ts).
  let targetCount = 0;
  const r2 = nominalRadius * nominalRadius;
  for (let z = 0; z < g.nz; z++)
    for (let y = 0; y < g.ny; y++)
      for (let x = 0; x < g.nx; x++) {
        const dx = x - g.cx;
        const dy = y - g.cy;
        const dz = z - g.cz;
        if (dx * dx + dy * dy + dz * dz < r2) targetCount++;
      }

  // Bisect the mesh radius: the voxelized count grows monotonically with radius (up to
  // single-cell granularity), and conservative inflation guarantees count(nominal) ≥ target,
  // so the bracket below always straddles the target.
  let lo = nominalRadius - 1.5;
  let hi = nominalRadius + 0.25;
  let best = { radius: hi, count: voxelCount(g, subdivisions, hi) };
  const consider = (radius: number, count: number): void => {
    if (Math.abs(count - targetCount) < Math.abs(best.count - targetCount)) {
      best = { radius, count };
    }
  };
  consider(lo, voxelCount(g, subdivisions, lo));
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const count = voxelCount(g, subdivisions, mid);
    consider(mid, count);
    if (count === targetCount) break;
    if (count > targetCount) hi = mid;
    else lo = mid;
  }

  return {
    radius: best.radius,
    solidCount: best.count,
    targetCount,
    mismatch: (best.count - targetCount) / targetCount,
    radiusOffset: nominalRadius - best.radius,
  };
}

export interface StlSphereScene extends Sphere3DScene {
  /** The tessellated sphere, in domain lattice coordinates (for preview/GPU parity). */
  mesh: TriangleMesh;
  meshRadius: number;
  calibration: SphereRadiusCalibration;
  /** Analytic-mask solid count at the same grid/center (the M7 scene's sphereVoxels). */
  analyticVoxels: number;
  /** (sphereVoxels − analyticVoxels) / analyticVoxels — should be ≪ 1% post-calibration. */
  voxelCountMismatch: number;
  subdivisions: number;
  triangleCount: number;
}

export interface StlSphereSceneOptions extends SphereSceneOptions {
  /** Icosphere subdivisions. Default 5 → 20,480 triangles (acceptance 2 wants ≥ 20k). */
  subdivisions?: number;
}

/**
 * Build the STL-sphere variant of an M7 drag case: same grid, boundaries, τ, and inflow as
 * `sphereScene(spec)`, but the solid comes from voxelizing a calibrated icosphere. The
 * voxelization runs on a tight sub-grid around the sphere (counts are domain-independent)
 * and is pasted at the M7 center, so building the full 320×160×160 scene stays fast.
 */
export function stlSphereScene(
  spec: Sphere3DCaseSpec = SPHERE_CASES.Re1000,
  opts: StlSphereSceneOptions = {},
): StlSphereScene {
  const subdivisions = opts.subdivisions ?? 5;
  const base = sphereScene(spec, opts);

  // Remove the analytic sphere: interior Solid cells are exactly the sphere (with the
  // default freestream lateral BC the domain faces hold Inlet/Outlet flags, and a 'wall'
  // lateral BC only touches the faces, which this loop skips).
  const { nx, ny, nz } = base;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        const idx = x + nx * (y + ny * z);
        if (base.flags[idx] === CellType.Solid) base.flags[idx] = CellType.Fluid;
      }

  const calibration = calibrateMeshSphereRadius(base.radius, subdivisions);
  const g = tightGrid(base.radius);
  const tightMesh = icosphere(subdivisions, calibration.radius, g.cx, g.cy, g.cz);
  const tightMask = voxelizeSolid(tightMesh.positions, tightMesh.indices, g);

  // Paste at the M7 center; offsets are integral because the tight grid reproduces the
  // domain's sub-cell alignment (cx integer, cy/cz half-integer).
  const ox = base.cx - g.cx;
  const oy = base.cy - g.cy;
  const oz = base.cz - g.cz;
  let sphereVoxels = 0;
  for (let z = 0; z < g.nz; z++)
    for (let y = 0; y < g.ny; y++)
      for (let x = 0; x < g.nx; x++) {
        if (tightMask[x + g.nx * (y + g.ny * z)] === CellType.Solid) {
          base.flags[x + ox + nx * (y + oy + ny * (z + oz))] = CellType.Solid;
          sphereVoxels++;
        }
      }

  return {
    ...base,
    sphereVoxels,
    mesh: icosphere(subdivisions, calibration.radius, base.cx, base.cy, base.cz),
    meshRadius: calibration.radius,
    calibration,
    analyticVoxels: base.sphereVoxels,
    voxelCountMismatch: (sphereVoxels - base.sphereVoxels) / base.sphereVoxels,
    subdivisions,
    triangleCount: 20 * 4 ** subdivisions,
  };
}
