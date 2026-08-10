import { describe, expect, it } from 'vitest';
import { compareStrain } from '../src/index.js';

function fields(nx: number, ny: number, nz: number) {
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

describe('finite-difference versus Pi-implied strain', () => {
  const nx = 5;
  const ny = 5;
  const nz = 5;
  const tau0 = 0.5001;
  const lesK = 18 * Math.SQRT2 * 0.1 * 0.1;
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);

  it('uses |S| = sqrt(2 S:S) with all symmetric off-diagonal terms', () => {
    const data = fields(nx, ny, nz);
    const scale = 1e-3;
    const expected = Math.sqrt(744) * scale;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = at(x, y, z);
          data.ux[idx] = scale * (2 * x + 3 * y + 4 * z);
          data.uy[idx] = scale * (5 * x + 6 * y + 7 * z);
          data.uz[idx] = scale * (8 * x + 9 * y + 10 * z);
          data.tauEff[idx] = tau0 + (lesK * expected) / 6;
        }
      }
    }

    const result = compareStrain({ nx, ny, nz, tau0, lesK, ...data });
    expect(result.stencilCells).toBe(27);
    expect(result.finiteDifference.mean).toBeCloseTo(expected, 14);
    expect(result.piImplied.mean).toBeCloseTo(expected, 14);
    expect(result.medianRatioSlope).toBeCloseTo(1, 12);
    expect(result.meanAbsoluteResidual).toBeLessThan(1e-15);
    expect(Number.isNaN(result.pearsonCorrelation)).toBe(true);
    expect(Number.isNaN(result.spearmanRankCorrelation)).toBe(true);
  });

  it('recovers proportional spatial variation and a robust median-ratio slope', () => {
    const data = fields(nx, ny, nz);
    const coefficient = 4e-4;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = at(x, y, z);
          data.ux[idx] = coefficient * x * x;
          const finiteDifference = Math.sqrt(2) * 2 * coefficient * x;
          const piImplied = 1.5 * finiteDifference;
          data.tauEff[idx] = tau0 + (lesK * piImplied) / 6;
        }
      }
    }

    const result = compareStrain({ nx, ny, nz, tau0, lesK, ...data });
    expect(result.pearsonCorrelation).toBeCloseTo(1, 14);
    expect(result.spearmanRankCorrelation).toBeCloseTo(1, 14);
    expect(result.medianRatioSlope).toBeCloseTo(1.5, 12);
    expect(result.relativeL1Residual).toBeLessThan(1e-12);
    expect(result.residualByBoundaryDistance.x.length).toBeGreaterThan(0);
    expect(result.residualByBoundaryDistance.y.length).toBeGreaterThan(0);
    expect(result.residualByBoundaryDistance.z.length).toBeGreaterThan(0);
    expect(result.densityWeighted.finiteDifference.mean).toBeCloseTo(
      result.finiteDifference.mean,
      14,
    );
    expect(result.densityWeighted.pearsonCorrelation).toBeCloseTo(1, 12);
  });

  it('reports density-gradient sensitivity separately from velocity-gradient strain', () => {
    const data = fields(nx, ny, nz);
    const velocity = 0.01;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = at(x, y, z);
          data.rho[idx] = 1 + 0.1 * x;
          data.ux[idx] = velocity;
          const densityStrain = (Math.sqrt(2) * 0.1 * velocity) / data.rho[idx];
          data.tauEff[idx] = tau0 + (lesK * densityStrain) / 6;
        }
      }
    }

    const result = compareStrain({ nx, ny, nz, tau0, lesK, ...data });
    expect(result.finiteDifference.max).toBe(0);
    expect(result.densityWeighted.finiteDifference.mean).toBeGreaterThan(0);
    expect(result.densityWeighted.pearsonCorrelation).toBeCloseTo(1, 12);
    expect(result.densityWeighted.medianRatioSlope).toBeCloseTo(1, 11);
  });

  it('rejects a center when any oracle-evaluated stencil neighbor is missing', () => {
    const data = fields(nx, ny, nz);
    data.tauEff.fill(tau0);
    const center = at(2, 2, 2);
    data.evaluated[at(3, 2, 2)] = 0;

    const result = compareStrain({
      nx,
      ny,
      nz,
      tau0,
      lesK,
      ...data,
      select: (idx) => idx === center,
    });
    expect(result.selectedCells).toBe(1);
    expect(result.rejectedIncompleteStencil).toBe(1);
    expect(result.stencilCells).toBe(0);
    expect(Number.isNaN(result.finiteDifference.mean)).toBe(true);
  });
});
