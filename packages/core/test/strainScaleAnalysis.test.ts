import { describe, expect, it } from 'vitest';
import { analyzeStrainScales } from '../src/index.js';

function fields(
  nx: number,
  ny: number,
  nz: number,
  velocity: (x: number, y: number, z: number) => readonly [number, number, number],
) {
  const n = nx * ny * nz;
  const evaluated = new Uint8Array(n).fill(1);
  const ux = new Float64Array(n);
  const uy = new Float64Array(n);
  const uz = new Float64Array(n);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = x + nx * (y + ny * z);
        [ux[idx], uy[idx], uz[idx]] = velocity(x, y, z);
      }
    }
  }
  return { nx, ny, nz, evaluated, ux, uy, uz };
}

describe('strain spatial-scale analysis', () => {
  it('recovers scale-invariant linear derivatives and retains their energy as long-wave trend', () => {
    const input = fields(20, 20, 20, (x, y, z) => [2 * y + 4 * z, 6 * x + 8 * z, 10 * x + 12 * y]);
    const result = analyzeStrainScales(input);

    expect(result.commonStencilCells).toBe(12 ** 3);
    expect(result.contributions.duxDy.stencils.map((entry) => entry.rms)).toEqual([2, 2, 2]);
    expect(result.components.xy.stencils.map((entry) => entry.rms)).toEqual([4, 4, 4]);
    expect(result.components.xz.stencils.map((entry) => entry.rms)).toEqual([7, 7, 7]);
    expect(result.components.yz.stencils.map((entry) => entry.rms)).toEqual([10, 10, 10]);
    for (const scale of result.components.xy.stencils) {
      expect(scale.energyRatioToH).toBeCloseTo(1, 14);
      expect(scale.throughOriginSlopeVsH).toBeCloseTo(1, 14);
      expect(scale.normalizedRmsDifferenceVsH).toBeCloseTo(0, 14);
    }
    expect(result.contributions.duxDy.spectrum.bands['>16'].fraction).toBeCloseTo(1, 12);
    expect(result.contributions.duxDy.spectrum.trendEnergy).toBeCloseTo(
      result.contributions.duxDy.spectrum.totalEnergy,
      10,
    );
    expect(
      result.components.xy.shortWaveLocalization.x.reduce(
        (sum, bin) => sum + bin.highPassEnergy,
        0,
      ),
    ).toBeCloseTo(0, 14);
  });

  it('places a four-cell transverse wave in the short bands and exposes stencil attenuation', () => {
    const input = fields(72, 16, 16, (x) => [0, Math.sin((2 * Math.PI * x) / 4), 0]);
    const result = analyzeStrainScales(input);
    const spectrum = result.contributions.duyDx.spectrum;
    const shortFraction = spectrum.bands['2-4'].fraction + spectrum.bands['4-8'].fraction;
    const bandFraction = Object.values(spectrum.bands).reduce(
      (sum, band) => sum + band.fraction,
      0,
    );
    const reconstructedEnergy = spectrum.modes.reduce((sum, mode) => sum + mode.energy, 0);

    expect(shortFraction).toBeGreaterThan(0.98);
    expect(bandFraction).toBeCloseTo(1, 12);
    expect(reconstructedEnergy + spectrum.trendEnergy).toBeCloseTo(spectrum.totalEnergy, 12);
    expect(spectrum.bands['>16'].fraction).toBeLessThan(0.01);
    expect(result.contributions.duyDx.stencils[0].rms).toBeCloseTo(Math.SQRT1_2, 12);
    expect(result.contributions.duyDx.stencils[1].energyRatioToH).toBeLessThan(1e-24);
    expect(result.contributions.duyDx.stencils[2].energyRatioToH).toBeLessThan(1e-24);
    expect(result.components.xy.stencils[1].normalizedRmsDifferenceVsH).toBeCloseTo(1, 12);
  });

  it('identifies a 32-cell wave as long-wave without periodic wrapping of the selected line', () => {
    const input = fields(72, 16, 16, (x) => [0, Math.sin((2 * Math.PI * x) / 32), 0]);
    const result = analyzeStrainScales(input);
    const spectrum = result.contributions.duyDx.spectrum;

    expect(spectrum.bands['>16'].fraction).toBeGreaterThan(0.98);
    expect(spectrum.bands['2-4'].fraction).toBeLessThan(1e-4);
    expect(spectrum.lines).toBe(8 * 8);
    expect(spectrum.samples).toBe(result.commonStencilCells);
  });

  it('uses one common h/2h/4h stencil mask and reports rejected cells', () => {
    const input = fields(16, 16, 16, (x, y, z) => [x + y, y + z, z + x]);
    input.evaluated[8 + 16 * (8 + 16 * 8)] = 0;
    const result = analyzeStrainScales(input);

    expect(result.selectedCells).toBe(16 ** 3 - 1);
    expect(result.commonStencilCells).toBeLessThan(8 ** 3);
    expect(result.rejectedIncompleteStencil).toBe(result.selectedCells - result.commonStencilCells);
    expect(
      result.components.xy.stencils.every((entry) => entry.samples === result.commonStencilCells),
    ).toBe(true);
  });

  it('localizes h-versus-2h disagreement without claiming it is a Fourier band', () => {
    const input = fields(72, 20, 16, (x, y) => [
      0,
      (y < 10 ? 1 : 0.1) * Math.sin((2 * Math.PI * x) / 4),
      0,
    ]);
    const result = analyzeStrainScales(input);
    const localization = result.components.xy.shortWaveLocalization;
    const energetic = localization.y.find((bin) => bin.coordinateCells === 6);
    const weak = localization.y.find((bin) => bin.coordinateCells === 12);

    expect(localization.method).toContain('(S_h - S_2h)^2');
    expect(energetic).toBeDefined();
    expect(weak).toBeDefined();
    expect(energetic!.highPassEnergy).toBeGreaterThan(50 * weak!.highPassEnergy);
    expect(localization.y.reduce((sum, bin) => sum + bin.highPassEnergyFraction, 0)).toBeCloseTo(
      1,
      12,
    );
  });
});
