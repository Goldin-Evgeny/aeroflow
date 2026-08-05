import type { UrbanDomainPlan } from '../scenes/urbanDomain.js';
import { scoreAijUrbanDirection, type AijUrbanData, type AijUrbanDirection } from './aijUrban.js';

export interface AijUrbanRunEvidence {
  generatedAt: string;
  precision: 'fp16' | 'fp32';
  totalSteps: number;
  transientSteps: number;
  flowThroughSteps: number;
  elapsedMs: number;
  voxelizationMs: number;
  gpu: string;
  browser: string;
  probeSampling: 'published-coordinates' | 'nearest-fluid-cell-smoke';
}

export interface AijUrbanReportRow {
  id: string;
  east: number;
  north: number;
  up: number;
  measured: number;
  simulated: number;
  delta: number;
  hit: boolean;
}

export interface AijUrbanReport {
  schemaVersion: 1;
  generatedAt: string;
  caseId: AijUrbanData['caseId'];
  geometryVariant?: string;
  windFromDegrees: number;
  provenance: {
    measurements: AijUrbanData['source'];
    geometry: AijUrbanData['geometry'];
    /** Citations and AIJ's disclaimer travel with every exported score. */
    attribution: AijUrbanData['attribution'];
  };
  method: {
    measurementStatistic: AijUrbanData['measurement']['statistic'];
    inflow: AijUrbanData['inflow'];
    collision: 'trt';
    lesCs: 0.1;
  };
  simulation: {
    grid: UrbanDomainPlan['grid'];
    totalCells: number;
    dx: number;
    precision: AijUrbanRunEvidence['precision'];
    totalSteps: number;
    transientSteps: number;
    averagingSteps: number;
    flowThroughSteps: number;
    averagingFlowThroughs: number;
    elapsedMs: number;
    voxelizationMs: number;
    gpu: string;
    browser: string;
    probeSampling: AijUrbanRunEvidence['probeSampling'];
  };
  resolution: {
    acceptanceReady: boolean;
    requiredCells: number;
    requiredDx: number;
    checks: UrbanDomainPlan['checks'];
  };
  metrics: {
    q: number;
    qGate: 0.66;
    r: number | null;
    rGate: 0.7 | null;
  };
  verdict: 'pass' | 'fail' | 'suppressed';
  suppressionReasons: string[];
  rows: AijUrbanReportRow[];
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** Build the JSON-safe evidence artifact consumed by the M11 UI and M15 trust page. */
export function buildAijUrbanReport(
  data: AijUrbanData,
  direction: AijUrbanDirection,
  plan: UrbanDomainPlan,
  simulated: ArrayLike<number>,
  evidence: AijUrbanRunEvidence,
): AijUrbanReport {
  if (
    Number.isNaN(Date.parse(evidence.generatedAt)) ||
    !nonNegativeInteger(evidence.totalSteps) ||
    !nonNegativeInteger(evidence.transientSteps) ||
    !Number.isInteger(evidence.flowThroughSteps) ||
    evidence.flowThroughSteps <= 0 ||
    evidence.totalSteps < evidence.transientSteps ||
    ![evidence.elapsedMs, evidence.voxelizationMs].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) ||
    evidence.gpu.length === 0 ||
    evidence.browser.length === 0 ||
    (evidence.probeSampling !== 'published-coordinates' &&
      evidence.probeSampling !== 'nearest-fluid-cell-smoke')
  ) {
    throw new Error('buildAijUrbanReport: invalid run evidence');
  }
  if (!data.directions.includes(direction)) {
    throw new Error('buildAijUrbanReport: direction does not belong to fixture');
  }

  const score = scoreAijUrbanDirection(direction, simulated);
  const averagingSteps = evidence.totalSteps - evidence.transientSteps;
  const averagingFlowThroughs = averagingSteps / evidence.flowThroughSteps;
  const suppressionReasons = plan.checks
    .filter((check) => !check.pass)
    .map((check) => check.message);
  if (averagingFlowThroughs < 10) {
    suppressionReasons.push(
      `${averagingFlowThroughs.toFixed(2)} averaged flow-throughs (gate: >= 10)`,
    );
  }
  if (evidence.probeSampling === 'nearest-fluid-cell-smoke') {
    suppressionReasons.push(
      'under-resolved smoke run samples nearest interior fluid cells, not published probe coordinates',
    );
  }
  const correlation = Number.isFinite(score.r) ? score.r : null;
  const qPass = score.q >= 0.66;
  const rPass = data.caseId === 'C' || (correlation !== null && correlation >= 0.7);
  const verdict = suppressionReasons.length > 0 ? 'suppressed' : qPass && rPass ? 'pass' : 'fail';

  return {
    schemaVersion: 1,
    generatedAt: evidence.generatedAt,
    caseId: data.caseId,
    geometryVariant: data.geometryVariant,
    windFromDegrees: direction.windFromDegrees,
    provenance: {
      measurements: data.source,
      geometry: data.geometry,
      attribution: data.attribution,
    },
    method: {
      measurementStatistic: data.measurement.statistic,
      inflow: data.inflow,
      collision: 'trt',
      lesCs: 0.1,
    },
    simulation: {
      grid: plan.grid,
      totalCells: plan.totalCells,
      dx: plan.dx,
      precision: evidence.precision,
      totalSteps: evidence.totalSteps,
      transientSteps: evidence.transientSteps,
      averagingSteps,
      flowThroughSteps: evidence.flowThroughSteps,
      averagingFlowThroughs,
      elapsedMs: evidence.elapsedMs,
      voxelizationMs: evidence.voxelizationMs,
      gpu: evidence.gpu,
      browser: evidence.browser,
      probeSampling: evidence.probeSampling,
    },
    resolution: {
      acceptanceReady: plan.acceptanceReady,
      requiredCells: plan.requiredCells,
      requiredDx: plan.requiredDx,
      checks: plan.checks,
    },
    metrics: {
      q: score.q,
      qGate: 0.66,
      r: correlation,
      rGate: data.caseId === 'E' ? 0.7 : null,
    },
    verdict,
    suppressionReasons,
    rows: score.rows.map((row) => ({
      id: row.probe.id,
      east: row.probe.east,
      north: row.probe.north,
      up: row.probe.up,
      measured: row.probe.u,
      simulated: row.sim,
      delta: row.sim - row.probe.u,
      hit: row.hit,
    })),
  };
}
