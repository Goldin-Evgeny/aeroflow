import { GHIA_U, GHIA_V, interpProfile } from '../fixtures/ghia.js';

/**
 * M3 lid-driven-cavity scoring against Ghia, Ghia & Shin 1982 (docs/handoff/H9-fixtures-ghia.md).
 *
 * Two pieces: centreline extraction from a macroscopic field, and the comparison against
 * the 17-point reference tables. Every reference number is READ FROM `fixtures/ghia.ts`
 * by coordinate lookup — none is retyped here, so there is exactly one copy of the tables
 * in the repo (CLAUDE.md honest-claims rule).
 *
 * Node positions: with halfway bounce-back the wall sits half a cell outside the first
 * fluid node, so interior node `j ∈ [1, H]` sits at normalized coordinate `(j − 0.5)/H`
 * and the walls are at 0 and 1 exactly. Using `j/(H−1)` instead shifts every interpolated
 * comparison by half a cell and shows up as a systematic ~1–2 % error that no amount of
 * extra convergence removes (M3.md pitfall "Node positions vs. wall positions").
 */

export interface CavityCenterlines {
  /** Normalized y of each interior node on the vertical centreline x=0.5. */
  y: number[];
  /** ux/uLid at those nodes. */
  u: number[];
  /** Normalized x of each interior node on the horizontal centreline y=0.5. */
  x: number[];
  /** uy/uLid at those nodes. */
  v: number[];
}

/**
 * Extract both centrelines from a macroscopic field on the `(H+2)²` cavity domain.
 *
 * The geometric centre x=0.5 falls *between* two node columns for even H, so the two
 * straddling columns are averaged (equivalent to linear interpolation at 0.5). Taking a
 * single column biases the v extrema (M3.md pitfall "Even-n centreline").
 */
export function cavityCenterlines(
  ux: ArrayLike<number>,
  uy: ArrayLike<number>,
  H: number,
  uLid: number,
): CavityCenterlines {
  const nx = H + 2;
  const idx = (x: number, y: number) => y * nx + x;
  const c = H / 2; // interior nodes c and c+1 straddle the centre

  const y: number[] = [];
  const u: number[] = [];
  const x: number[] = [];
  const v: number[] = [];
  for (let j = 1; j <= H; j++) {
    y.push((j - 0.5) / H);
    u.push((0.5 * (ux[idx(c, j)] + ux[idx(c + 1, j)])) / uLid);
  }
  for (let i = 1; i <= H; i++) {
    x.push((i - 0.5) / H);
    v.push((0.5 * (uy[idx(i, c)] + uy[idx(i, c + 1)])) / uLid);
  }
  return { y, u, x, v };
}

export type CavityRe = 100 | 1000;

export interface CavityExtremum {
  /** e.g. "u_min", "v_min", "v_max", "u(0.5)". */
  name: string;
  /** Ghia coordinate the profile is interpolated at. */
  coord: number;
  /** Ghia reference value at that coordinate. */
  reference: number;
  /** Simulated profile interpolated at `coord`. */
  simulated: number;
  /** |sim − ref| / |ref|, as a fraction (not a percentage). */
  relError: number;
  /** Acceptance tolerance as a fraction, or null when this row is report-only. */
  tolerance: number | null;
  /** Whether `relError <= tolerance`. Null when the row is report-only. */
  pass: boolean | null;
}

export interface CavityGhiaComparison {
  Re: CavityRe;
  extrema: CavityExtremum[];
  /** Max |sim − ref| across all 17 in-range points of each table (absolute, normalized u). */
  maxAbsErrorU: number;
  maxAbsErrorV: number;
  /** True when every gated extremum passes. Report-only rows never affect this. */
  pass: boolean;
}

/**
 * The acceptance extrema per M3.md §Acceptance criteria 1 and 2. `tolerance: null` marks
 * the rows the spec calls "secondary (report, not gate)".
 *
 * Coordinates index into the Ghia tables; the reference VALUES are looked up from them.
 */
const TARGETS: Record<
  CavityRe,
  { name: string; table: 'u' | 'v'; coord: number; tolerance: number | null }[]
