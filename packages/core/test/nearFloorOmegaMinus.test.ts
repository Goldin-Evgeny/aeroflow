import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { type FreeSlipFaces } from '../src/cpu/freeslip.js';

/**
 * D1 (openspec/changes/discriminate-near-floor-instability): the ω⁻-inertness null test.
 *
 * `collide.ts:391` asserts, in a comment and nowhere else, that the Latt–Chopard projection
 * is even in the lattice directions, so the TRT antisymmetric rate ω⁻ "acts on nothing" in a
 * regularized cell. Every near-floor acceptance configuration in this repo runs
 * `regularize: true`, so if that claim holds, the ω⁻-collapse mechanism (A) cannot be
 * operating at the acceptance operating point at all, and the near-floor pathology there
 * belongs to the projection (B) or to something not yet named.
 *
 * The scene and physics are `pressureOutlet3d.test.ts`'s M9 free-slip empty tunnel at the
 * acceptance-tier τ₀ = 0.5000005 — not a proxy for the acceptance point, the point itself.
 * ω⁻ is varied through `lambda`, the only handle that exists before section 2 of this change
 * adds a direct one. `lambda` also sets the effective bounce-back wall position, which is why
 * a *difference* here would be ambiguous — but the prediction is bit-identity, and bit-identity
 * is not ambiguous.
 */

const NX = 10;
const NY = 8;
const NZ = 7;
const at = (x: number, y: number, z: number): number => x + NX * (y + NY * z);

/** The free-slip empty tunnel of `pressureOutlet3d.test.ts` `sceneFlags(false)`. */
function emptyTunnelFlags(): Uint8Array {
  const flags = new Uint8Array(NX * NY * NZ);
  for (let z = 0; z < NZ; z++) {
    for (let x = 0; x < NX; x++) {
      flags[at(x, 0, z)] = CellType.Solid;
      flags[at(x, NY - 1, z)] = CellType.FreeSlip;
    }
  }
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      flags[at(x, y, 0)] = CellType.FreeSlip;
      flags[at(x, y, NZ - 1)] = CellType.FreeSlip;
    }
  }
  for (let z = 1; z < NZ - 1; z++) {
    for (let y = 1; y < NY - 1; y++) {
      flags[at(0, y, z)] = CellType.VelocityInlet;
      flags[at(NX - 1, y, z)] = CellType.Outlet;
    }
  }
  for (let z = 0; z < NZ; z++) flags[at(0, NY - 1, z)] = CellType.Inlet;
  for (let y = 1; y < NY; y++) {
    flags[at(0, y, 0)] = CellType.Inlet;
    flags[at(0, y, NZ - 1)] = CellType.Inlet;
  }
  return flags;
}

const FREE_SLIP: FreeSlipFaces = { yMax: true, zMin: true, zMax: true };

/** τ₀ = 0.5000005 — the acceptance-tier near-floor operating point (Ahmed/AIJ ≈ 0.5000042). */
const TAU0 = 0.5000005;

/** Two widely separated magic parameters: Λ = 3/16 (canonical) and Λ = 3 (16× larger). */
const LAMBDA_A = 3 / 16;
const LAMBDA_B = 3;

function runTunnel(lambda: number, regularize: boolean, steps: number): Float64Array {
  const solver = new Solver3D({
    nx: NX,
    ny: NY,
    nz: NZ,
    omega: 1 / TAU0,
    flags: emptyTunnelFlags(),
    inletVelocity: 0.05,
    collision: 'trt',
    lambda,
    les: { cs: 0.1 },
    regularize,
    conserveMass: true,
    outlet: 'pressure',
    freeSlip: FREE_SLIP,
  });
  solver.reset(1);
  solver.step(steps);
  return solver.snapshotPostCollision();
}

interface Divergence {
  identical: boolean;
  firstIndex: number;
  maxAbsDiff: number;
  maxRelDiff: number;
  differingCount: number;
}

function compare(a: Float64Array, b: Float64Array): Divergence {
  let firstIndex = -1;
  let maxAbsDiff = 0;
  let maxRelDiff = 0;
  let differingCount = 0;
  for (let i = 0; i < a.length; i++) {
    if (Object.is(a[i], b[i])) continue;
    differingCount++;
    if (firstIndex < 0) firstIndex = i;
    const d = Math.abs(a[i] - b[i]);
    if (d > maxAbsDiff) maxAbsDiff = d;
    const scale = Math.max(Math.abs(a[i]), Math.abs(b[i]));
    if (scale > 0 && d / scale > maxRelDiff) maxRelDiff = d / scale;
  }
  return { identical: differingCount === 0, firstIndex, maxAbsDiff, maxRelDiff, differingCount };
}

function allFinite(f: Float64Array): boolean {
  for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i])) return false;
  return true;
}

describe('near-floor ω⁻ inertness under projected regularization (D1)', () => {
  /**
   * Task 1.1. The spec scenario "Varying the antisymmetric rate under regularization changes
   * nothing": Q_i and w_i are both even in e_i, so f − f^eq after the projection is purely
   * even, its antisymmetric part is identically zero, and `dAnti = omm · 0` at `collide.ts:424`.
   */
  it('is bit-identical at two widely separated Λ with regularization on', () => {
    const STEPS = 300;
    const a = runTunnel(LAMBDA_A, true, STEPS);
    const b = runTunnel(LAMBDA_B, true, STEPS);
    expect(allFinite(a), `Λ=${LAMBDA_A} went non-finite in ${STEPS} steps`).toBe(true);
    expect(allFinite(b), `Λ=${LAMBDA_B} went non-finite in ${STEPS} steps`).toBe(true);

    const d = compare(a, b);
    expect(
      d.identical,
      `${d.differingCount}/${a.length} populations differ after ${STEPS} steps ` +
        `(first at ${d.firstIndex}, max |Δ| ${d.maxAbsDiff.toExponential(3)}, ` +
        `max relative ${d.maxRelDiff.toExponential(3)})`,
    ).toBe(true);
  });

  /**
   * Task 1.3, the negative control. Without the projection, f^neq retains its antisymmetric
   * part and ω⁻ relaxes it, so the same two Λ MUST diverge. Without this, the test above
   * could be passing because the configuration never reaches the TRT branch at all.
   */
  it('does differ at those same two Λ with regularization off', () => {
    // 150, not the 300 used above: unregularized at this τ₀ the Λ = 3 arm goes non-finite at
    // step 228 (measured 2026-08-17), and NaN ≠ NaN would make this control pass for the
    // wrong reason. 150 leaves both arms finite with margin. The divergence itself is a
    // result, not a nuisance — without the projection the near-floor tunnel is strongly
    // ω⁻-sensitive, which is the very sensitivity the regularized case above does not have.
    const STEPS = 150;
    const a = runTunnel(LAMBDA_A, false, STEPS);
    const b = runTunnel(LAMBDA_B, false, STEPS);
    expect(allFinite(a), `Λ=${LAMBDA_A} unregularized went non-finite in ${STEPS} steps`).toBe(
      true,
    );
    expect(allFinite(b), `Λ=${LAMBDA_B} unregularized went non-finite in ${STEPS} steps`).toBe(
      true,
    );

    const d = compare(a, b);
    expect(d.identical, 'unregularized runs at different Λ were bit-identical').toBe(false);
  });
});
