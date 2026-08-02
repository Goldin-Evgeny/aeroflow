import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { cavityScene2D } from '../src/scenes/cavity2d.js';
import { cavityCenterlines, compareToGhia } from '../src/validation/cavity.js';
import { GHIA_U, GHIA_V } from '../src/fixtures/ghia.js';
import {
  steadyStateResidual,
  SteadyStateDetector,
  STEADY_STATE_THRESHOLD,
  STEADY_STATE_INTERVAL,
} from '../src/stats/steadyState.js';

/**
 * M3 headline-run machinery: the scene builder, the centreline/Ghia scoring, and the
 * steady-state detector. These are the pieces the GPU acceptance runs depend on, so they
 * are pinned here against analytic answers rather than against solver output.
 */

describe('M3 cavityScene2D', () => {
  it('matches the spec sanity numbers for both acceptance grids', () => {
    // M3 step 3 states these exact values.
    const a = cavityScene2D({ H: 256, Re: 100 });
    expect(a.nu).toBeCloseTo(0.256, 12);
    expect(a.tau).toBeCloseTo(1.268, 12);

    const b = cavityScene2D({ H: 512, Re: 1000 });
    expect(b.nu).toBeCloseTo(0.0512, 12);
    expect(b.tau).toBeCloseTo(0.6536, 12);

    // Both must sit inside the stable envelope (τ > 0.5, u ≤ 0.1).
    for (const s of [a, b]) {
      expect(s.tau).toBeGreaterThan(0.5);
      expect(s.uLid).toBeLessThanOrEqual(0.1);
    }
  });

  it('builds a one-cell solid rim with the lid across the whole top row incl. corners', () => {
    const H = 8;
    const { nx, ny, flags, wallVelocity, uLid } = cavityScene2D({ H, Re: 100 });
    expect(nx).toBe(H + 2);
    expect(ny).toBe(H + 2);
    const idx = (x: number, y: number) => y * nx + x;

    // Interior is fluid.
    for (let j = 1; j <= H; j++) {
      for (let i = 1; i <= H; i++) expect(flags[idx(i, j)]).toBe(CellType.Fluid);
    }
    // Rim is solid, and ONLY the top row carries lid velocity — including both corners,
    // which is the convention the Ghia numbers were derived under.
    for (let x = 0; x < nx; x++) {
      expect(flags[idx(x, 0)]).toBe(CellType.Solid);
      expect(flags[idx(x, ny - 1)]).toBe(CellType.Solid);
      expect(wallVelocity[2 * idx(x, ny - 1)]).toBe(uLid);
      expect(wallVelocity[2 * idx(x, 0)]).toBe(0);
    }
    for (let y = 0; y < ny; y++) {
      expect(flags[idx(0, y)]).toBe(CellType.Solid);
      expect(flags[idx(nx - 1, y)]).toBe(CellType.Solid);
      // Side walls are stationary except where the top row overrides them (the corners).
      if (y !== ny - 1) {
        expect(wallVelocity[2 * idx(0, y)]).toBe(0);
        expect(wallVelocity[2 * idx(nx - 1, y)]).toBe(0);
      }
    }
  });

  it('rejects odd H, because the centreline extraction assumes two straddling columns', () => {
    expect(() => cavityScene2D({ H: 65 })).toThrow(/even integer/);
  });
});

describe('M3 centreline extraction', () => {
  /**
   * Node j sits at (j − 0.5)/H, NOT j/(H−1). Feeding in a field that is an exact linear
   * function of that coordinate must come back exactly, which is what pins the mapping:
   * an off-by-half-a-cell convention shows up immediately as a shifted profile.
   */
  it('places nodes at (j − 0.5)/H and averages the two central columns', () => {
    const H = 16;
    const uLid = 0.1;
    const nx = H + 2;
    const n = nx * (H + 2);
    const ux = new Float64Array(n);
    const uy = new Float64Array(n);
    const idx = (x: number, y: number) => y * nx + x;

    // ux = uLid · y-coordinate; uy = uLid · x-coordinate.
    for (let j = 0; j < H + 2; j++) {
      for (let i = 0; i < nx; i++) {
        ux[idx(i, j)] = uLid * ((j - 0.5) / H);
        uy[idx(i, j)] = uLid * ((i - 0.5) / H);
      }
    }

    const lines = cavityCenterlines(ux, uy, H, uLid);
    expect(lines.y).toHaveLength(H);
    expect(lines.x).toHaveLength(H);
    expect(lines.y[0]).toBeCloseTo(0.5 / H, 12);
    expect(lines.y[H - 1]).toBeCloseTo((H - 0.5) / H, 12);
    // Normalized profile equals the coordinate itself.
    for (let k = 0; k < H; k++) expect(lines.u[k]).toBeCloseTo(lines.y[k], 12);

    // The v line averages columns c and c+1, i.e. exactly the centre x=0.5.
    const c = H / 2;
    const expectedCentre = 0.5 * ((c - 0.5) / H + (c + 1 - 0.5) / H);
    expect(expectedCentre).toBeCloseTo(0.5, 12);
    for (let k = 0; k < H; k++) expect(lines.v[k]).toBeCloseTo(lines.x[k], 12);
  });
});

