import { enuVectorToWindFrame, normalizeDegrees } from '../geometry/windFrame.js';
import type { ResolvedVelocityStatistic } from '../stats/velocityTimeAverage.js';
import { validateAijAttribution, type AijAttribution } from './aijAttribution.js';
import { hitRate, pearson } from './score.js';

export type AijUrbanCaseId = 'C' | 'E';
export type AijUrbanSpeedUnit = 'm/s' | 'u/uRef';
export type AijUrbanSpeedStatistic = ResolvedVelocityStatistic;

export interface AijUrbanSource {
  url: string;
  file: string;
  sha256: string;
  retrieved: string;
}

export interface AijUrbanGeometrySource extends AijUrbanSource {
  convertedFile: string;
  coordinateTransform: string;
  geometryVariant?: string;
}

export interface AijUrbanRawProbe {
  id: string;
  /** Source-local horizontal x coordinate. */
  x: number;
  /** Source-local horizontal y coordinate. */
  y: number;
  /** Source-local height. */
  z: number;
  /** Raw measured speed in `measurement.speedUnit`. */
  speed: number;
  /** Optional verbatim values for every source geometry variant (Case C: 0H/1H/2H). */
  speedByVariant?: Record<string, number>;
}

export interface AijUrbanRawDirection {
  /** Optional angle as labeled by the source before conversion to meteorological FROM. */
  sourceAngleDegrees?: number;
  /** Meteorological direction FROM which wind arrives, clockwise from north. */
  windFromDegrees: number;
  /** Physical reference speed represented by U/Uref, in m/s. */
  uRefMps: number;
  probes: AijUrbanRawProbe[];
}

export interface AijUrbanRawFixture {
  schemaVersion: 1;
  caseId: AijUrbanCaseId;
  source: AijUrbanSource;
  geometry: AijUrbanGeometrySource;
  /** Citations, processing and AIJ's disclaimer — a redistribution condition, not decoration. */
  attribution: AijAttribution;
  /** Geometry variant selected into each probe's `speed` field, when the source has many. */
  geometryVariant?: string;
  coordinates: {
    /** Physical scale of source-local x/y/z. Both variants are stored in meters. */
    lengthUnit: 'model-m' | 'full-scale-m';
    /** Full scale / model scale (Case E: 250), when the official source states it. */
    modelScale?: number;
    /** ENU unit vector represented by increasing source-local x. */
    xAxisEnu: { east: number; north: number };
    /** ENU unit vector represented by increasing source-local y. */
    yAxisEnu: { east: number; north: number };
    /** Human-readable source definition of the shared geometry/probe origin. */
    origin: string;
  };
  measurement: {
    speedUnit: AijUrbanSpeedUnit;
    statistic: AijUrbanSpeedStatistic;
    /** Human-readable reference-speed convention quoted or derived from the source. */
    uRef: string;
    /** Height at which Uref is defined, in the same simulation-scale meters. */
    uRefHeightMeters?: number;
    /** Probe height in the same physical scale as `coordinates`, in meters. */
    probeHeightMeters: number;
    /** Optional full-scale equivalent for reporting only; never used to size the solver. */
    probeHeightFullScaleMeters?: number;
  };
  inflow:
    | { kind: 'power'; alpha: number; note: string }
    | {
        kind: 'measured';
        speedUnit: AijUrbanSpeedUnit;
        samples: { z: number; speed: number; sigmaSpeed?: number }[];
        note: string;
      };
  directions: AijUrbanRawDirection[];
}

export interface AijUrbanProbe {
  id: string;
  /** Local physical east/north/up meters in the benchmark's simulation scale. */
  east: number;
  north: number;
  up: number;
  /** Measured speed normalized to the direction's Uref. */
  u: number;
}

export interface AijUrbanDirection {
  windFromDegrees: number;
  uRefMps: number;
  probes: AijUrbanProbe[];
}

export interface AijUrbanData {
  caseId: AijUrbanCaseId;
  source: AijUrbanSource;
  geometry: AijUrbanGeometrySource;
  attribution: AijAttribution;
  geometryVariant?: string;
  coordinateOrigin: string;
  coordinateScale: 'model' | 'full-scale';
  modelScale?: number;
  measurement: AijUrbanRawFixture['measurement'];
  inflow: AijUrbanRawFixture['inflow'];
  directions: AijUrbanDirection[];
}

export interface AijUrbanWindFrameProbe {
  id: string;
  /** Solver coordinates in full-scale meters: +x downstream, +y up, +z flow-right. */
  x: number;
  y: number;
  z: number;
  u: number;
}

