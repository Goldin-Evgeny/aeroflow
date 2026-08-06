import { describe, expect, it } from 'vitest';
import { CellType, fieldStats } from '../src/index.js';

/**
 * `fieldStats` is the stability instrumentation the M9 Cs sweep reads to tell a clean rung from
 * one that merely survived. Its contract is arithmetic, so it is pinned against hand-computed
 * values rather than against another implementation.
 */

const NX = 4;
const NY = 3;
const NZ = 2;
const N = NX * NY * NZ;

/** Uniform ρ=1, u=0 field with every cell fluid — the worker's initial condition. */
function uniformField(): { macro: Float32Array; flags: Uint8Array } {
  const macro = new Float32Array(4 * N);
  for (let i = 0; i < N; i++) macro[4 * i] = 1;
  return { macro, flags: new Uint8Array(N).fill(CellType.Fluid) };
}

describe('fieldStats', () => {
  it('reports zero mass drift on the uniform ρ=1 initial condition', () => {
    const { macro, flags } = uniformField();
    const s = fieldStats(macro, flags, NX, NY, NZ);

    // massDriftRel is defined against ρ=1 per fluid cell, so the initial condition must be
    // exactly zero — not "small". A nonzero value here would mean the reference is wrong and
    // every drift number the sweep reports is offset by it.
    expect(s.fluidCells).toBe(N);
    expect(s.totalMass).toBe(N);
    expect(s.massDriftRel).toBe(0);
    expect(s.rhoMin).toBe(1);
    expect(s.rhoMax).toBe(1);
    expect(s.rhoMean).toBe(1);
    expect(s.uMax).toBe(0);
    expect(s.machMax).toBe(0);
    expect(s.nonFiniteCells).toBe(0);
  });

  it('excludes the boundary shell, which the macro pass leaves at ρ=0', () => {
    // REGRESSION (2026-08-06, caught by the M9 smoke ladder). `write_macro` populates only
    // FLUID cells and stores ρ=0 elsewhere, so filtering with `isSolid` — which passes
    // Inlet/Outlet/FreeSlip through — counted the entire boundary shell as zero-density
    // fluid. On the 120×37×67 Ahmed smoke grid that shell is ~6.5% of the domain and a
    // perfectly healthy run reported −7.3% mass drift with ρ_min = 0.
    const { macro, flags } = uniformField();
    flags[0] = CellType.Inlet;
    flags[1] = CellType.Outlet;
    flags[2] = CellType.FreeSlip;
    macro[4 * 0] = 0; // what write_macro actually leaves behind
    macro[4 * 1] = 0;
    macro[4 * 2] = 0;

    const s = fieldStats(macro, flags, NX, NY, NZ);

    expect(s.fluidCells).toBe(N - 3);
    expect(s.massDriftRel).toBe(0);
    expect(s.rhoMin).toBe(1);
    expect(s.rhoMean).toBe(1);
  });

  it('excludes Solid and BodySolid cells from every statistic', () => {
    const { macro, flags } = uniformField();
    // Garbage in the solids: LBM never writes meaningful macros there, so counting them would
    // corrupt the mass reference AND manufacture density extrema out of uninitialized memory.
    flags[0] = CellType.Solid;
    flags[1] = CellType.BodySolid;
    macro[0] = 500;
    macro[4] = -500;
    macro[4 * 1 + 1] = 99;

    const s = fieldStats(macro, flags, NX, NY, NZ);

    expect(s.fluidCells).toBe(N - 2);
    expect(s.totalMass).toBe(N - 2);
    expect(s.massDriftRel).toBe(0);
    expect(s.rhoMin).toBe(1);
    expect(s.rhoMax).toBe(1);
    expect(s.uMax).toBe(0);
  });

  it('computes signed drift, density extrema and Mach from a perturbed field', () => {
    const { macro, flags } = uniformField();
    macro[4 * 2] = 1.5; // heavy cell
    macro[4 * 5] = 0.75; // light cell
    macro[4 * 7 + 1] = 0.3; // ux
    macro[4 * 7 + 3] = 0.4; // uz ⇒ |u| = 0.5

    const s = fieldStats(macro, flags, NX, NY, NZ);

    expect(s.totalMass).toBeCloseTo(N + 0.5 - 0.25, 12);
    expect(s.massDriftRel).toBeCloseTo(0.25 / N, 12);
    expect(s.rhoMax).toBeCloseTo(1.5, 12);
    expect(s.rhoMin).toBeCloseTo(0.75, 12);
    expect(s.uMax).toBeCloseTo(0.5, 6);
    expect(s.machMax).toBeCloseTo(0.5 * Math.sqrt(3), 6);
  });

  it('counts non-finite cells without poisoning the surviving statistics', () => {
    const { macro, flags } = uniformField();
    macro[4 * 3] = Number.NaN;
    macro[4 * 6 + 2] = Number.POSITIVE_INFINITY;

    const s = fieldStats(macro, flags, NX, NY, NZ);

    // The point of the exclusion: a diverging rung must still be able to say what the healthy
    // remainder of the field looked like. If NaN propagated, every number would be NaN and the
    // report could not distinguish two poisoned cells from a destroyed domain.
    expect(s.nonFiniteCells).toBe(2);
    expect(s.fluidCells).toBe(N - 2);
    expect(Number.isFinite(s.rhoMean)).toBe(true);
    expect(s.rhoMean).toBe(1);
    expect(s.uMax).toBe(0);
  });

  it('returns NaN statistics rather than throwing when no fluid cell survives', () => {
    const { macro, flags } = uniformField();
    flags.fill(CellType.Solid);

    const s = fieldStats(macro, flags, NX, NY, NZ);

    expect(s.fluidCells).toBe(0);
    expect(s.totalMass).toBe(0);
    expect(Number.isNaN(s.massDriftRel)).toBe(true);
    expect(Number.isNaN(s.rhoMin)).toBe(true);
  });

  it('rejects arrays too short for the stated grid', () => {
    const { flags } = uniformField();
    expect(() => fieldStats(new Float32Array(4 * N - 1), flags, NX, NY, NZ)).toThrow(/macro/);
    expect(() => fieldStats(new Float32Array(4 * N), new Uint8Array(N - 1), NX, NY, NZ)).toThrow(
      /flags/,
    );
  });
});
