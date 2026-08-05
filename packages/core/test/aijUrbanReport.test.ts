import { describe, expect, it } from 'vitest';
import type { AijUrbanData, AijUrbanDirection, UrbanDomainPlan } from '../src/index.js';
import { AIJ_DATA_PAPER, AIJ_DISCLAIMER } from '../src/validation/aijAttribution.js';
import { buildAijUrbanReport } from '../src/validation/aijUrbanReport.js';

const attribution = {
  dataPaper: AIJ_DATA_PAPER,
  caseSources: ['experiment paper'],
  processing: 'test fixture',
  disclaimer: AIJ_DISCLAIMER,
};
const source = {
  url: 'https://www.aij.or.jp/source.xls',
  file: 'source.xls',
  sha256: 'a'.repeat(64),
  retrieved: '2026-07-24',
};
const geometry = {
  ...source,
  file: 'source.zip',
  convertedFile: 'geometry.glb',
  coordinateTransform: 'source to glTF',
};
const direction: AijUrbanDirection = {
  windFromDegrees: 0,
  uRefMps: 4,
  probes: [
    { id: '1', east: 0, north: 0, up: 2, u: 0.5 },
    { id: '2', east: 1, north: 0, up: 2, u: 1 },
  ],
};
const data = (caseId: 'C' | 'E'): AijUrbanData => ({
  caseId,
  source,
  geometry,
  attribution,
  geometryVariant: 'After Construction',
  coordinateOrigin: 'origin',
  coordinateScale: 'full-scale',
  measurement: {
    speedUnit: 'u/uRef',
    statistic: 'time-mean-of-instantaneous-scalar-speed',
    uRef: 'reference',
    probeHeightMeters: 2,
  },
  inflow: { kind: 'power', alpha: 0.25, note: 'published' },
  directions: [direction],
});
const plan = (acceptanceReady = true): UrbanDomainPlan => ({
  domainSize: [10, 10, 10],
  grid: { nx: 10, ny: 10, nz: 10 },
  totalCells: 1_000,
  dx: 1,
  maxBuildingHeight: 2,
  geometryOffset: [1, 0, 1],
  probeLatticeY: acceptanceReady ? 2 : 1,
  cellsPerBuildingHeight: 10,
  blockage: 0.01,
  requiredDx: 0.8,
  requiredCells: 2_000,
  checks: [
    {
      code: 'probe-height',
      pass: acceptanceReady,
      message: acceptanceReady ? 'resolved' : 'probe plane below third node',
    },
  ],
  acceptanceReady,
});
const evidence = {
  generatedAt: '2026-07-24T12:00:00.000Z',
  precision: 'fp16' as const,
  totalSteps: 1_300,
  transientSteps: 300,
  flowThroughSteps: 100,
  elapsedMs: 60_000,
  voxelizationMs: 400,
  gpu: 'test GPU',
  browser: 'test browser',
  probeSampling: 'published-coordinates' as const,
};

describe('buildAijUrbanReport', () => {
  it('emits a reproducible Case E pass after ten averaged flow-throughs', () => {
    const report = buildAijUrbanReport(data('E'), direction, plan(), [0.5, 1], evidence);
    expect(report.verdict).toBe('pass');
    expect(report.metrics).toMatchObject({ q: 1, r: 1, qGate: 0.66, rGate: 0.7 });
    expect(report.simulation.averagingFlowThroughs).toBe(10);
    expect(report.rows[1]).toMatchObject({ id: '2', measured: 1, simulated: 1, delta: 0 });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('suppresses a verdict when resolution or averaging is incomplete', () => {
    const report = buildAijUrbanReport(data('E'), direction, plan(false), [0.5, 1], {
      ...evidence,
      totalSteps: 1_200,
    });
    expect(report.verdict).toBe('suppressed');
    expect(report.suppressionReasons).toEqual([
      'probe plane below third node',
      '9.00 averaged flow-throughs (gate: >= 10)',
    ]);
  });

  it('applies only the q gate to Case C', () => {
    const report = buildAijUrbanReport(data('C'), direction, plan(), [0.75, 0.75], evidence);
    expect(report.metrics.r).toBeNull();
    expect(report.metrics.rGate).toBeNull();
    expect(report.verdict).toBe('pass');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('records approximate probe locations as a suppressed smoke result', () => {
    const report = buildAijUrbanReport(data('C'), direction, plan(), [0.5, 1], {
      ...evidence,
      probeSampling: 'nearest-fluid-cell-smoke',
    });
    expect(report.verdict).toBe('suppressed');
    expect(report.simulation.probeSampling).toBe('nearest-fluid-cell-smoke');
    expect(report.suppressionReasons).toContain(
      'under-resolved smoke run samples nearest interior fluid cells, not published probe coordinates',
    );
  });
});