export interface AijUrbanScoreRow {
  probe: AijUrbanProbe;
  sim: number;
  hit: boolean;
}

export interface AijUrbanScore {
  q: number;
  r: number;
  rows: AijUrbanScoreRow[];
}

export interface AijUrbanInflowPoint {
  /** Height in simulation-scale meters. */
  z: number;
  /** Mean streamwise speed normalized by this direction's Uref. */
  u: number;
}

const CASE_E_PROBE_COUNT = 80;
const CASE_C_PROBE_COUNT = 120;
const UNIT_TOLERANCE = 1e-9;
const COORDINATE_TOLERANCE_METERS = 1e-7;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateSource(source: unknown): asserts source is AijUrbanSource {
  if (!isObject(source)) throw new Error('aij-urban fixture: missing source provenance');
  for (const key of ['url', 'file', 'sha256', 'retrieved'] as const) {
    if (typeof source[key] !== 'string' || source[key].length === 0) {
      throw new Error(`aij-urban fixture: missing source.${key}`);
    }
  }
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
    throw new Error('aij-urban fixture: source.sha256 must be a 64-digit SHA-256');
  }
}

function validateGeometrySource(source: unknown): asserts source is AijUrbanGeometrySource {
  validateSource(source);
  if (
    !isObject(source) ||
    typeof source.convertedFile !== 'string' ||
    source.convertedFile.length === 0 ||
    typeof source.coordinateTransform !== 'string' ||
    source.coordinateTransform.length === 0 ||
    (source.geometryVariant !== undefined &&
      (typeof source.geometryVariant !== 'string' || source.geometryVariant.length === 0))
  ) {
    throw new Error('aij-urban fixture: invalid geometry provenance');
  }
}

function validateCoordinateBasis(coordinates: AijUrbanRawFixture['coordinates']): void {
  const { xAxisEnu: x, yAxisEnu: y } = coordinates;
  if (![x.east, x.north, y.east, y.north].every(Number.isFinite)) {
    throw new Error('aij-urban fixture: coordinate basis must be finite');
  }
  const xNorm = Math.hypot(x.east, x.north);
  const yNorm = Math.hypot(y.east, y.north);
  const dot = x.east * y.east + x.north * y.north;
  const determinant = x.east * y.north - x.north * y.east;
  if (
    Math.abs(xNorm - 1) > UNIT_TOLERANCE ||
    Math.abs(yNorm - 1) > UNIT_TOLERANCE ||
    Math.abs(dot) > UNIT_TOLERANCE ||
    Math.abs(determinant - 1) > UNIT_TOLERANCE
  ) {
    throw new Error('aij-urban fixture: x/y axes must be an orthonormal right-handed ENU basis');
  }
}

function sameCoordinate(a: AijUrbanProbe, b: AijUrbanProbe): boolean {
  return (
    Math.abs(a.east - b.east) <= COORDINATE_TOLERANCE_METERS &&
    Math.abs(a.north - b.north) <= COORDINATE_TOLERANCE_METERS &&
    Math.abs(a.up - b.up) <= COORDINATE_TOLERANCE_METERS
  );
}

function interpolateMeasuredSpeed(samples: { z: number; speed: number }[], height: number): number {
  if (height <= samples[0].z) return samples[0].speed;
  if (height >= samples[samples.length - 1].z) return samples[samples.length - 1].speed;
  let index = 1;
  while (samples[index].z < height) index++;
  const lower = samples[index - 1];
  const upper = samples[index];
  const fraction = (height - lower.z) / (upper.z - lower.z);
  return lower.speed + fraction * (upper.speed - lower.speed);
}

/**
 * Validate and normalize an official Case C/E fixture.
 *
 * The on-disk data stay in their source units; this loader is the single visible place
 * that maps source axes to ENU and divides raw m/s by Uref. Coordinates deliberately
 * stay in the physical scale of the wind-tunnel data: multiplying model meters by the
 * geometric scale would change Reynolds number and invalidate the comparison. Optional
 * full-scale equivalents are reporting metadata only. Ambiguous or internally
 * inconsistent fixtures fail before a simulation can print a validation verdict.
 */