describe('M3 compareToGhia', () => {
  /** Feeding the reference tables back in must score a perfect zero at every extremum. */
  it('scores the Ghia tables against themselves as exactly zero error', () => {
    for (const Re of [100, 1000] as const) {
      // The tables run 1→0; interpProfile handles either direction, but the extraction
      // produces ascending coordinates, so mirror them here.
      const y = [...GHIA_U.y].reverse();
      const u = [...(Re === 100 ? GHIA_U.re100 : GHIA_U.re1000)].reverse();
      const x = [...GHIA_V.x].reverse();
      const v = [...(Re === 100 ? GHIA_V.re100 : GHIA_V.re1000)].reverse();

      const cmp = compareToGhia({ y, u, x, v }, Re);
      for (const e of cmp.extrema) {
        expect(e.relError, `${Re} ${e.name}`).toBeLessThan(1e-12);
      }
      expect(cmp.pass).toBe(true);
      expect(cmp.maxAbsErrorU).toBeLessThan(1e-12);
      expect(cmp.maxAbsErrorV).toBeLessThan(1e-12);
    }
  });

  it('reads reference values from the fixture, not from retyped constants', () => {
    const y = [...GHIA_U.y].reverse();
    const u = [...GHIA_U.re100].reverse();
    const x = [...GHIA_V.x].reverse();
    const v = [...GHIA_V.re100].reverse();
    const cmp = compareToGhia({ y, u, x, v }, 100);

    const uMin = cmp.extrema.find((e) => e.name === 'u_min')!;
    const vMin = cmp.extrema.find((e) => e.name === 'v_min')!;
    // These are the M3 acceptance-1 anchors; they must come back off the published table.
    expect(uMin.reference).toBe(-0.2109);
    expect(uMin.coord).toBe(0.4531);
    expect(uMin.tolerance).toBe(0.015);
    expect(vMin.reference).toBe(-0.24533);
    expect(vMin.coord).toBe(0.8047);

    // Re=1000 gates v_max too, and its u_min sits at a different coordinate.
    const cmp1000 = compareToGhia({ y, u, x, v }, 1000);
    expect(cmp1000.extrema.find((e) => e.name === 'u_min')!.coord).toBe(0.1719);
    expect(cmp1000.extrema.find((e) => e.name === 'v_max')!.reference).toBe(0.37095);
    expect(cmp1000.extrema.find((e) => e.name === 'v_max')!.tolerance).toBe(0.02);
  });

  it('fails a gated extremum that drifts past its bar, and never gates report-only rows', () => {
    const y = [...GHIA_U.y].reverse();
    const x = [...GHIA_V.x].reverse();
    // Scale u by 1.05 (5 % high, past the ±1.5 % bar) and leave v exact.
    const u = [...GHIA_U.re100].reverse().map((z) => z * 1.05);
    const v = [...GHIA_V.re100].reverse();

    const cmp = compareToGhia({ y, u, x, v }, 100);
    const uMin = cmp.extrema.find((e) => e.name === 'u_min')!;
    expect(uMin.relError).toBeCloseTo(0.05, 6);
    expect(uMin.pass).toBe(false);
    expect(cmp.pass).toBe(false);

    // u(0.5) is also 5 % off but is report-only, so it reports null rather than failing.
    const uHalf = cmp.extrema.find((e) => e.name === 'u(0.5)')!;
    expect(uHalf.tolerance).toBeNull();
    expect(uHalf.pass).toBeNull();
  });
});

