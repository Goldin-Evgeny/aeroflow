import { describe, expect, it } from 'vitest';
import {
  collideCell,
  D2Q9_SPEC,
  D3Q19_SPEC,
  equilibrium3,
  makeCollideContext,
  type LatticeSpec,
} from '../src/cpu/collide.js';

/** Deterministic non-equilibrium (but positive, mass≈1) state. */
function nonEqState(lat: LatticeSpec): Float64Array {
  const f = new Float64Array(lat.q);
  for (let i = 0; i < lat.q; i++) f[i] = lat.w[i] * (1 + 0.12 * Math.sin(3.7 * i + 1));
  return f;
}

function equilibriumState(lat: LatticeSpec, ux: number, uy: number, uz: number): Float64Array {
  const f = new Float64Array(lat.q);
  for (let i = 0; i < lat.q; i++) f[i] = equilibrium3(lat, i, 1, ux, uy, uz);
  return f;
}

function moments(lat: LatticeSpec, f: Float64Array): { rho: number; m: [number, number, number] } {
  let rho = 0;
  const m: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < lat.q; i++) {
    rho += f[i];
    m[0] += lat.ex[i] * f[i];
    m[1] += lat.ey[i] * f[i];
    m[2] += lat.ez[i] * f[i];
  }
  return { rho, m };
}

function secondMoments(lat: LatticeSpec, f: Float64Array): number[] {
  const result = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < lat.q; i++) {
    result[0] += lat.ex[i] * lat.ex[i] * f[i];
    result[1] += lat.ey[i] * lat.ey[i] * f[i];
    result[2] += lat.ez[i] * lat.ez[i] * f[i];
    result[3] += lat.ex[i] * lat.ey[i] * f[i];
    result[4] += lat.ex[i] * lat.ez[i] * f[i];
    result[5] += lat.ey[i] * lat.ez[i] * f[i];
  }
  return result;
}