export function validateAijUrbanData(value: unknown): AijUrbanData {
  if (!isObject(value)) throw new Error('aij-urban fixture: expected an object');
  const raw = value as unknown as AijUrbanRawFixture;
  if (raw.schemaVersion !== 1 || (raw.caseId !== 'C' && raw.caseId !== 'E')) {
    throw new Error('aij-urban fixture: unsupported schemaVersion or caseId');
  }
  validateSource(raw.source);
  validateGeometrySource(raw.geometry);
  validateAijAttribution(raw.attribution, `aij-urban fixture (Case ${raw.caseId})`);
  if (
    raw.geometryVariant !== undefined &&
    raw.geometry.geometryVariant !== undefined &&
    raw.geometryVariant !== raw.geometry.geometryVariant
  ) {
    throw new Error('aij-urban fixture: selected geometry variant differs from geometry source');
  }
  if (
    !isObject(raw.coordinates) ||
    (raw.coordinates.lengthUnit !== 'model-m' && raw.coordinates.lengthUnit !== 'full-scale-m') ||
    (raw.coordinates.modelScale !== undefined &&
      (!Number.isFinite(raw.coordinates.modelScale) || raw.coordinates.modelScale <= 0)) ||
    !isObject(raw.coordinates.xAxisEnu) ||
    !isObject(raw.coordinates.yAxisEnu) ||
    typeof raw.coordinates.origin !== 'string' ||
    raw.coordinates.origin.length === 0
  ) {
    throw new Error('aij-urban fixture: invalid coordinate metadata');
  }
  validateCoordinateBasis(raw.coordinates);
  if (
    !isObject(raw.measurement) ||
    (raw.measurement.speedUnit !== 'm/s' && raw.measurement.speedUnit !== 'u/uRef') ||
    (raw.measurement.statistic !== 'time-mean-of-instantaneous-scalar-speed' &&
      raw.measurement.statistic !== 'magnitude-of-time-mean-vector') ||
    typeof raw.measurement.uRef !== 'string' ||
    raw.measurement.uRef.length === 0 ||
    (raw.measurement.uRefHeightMeters !== undefined &&
      (!Number.isFinite(raw.measurement.uRefHeightMeters) ||
        raw.measurement.uRefHeightMeters <= 0)) ||
    !Number.isFinite(raw.measurement.probeHeightMeters) ||
    raw.measurement.probeHeightMeters <= 0 ||
    (raw.measurement.probeHeightFullScaleMeters !== undefined &&
      (!Number.isFinite(raw.measurement.probeHeightFullScaleMeters) ||
        raw.measurement.probeHeightFullScaleMeters <= 0))
  ) {
    throw new Error('aij-urban fixture: invalid or ambiguous measurement metadata');
  }
  if (
    !isObject(raw.inflow) ||
    (raw.inflow.kind !== 'power' && raw.inflow.kind !== 'measured') ||
    typeof raw.inflow.note !== 'string' ||
    raw.inflow.note.length === 0 ||
    (raw.inflow.kind === 'power' &&
      (!Number.isFinite(raw.inflow.alpha) || raw.inflow.alpha <= 0)) ||
    (raw.inflow.kind === 'measured' &&
      ((raw.inflow.speedUnit !== 'm/s' && raw.inflow.speedUnit !== 'u/uRef') ||
        !Array.isArray(raw.inflow.samples) ||
        raw.inflow.samples.length < 2))
  ) {
    throw new Error('aij-urban fixture: invalid inflow metadata');
  }
  if (raw.inflow.kind === 'measured') {
    let previousHeight = -Infinity;
    for (const [index, sample] of raw.inflow.samples.entries()) {
      if (
        !isObject(sample) ||
        !Number.isFinite(sample.z) ||
        sample.z < 0 ||
        sample.z <= previousHeight ||
        !Number.isFinite(sample.speed) ||
        sample.speed < 0 ||
        (sample.sigmaSpeed !== undefined &&
          (!Number.isFinite(sample.sigmaSpeed) || sample.sigmaSpeed < 0))
      ) {
        throw new Error(`aij-urban fixture: invalid measured inflow sample ${index}`);
      }
      previousHeight = sample.z;
    }
  }
  if (raw.caseId === 'E' && (raw.inflow.kind !== 'power' || raw.inflow.alpha !== 0.25)) {
    throw new Error(
      'aij-urban fixture: Case E validation requires the published alpha=0.25 inflow',
    );
  }
  if (!Array.isArray(raw.directions) || raw.directions.length === 0) {
    throw new Error('aij-urban fixture: no wind directions');
  }

  if (
    raw.coordinates.lengthUnit === 'model-m' &&
    raw.coordinates.modelScale !== undefined &&
    raw.measurement.probeHeightFullScaleMeters !== undefined
  ) {
    const expectedFullScale = raw.measurement.probeHeightMeters * raw.coordinates.modelScale;
    const tolerance = Math.max(1e-9, 1e-9 * raw.measurement.probeHeightFullScaleMeters);
    if (Math.abs(expectedFullScale - raw.measurement.probeHeightFullScaleMeters) > tolerance) {
      throw new Error(
        `aij-urban fixture: model probe height ${raw.measurement.probeHeightMeters} m ` +
          `at 1/${raw.coordinates.modelScale} scale does not equal reported full-scale ` +
          `${raw.measurement.probeHeightFullScaleMeters} m`,
      );
    }
  }

  const seenDirections = new Set<number>();
  let canonicalCoordinates: Map<string, AijUrbanProbe> | null = null;
  const directions: AijUrbanDirection[] = raw.directions.map((direction, directionIndex) => {
    if (!isObject(direction) || !Number.isFinite(direction.windFromDegrees)) {
      throw new Error(`aij-urban fixture: invalid direction ${directionIndex}`);
    }
    if (
      direction.sourceAngleDegrees !== undefined &&
      !Number.isFinite(direction.sourceAngleDegrees)
    ) {
      throw new Error(`aij-urban fixture: invalid source angle ${directionIndex}`);
    }
    const windFromDegrees = normalizeDegrees(direction.windFromDegrees);
    if (seenDirections.has(windFromDegrees)) {
      throw new Error(`aij-urban fixture: duplicate wind direction ${windFromDegrees} degrees`);
    }
    seenDirections.add(windFromDegrees);
    if (!Number.isFinite(direction.uRefMps) || direction.uRefMps <= 0) {
      throw new Error(`aij-urban fixture: invalid Uref at ${windFromDegrees} degrees`);
    }
    if (!Array.isArray(direction.probes) || direction.probes.length === 0) {
      throw new Error(`aij-urban fixture: no probes at ${windFromDegrees} degrees`);
    }
    const expectedProbeCount = raw.caseId === 'C' ? CASE_C_PROBE_COUNT : CASE_E_PROBE_COUNT;
    if (direction.probes.length !== expectedProbeCount) {
      throw new Error(
        `aij-urban fixture: Case ${raw.caseId} direction ${windFromDegrees} has ` +
          `${direction.probes.length} probes, expected ${expectedProbeCount}`,
      );
    }

    const ids = new Set<string>();
    const probes = direction.probes.map((probe, probeIndex): AijUrbanProbe => {
      if (
        !isObject(probe) ||
        typeof probe.id !== 'string' ||
        probe.id.length === 0 ||
        ![probe.x, probe.y, probe.z, probe.speed].every(Number.isFinite) ||
        probe.speed < 0
      ) {
        throw new Error(
          `aij-urban fixture: invalid probe ${probeIndex} at ${windFromDegrees} degrees`,
        );
      }
      if (ids.has(probe.id)) {
        throw new Error(
          `aij-urban fixture: duplicate probe id ${probe.id} at ${windFromDegrees} degrees`,
        );
      }
      ids.add(probe.id);
      if (raw.geometryVariant !== undefined) {
        if (
          !isObject(probe.speedByVariant) ||
          !Number.isFinite(probe.speedByVariant[raw.geometryVariant]) ||
          probe.speedByVariant[raw.geometryVariant] !== probe.speed
        ) {
          throw new Error(
            `aij-urban fixture: probe ${probe.id} does not preserve selected geometry ` +
              `variant ${raw.geometryVariant}`,
          );
        }
        for (const [variant, speed] of Object.entries(probe.speedByVariant)) {
          if (variant.length === 0 || !Number.isFinite(speed) || speed < 0) {
            throw new Error(
              `aij-urban fixture: invalid ${variant || '(empty)'} speed for probe ${probe.id}`,
            );
          }
        }
      }
      const x = probe.x;
      const y = probe.y;
      const up = probe.z;
      const normalizedSpeed =
        raw.measurement.speedUnit === 'm/s' ? probe.speed / direction.uRefMps : probe.speed;
      return {
        id: probe.id,
        east: x * raw.coordinates.xAxisEnu.east + y * raw.coordinates.yAxisEnu.east,
        north: x * raw.coordinates.xAxisEnu.north + y * raw.coordinates.yAxisEnu.north,
        up,
        u: normalizedSpeed,
      };
    });

    const heightTolerance = Math.max(1e-9, 1e-6 * raw.measurement.probeHeightMeters);
    for (const probe of probes) {
      if (Math.abs(probe.up - raw.measurement.probeHeightMeters) > heightTolerance) {
        throw new Error(
          `aij-urban fixture: probe ${probe.id} height ${probe.up} m does not match ` +
            `${raw.measurement.probeHeightMeters} m`,
        );
      }
    }

    if (!canonicalCoordinates) {
      canonicalCoordinates = new Map(probes.map((probe) => [probe.id, probe]));
    } else {
      if (probes.length !== canonicalCoordinates.size) {
        throw new Error('aij-urban fixture: probe set differs between wind directions');
      }
      for (const probe of probes) {
        const canonical = canonicalCoordinates.get(probe.id);
        if (!canonical || !sameCoordinate(probe, canonical)) {
          throw new Error(
            `aij-urban fixture: probe ${probe.id} coordinate differs between wind directions`,
          );
        }
      }
    }
    return { windFromDegrees, uRefMps: direction.uRefMps, probes };
  });

  if (
    raw.inflow.kind === 'measured' &&
    raw.inflow.speedUnit === 'm/s' &&
    raw.measurement.uRefHeightMeters !== undefined
  ) {
    const expectedURef = interpolateMeasuredSpeed(
      raw.inflow.samples,
      raw.measurement.uRefHeightMeters,
    );
    for (const direction of directions) {
      const tolerance = Math.max(1e-9, 1e-9 * expectedURef);
      if (Math.abs(direction.uRefMps - expectedURef) > tolerance) {
        throw new Error(
          `aij-urban fixture: Uref ${direction.uRefMps} m/s at ` +
            `${direction.windFromDegrees} degrees does not match measured inflow ` +
            `${expectedURef} m/s at z=${raw.measurement.uRefHeightMeters} m`,
        );
      }
    }
  }

  return {
    caseId: raw.caseId,
    source: raw.source,
    geometry: raw.geometry,
    attribution: raw.attribution,
    geometryVariant: raw.geometryVariant,
    coordinateOrigin: raw.coordinates.origin,
    coordinateScale: raw.coordinates.lengthUnit === 'model-m' ? 'model' : 'full-scale',
    modelScale: raw.coordinates.modelScale,
    measurement: raw.measurement,
    inflow: raw.inflow,
    directions,
  };
}

