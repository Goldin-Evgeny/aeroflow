import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { D3Q19 } from '../src/lattice3d.js';
import {
  collideCell,
  D3Q19_SPEC,
  equilibrium3,
  makeCollideContext,
  smagorinskyTauEff,
  lesKFromCs,
  piNeqNormLegacy,
  piNeq,
} from '../src/cpu/collide.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { Solver3D } from '../src/cpu/solver3d.js';

/**
 * near-floor-collision-diagnostics: the relaxation rates actually in force are observable,
 * and the antisymmetric rate is independently controllable.
 *
 * The gate for the whole of section 2 is the bit-identity regression: `omegaMinus` exists so
 * a near-floor failure can be attributed, and it is worthless if adding it moved the default
 * path by one ulp. Every recorded result in docs/validation/ depends on that path.
 */

const NX = 8;
const NY = 7;
const NZ = 6;
const at = (x: number, y: number, z: number): number => x + NX * (y + NY * z);

/** A closed duct with an inlet, an outlet and solid sides — legal for both 3D solvers. */
function ductFlags(): Uint8Array {
  const flags = new Uint8Array(NX * NY * NZ);
  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        if (y === 0 || y === NY - 1 || z === 0 || z === NZ - 1) {
          flags[at(x, y, z)] = CellType.Solid;
        } else if (x === 0) {
          flags[at(x, y, z)] = CellType.VelocityInlet;
        } else if (x === NX - 1) {
          flags[at(x, y, z)] = CellType.Outlet;
        }
      }
    }
  }
  return flags;
}

/**
 * A gathered population set with genuine non-equilibrium in BOTH the even and odd parts —
 * a pure equilibrium state would make every ω⁻ test vacuous.
 */
function perturbedPopulations(rho: number, ux: number): Float64Array {
  const f = new Float64Array(D3Q19.q);
  for (let i = 0; i < D3Q19.q; i++) {
    f[i] = equilibrium3(D3Q19_SPEC, i, rho, ux, 0, 0) * (1 + 0.02 * Math.sin(3 * i + 1));
  }
  return f;
}

