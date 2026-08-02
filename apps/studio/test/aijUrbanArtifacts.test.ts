import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { aijUrbanDirection, scoreAijUrbanDirection, validateAijUrbanData } from '@aeroflow/core';
import { meshBounds, parseGltf } from '../src/sim/meshImport';

const caseCFixtureUrl = new URL('../public/benchmarks/aij/case-c/fixture.json', import.meta.url);
const caseCGeometryUrl = new URL('../public/benchmarks/aij/case-c/geometry.glb', import.meta.url);
const caseEFixtureUrl = new URL('../public/benchmarks/aij/case-e/fixture.json', import.meta.url);
const caseEGeometryUrl = new URL('../public/benchmarks/aij/case-e/geometry.glb', import.meta.url);

/**
 * The AIJ benchmark data is not redistributed with this repository (see NOTICE and
 * docs/BENCHMARK-DATA.md), so these assertions only run once a developer has fetched and
 * converted it. Absent data skips them; it never weakens them.
 */
const artifactsPresent = [
  caseCFixtureUrl,
  caseCGeometryUrl,
  caseEFixtureUrl,
  caseEGeometryUrl,
].every((url) => existsSync(url));

describe.skipIf(!artifactsPresent)('official AIJ urban artifacts', () => {
  it('loads all three Case C directions and the selected 2H measurements', async () => {
    const raw = JSON.parse(await readFile(caseCFixtureUrl, 'utf8')) as unknown;
    const data = validateAijUrbanData(raw);
    expect(data.caseId).toBe('C');
    expect(data.coordinateScale).toBe('model');
    expect(data.measurement.probeHeightMeters).toBe(0.02);
    expect(data.inflow).toMatchObject({ kind: 'measured', speedUnit: 'm/s' });
    expect(data.directions.map((direction) => direction.windFromDegrees)).toEqual([
      270, 247.5, 225,
    ]);
    expect(data.directions.every((direction) => direction.probes.length === 120)).toBe(true);
    expect(aijUrbanDirection(data, -90).uRefMps).toBe(2.434);
  });

  it('loads all 16 after-construction directions through the strict fixture contract', async () => {
    const raw = JSON.parse(await readFile(caseEFixtureUrl, 'utf8')) as unknown;
    const data = validateAijUrbanData(raw);
    expect(data.caseId).toBe('E');
    expect(data.coordinateScale).toBe('full-scale');
    expect(data.modelScale).toBe(250);
    expect(data.measurement.probeHeightMeters).toBe(2);
    expect(data.measurement.statistic).toBe('time-mean-of-instantaneous-scalar-speed');
    expect(data.inflow).toMatchObject({ kind: 'power', alpha: 0.25 });
    expect(data.directions.map((direction) => direction.windFromDegrees)).toEqual(
      Array.from({ length: 16 }, (_, index) => index * 22.5),
    );
    expect(data.directions.every((direction) => direction.probes.length === 80)).toBe(true);

    const north = aijUrbanDirection(data, 360);
    const selfScore = scoreAijUrbanDirection(
      north,
      north.probes.map((probe) => probe.u),
    );
    expect(selfScore.q).toBe(1);
    expect(selfScore.r).toBeCloseTo(1, 12);
  });

  it('loads both converted geometries through the production glTF importer', async () => {
    const load = async (url: URL) => {
      const bytes = await readFile(url);
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return parseGltf(buffer);
    };
    const caseC = await load(caseCGeometryUrl);
    expect(caseC.triangleCount).toBe(108);
    expect(caseC.positions.length / 3).toBe(72);
    expect(meshBounds(caseC.positions)).toEqual({
      min: [-0.5, 0, -0.5],
      max: [0.5, 0.4000000059604645, 0.5],
      size: [1, 0.4000000059604645, 1],
    });

    const caseE = await load(caseEGeometryUrl);
    expect(caseE.triangleCount).toBe(22_906);
    expect(caseE.positions.length / 3).toBe(13_681);
    expect(meshBounds(caseE.positions)).toEqual({
      min: [-246, 0, -250],
      max: [254, 60, 250],
      size: [500, 60, 500],
    });
  });
});
