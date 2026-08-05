import { describe, expect, it } from 'vitest';
import {
  AIJ_DATA_PAPER,
  AIJ_DISCLAIMER,
  CellType,
  type AijUrbanData,
  type AijUrbanDirection,
} from '@aeroflow/core';
import {
  buildAijUrbanInflow,
  gltfYUpToEnu,
  planAijUrbanAveraging,
  planAijUrbanProbeSampling,
} from '../src/sim/cases/aijUrban';

const direction: AijUrbanDirection = {
  windFromDegrees: 0,
  uRefMps: 4,
  probes: [],
};
const data = (inflow: AijUrbanData['inflow']): AijUrbanData => ({
  caseId: inflow.kind === 'power' ? 'E' : 'C',
  source: {
    url: 'https://example.com/data.xls',
    file: 'data.xls',
    sha256: 'a'.repeat(64),
    retrieved: '2026-07-24',
  },
  geometry: {
    url: 'https://example.com/geometry.dxf',
    file: 'geometry.dxf',
    sha256: 'b'.repeat(64),
    retrieved: '2026-07-24',
    convertedFile: 'geometry.glb',
    coordinateTransform: 'source to glTF',
  },
  attribution: {
    dataPaper: AIJ_DATA_PAPER,
    caseSources: ['experiment paper'],
    processing: 'test fixture',
    disclaimer: AIJ_DISCLAIMER,
  },
  coordinateOrigin: 'origin',
  coordinateScale: 'full-scale',
  measurement: {
    speedUnit: 'u/uRef',
    statistic: 'time-mean-of-instantaneous-scalar-speed',
    uRef: 'reference',
    uRefHeightMeters: 2,
    probeHeightMeters: 2,
  },
  inflow,
  directions: [direction],
});

describe('AIJ urban GPU-run preparation', () => {
  it('exactly reverses the converter glTF coordinate transform', () => {
    expect(Array.from(gltfYUpToEnu([2, 5, -3, -7, 11, 13]))).toEqual([2, 3, 5, -7, -13, 11]);
    expect(() => gltfYUpToEnu([1, 2])).toThrow(/triplets/);
  });

  it('samples power-law U/Uref at fluid-node centers', () => {
    const profile = buildAijUrbanInflow(
      data({ kind: 'power', alpha: 0.25, note: 'published' }),
      direction,
      2,
      1,
    );
    expect(profile[0]).toBeCloseTo((0.5 / 2) ** 0.25, 12);
    expect(profile[1]).toBeCloseTo((1.5 / 2) ** 0.25, 12);
  });

  it('normalizes measured m/s inflow by the direction Uref before interpolation', () => {
    const profile = buildAijUrbanInflow(
      data({
        kind: 'measured',
        speedUnit: 'm/s',
        samples: [
          { z: 1, speed: 2 },
          { z: 2, speed: 4 },
        ],
        note: 'workbook',
      }),
      direction,
      2,
      1,
    );
    expect(Array.from(profile)).toEqual([0.25, 0.75]);
  });

  it('keeps the full transient for acceptance and labels smoke averaging honestly', () => {
    const acceptance = planAijUrbanAveraging(100, 0.05, true);
    expect(acceptance).toEqual({
      flowThroughSteps: 2_000,
      transientSteps: 6_000,
      sampleIntervalSteps: 100,
      targetSteps: 26_000,
    });
    const smoke = planAijUrbanAveraging(100, 0.05, false);
    expect(smoke).toEqual({
      flowThroughSteps: 2_000,
      transientSteps: 0,
      sampleIntervalSteps: 100,
      targetSteps: 20_000,
    });
  });

  it('keeps acceptance coordinates exact and labels coarse nearest-fluid sampling', () => {
    const grid = { nx: 4, ny: 4, nz: 4 };
    const flags = new Uint8Array(64).fill(CellType.Fluid);
    for (let z = 0; z < 4; z++) {
      for (let x = 0; x < 4; x++) flags[x + 4 * (4 * z)] = CellType.Solid;
    }
    flags[1 + 4 * (1 + 4)] = CellType.Solid;
    const published = [{ x: 1.2, y: -0.4, z: 1.1 }];
    expect(planAijUrbanProbeSampling(published, flags, grid, true)).toEqual({
      points: published,
      mode: 'published-coordinates',
    });
    const smoke = planAijUrbanProbeSampling(published, flags, grid, false);
    expect(smoke.mode).toBe('nearest-fluid-cell-smoke');
    expect(smoke.points[0]).toEqual({ x: 2, y: 1, z: 1 });
  });
});
