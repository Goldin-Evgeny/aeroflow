import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';

/**
 * M9 step 7 / acceptance 3 (CPU half): checkpoint round-trip must be BIT-IDENTICAL.
 * Run the D3Q19 reference on a 16³ cylinder-in-box for 50 steps (odd count on purpose —
 * the saved state sits at parity 1, so the test fails if parity is dropped), serialize,
 * restore into a fresh solver, run 50 more; every Float64 DDF must equal an uninterrupted
 * 100-step run's. The GPU path reuses this contract with raw FP16 bytes (M9 step 4).
 */

const N = 16;

function cylinderBoxFlags(): Uint8Array {
  const flags = new Uint8Array(N * N * N).fill(CellType.Fluid);
  const at = (x: number, y: number, z: number) => x + N * (y + N * z);
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (y === 0 || y === N - 1 || z === 0 || z === N - 1) flags[at(x, y, z)] = CellType.Solid;
        else if (x === 0) flags[at(x, y, z)] = CellType.Inlet;
        else if (x === N - 1) flags[at(x, y, z)] = CellType.Outlet;
      }
  // Cylinder along z, centered at (6, 7.5), radius 2.5 — asymmetric on purpose.
  for (let z = 1; z < N - 1; z++)
    for (let y = 1; y < N - 1; y++)
      for (let x = 1; x < N - 1; x++) {
        if ((x - 6) ** 2 + (y - 7.5) ** 2 <= 2.5 ** 2) flags[at(x, y, z)] = CellType.Solid;
      }
  return flags;
}

const mkSolver = () =>
  new EsotericPull3D({
    nx: N,
    ny: N,
    nz: N,
    omega: 1 / 0.56,
    flags: cylinderBoxFlags(),
    inletVelocity: 0.05,
    collision: 'trt',
  });

describe('EsotericPull3D checkpoint (M9)', () => {
  it('save at step 50 → restore → 50 more steps is bit-identical to uninterrupted 100', () => {
    const reference = mkSolver();
    reference.step(100);
    const refState = reference.saveState();

    const original = mkSolver();
    original.step(50);
    const checkpoint = original.saveState();
    expect(checkpoint.steps).toBe(50); // even step ⇒ parity 0; the odd case is tested below
    original.step(17); // mutate the original after the save; the snapshot must be a copy

    const resumed = mkSolver();
    resumed.loadState(checkpoint);
    expect(resumed.steps).toBe(50);
    resumed.step(50);

    expect(resumed.steps).toBe(100);
    const resumedState = resumed.saveState();
    // Bit-identical: every Float64 of the raw DDF array, no tolerance.
    expect(resumedState.ddf).toEqual(refState.ddf);
    // And the physics keeps evolving identically after the join.
    resumed.step(3);
    reference.step(3);
    expect(resumed.saveState().ddf).toEqual(reference.saveState().ddf);
    expect(resumed.force).toEqual(reference.force);
  });

  it('odd-step checkpoint (parity 1) round-trips bit-identically too', () => {
    const reference = mkSolver();
    reference.step(100);

    const original = mkSolver();
    original.step(51); // parity 1 at the save point
    const checkpoint = original.saveState();

    const resumed = mkSolver();
    resumed.loadState(checkpoint);
    resumed.step(49);
    expect(resumed.saveState().ddf).toEqual(reference.saveState().ddf);
  });

  it('restoring with corrupted parity drifts (the failure mode the counter guards)', () => {
    const reference = mkSolver();
    reference.step(100);

    const original = mkSolver();
    original.step(51);
    const checkpoint = original.saveState();
    const corrupted = { ...checkpoint, steps: checkpoint.steps + 1 }; // wrong parity

    const resumed = mkSolver();
    resumed.loadState(corrupted);
    resumed.step(48); // lands on step "100"
    // NOT bit-identical — wrong parity reads the wrong slots. No NaN required; it drifts.
    expect(resumed.saveState().ddf).not.toEqual(reference.saveState().ddf);
  });

  it('rejects grid/length/step mismatches', () => {
    const solver = mkSolver();
    const state = solver.saveState();
    expect(() => solver.loadState({ ...state, nx: N + 1 })).toThrow('grid mismatch');
    expect(() => solver.loadState({ ...state, ddf: state.ddf.slice(1) })).toThrow('length');
    expect(() => solver.loadState({ ...state, steps: -1 })).toThrow('non-negative');
    expect(() => solver.loadState({ ...state, steps: 2.5 })).toThrow('integer');
  });
});
