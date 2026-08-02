import { describe, expect, it } from 'vitest';
import {
  aijUrbanDirection,
  aijUrbanMeasuredInflow,
  aijUrbanProbesInWindFrame,
  scoreAijUrbanDirection,
  validateAijUrbanData,
  type AijUrbanRawFixture,
} from '../src/validation/aijUrban.js';

const SHA256 = 'a'.repeat(64);

function caseEFixture(): AijUrbanRawFixture {
  const probes = Array.from({ length: 80 }, (_, index) => ({
    id: `P${index + 1}`,
    x: index === 0 ? 0 : 0.01 * index,
    y: index === 0 ? 0.04 : 0,
    z: 0.008,
    speed: 2 + index * 0.01,
  }));
  return {
    schemaVersion: 1,
    caseId: 'E',
    source: {
      url: 'https://www.aij.or.jp/example.xls',
      file: 'example.xls',
      sha256: SHA256,
      retrieved: '2026-07-23',
    },
    geometry: {
      url: 'https://www.aij.or.jp/example.zip',
      file: 'example.zip',
      sha256: SHA256,
      retrieved: '2026-07-23',
      convertedFile: 'geometry.glb',
      coordinateTransform: 'source (X,Y,Z) -> glTF (X,Z,-Y)',
    },
    coordinates: {
      lengthUnit: 'model-m',
      modelScale: 250,
      xAxisEnu: { east: 1, north: 0 },
      yAxisEnu: { east: 0, north: 1 },
      origin: 'fixture origin shared with geometry',
    },
    measurement: {
      speedUnit: 'm/s',
      statistic: 'time-mean-of-instantaneous-scalar-speed',
      uRef: 'wind-tunnel reference speed',
      uRefHeightMeters: 0.008,
      probeHeightMeters: 0.008,
      probeHeightFullScaleMeters: 2,
    },
    inflow: { kind: 'power', alpha: 0.25, note: 'published Case E inflow' },
    directions: [
      { windFromDegrees: 0, uRefMps: 4, probes },
      {
        windFromDegrees: 90,
        uRefMps: 5,
        probes: probes.map((probe) => ({ ...probe, speed: probe.speed + 0.5 })),
      },
    ],
  };
}

function convertToCaseC(raw: AijUrbanRawFixture): void {
  raw.caseId = 'C';
  for (const direction of raw.directions) {
    const template = direction.probes[direction.probes.length - 1];
    while (direction.probes.length < 120) {
      const index = direction.probes.length;
      direction.probes.push({ ...template, id: `P${index + 1}`, x: 0.01 * index });
    }
  }
}

