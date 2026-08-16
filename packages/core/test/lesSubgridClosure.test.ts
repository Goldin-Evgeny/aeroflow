import { describe, expect, it } from 'vitest';
import {
  compareStrain,
  lesKFromCs,
  piNeqNormLegacy,
  piNeqNormSpec,
  smagorinskyTauEff,
} from '../src/index.js';

/**
 * fix-confirmed-physics-defects, les-subgrid-closure, tasks 6.5/6.6.
 *
 * Two things this file must prove that no other test proves:
 *  1. The 'spec' closure matches the ANALYTIC Smagorinsky target — an oracle derived from
 *     the textbook model (ν_t = Cs²|S|) and the Chapman-Enskog stress/strain relation
 *     (Π_αβ = −2ρc_s²τ·S_αβ), not from the solver's own `lesK`/norm constants. This is
 *     the test the pre-fix code lacked: `tauStats.test.ts` and
 *     `centralMomentEigenProof.test.ts` re-declared `lesK` and asserted the solver against
 *     a copy of itself, which cannot detect an error in the shared formula.
 *  2. The closure/inversion round-trip is the identity under EITHER convention, and the
 *     strain-audit ratio `compareStrain` reports is IDENTICAL between conventions — so
 *     fixing the norm does not, by itself, move the V11 mechanism diagnosis for a
 *     bookkeeping reason unrelated to the field being audited.
 */

describe('LES closure: analytic Smagorinsky oracle (independent of solver constants)', () => {
  /**
   * Simple shear u_x = γ·y (all else zero) has an EXACT analytic strain rate: only
   * S_xy = S_yx = γ/2 is nonzero, so |S| = √(2·S:S) = √(2·2·(γ/2)²) = γ.
   *
   * The Chapman-Enskog relation between the non-equilibrium stress and the strain rate is
   * Π_αβ = −2ρc_s²τ_eff·S_αβ (Krüger et al. 2017 ch. 3; c_s² = 1/3 on this lattice). Given
   * a TARGET τ_eff, this determines γ (and hence Π) without needing to run a solver or
   * solve the implicit closure — γ = (τ_eff − τ0)/(3·Cs²), the Smagorinsky ν_t = Cs²|S|
   * relation applied directly. Feeding the resulting Π back into `smagorinskyTauEff` must
   * recover exactly the τ_eff that was used to construct it.
   */
  function manufacturedShearPi(targetTauEff: number, tau0: number, cs: number, rho: number) {
    const tauT = targetTauEff - tau0;
    const gamma = tauT / (3 * cs * cs); // ν_t = Cs²|S| = Cs²·γ, τ_t = 3ν_t
    const cs2 = 1 / 3;
    const pxy = -2 * rho * cs2 * targetTauEff * (gamma / 2);
    return { p: Float64Array.of(0, 0, 0, pxy, 0, 0), gamma };
  }

  it("'spec' recovers the target τ_eff from a manufactured Π via the Chapman-Enskog relation", () => {
    const tau0 = 0.51;
    const cs = 0.1;
    const rho = 1;
    const targetTauEff = 0.55;
    const { p, gamma } = manufacturedShearPi(targetTauEff, tau0, cs, rho);
    expect(gamma).toBeGreaterThan(0); // sanity: a real shear, not a degenerate zero

    const lesK = lesKFromCs(cs);
    const tauEff = smagorinskyTauEff(tau0, lesK, piNeqNormSpec(p), rho);
    expect(tauEff).toBeCloseTo(targetTauEff, 10);
  });

  it("'spec' matches the analytic target across a range of shear magnitudes and τ0", () => {
    const cs = 0.1;
    const rho = 1;
    for (const tau0 of [0.5001, 0.51, 0.55, 0.8]) {
      for (const targetTauEff of [tau0 + 1e-4, tau0 + 0.01, tau0 + 0.1]) {
        const { p } = manufacturedShearPi(targetTauEff, tau0, cs, rho);
        const lesK = lesKFromCs(cs);
        const tauEff = smagorinskyTauEff(tau0, lesK, piNeqNormSpec(p), rho);
        expect(tauEff).toBeCloseTo(targetTauEff, 9);
      }
    }
  });

  it("'legacy' does NOT match the analytic target (this is the confirmed defect, pinned)", () => {
    // Same manufactured Π, same target — but piNeqNormLegacy is √2 too large, so the
    // recovered τ_eff overshoots the analytic target. This test exists to catch a future
    // "fix" that quietly changes what 'legacy' means; 'legacy' must stay wrong in exactly
    // this way, because reproducing OLD results is the only reason it still exists.
    const tau0 = 0.51;
    const cs = 0.1;
    const rho = 1;
    const targetTauEff = 0.55;
    const { p } = manufacturedShearPi(targetTauEff, tau0, cs, rho);
    const lesK = lesKFromCs(cs);
    const tauEffLegacy = smagorinskyTauEff(tau0, lesK, piNeqNormLegacy(p), rho);
    expect(tauEffLegacy).not.toBeCloseTo(targetTauEff, 3);
    expect(tauEffLegacy).toBeGreaterThan(targetTauEff); // too much viscosity, not too little
  });
});

