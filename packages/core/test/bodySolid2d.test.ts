import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver2D } from '../src/cpu/solver2d.js';

/**
 * `CellType.BodySolid` must be SOLID in 2D, not fluid.
 *
 * M9 added the flag for the 3D Ahmed ground-contamination fix, where `isSolid()` covers
 * both `Solid` and `BodySolid`. The 2D paths were never updated: `solver2d.ts` tested
 * `flags[s] === CellType.Solid` in five places and `lbm2d.wgsl` tested `flag == SOLID`, so
 * a `BodySolid` (6) cell fell through every solid branch and was treated as **Fluid**.
 *
 * The failure mode is not "the body is unweighed" — it is a hole punched through the
 * geometry. The obstacle would stream, collide and carry mass like open fluid, silently
 * producing a different flow with a plausible-looking force of zero. `lattice.ts` warns
 * about exactly this ("`isSolid()` covers both"), which is why the flag is checked here
 * rather than trusted.
 *
 * No 2D scene tags `BodySolid` today; this pins the invariant before one does.
 */
describe('CellType.BodySolid is solid in the 2D solver', () => {
  const NX = 32;
  const NY = 16;
  const STEPS = 60;
  const U_IN = 0.05;

  /** Duct with walls on ±y, inlet/outlet on ±x, and a block tagged `blockFlag`. */
  function scene(blockFlag: number): { flags: Uint8Array; mask: Uint8Array } {
    const flags = new Uint8Array(NX * NY);
    const mask = new Uint8Array(NX * NY);
    const at = (x: number, y: number) => y * NX + x;
    for (let x = 0; x < NX; x++) {
      flags[at(x, 0)] = CellType.Solid;
      flags[at(x, NY - 1)] = CellType.Solid;
    }
    for (let y = 1; y < NY - 1; y++) {
      flags[at(0, y)] = CellType.Inlet;
      flags[at(NX - 1, y)] = CellType.Outlet;
    }
    // Deliberately off-centre so a lift sign error cannot cancel top against bottom.
    for (let y = 5; y <= 9; y++)
      for (let x = 10; x <= 13; x++) {
        flags[at(x, y)] = blockFlag;
        mask[at(x, y)] = 1;
      }
    return { flags, mask };
  }

  function run(blockFlag: number, useMask: boolean): Solver2D {
    const { flags, mask } = scene(blockFlag);
    const s = new Solver2D({
      nx: NX,
      ny: NY,
      omega: 1 / 0.6,
      flags,
      inletVelocity: U_IN,
      collision: 'trt',
      outlet: 'pressure',
      ...(useMask ? { forceMask: mask } : {}),
    });
    s.reset(1, U_IN, 0);
    s.step(STEPS);
    return s;
  }

  it('bounces off a BodySolid block exactly as off a Solid one', () => {
    const solid = run(CellType.Solid, true);
    const body = run(CellType.BodySolid, false);

    // Bit-identical distributions: BodySolid must change nothing about the dynamics.
    const a = solid.distributions();
    const b = body.distributions();
    expect(a.length).toBe(b.length);
    let mismatches = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatches++;
    expect(mismatches).toBe(0);

    // Non-vacuity: the block must actually be doing something, or the comparison above
    // would pass just as well on an empty duct.
    expect(solid.force.x).toBeGreaterThan(0);
  });

  it('weighs BodySolid in maskedForce without needing an explicit forceMask', () => {
    const masked = run(CellType.Solid, true);
    const tagged = run(CellType.BodySolid, false);

    // The flag is a mask in its own right (mirrors Solver3D/EsotericPull3D.isMeasured), so
    // tagging BodySolid must equal passing an explicit forceMask over the same cells.
    expect(tagged.maskedForce.x).toBe(masked.maskedForce.x);
    expect(tagged.maskedForce.y).toBe(masked.maskedForce.y);
    expect(tagged.maskedForce.x).toBeGreaterThan(0);

    // And the walls are still outside the mask — the whole point of having one.
    expect(tagged.maskedForce.x).toBeLessThan(tagged.force.x);
  });

  it('leaves the obstacle out of the macroscopic field', () => {
    const body = run(CellType.BodySolid, false);
    const { rho } = body.macroscopics();
    // A hole would carry mass here; a solid is skipped and stays at the zero initializer.
    expect(rho[7 * NX + 11]).toBe(0);
  });
});
