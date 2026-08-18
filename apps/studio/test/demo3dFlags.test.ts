import { describe, expect, it } from 'vitest';
import { CellType, validateEsotericPull3DFlags } from '@aeroflow/core';
import { buildDemo3DFlags } from '../src/ui/demo3dFlags';

describe('buildDemo3DFlags', () => {
  it('keeps the outlet strictly inside the lateral wall ring', () => {
    const [nx, ny, nz] = [16, 12, 10];
    const flags = new Uint8Array(nx * ny * nz);
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);

    buildDemo3DFlags(flags, nx, ny, nz, 4);

    expect(flags[at(nx - 1, 0, 0)]).toBe(CellType.Solid);
    expect(flags[at(nx - 1, 1, 1)]).toBe(CellType.Outlet);
    expect(flags[at(nx - 2, 1, 1)]).toBe(CellType.Fluid);
    expect(() => validateEsotericPull3DFlags(flags, nx, ny, nz)).not.toThrow();
  });
});
