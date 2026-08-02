import { describe, expect, it } from 'vitest';
import { D3Q19 } from '../src/lattice3d.js';

const { q, ex, ey, ez, w, opp, cs2 } = D3Q19;
const e = (i: number) => [ex[i], ey[i], ez[i]] as const;

describe('D3Q19 lattice constants (normative per docs/PHYSICS.md §2)', () => {
  it('has 1 rest + 6 axis (1/18) + 12 diagonal (1/36) directions summing to 1', () => {
    expect(q).toBe(19);
    expect(w[0]).toBeCloseTo(1 / 3, 15);
    let sum = 0;
    let axis = 0;
    let diag = 0;
    for (let i = 0; i < q; i++) {
      sum += w[i];
      const m = Math.abs(ex[i]) + Math.abs(ey[i]) + Math.abs(ez[i]);
      if (m === 1) {
        axis++;
        expect(w[i]).toBeCloseTo(1 / 18, 15);
      }
      if (m === 2) {
        diag++;
        expect(w[i]).toBeCloseTo(1 / 36, 15);
      }
    }
    expect(sum).toBeCloseTo(1, 15);
    expect(axis).toBe(6);
    expect(diag).toBe(12);
  });

  it('opposites are adjacent pairs: opp(0)=0, opp(odd i)=i+1, and e[opp]=−e', () => {
    expect(opp[0]).toBe(0);
    for (let i = 1; i < q; i += 2) expect(opp[i]).toBe(i + 1);
    for (let i = 0; i < q; i++) {
      expect(ex[opp[i]] + ex[i]).toBe(0);
      expect(ey[opp[i]] + ey[i]).toBe(0);
      expect(ez[opp[i]] + ez[i]).toBe(0);
      expect(opp[opp[i]]).toBe(i);
    }
  });

  it('second moment: Σ wᵢ eᵢₐeᵢᵦ = c_s²·δₐᵦ', () => {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let i = 0; i < q; i++) s += w[i] * e(i)[a] * e(i)[b];
        expect(s).toBeCloseTo(a === b ? cs2 : 0, 14);
      }
    }
  });

  it('fourth-moment isotropy: Σ w eₐeᵦe_ce_d = (1/9)(δₐᵦδ_cd + δₐ_cδᵦ_d + δₐ_dδᵦ_c)', () => {
    // The identity a correct D3Q19 velocity set must satisfy — a single sign typo in
    // the direction table breaks it (docs/handoff/H3-solver3d.md §1).
    const d = (a: number, b: number) => (a === b ? 1 : 0);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        for (let c = 0; c < 3; c++)
          for (let dd = 0; dd < 3; dd++) {
            let s = 0;
            for (let i = 0; i < q; i++) s += w[i] * e(i)[a] * e(i)[b] * e(i)[c] * e(i)[dd];
            const expected = (d(a, b) * d(c, dd) + d(a, c) * d(b, dd) + d(a, dd) * d(b, c)) / 9;
            expect(s).toBeCloseTo(expected, 14);
          }
  });

  it('third moment vanishes: Σ w eₐeᵦe_c = 0', () => {
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let i = 0; i < q; i++) s += w[i] * e(i)[a] * e(i)[b] * e(i)[c];
          expect(s).toBeCloseTo(0, 14);
        }
  });
});