describe.each([
  ['D2Q9', D2Q9_SPEC],
  ['D3Q19', D3Q19_SPEC],
])('collideCell on %s', (_name, lat) => {
  it('derives opposite pairs correctly', () => {
    expect(lat.pairs.length).toBe((lat.q - 1) / 2);
    for (const [a, b] of lat.pairs) {
      expect(lat.opp[a]).toBe(b);
      expect(lat.ex[b] + lat.ex[a]).toBe(0);
      expect(lat.ey[b] + lat.ey[a]).toBe(0);
      expect(lat.ez[b] + lat.ez[a]).toBe(0);
    }
  });

  it('conserves mass and momentum without forcing (BGK and TRT, LES on/off)', () => {
    for (const collision of ['bgk', 'trt'] as const) {
      for (const lesCs of [undefined, 0.1]) {
        const ctx = makeCollideContext(lat, { tau: 0.7, collision, lesCs });
        const f = nonEqState(lat);
        const before = moments(lat, f);
        collideCell(f, ctx);
        const after = moments(lat, f);
        expect(after.rho).toBeCloseTo(before.rho, 13);
        for (let d = 0; d < 3; d++) expect(after.m[d]).toBeCloseTo(before.m[d], 13);
      }
    }
  });

  it('T5: Guo forcing injects exactly ρg of momentum per step (H1 §4 bookkeeping)', () => {
    const g = [2e-4, -1e-4, lat === D3Q19_SPEC ? 3e-4 : 0] as const;
    for (const collision of ['bgk', 'trt'] as const) {
      for (const lesCs of [undefined, 0.1]) {
        const ctx = makeCollideContext(lat, { tau: 0.83, collision, lesCs, gravity: g });
        const f = nonEqState(lat);
        const before = moments(lat, f);
        collideCell(f, ctx);
        const after = moments(lat, f);
        expect(after.rho).toBeCloseTo(before.rho, 13);
        for (let d = 0; d < 3; d++) {
          expect(after.m[d] - before.m[d]).toBeCloseTo(before.rho * g[d], 13);
        }
      }
    }
  });

  it('T2: TRT with λ=(τ−½)² reproduces BGK', () => {
    const tau = 0.9;
    const lambda = (tau - 0.5) * (tau - 0.5);
    const fBgk = nonEqState(lat);
    const fTrt = Float64Array.from(fBgk);
    collideCell(fBgk, makeCollideContext(lat, { tau, collision: 'bgk' }));
    collideCell(fTrt, makeCollideContext(lat, { tau, collision: 'trt', lambda }));
    for (let i = 0; i < lat.q; i++) expect(fTrt[i]).toBeCloseTo(fBgk[i], 12);
  });

  it('LES is inert at equilibrium and active in a sheared state, monotone in Cs', () => {
    const tau = 0.6;
    const eq = equilibriumState(lat, 0.05, 0.02, 0);
    const ctxEq = makeCollideContext(lat, { tau, lesCs: 0.1 });
    collideCell(eq, ctxEq);
    expect(ctxEq.macro[4]).toBeCloseTo(tau, 12); // τ_eff = τ0 exactly at equilibrium

    const tauEffAt = (cs: number) => {
      const f = nonEqState(lat);
      const ctx = makeCollideContext(lat, { tau, lesCs: cs });
      collideCell(f, ctx);
      return ctx.macro[4];
    };
    const t1 = tauEffAt(0.05);
    const t2 = tauEffAt(0.1);
    const t3 = tauEffAt(0.17);
    expect(t1).toBeGreaterThan(tau);
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
  });

  // ---- H13 finite-precision conservative collision ----

  it('C1: mass correction changes only f0 and preserves momentum/stress exactly', () => {
    let observedCorrection = false;
    for (const collision of ['bgk', 'trt'] as const) {
      for (const lesCs of [undefined, 0.1]) {
        const input = nonEqState(lat);
        const inputMass = moments(lat, input).rho;
        const plain = Float64Array.from(input);
        const corrected = Float64Array.from(input);
        collideCell(plain, makeCollideContext(lat, { tau: 0.83, collision, lesCs }));
        collideCell(
          corrected,
          makeCollideContext(lat, { tau: 0.83, collision, lesCs, conserveMass: true }),
        );

        for (let i = 1; i < lat.q; i++) expect(corrected[i]).toBe(plain[i]);
        if (corrected[0] !== plain[0]) observedCorrection = true;

        const plainMoments = moments(lat, plain);
        const correctedMoments = moments(lat, corrected);
        for (let d = 0; d < 3; d++) expect(correctedMoments.m[d]).toBe(plainMoments.m[d]);
        expect(secondMoments(lat, corrected)).toEqual(secondMoments(lat, plain));
        expect(Math.abs(correctedMoments.rho - inputMass)).toBeLessThanOrEqual(
          Math.abs(plainMoments.rho - inputMass),
        );
      }
    }
    expect(observedCorrection).toBe(true);
  });

  // ---- H10 projected regularization (Latt & Chopard 2005) ----

  it('O1: regularization conserves mass and momentum (BGK/TRT, LES on/off; unforced)', () => {
    // M6 flows are unforced (forces are M7); forced regularization is gated by a throw
    // (see the rejection test below) because the Guo velocity shift leaks momentum.
    for (const collision of ['bgk', 'trt'] as const) {
      for (const lesCs of [undefined, 0.1]) {
        const ctx = makeCollideContext(lat, { tau: 0.83, collision, lesCs, regularize: true });
        const f = nonEqState(lat);
        const before = moments(lat, f);
        collideCell(f, ctx);
        const after = moments(lat, f);
        expect(after.rho).toBeCloseTo(before.rho, 13);
        for (let d = 0; d < 3; d++) expect(after.m[d]).toBeCloseTo(before.m[d], 13);
      }
    }
  });

  it('O1b: regularization combined with forcing is rejected (deferred to M7)', () => {
    expect(() =>
      makeCollideContext(lat, { tau: 0.8, regularize: true, gravity: [1e-6, 0, 0] }),
    ).toThrow(/regularization/);
  });

  it('O2: regularization removes ONLY ghost modes — Δ has zero 0th/1st/2nd moments', () => {
    // Δ = f^{out,reg} − f^{out,plain} = −(1−ω⁺)·f^ghost. Its density, momentum, and
    // momentum-flux moments must all vanish (H10 O2): the projection preserves {ρ,u,Π}
    // exactly and alters only moments ≥ 3. LES off so ω⁺ is a plain constant (≠1 here).
    const tau = 0.9;
    const plain = nonEqState(lat);
    const reg = Float64Array.from(plain);
    collideCell(plain, makeCollideContext(lat, { tau, collision: 'trt' }));
    collideCell(reg, makeCollideContext(lat, { tau, collision: 'trt', regularize: true }));

    let d0 = 0;
    const d1 = [0, 0, 0];
    // 2nd-moment components xx,yy,zz,xy,xz,yz.
    const d2 = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < lat.q; i++) {
      const di = reg[i] - plain[i];
      const ax = lat.ex[i];
      const ay = lat.ey[i];
      const az = lat.ez[i];
      d0 += di;
      d1[0] += ax * di;
      d1[1] += ay * di;
      d1[2] += az * di;
      d2[0] += ax * ax * di;
      d2[1] += ay * ay * di;
      d2[2] += az * az * di;
      d2[3] += ax * ay * di;
      d2[4] += ax * az * di;
      d2[5] += ay * az * di;
    }
    // Sanity: the states genuinely differ at higher order (regularization did something).
    let maxDiff = 0;
    for (let i = 0; i < lat.q; i++) maxDiff = Math.max(maxDiff, Math.abs(reg[i] - plain[i]));
    expect(maxDiff).toBeGreaterThan(1e-6);

    expect(d0).toBeCloseTo(0, 13);
    for (const v of d1) expect(v).toBeCloseTo(0, 13);
    for (const v of d2) expect(v).toBeCloseTo(0, 13);
  });

  it('O3: regularization is inert at equilibrium (f^(1)=0, τ_eff=τ₀)', () => {
    const tau = 0.6;
    const eq = equilibriumState(lat, 0.05, 0.02, 0);
    const ref = Float64Array.from(eq);
    const ctx = makeCollideContext(lat, { tau, collision: 'trt', regularize: true, lesCs: 0.1 });
    collideCell(eq, ctx);
    // At equilibrium, plain TRT also returns f unchanged; so does the regularized path.
    const plainCtx = makeCollideContext(lat, { tau, collision: 'trt', lesCs: 0.1 });
    const plain = Float64Array.from(ref);
    collideCell(plain, plainCtx);
    for (let i = 0; i < lat.q; i++) expect(eq[i]).toBeCloseTo(plain[i], 13);
    expect(ctx.macro[4]).toBeCloseTo(tau, 12);
  });

  it('O4: regularization leaves the LES τ_eff bit-identical (Π^neq preserved)', () => {
    const tau = 0.6;
    const off = makeCollideContext(lat, { tau, lesCs: 0.1 });
    const on = makeCollideContext(lat, { tau, lesCs: 0.1, regularize: true });
    collideCell(nonEqState(lat), off);
    collideCell(nonEqState(lat), on);
    expect(on.macro[4]).toBe(off.macro[4]);
  });

  it('rejects the legacy shift forcing outside its compatibility envelope', () => {
    expect(() =>
      makeCollideContext(lat, {
        tau: 0.8,
        collision: 'trt',
        forcing: 'shift',
        gravity: [1e-6, 0, 0],
      }),
    ).toThrow();
    expect(() =>
      makeCollideContext(lat, { tau: 0.8, lesCs: 0.1, forcing: 'shift', gravity: [1e-6, 0, 0] }),
    ).toThrow();
  });
});
