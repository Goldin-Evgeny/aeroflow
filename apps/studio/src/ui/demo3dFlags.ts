import { CellType } from '@aeroflow/core';

/** Build the wall-bounded flag field used by the default 3D demo. */
export function buildDemo3DFlags(
  flags: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  cube: number,
): void {
  const expected = nx * ny * nz;
  if (flags.length !== expected) {
    throw new Error(`demo3d flags length ${flags.length} ≠ nx·ny·nz ${expected}`);
  }

  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let type = CellType.Fluid;
        if (x === 0) type = CellType.Inlet;
        else if (y === 0 || y === ny - 1 || z === 0 || z === nz - 1) type = CellType.Solid;
        // Esoteric Pull requires the outlet to be strictly interior in y and z. Keeping
        // the lateral wall ring Solid also ensures every Outlet has a Fluid upstream cell.
        else if (x === nx - 1) type = CellType.Outlet;
        flags[at(x, y, z)] = type;
      }
    }
  }

  // Solid cube centered a quarter-length downstream of the inlet.
  const cx = Math.floor(nx / 4);
  const half = cube / 2;
  const lo = (center: number) => Math.floor(center - half);
  const hi = (center: number) => Math.floor(center + half);
  for (let z = lo(nz / 2); z < hi(nz / 2); z++) {
    for (let y = lo(ny / 2); y < hi(ny / 2); y++) {
      for (let x = lo(cx); x < hi(cx); x++) {
        flags[at(x, y, z)] = CellType.Solid;
      }
    }
  }
}
