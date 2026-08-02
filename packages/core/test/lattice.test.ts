import { describe, expect, it } from 'vitest';
import { D2Q9, equilibrium } from '../src/lattice.js';

const { q, ex, ey, w, opp, cs2 } = D2Q9;

describe('D2Q9 lattice constants', () => {
  it('weights sum to 1', () => {
    const sum = w.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 15);
  });

  it('first moment of weights vanishes: Σ wᵢ eᵢ = 0', () => {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < q; i++) {
      sx += w[i] * ex[i];
      sy += w[i] * ey[i];
    }
    expect(sx).toBeCloseTo(0, 15);
    expect(sy).toBeCloseTo(0, 15);
  });

  it('second moment gives c_s²·δ: Σ wᵢ eᵢₐeᵢᵦ = (1/3)δₐᵦ', () => {
    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (let i = 0; i < q; i++) {
      xx += w[i] * ex[i] * ex[i];
      yy += w[i] * ey[i] * ey[i];
      xy += w[i] * ex[i] * ey[i];
    }
    expect(xx).toBeCloseTo(cs2, 15);
    expect(yy).toBeCloseTo(cs2, 15);
    expect(xy).toBeCloseTo(0, 15);
  });

  it('opposite directions are consistent: e[opp[i]] = −e[i]', () => {
    for (let i = 0; i < q; i++) {
      expect(ex[opp[i]] + ex[i]).toBe(0);
      expect(ey[opp[i]] + ey[i]).toBe(0);
      expect(opp[opp[i]]).toBe(i);
    }
  });
});

describe('equilibrium distribution', () => {
  const cases: Array<[number, number, number]> = [
    [1, 0, 0],
    [1.05, 0.08, -0.03],
    [0.97, -0.05, 0.1],
  ];

  it.each(cases)('conserves density and momentum for ρ=%f, u=(%f,%f)', (rho, ux, uy) => {
    let r = 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < q; i++) {
      const feq = equilibrium(i, rho, ux, uy);
      r += feq;
      mx += ex[i] * feq;
      my += ey[i] * feq;
    }
    expect(r).toBeCloseTo(rho, 12);
    expect(mx).toBeCloseTo(rho * ux, 12);
    expect(my).toBeCloseTo(rho * uy, 12);
  });
});