/** Normalize the measured approach-flow profile for one published direction. */
export function aijUrbanMeasuredInflow(
  data: AijUrbanData,
  direction: AijUrbanDirection,
): AijUrbanInflowPoint[] {
  if (data.inflow.kind !== 'measured') {
    throw new Error(`AIJ Case ${data.caseId}: inflow is not a measured profile`);
  }
  return data.inflow.samples.map((sample) => ({
    z: sample.z,
    u:
      data.inflow.kind === 'measured' && data.inflow.speedUnit === 'm/s'
        ? sample.speed / direction.uRefMps
        : sample.speed,
  }));
}

/** Find one published direction, accepting periodic query angles. */
export function aijUrbanDirection(data: AijUrbanData, windFromDegrees: number): AijUrbanDirection {
  const direction = normalizeDegrees(windFromDegrees);
  const found = data.directions.find((entry) => entry.windFromDegrees === direction);
  if (!found) throw new Error(`AIJ Case ${data.caseId}: no ${direction} degree direction`);
  return found;
}

/** Rotate full-scale ENU probes into the same wind-aligned frame used by urban geometry. */
export function aijUrbanProbesInWindFrame(direction: AijUrbanDirection): AijUrbanWindFrameProbe[] {
  return direction.probes.map((probe) => {
    const point = enuVectorToWindFrame(probe, direction.windFromDegrees);
    return { id: probe.id, x: point.x, y: point.y, z: point.z, u: probe.u };
  });
}

/** VDI 3783/9 q and Pearson r for one direction's normalized mean speeds. */
export function scoreAijUrbanDirection(
  direction: AijUrbanDirection,
  simulated: ArrayLike<number>,
  allowed = 0.25,
): AijUrbanScore {
  if (simulated.length !== direction.probes.length) {
    throw new Error(
      `scoreAijUrbanDirection: sim length ${simulated.length} != probes ${direction.probes.length}`,
    );
  }
  const sim = Array.from({ length: simulated.length }, (_, index) => simulated[index]);
  const measured = direction.probes.map((probe) => probe.u);
  const rows = direction.probes.map((probe, index) => ({
    probe,
    sim: sim[index],
    hit: Math.abs(sim[index] - probe.u) <= allowed,
  }));
  return { q: hitRate(sim, measured, allowed, 1), r: pearson(sim, measured), rows };
}
