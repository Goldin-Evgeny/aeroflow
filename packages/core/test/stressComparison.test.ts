import { describe, expect, it } from 'vitest';
import { compareStressTensors, STRESS_COMPONENTS } from '../src/index.js';

const nx = 5;
const ny = 5;
const nz = 5;
const n = nx * ny * nz;
const cs2 = 1 / 3;
const scale = 4e-4;
const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);

function analyticFields(transform: (hydro: number[], trace: number, component: number) => number) {
  const evaluated = new Uint8Array(n).fill(1);
  const rho = new Float64Array(n);
  const ux = new Float64Array(n);
  const uy = new Float64Array(n);
  const uz = new Float64Array(n);
  const tauEff = new Float64Array(n);
  const piNeq = new Float64Array(6 * n);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = at(x, y, z);
        rho[idx] = 1 + 0.01 * (x + y + z);
        tauEff[idx] = 0.7 + 0.001 * (x + 2 * y + 3 * z);
        ux[idx] = scale * (x * x + y * y);
        uy[idx] = scale * (y * y + z * z);
        uz[idx] = scale * (z * z + x * x);
        // Centered differences reproduce these derivatives exactly for the quadratic field.
        const strain = [
          2 * scale * x,
          2 * scale * y,
          2 * scale * z,
          scale * y,
          scale * x,
          scale * z,
        ];
        const factor = -2 * rho[idx] * cs2 * tauEff[idx];
        const hydro = strain.map((value) => factor * value);
        const trace = hydro[0] + hydro[1] + hydro[2];
        for (let component = 0; component < 6; component++) {
          piNeq[6 * idx + component] = transform(hydro, trace, component);
        }
      }
    }
  }
  return { nx, ny, nz, evaluated, rho, ux, uy, uz, tauEff, piNeq, cs2 };
}

describe('pre-collision Pi_neq versus finite-difference hydrodynamic stress', () => {
  it('recovers one multiplicative factor for every component, trace, and deviatoric tensor', () => {
    const alpha = 2.6;
    const result = compareStressTensors(
      analyticFields((hydro, _trace, component) => alpha * hydro[component]),
    );

    expect(result.tensorCells).toBe(27);
    for (const component of STRESS_COMPONENTS) {
      const stats = result.components[component];
      expect(stats.pearsonCorrelation).toBeCloseTo(1, 12);
      expect(stats.spearmanRankCorrelation).toBeCloseTo(1, 12);
      expect(stats.throughOriginSlope).toBeCloseTo(alpha, 12);
      expect(stats.unconstrainedSlope).toBeCloseTo(alpha, 12);
      expect(stats.unconstrainedIntercept).toBeCloseTo(0, 14);
      expect(stats.normalizedRmsResidual).toBeLessThan(1e-12);
      expect(stats.signAgreementRate).toBe(1);
    }
    expect(result.global.throughOriginSlope).toBeCloseTo(alpha, 12);
    expect(result.global.normalizedRmsResidual).toBeLessThan(1e-12);
    expect(result.trace.hydrodynamic.throughOriginSlope).toBeCloseTo(alpha, 12);
    expect(result.deviatoric.throughOriginSlope).toBeCloseTo(alpha, 12);
  });

  it('isolates a trace-only multiplier while leaving deviatoric agreement exact', () => {
    const traceMultiplier = 3;
    const result = compareStressTensors(
      analyticFields((hydro, trace, component) => {
        if (component >= 3) return hydro[component];
        return hydro[component] - trace / 3 + (traceMultiplier * trace) / 3;
      }),
    );

    expect(result.trace.hydrodynamic.throughOriginSlope).toBeCloseTo(traceMultiplier, 12);
    expect(result.trace.hydrodynamic.normalizedRmsResidual).toBeLessThan(1e-12);
    expect(result.deviatoric.throughOriginSlope).toBeCloseTo(1, 12);
    expect(result.deviatoric.normalizedRmsResidual).toBeLessThan(1e-12);
    expect(result.global.normalizedRmsResidual).toBeGreaterThan(0.1);
  });

  it('reports distinct component factors and a nonzero global residual', () => {
    const factors = [1, 1.5, 2, 2.5, 3, 3.5];
    const result = compareStressTensors(
      analyticFields((hydro, _trace, component) => factors[component] * hydro[component]),
    );

    STRESS_COMPONENTS.forEach((component, index) => {
      expect(result.components[component].throughOriginSlope).toBeCloseTo(factors[index], 12);
      expect(result.components[component].normalizedRmsResidual).toBeLessThan(1e-12);
    });
    expect(result.global.normalizedRmsResidual).toBeGreaterThan(0.2);
    expect(result.residualByBoundaryDistance.x.length).toBeGreaterThan(0);
    expect(result.residualByBoundaryDistance.y.length).toBeGreaterThan(0);
    expect(result.residualByBoundaryDistance.z.length).toBeGreaterThan(0);
  });
});