describe('LES closure: round-trip and cross-convention audit invariance', () => {
  const nx = 5;
  const ny = 5;
  const nz = 5;
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);

  function fields() {
    const n = nx * ny * nz;
    return {
      tauEff: new Float64Array(n),
      evaluated: new Uint8Array(n).fill(1),
      rho: new Float64Array(n).fill(1),
      ux: new Float64Array(n),
      uy: new Float64Array(n),
      uz: new Float64Array(n),
    };
  }

  // Same manufactured linear field as strainComparison.test.ts's first case: a uniform
  // FD strain of `expected` everywhere, so tauEff can be constructed to match exactly
  // under either convention and compareStrain's inversion must recover it exactly.
  const scale = 1e-3;
  const expected = Math.sqrt(744) * scale;
  const tau0 = 0.5001;
  const lesK = lesKFromCs(0.1);

  function buildFor(lesNorm: 'spec' | 'legacy') {
    const data = fields();
    const inversionFactor = lesNorm === 'spec' ? 6 * Math.SQRT2 : 6;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = at(x, y, z);
          data.ux[idx] = scale * (2 * x + 3 * y + 4 * z);
          data.uy[idx] = scale * (5 * x + 6 * y + 7 * z);
          data.uz[idx] = scale * (8 * x + 9 * y + 10 * z);
          // Constructed so that the CLOSURE's own inversion for `lesNorm` recovers exactly
          // `expected` — this is the round-trip: closure(strain) -> tauEff -> inversion(tauEff)
          // -> strain, and the middle step must be the identity.
          data.tauEff[idx] = tau0 + (lesK * expected) / inversionFactor;
        }
      }
    }
    return data;
  }

  it("round-trip is the identity under 'spec'", () => {
    const data = buildFor('spec');
    const result = compareStrain({ nx, ny, nz, tau0, lesK, lesNorm: 'spec', ...data });
    expect(result.piImplied.mean).toBeCloseTo(expected, 12);
    expect(result.medianRatioSlope).toBeCloseTo(1, 10);
  });

  it("round-trip is the identity under 'legacy'", () => {
    const data = buildFor('legacy');
    const result = compareStrain({ nx, ny, nz, tau0, lesK, lesNorm: 'legacy', ...data });
    expect(result.piImplied.mean).toBeCloseTo(expected, 12);
    expect(result.medianRatioSlope).toBeCloseTo(1, 10);
  });

  it('the strain-audit ratio is IDENTICAL between conventions for the same underlying field', () => {
    // This is the invariance the design explicitly calls out: fixing the norm must not, by
    // itself, move the V11 mechanism's reported ratio for a bookkeeping reason. Build two
    // fields whose tauEff differs (because the closure differs) but which represent the
    // SAME physical strain — each inverted with its OWN matching convention — and confirm
    // both report the same ratio against the same finite-difference field.
    const specData = buildFor('spec');
    const legacyData = buildFor('legacy');
    const specResult = compareStrain({ nx, ny, nz, tau0, lesK, lesNorm: 'spec', ...specData });
    const legacyResult = compareStrain({
      nx,
      ny,
      nz,
      tau0,
      lesK,
      lesNorm: 'legacy',
      ...legacyData,
    });
    expect(specResult.medianRatioSlope).toBeCloseTo(legacyResult.medianRatioSlope, 10);
    expect(specResult.piImplied.mean).toBeCloseTo(legacyResult.piImplied.mean, 10);
  });

  it('using the WRONG inversion for a convention breaks the round-trip (sanity check on the test itself)', () => {
    // If lesNorm is specified as 'spec' but the tauEff field was built for 'legacy', the
    // round-trip must NOT be the identity — confirming the round-trip tests above are
    // actually sensitive to getting the convention right, not vacuously passing.
    const data = buildFor('legacy');
    const result = compareStrain({ nx, ny, nz, tau0, lesK, lesNorm: 'spec', ...data });
    expect(result.medianRatioSlope).not.toBeCloseTo(1, 3);
  });
});