describe('relaxation-rate reporting and the ω⁻ override', () => {
  /**
   * Task 2.5 — the section gate. `EsotericPull3D` is what production runs, so it is the path
   * the regression has to cover; `Solver3D` is included because it is the bit-identity oracle
   * the esoteric solver is checked against.
   *
   * The fixture is the pre-change code path reconstructed exactly: with `omegaMinus` unset,
   * `collideCell` evaluates `1 / (0.5 + lambda / (tauEff - 0.5))` verbatim. Rather than store
   * an opaque blob of numbers, the two solvers are run against each other AND against the
   * derived-rate expression stated explicitly — a stored blob would pin the behaviour without
   * saying what it is, and could not distinguish "unchanged" from "changed identically in
   * both solvers".
   */
  it('leaves the default derived-ω⁻ path bit-identical on the Esoteric path', () => {
    const opts = {
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.5000005,
      flags: ductFlags(),
      inletVelocity: 0.05,
      collision: 'trt' as const,
      les: { cs: 0.1 },
      regularize: false,
      conserveMass: true,
      outlet: 'pressure' as const,
    };
    const eso = new EsotericPull3D(opts);
    const naive = new Solver3D(opts);
    eso.step(60);
    naive.step(60);
    // `snapshotCanonical` fills FLUID cells only, so the comparison is over fluid slots —
    // the same convention `velocityInlet.test.ts` and `aijCaseA.test.ts` use for H4 §8.
    const a = eso.snapshotCanonical();
    const b = naive.snapshotPostCollision();
    const n = NX * NY * NZ;
    const flags = opts.flags;
    let compared = 0;
    for (let idx = 0; idx < n; idx++) {
      if (flags[idx] !== CellType.Fluid) continue;
      for (let d = 0; d < D3Q19.q; d++) {
        const slot = d * n + idx;
        expect(Number.isFinite(a[slot]), `esoteric slot ${slot} non-finite`).toBe(true);
        expect(
          Object.is(a[slot], b[slot]),
          `slot ${slot} (dir ${d}, cell ${idx}): esoteric ${a[slot]} vs naive ${b[slot]}`,
        ).toBe(true);
        compared++;
      }
    }
    expect(compared, 'no fluid slots were compared — the scene has no interior').toBeGreaterThan(0);
  });

  /**
   * Task 2.5, second half: the derived rate the default path applies is exactly the
   * pre-change expression, evaluated on the τ_eff that cell actually reached. If the
   * `?? ` rewrite had perturbed the default in any way, this is where it shows.
   */
  it('reports a derived ω⁻ equal to the pre-change expression, bit for bit', () => {
    const tau0 = 0.5000005;
    const lambda = 3 / 16;
    const lesK = lesKFromCs(0.1);
    const ctx = makeCollideContext(D3Q19_SPEC, {
      tau: tau0,
      collision: 'trt',
      lesCs: 0.1,
      regularize: false,
    });
    const f = perturbedPopulations(1.02, 0.05);
    const fIn = Float64Array.from(f);
    collideCell(f, ctx);

    // Reconstruct τ_eff independently from the incoming populations, then the pre-change ω⁻.
    let rho = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let i = 0; i < D3Q19.q; i++) {
      rho += fIn[i];
      mx += D3Q19.ex[i] * fIn[i];
      my += D3Q19.ey[i] * fIn[i];
      mz += D3Q19.ez[i] * fIn[i];
    }
    const feq = new Float64Array(D3Q19.q);
    for (let i = 0; i < D3Q19.q; i++) {
      feq[i] = equilibrium3(D3Q19_SPEC, i, rho, mx / rho, my / rho, mz / rho);
    }
    const p = new Float64Array(6);
    piNeq(fIn, feq, D3Q19_SPEC, p);
    const tauEff = smagorinskyTauEff(tau0, lesK, piNeqNormLegacy(p), rho);
    const expectedOmm = 1 / (0.5 + lambda / (tauEff - 0.5));

    expect(Object.is(ctx.macro[4], tauEff)).toBe(true);
    expect(Object.is(ctx.macro[5], 1 / tauEff)).toBe(true);
    expect(Object.is(ctx.macro[6], expectedOmm)).toBe(true);
    // The near-floor collapse this change exists to test for: ω⁺ ≈ 2 against a tiny ω⁻.
    expect(ctx.macro[6]).toBeLessThan(0.05 * ctx.macro[5]);
  });

  /**
   * Task 2.6 — positional stability of `macro[0..4]`. `esoteric.ts:362` reads `macro[4]` and
   * several tests read 0–4; appending must not have shifted any of them. Values are stated
   * from the definition (Σf, Σe·f/ρ, τ₀ at equilibrium), not copied from a run.
   */
  it('keeps macro[0..4] at rho, ux, uy, uz, tauEff', () => {
    const tau = 0.6;
    const ctx = makeCollideContext(D3Q19_SPEC, { tau, collision: 'trt' });
    const rho = 1.25;
    const ux = 0.03;
    const uy = -0.01;
    const uz = 0.02;
    const f = new Float64Array(D3Q19.q);
    for (let i = 0; i < D3Q19.q; i++) f[i] = equilibrium3(D3Q19_SPEC, i, rho, ux, uy, uz);
    collideCell(f, ctx);
    expect(ctx.macro.length).toBe(7);
    expect(ctx.macro[0]).toBeCloseTo(rho, 12);
    expect(ctx.macro[1]).toBeCloseTo(ux, 12);
    expect(ctx.macro[2]).toBeCloseTo(uy, 12);
    expect(ctx.macro[3]).toBeCloseTo(uz, 12);
    expect(ctx.macro[4]).toBe(tau); // LES off ⇒ τ_eff = τ₀ exactly
  });

  /** Spec scenario: reported rates reflect per-cell subgrid variation. */
  it('reports different rates for cells the subgrid closure treats differently', () => {
    const ctx = makeCollideContext(D3Q19_SPEC, {
      tau: 0.51,
      collision: 'trt',
      lesCs: 0.1,
    });
    const quiet = new Float64Array(D3Q19.q);
    for (let i = 0; i < D3Q19.q; i++) quiet[i] = equilibrium3(D3Q19_SPEC, i, 1, 0.01, 0, 0);
    collideCell(quiet, ctx);
    const quietRates = [ctx.macro[4], ctx.macro[5], ctx.macro[6]];

    const strained = perturbedPopulations(1, 0.05);
    collideCell(strained, ctx);
    const strainedRates = [ctx.macro[4], ctx.macro[5], ctx.macro[6]];

    // Equilibrium ⇒ ‖Π^neq‖ = 0 ⇒ τ_eff = τ₀; the perturbed cell must be strictly above it.
    expect(strainedRates[0]).toBeGreaterThan(quietRates[0]);
    expect(strainedRates[1]).toBeLessThan(quietRates[1]); // ω⁺ = 1/τ_eff falls
    expect(strainedRates[2]).toBeGreaterThan(quietRates[2]); // ω⁻ rises with τ_eff
  });

  /** Spec scenario: a single-relaxation operator reports consistent rates. */
  it('reports equal rates under BGK', () => {
    const ctx = makeCollideContext(D3Q19_SPEC, { tau: 0.8, collision: 'bgk', lesCs: 0.1 });
    const f = perturbedPopulations(1, 0.04);
    collideCell(f, ctx);
    expect(Object.is(ctx.macro[5], ctx.macro[6])).toBe(true);
    expect(Object.is(ctx.macro[5], 1 / ctx.macro[4])).toBe(true);
  });

  /** Spec scenario: explicit rate overrides the derived one. */
  it('applies the explicit ω⁻ instead of the one lambda derives', () => {
    const base = { tau: 0.6, collision: 'trt' as const, lambda: 3 / 16 };
    const derived = makeCollideContext(D3Q19_SPEC, base);
    const overridden = makeCollideContext(D3Q19_SPEC, { ...base, omegaMinus: 1.4 });

    const fa = perturbedPopulations(1, 0.05);
    const fb = Float64Array.from(fa);
    collideCell(fa, derived);
    collideCell(fb, overridden);

    expect(overridden.macro[6]).toBe(1.4);
    expect(derived.macro[6]).not.toBe(1.4);
    // Same τ_eff and same ω⁺ — only the antisymmetric relaxation moved.
    expect(Object.is(derived.macro[4], overridden.macro[4])).toBe(true);
    expect(Object.is(derived.macro[5], overridden.macro[5])).toBe(true);
    let differs = false;
    for (let i = 0; i < fa.length; i++) if (!Object.is(fa[i], fb[i])) differs = true;
    expect(differs, 'explicit ω⁻ left the populations unchanged').toBe(true);
  });

  /** Spec scenario: an out-of-range rate is rejected, not silently clamped. */
  it('rejects an out-of-range ω⁻ naming the parameter and the interval', () => {
    for (const bad of [0, -0.5, 2, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        makeCollideContext(D3Q19_SPEC, { tau: 0.6, collision: 'trt', omegaMinus: bad }),
      ).toThrow(/omegaMinus must be in the open interval \(0, 2\)/);
    }
  });

  /** Silently discarding it under BGK would misreport what the run applied. */
  it('rejects an ω⁻ override under a single-relaxation operator', () => {
    expect(() =>
      makeCollideContext(D3Q19_SPEC, { tau: 0.6, collision: 'bgk', omegaMinus: 1.4 }),
    ).toThrow(/omegaMinus requires collision 'trt'/);
  });

  /** Task 2.4 — the option reaches the collision context through every solver entry point. */
  it('threads omegaMinus through Solver3D and EsotericPull3D', () => {
    const opts = {
      nx: NX,
      ny: NY,
      nz: NZ,
      omega: 1 / 0.6,
      flags: ductFlags(),
      inletVelocity: 0.05,
      collision: 'trt' as const,
      omegaMinus: 1.4,
    };
    expect(new Solver3D(opts).ctx.omegaMinus).toBe(1.4);
    expect(new EsotericPull3D(opts).ctx.omegaMinus).toBe(1.4);
  });
});
