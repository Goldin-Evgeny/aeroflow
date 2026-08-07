import { CellType, hasMacroscopics } from '../lattice.js';

/**
 * Ahmed wake topology, reduced to numbers (M9 force audit, phase 3).
 *
 * ## Why this exists
 *
 * The phase-3 lateral-BC A/B has a decision rule that nothing in the repo could evaluate: "if
 * the wake reorganizes materially even without a large Cd shift, that is significant". The
 * Ahmed page renders no field and there was no separation or recirculation diagnostic
 * anywhere, so that rule could only ever have been answered by eye, and only if someone had
 * thought to look. A boundary condition that changes the flow without changing the drag
 * coefficient would otherwise be recorded as "lateral BC closed" — the wrong conclusion, and
 * an expensive one to reach twice.
 *
 * The 25° slant is the right thing to watch. Ahmed's case is a topology problem before it is a
 * drag problem: at this angle the flow is on the edge between staying attached over the slant
 * (with a strong C-pillar vortex pair) and separating off the slant edge, and Cd differs
 * sharply between those two states. A far-field change is exactly the kind of thing that can
 * push it across.
 *
 * ## Cost
 *
 * Zero extra GPU work. Every quantity here is reduced from the SAME `readMacro()` image the
 * approach-flow diagnostics already pull, including the streamwise vorticity — `readMacro`
 * returns (ρ, u_x, u_y, u_z) per cell, so ω_x is a central difference on data already on the
 * host.
 *
 * ## What these numbers are
 *
 * Screening diagnostics for comparing two runs of the SAME geometry on the SAME grid, not
 * validated measurements of separation or of circulation. The staircase body has no smooth
 * surface normal, the boxes below are geometric rather than flow-adapted, and ω_x on a lattice
 * this coarse is a finite difference across cells that barely resolve the vortex core. None of
 * them carries an acceptance band and none should be quoted against experiment. What they can
 * do honestly is answer "did the wake change, and where", which is the question asked.
 */

/** Body/domain geometry in CELLS. Mirrors `ahmedTauRegions`' input so callers derive it once. */
export interface AhmedWakeGeometry {
  nx: number;
  ny: number;
  nz: number;
  /** Nose station (`AhmedScene.noseX`). */
  noseX: number;
  /** Body length in cells (`round(AhmedScene.lengthCells)`) — the normalization length. */
  bodyLength: number;
  /** Top of the body above the ground, in cells: (groundClearance + height) / dx. */
  bodyHeight: number;
  /** x at which the slant begins: noseX + (length − slantChord·cos α) / dx. */
  slantStartX: number;
  /**
   * Fluid layers probed directly above the slant surface. Default 3 — thick enough to see a
   * separated shear layer at screening resolution, thin enough not to sample the freestream.
   */
  slantShellCells?: number;
  /**
   * Streamwise extent of the near-wake box behind the base, in body lengths. Default 1.
   * Clipped to the domain.
   */
  wakeBodyLengths?: number;
}

export interface WakeProbe {
  /** Fraction of fluid cells with u_x < 0 in the near-wake box behind the base. */
  baseReverseFraction: number;
  baseCells: number;
  /**
   * Fraction with u_x < 0 in the thin shell above the slant — the attached-vs-separated
   * discriminator. Near 0 means the flow stays on the slant; a large value means it has let go.
   */
  slantReverseFraction: number;
  slantCells: number;
  /**
   * Distance from the base to the first centreline station whose u_x is no longer negative.
   * 0 means no reverse flow at the base on that line. Capped by the wake box.
   */
  recircLengthCells: number;
  /** recircLengthCells / bodyLength. */
  recircLengthBodyLengths: number;
  /**
   * Σω_x over the C-pillar box on each side of the mid-plane — a circulation proxy for each
   * member of the counter-rotating pair. A clean Ahmed wake gives two roughly equal and
   * OPPOSITE values.
   */
  gammaLeft: number;
  gammaRight: number;
  /**
   * |Γ_L + Γ_R| / (|Γ_L| + |Γ_R|) — 0 for a perfectly antisymmetric pair, 1 for one-sided.
   * The body and the grid are symmetric about the mid-plane, so a persistently nonzero value
   * is either an unsteady wake caught mid-oscillation or a broken symmetry worth explaining.
   */
  cPillarAsymmetry: number;
  meanAbsOmegaX: number;
  peakAbsOmegaX: number;
  vorticityCells: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function wakeProbe(
  macro: Float32Array,
  flags: Uint8Array,
  geom: AhmedWakeGeometry,
): WakeProbe {
  const { nx, ny, nz, noseX, bodyLength, bodyHeight, slantStartX } = geom;
  const n = nx * ny * nz;
  if (macro.length < 4 * n) {
    throw new Error(`wakeProbe: macro has ${macro.length} entries, need ${4 * n}`);
  }
  if (flags.length < n) {
    throw new Error(`wakeProbe: flags has ${flags.length} entries, need ${n}`);
  }
  if (!(bodyLength > 0)) throw new Error(`wakeProbe: bodyLength must be positive (${bodyLength})`);

  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const ux = (i: number): number => macro[4 * i + 1];
  const shell = geom.slantShellCells ?? 3;
  const wakeLen = Math.round((geom.wakeBodyLengths ?? 1) * bodyLength);

  const tailX = clamp(noseX + bodyLength, 1, nx - 2);
  const wakeEndX = clamp(tailX + wakeLen, 1, nx - 2);
  const topY = clamp(bodyHeight, 1, ny - 2);

  // ── 1. Base wake: reverse flow behind the body, below its roof line ──────────────────
  let baseCells = 0;
  let baseReverse = 0;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y <= topY; y++)
      for (let x = tailX; x <= wakeEndX; x++) {
        const i = at(x, y, z);
        if (!hasMacroscopics(flags[i])) continue;
        const v = ux(i);
        if (!Number.isFinite(v)) continue;
        baseCells++;
        if (v < 0) baseReverse++;
      }