> = {
  100: [
    { name: 'u_min', table: 'u', coord: 0.4531, tolerance: 0.015 },
    { name: 'v_min', table: 'v', coord: 0.8047, tolerance: 0.015 },
    { name: 'u(0.5)', table: 'u', coord: 0.5, tolerance: null },
    { name: 'v_max', table: 'v', coord: 0.2344, tolerance: null },
  ],
  1000: [
    { name: 'u_min', table: 'u', coord: 0.1719, tolerance: 0.02 },
    { name: 'v_min', table: 'v', coord: 0.9063, tolerance: 0.02 },
    { name: 'v_max', table: 'v', coord: 0.1563, tolerance: 0.02 },
    { name: 'u(0.5)', table: 'u', coord: 0.5, tolerance: null },
  ],
};

/** Reference value at an exact Ghia table coordinate — never interpolated, never retyped. */
function referenceAt(table: 'u' | 'v', coord: number, Re: CavityRe): number {
  const coords = table === 'u' ? GHIA_U.y : GHIA_V.x;
  const values =
    table === 'u'
      ? Re === 100
        ? GHIA_U.re100
        : GHIA_U.re1000
      : Re === 100
        ? GHIA_V.re100
        : GHIA_V.re1000;
  const k = coords.findIndex((c) => Math.abs(c - coord) < 1e-9);
  if (k < 0) throw new Error(`referenceAt: ${coord} is not a Ghia ${table}-table coordinate`);
  return values[k];
}

/** Max absolute deviation over the reference points that lie inside the sampled range. */
function maxAbsError(
  simCoord: readonly number[],
  simValue: readonly number[],
  refCoord: readonly number[],
  refValue: readonly number[],
): number {
  let worst = 0;
  for (let k = 0; k < refCoord.length; k++) {
    const q = refCoord[k];
    // The end points sit ON the walls, outside the fluid nodes — extrapolating there
    // would compare against a bounce-back wall value, not a simulated one.
    if (q <= simCoord[0] || q >= simCoord[simCoord.length - 1]) continue;
    worst = Math.max(worst, Math.abs(interpProfile(simCoord, simValue, q) - refValue[k]));
  }
  return worst;
}

export function compareToGhia(lines: CavityCenterlines, Re: CavityRe): CavityGhiaComparison {
  const extrema = TARGETS[Re].map((t): CavityExtremum => {
    const reference = referenceAt(t.table, t.coord, Re);
    const simulated =
      t.table === 'u'
        ? interpProfile(lines.y, lines.u, t.coord)
        : interpProfile(lines.x, lines.v, t.coord);
    const relError = Math.abs(simulated - reference) / Math.abs(reference);
    return {
      name: t.name,
      coord: t.coord,
      reference,
      simulated,
      relError,
      tolerance: t.tolerance,
      pass: t.tolerance === null ? null : relError <= t.tolerance,
    };
  });

  return {
    Re,
    extrema,
    maxAbsErrorU: maxAbsError(
      lines.y,
      lines.u,
      GHIA_U.y,
      Re === 100 ? GHIA_U.re100 : GHIA_U.re1000,
    ),
    maxAbsErrorV: maxAbsError(
      lines.x,
      lines.v,
      GHIA_V.x,
      Re === 100 ? GHIA_V.re100 : GHIA_V.re1000,
    ),
    pass: extrema.every((e) => e.pass !== false),
  };
}

/** One line per extremum, for the run report and the milestone Status section. */
export function formatGhiaComparison(cmp: CavityGhiaComparison): string {
  const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
  const rows = cmp.extrema.map((e) => {
    const verdict = e.pass === null ? 'report' : e.pass ? 'PASS' : 'FAIL';
    const bar = e.tolerance === null ? '  —  ' : `±${(100 * e.tolerance).toFixed(1)}%`;
    return (
      `  ${e.name.padEnd(7)} @${e.coord.toFixed(4)}  ref ${e.reference.toFixed(5)}  ` +
      `sim ${e.simulated.toFixed(5)}  relErr ${pct(e.relError).padStart(7)}  ` +
      `bar ${bar}  ${verdict}`
    );
  });
  return [
    `Ghia Re=${cmp.Re} comparison (${cmp.pass ? 'all gated extrema PASS' : 'GATED FAILURE'}):`,
    ...rows,
    `  max |Δ| over table points: u ${cmp.maxAbsErrorU.toFixed(5)}  v ${cmp.maxAbsErrorV.toFixed(5)}`,
  ].join('\n');
}
