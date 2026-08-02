import { describe, expect, it } from 'vitest';
import { AHMED, ahmedBody } from '../src/geometry/ahmedBody.js';
import { CellType } from '../src/lattice.js';
import { voxelizeSolid } from '../src/voxel/voxelize.js';

/**
 * Ahmed body generator (M9 step 1). Dimensional targets are the published SAE 840300
 * figures: 1044 × 389 × 288 mm, R=100 front fillets, 222 mm slant chord, 50 mm ground
 * clearance. Watertightness and solid volume are checked through our own voxelizer —
 * exactly the pipeline the mesh exists to feed: a leaky hull would flood-fill the interior
 * and read near-zero drag (the M8 leaky-surface symptom).
 */

const DX = 6; // mm per cell in the voxelization checks (fast: ~0.7M cells)

/** Analytic body volume via fine quadrature of the loft's cross-section model. */
function loftVolume(slantAngleDeg: number): number {
  const { length: L, width: W, height: H, noseRadius: R, slantChord } = AHMED;
  const a = (slantAngleDeg * Math.PI) / 180;
  const slantDx = slantChord * Math.cos(a);
  const slantDrop = slantChord * Math.sin(a);
  let v = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const theta = ((i + 0.5) / N) * (Math.PI / 2);
    const d = R * (1 - Math.sin(theta));
    v += (W - 2 * d) * (H - 2 * d) * R * Math.sin(theta) * (Math.PI / 2 / N);
  }
  v += (L - R - slantDx) * W * H;
  v += slantDx * W * (H - slantDrop / 2);
  return v;
}

describe('ahmedBody', () => {
  const mesh = ahmedBody();

  it('has the exact published bounding box (mm, y-up, ground clearance 50)', () => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], mesh.positions[i + a]);
        max[a] = Math.max(max[a], mesh.positions[i + a]);
      }
    }
    expect(min[0]).toBeCloseTo(0, 3);
    expect(max[0]).toBeCloseTo(1044, 3);
    expect(min[1]).toBeCloseTo(50, 3);
    expect(max[1]).toBeCloseTo(50 + 288, 3);
    expect(min[2]).toBeCloseTo(-389 / 2, 3);
    expect(max[2]).toBeCloseTo(389 / 2, 3);
  });

  it('puts the 25° slant break and base height at the published trigonometry', () => {
    const slantStartX = 1044 - 222 * Math.cos((25 * Math.PI) / 180); // ≈ 842.8
    const baseTopY = 50 + 288 - 222 * Math.sin((25 * Math.PI) / 180); // ≈ 244.2
    let maxYAtTail = -Infinity;
    let hasSlantStart = false;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y] = [mesh.positions[i], mesh.positions[i + 1]];
      if (Math.abs(x - 1044) < 1e-3) maxYAtTail = Math.max(maxYAtTail, y);
      if (Math.abs(x - slantStartX) < 1e-3 && Math.abs(y - (50 + 288)) < 1e-3) {
        hasSlantStart = true;
      }
    }
    expect(maxYAtTail).toBeCloseTo(baseTopY, 3);
    expect(hasSlantStart).toBe(true);
  });

  it('rejects fewer than the spec minimum of 16 nose segments', () => {
    expect(() => ahmedBody({ noseSegments: 8 })).toThrow('≥ 16');
  });

  describe('through the voxelizer (the consuming pipeline)', () => {
    // Lattice-space mesh at DX mm/cell with a 3-cell margin all around.
    const m = 3;
    const lattice = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      lattice[i] = mesh.positions[i] / DX + m;
      lattice[i + 1] = (mesh.positions[i + 1] - 50) / DX + m; // clearance off; body on grid
      lattice[i + 2] = (mesh.positions[i + 2] + 389 / 2) / DX + m;
    }
    const grid = {
      nx: Math.ceil(1044 / DX) + 2 * m + 1,
      ny: Math.ceil(288 / DX) + 2 * m + 1,
      nz: Math.ceil(389 / DX) + 2 * m + 1,
    };
    const mask = voxelizeSolid(lattice, mesh.indices, grid);
    const at = (x: number, y: number, z: number) => x + grid.nx * (y + grid.ny * z);

    it('is watertight: the interior classifies solid (no flood-fill leak)', () => {
      // Mid-body center and a point under the nose fillet region.
      const cx = Math.round(522 / DX) + m;
      const cy = Math.round(144 / DX) + m;
      const cz = Math.round(389 / 2 / DX) + m;
      expect(mask[at(cx, cy, cz)]).toBe(CellType.Solid);
      expect(mask[at(Math.round(150 / DX) + m, cy, cz)]).toBe(CellType.Solid);
      // And the far corner of the domain is fluid (fill actually ran).
      expect(mask[at(0, 0, 0)]).toBe(CellType.Fluid);
    });

    it('solid volume matches the analytic loft volume (+conservative inflation only)', () => {
      let solid = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i] === CellType.Solid) solid++;
      const voxVolume = solid * DX * DX * DX;
      const analytic = loftVolume(25);
      // Conservative voxelization only ever inflates; ~surface·dx bounds the excess.
      expect(voxVolume).toBeGreaterThan(analytic);
      expect(voxVolume).toBeLessThan(analytic * 1.12);
    });

    it('projected frontal area ≈ W·H (the Cd normalization the milestone mandates)', () => {
      let frontal = 0;
      for (let z = 0; z < grid.nz; z++)
        for (let y = 0; y < grid.ny; y++) {
          for (let x = 0; x < grid.nx; x++) {
            if (mask[at(x, y, z)] === CellType.Solid) {
              frontal++;
              break;
            }
          }
        }
      const analyticCells = (389 * 288) / (DX * DX);
      expect(frontal).toBeGreaterThan(analyticCells);
      expect(frontal).toBeLessThan(analyticCells * 1.09); // staircase perimeter inflation
    });
  });
});