  // ── 2. Slant shell: walk each column, find the body's top surface, probe just above it ──
  //
  // Keyed off the FLAGS rather than off an analytic slant plane, so the staircase surface the
  // solver actually sees is the one probed. The slant drops as x grows, so a fixed-height band
  // would sit inside the body at the front of the slant and in the freestream at the back.
  let slantCells = 0;
  let slantReverse = 0;
  const slantX0 = clamp(slantStartX, 1, nx - 2);
  for (let z = 1; z < nz - 1; z++)
    for (let x = slantX0; x < tailX; x++) {
      let surfaceY = -1;
      for (let y = topY; y >= 1; y--) {
        if (flags[at(x, y, z)] === CellType.BodySolid) {
          surfaceY = y;
          break;
        }
      }
      if (surfaceY < 0) continue; // no body in this column (outside the span)
      for (let k = 1; k <= shell; k++) {
        const y = surfaceY + k;
        if (y >= ny - 1) break;
        const i = at(x, y, z);
        if (!hasMacroscopics(flags[i])) continue;
        const v = ux(i);
        if (!Number.isFinite(v)) continue;
        slantCells++;
        if (v < 0) slantReverse++;
      }
    }

  // ── 3. Centreline recirculation length ───────────────────────────────────────────────
  //
  // Distance from the base to where the mid-height centreline first stops flowing backwards.
  // Stops at the first non-negative station rather than taking the furthest negative one: the
  // bubble is the CONTIGUOUS reverse region, and an isolated negative cell far downstream is
  // wake turbulence, not the closure point.
  const zMid = Math.round((nz - 1) / 2);
  const probeY = clamp(Math.round(topY / 2), 1, ny - 2);
  let recircLengthCells = 0;
  for (let x = tailX; x <= wakeEndX; x++) {
    const i = at(x, probeY, zMid);
    if (!hasMacroscopics(flags[i])) break;
    const v = ux(i);
    if (!Number.isFinite(v) || v >= 0) break;
    recircLengthCells = x - tailX + 1;
  }

  // ── 4. Streamwise vorticity ω_x = ∂u_z/∂y − ∂u_y/∂z over the C-pillar region ──────────
  //
  // Central differences, evaluated only where all four neighbours carry macroscopics, so the
  // shell and the body never contribute a one-sided difference masquerading as shear. The box
  // spans the slant and the near wake, which is where the C-pillar pair lives.
  let gammaLeft = 0;
  let gammaRight = 0;
  let sumAbs = 0;
  let peakAbs = 0;
  let vorticityCells = 0;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y <= topY; y++)
      for (let x = slantX0; x <= wakeEndX; x++) {
        const i = at(x, y, z);
        if (!hasMacroscopics(flags[i])) continue;
        const yUp = at(x, y + 1, z);
        const yDn = at(x, y - 1, z);
        const zUp = at(x, y, z + 1);
        const zDn = at(x, y, z - 1);
        if (
          !hasMacroscopics(flags[yUp]) ||
          !hasMacroscopics(flags[yDn]) ||
          !hasMacroscopics(flags[zUp]) ||
          !hasMacroscopics(flags[zDn])
        ) {
          continue;
        }
        const duzdy = 0.5 * (macro[4 * yUp + 3] - macro[4 * yDn + 3]);
        const duydz = 0.5 * (macro[4 * zUp + 2] - macro[4 * zDn + 2]);
        const omegaX = duzdy - duydz;
        if (!Number.isFinite(omegaX)) continue;
        vorticityCells++;
        const mag = Math.abs(omegaX);
        sumAbs += mag;
        if (mag > peakAbs) peakAbs = mag;
        // z == zMid contributes to neither half: on an odd nz it is the symmetry plane itself,
        // where the antisymmetric field is ~0 anyway, and splitting it either way would bias
        // the asymmetry ratio by one column.
        if (z < zMid) gammaLeft += omegaX;
        else if (z > zMid) gammaRight += omegaX;
      }

  const gammaScale = Math.abs(gammaLeft) + Math.abs(gammaRight);

  return {
    baseReverseFraction: baseCells > 0 ? baseReverse / baseCells : Number.NaN,
    baseCells,
    slantReverseFraction: slantCells > 0 ? slantReverse / slantCells : Number.NaN,
    slantCells,
    recircLengthCells,
    recircLengthBodyLengths: recircLengthCells / bodyLength,
    gammaLeft,
    gammaRight,
    cPillarAsymmetry: gammaScale > 0 ? Math.abs(gammaLeft + gammaRight) / gammaScale : Number.NaN,
    meanAbsOmegaX: vorticityCells > 0 ? sumAbs / vorticityCells : Number.NaN,
    peakAbsOmegaX: vorticityCells > 0 ? peakAbs : Number.NaN,
    vorticityCells,
  };
}