describe('validateAijUrbanData', () => {
  it('preserves model meters for simulation and converts raw m/s to U/Uref once', () => {
    const data = validateAijUrbanData(caseEFixture());
    expect(data.caseId).toBe('E');
    expect(data.coordinateScale).toBe('model');
    expect(data.measurement.probeHeightFullScaleMeters).toBe(2); // reporting only
    expect(data.measurement.statistic).toBe('time-mean-of-instantaneous-scalar-speed');
    const north = aijUrbanDirection(data, 360);
    expect(north.probes).toHaveLength(80);
    expect(north.probes[0]).toMatchObject({ east: 0, north: 0.04, up: 0.008 });
    expect(north.probes[0].u).toBeCloseTo(0.5, 12); // 2 m/s / 4 m/s
    const east = aijUrbanDirection(data, 450);
    expect(east.probes[0].u).toBeCloseTo(0.5, 12); // 2.5 m/s / 5 m/s
  });

  it('rotates probes using meteorological FROM semantics', () => {
    const direction = aijUrbanDirection(validateAijUrbanData(caseEFixture()), 0);
    const probes = aijUrbanProbesInWindFrame(direction);
    // P1 is 0.04 model-m north. Wind from north puts it 0.04 model-m UPSTREAM.
    expect(probes[0]).toMatchObject({ id: 'P1', x: -0.04, y: 0.008, z: 0 });
  });

  it('preserves already-normalized speed instead of dividing it twice', () => {
    const raw = caseEFixture();
    raw.measurement.speedUnit = 'u/uRef';
    raw.directions[0].probes[0].speed = 0.73;
    const data = validateAijUrbanData(raw);
    expect(data.directions[0].probes[0].u).toBeCloseTo(0.73, 12);
  });

  it('rejects duplicate periodic directions and incomplete Case E probe sets', () => {
    const duplicate = caseEFixture();
    duplicate.directions[1].windFromDegrees = 360;
    expect(() => validateAijUrbanData(duplicate)).toThrow(/duplicate wind direction/);

    const incomplete = caseEFixture();
    incomplete.directions[0].probes.pop();
    expect(() => validateAijUrbanData(incomplete)).toThrow(/79 probes, expected 80/);
  });

  it('rejects coordinate drift between directions and a left-handed basis', () => {
    const moved = caseEFixture();
    moved.directions[1].probes[3].x += 0.001;
    expect(() => validateAijUrbanData(moved)).toThrow(/coordinate differs/);

    const mirrored = caseEFixture();
    mirrored.coordinates.yAxisEnu = { east: 0, north: -1 };
    expect(() => validateAijUrbanData(mirrored)).toThrow(/right-handed/);
  });

  it('rejects wrong probe units/heights and a non-published Case E inflow', () => {
    const wrongHeight = caseEFixture();
    wrongHeight.directions[0].probes[0].z = 2;
    expect(() => validateAijUrbanData(wrongHeight)).toThrow(/height/);

    const wrongInflow = caseEFixture();
    wrongInflow.inflow = { kind: 'power', alpha: 0.2, note: 'wrong benchmark profile' };
    expect(() => validateAijUrbanData(wrongInflow)).toThrow(/alpha=0.25/);

    const ambiguous = caseEFixture() as unknown as Record<string, unknown>;
    (ambiguous.measurement as Record<string, unknown>).speedUnit = 'normalized';
    expect(() => validateAijUrbanData(ambiguous)).toThrow(/measurement metadata/);
  });

  it('rejects inconsistent model/full-scale reporting metadata', () => {
    const raw = caseEFixture();
    raw.measurement.probeHeightFullScaleMeters = 1.5;
    expect(() => validateAijUrbanData(raw)).toThrow(/does not equal reported full-scale/);
  });

  it('validates selected geometry variants and normalizes measured inflow', () => {
    const raw = caseEFixture();
    convertToCaseC(raw);
    raw.geometryVariant = '2H';
    raw.inflow = {
      kind: 'measured',
      speedUnit: 'm/s',
      samples: [
        { z: 0.004, speed: 2 },
        { z: 0.008, speed: 4, sigmaSpeed: 0.5 },
        { z: 0.012, speed: 5 },
      ],
      note: 'official measured profile',
    };
    raw.directions = [raw.directions[0]];
    raw.directions[0].uRefMps = 4;
    raw.directions[0].probes = raw.directions[0].probes.map((probe) => ({
      ...probe,
      speedByVariant: { '0H': probe.speed + 0.1, '1H': probe.speed + 0.2, '2H': probe.speed },
    }));
    const data = validateAijUrbanData(raw);
    expect(aijUrbanMeasuredInflow(data, data.directions[0])).toEqual([
      { z: 0.004, u: 0.5 },
      { z: 0.008, u: 1 },
      { z: 0.012, u: 1.25 },
    ]);

    raw.directions[0].probes[0].speedByVariant!['2H'] += 0.01;
    expect(() => validateAijUrbanData(raw)).toThrow(/selected geometry variant 2H/);
  });

  it('rejects a measured inflow whose Uref disagrees with the stated height', () => {
    const raw = caseEFixture();
    convertToCaseC(raw);
    raw.inflow = {
      kind: 'measured',
      speedUnit: 'm/s',
      samples: [
        { z: 0.004, speed: 2 },
        { z: 0.012, speed: 6 },
      ],
      note: 'linear test profile',
    };
    raw.directions = [raw.directions[0]];
    raw.directions[0].uRefMps = 3.9; // interpolation at z=0.008 is exactly 4.0
    expect(() => validateAijUrbanData(raw)).toThrow(/does not match measured inflow/);
  });
});

describe('scoreAijUrbanDirection', () => {
  it('reports VDI q and Pearson r on normalized values', () => {
    const raw = caseEFixture();
    raw.measurement.speedUnit = 'u/uRef';
    raw.directions = [raw.directions[0]];
    raw.directions[0].probes = raw.directions[0].probes.map((probe, index) => ({
      ...probe,
      speed: index / 100,
    }));
    const direction = validateAijUrbanData(raw).directions[0];
    const sim = direction.probes.map((probe, index) => probe.u + (index === 0 ? 0.3 : 0.1));
    const score = scoreAijUrbanDirection(direction, sim);
    expect(score.q).toBeCloseTo(79 / 80, 12);
    expect(score.rows.filter((row) => !row.hit)).toHaveLength(1);
    expect(score.r).toBeGreaterThan(0.99);
  });
});