describe('M3 steady-state residual', () => {
  it('is zero for an unchanged field and scales as ‖Δu‖/uRef', () => {
    const flags = new Uint8Array([
      CellType.Fluid,
      CellType.Fluid,
      CellType.Solid,
      CellType.Fluid,
      CellType.Fluid,
    ]);
    const zero = new Float64Array(5);
    expect(steadyStateResidual(zero, zero, zero, zero, flags, 0.1)).toBe(0);

    // Every fluid cell moves by (3e-3, 4e-3) → ‖Δu‖ = 5e-3; uRef = 0.1 → R = 0.05.
    const ux = new Float64Array([3e-3, 3e-3, 999, 3e-3, 3e-3]);
    const uy = new Float64Array([4e-3, 4e-3, 999, 4e-3, 4e-3]);
    expect(steadyStateResidual(zero, zero, ux, uy, flags, 0.1)).toBeCloseTo(0.05, 12);
  });

  it('ignores solid cells entirely', () => {
    const flags = new Uint8Array([CellType.Fluid, CellType.Solid]);
    const zero = new Float64Array(2);
    // A huge change inside the solid cell must not register.
    const ux = new Float64Array([0, 1e6]);
    expect(steadyStateResidual(zero, zero, ux, zero, flags, 0.1)).toBe(0);
  });

  it('throws rather than silently returning NaN on a degenerate call', () => {
    const zero = new Float64Array(1);
    expect(() =>
      steadyStateResidual(zero, zero, zero, zero, new Uint8Array([CellType.Solid]), 0.1),
    ).toThrow(/no fluid cells/);
    expect(() =>
      steadyStateResidual(zero, zero, zero, zero, new Uint8Array([CellType.Fluid]), 0),
    ).toThrow(/uRef/);
  });

  it('publishes the documented criterion constants (M3 acceptance 3)', () => {
    expect(STEADY_STATE_THRESHOLD).toBe(1e-7);
    expect(STEADY_STATE_INTERVAL).toBe(1000);
  });
});

/**
 * The stopping rule. The threshold must keep priority whenever the arithmetic can reach it;
 * the plateau rule exists only because FP32 floors ~30× above 1e-7 (measured table in
 * `stats/steadyState.ts`), and stopping there is what keeps the FP32 answer correct.
 */
describe('M3 SteadyStateDetector', () => {
  it('stops on the documented threshold, and reports THAT rule', () => {
    const d = new SteadyStateDetector();
    expect(d.push(1000, 1e-3)).toBe('running');
    expect(d.push(2000, 1e-7)).toBe('threshold');
    // Exactly at the bar counts as met; the criterion is "≤".
    expect(new SteadyStateDetector().push(1000, STEADY_STATE_THRESHOLD)).toBe('threshold');
  });

  it('keeps running while the residual is still decreasing', () => {
    const d = new SteadyStateDetector();
    let r = 1e-2;
    // A steady 20 %/sample decay is well past the 5 % improvement bar.
    for (let i = 1; i <= 40; i++) {
      r *= 0.8;
      if (r <= STEADY_STATE_THRESHOLD) break;
      expect(d.push(1000 * i, r), `sample ${i} (r=${r.toExponential(2)})`).toBe('running');
    }
  });

  it('declares a plateau at a noisy floor a running minimum would ratchet through', () => {
    const d = new SteadyStateDetector();
    let step = 0;
    let verdict: string = 'running';

    // The measured shape of a real run: a decay of ~5 decades from 1.8e-1 …
    let r = 1.829e-1;
    while (r > 3.4e-6) {
      r *= 0.8;
      step += 1000;
      verdict = d.push(step, r);
      expect(verdict, `must not stop mid-decay at r=${r.toExponential(2)}`).toBe('running');
    }
    // … then the FP32 floor: ~3.2e-6 jittering ±15 %, never improving. A running minimum
    // would ratchet down through this noise; the median-of-windows test does not.
    const floor = [3.43, 3.66, 3.18, 3.76, 3.21, 3.55, 3.29, 3.61, 3.34, 3.48].map((z) => z * 1e-6);
    for (let i = 0; i < 40 && verdict === 'running'; i++) {
      step += 1000;
      verdict = d.push(step, floor[i % floor.length]);
    }
    expect(verdict).toBe('plateau');
    expect(d.samples.length).toBeGreaterThanOrEqual(20);
  });

  it('will not call a plateau during spin-up, even when the residual goes flat', () => {
    // Starting from rest the lid spins the cavity up at a roughly constant rate, so the
    // residual sits flat near its peak. A "stopped improving" rule alone fires here and
    // ended a real 256² run in 2.4 s; the decades-below-peak test is what prevents it.
    const d = new SteadyStateDetector();
    let verdict: string = 'running';
    for (let i = 1; i <= 60 && verdict === 'running'; i++) {
      verdict = d.push(1000 * i, 1.8e-1 * (1 + 0.02 * Math.sin(i)));
    }
    expect(verdict).toBe('running');
  });

  it('does not mistake a slow but real decay for a plateau', () => {
    const d = new SteadyStateDetector();
    let r = 1e-3;
    let verdict: string = 'running';
    // 10 %/sample still beats the 5 % per-window improvement bar comfortably.
    for (let i = 1; i <= 25 && verdict === 'running'; i++) {
      r *= 0.9;
      verdict = d.push(1000 * i, r);
    }
    expect(verdict).toBe('running');
  });
});
