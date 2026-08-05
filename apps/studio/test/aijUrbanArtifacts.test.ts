import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AIJ_DATA_PAPER,
  AIJ_DISCLAIMER,
  aijUrbanDirection,
  scoreAijUrbanDirection,
  validateAijAttribution,
  validateAijCaseAData,
  validateAijUrbanData,
} from '@aeroflow/core';
import { meshBounds, parseGltf } from '../src/sim/meshImport';

const caseCFixtureUrl = new URL('../public/benchmarks/aij/case-c/fixture.json', import.meta.url);
const caseCGeometryUrl = new URL('../public/benchmarks/aij/case-c/geometry.glb', import.meta.url);
const caseEFixtureUrl = new URL('../public/benchmarks/aij/case-e/fixture.json', import.meta.url);
const caseEGeometryUrl = new URL('../public/benchmarks/aij/case-e/geometry.glb', import.meta.url);
const caseAFixtureUrl = new URL('../src/sim/cases/data/aij-case-a.json', import.meta.url);

/** Read the glTF JSON chunk of a .glb without going through the mesh importer. */
async function gltfJson(url: URL): Promise<{ extras: Record<string, unknown> }> {
  const bytes = await readFile(url);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
    extras: Record<string, unknown>;
  };
}

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

/**
 * AIJ agreed to redistribution of files derived from their benchmark data on condition
 * that each one keeps its citations, its provenance and AIJ's no-warranty statement
 * (NOTICE §1). This repository ships none of those files — `scripts/convert-aij-*.py`
 * produce them locally — so what is checked here is that the converters put the
 * attribution in, on the machine where the derived files actually exist.
 */
describe.skipIf(!artifactsPresent)('converted AIJ files carry their attribution', () => {
  it('cites the data paper, the case experiment and the AIJ dataset in each fixture', async () => {
    for (const [url, doi] of [
      [caseCFixtureUrl, 'zenodo.15401792'],
      [caseEFixtureUrl, 'zenodo.15429018'],
    ] as const) {
      const raw = JSON.parse(await readFile(url, 'utf8')) as { attribution: unknown };
      validateAijAttribution(raw.attribution, url.pathname);
      expect(raw.attribution.dataPaper).toBe(AIJ_DATA_PAPER);
      expect(raw.attribution.disclaimer).toBe(AIJ_DISCLAIMER);
      expect(raw.attribution.dataset?.doi).toContain(doi);
      // "cite the data paper AND the original publications" — at least one real citation
      // beyond the data paper, each carrying a resolvable identifier.
      expect(raw.attribution.caseSources.length).toBeGreaterThan(0);
      for (const source of raw.attribution.caseSources) {
        expect(source).toMatch(/https:\/\/doi\.org\/|ISBN/);
      }
      // The LES guideline AIJ asked to be consulted for these benchmarks.
      expect(raw.attribution.implementationGuidance?.join(' ')).toContain(
        'https://doi.org/10.1016/j.jweia.2025.106321',
      );
      expect(raw.attribution.processing).toMatch(/scripts\/convert-aij-case-[ce]\.py/);
    }
  });

  it('keeps source, download date and processing in the converted geometry itself', async () => {
    for (const [url, retrieved] of [
      [caseCGeometryUrl, '2026-07-23'],
      [caseEGeometryUrl, '2026-07-24'],
    ] as const) {
      const { extras } = await gltfJson(url);
      expect(extras.sourceUrl).toContain('aij.or.jp');
      expect(extras.retrieved).toBe(retrieved);
      validateAijAttribution(extras.attribution, url.pathname);
      expect(extras.attribution.processing).toMatch(/glTF/);
    }
  });
});

/**
 * Case A is the one AIJ-shaped file that always exists here: a synthetic placeholder on a
 * fresh clone, overwritten in place by real measurements the moment
 * `scripts/convert-aij-case-a.py` runs. That overwrite is exactly where this repository
 * could begin carrying AIJ data without saying so, and it is not gated on the data being
 * present — so this check is not skippable. A placeholder must claim no AIJ provenance;
 * real measurements must carry the full attribution or fail to load.
 */
describe('the shipped Case A fixture', () => {
  it('is either an unattributed synthetic placeholder or fully attributed AIJ data', async () => {
    const raw = JSON.parse(await readFile(caseAFixtureUrl, 'utf8')) as {
      synthetic?: boolean;
      attribution?: unknown;
    };

    if (raw.synthetic === true) {
      // A placeholder is not AIJ data; citing AIJ on it would be a false provenance claim.
      expect(raw.attribution).toBeUndefined();
    } else {
      validateAijAttribution(raw.attribution, 'aij-case-a fixture');
      expect(raw.attribution.dataPaper).toBe(AIJ_DATA_PAPER);
      expect(raw.attribution.disclaimer).toBe(AIJ_DISCLAIMER);
      expect(raw.attribution.caseSources.join(' ')).toContain('Meng');
      expect(raw.attribution.dataset?.doi).toContain('zenodo.15050148');
    }

    // Whichever it is, the loader accepts it — the synthetic exemption and the attribution
    // requirement are the same code path a user hits when the page loads.
    expect(() => validateAijCaseAData(raw)).not.toThrow();
  });
});
