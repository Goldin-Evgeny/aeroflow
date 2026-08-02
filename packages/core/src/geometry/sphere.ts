import { CellType } from '../lattice.js';

/**
 * Analytic sphere mask for the M7 sphere-drag ladder (no mesh import — that is M8).
 *
 * Flags a cell `(x, y, z)` as `CellType.Solid` when its center lies strictly inside the
 * sphere of the given radius. Cell centers sit at integer coordinates and the test is a
 * strict `<`, so the physical surface falls *between* nodes — the convention halfway
 * bounce-back expects (the wall is halfway along each cut link, H2/PHYSICS §5). Everything
 * else is left `CellType.Fluid` (0); callers overlay inlet/outlet/wall flags afterward.
 *
 * Index convention matches the solvers and the WGSL kernel: `idx = x + nx·(y + ny·z)`.
 */
export function sphereMask(
  nx: number,
  ny: number,
  nz: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): Uint8Array {
  const mask = new Uint8Array(nx * ny * nz); // CellType.Fluid = 0 everywhere by default
  const r2 = radius * radius;
  for (let z = 0; z < nz; z++) {
    const dz = z - cz;
    const dz2 = dz * dz;
    for (let y = 0; y < ny; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      for (let x = 0; x < nx; x++) {
        const dx = x - cx;
        if (dx * dx + dy2 + dz2 < r2) {
          mask[x + nx * (y + ny * z)] = CellType.Solid;
        }
      }
    }
  }
  return mask;
}
