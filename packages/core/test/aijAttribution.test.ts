import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AIJ_DATA_PAPER,
  AIJ_DISCLAIMER,
  AIJ_LES_GUIDELINE,
  formatAijCitation,
  validateAijAttribution,
  type AijAttribution,
} from '../src/validation/aijAttribution.js';

/**
 * AIJ permits redistribution of AeroFlow's derived benchmark files on three conditions
 * (NOTICE §1): cite the data paper AND the case's own publications, carry AIJ's
 * no-warranty statement, and record what the conversion did. These tests pin the loader
 * that enforces them — a file that satisfies the physics contract but drops its
 * attribution must fail to load, because loading is what puts it in front of a user.
 */

function valid(): AijAttribution {
  return {
    dataPaper: AIJ_DATA_PAPER,
    caseSources: ['Meng, Y. & Hibi, K. (1998), ... https://doi.org/10.5359/jawe.1998.76_55'],
    dataset: {
      title: 'AIJ UWE Benchmark Dataset - Case A (112)',
      doi: 'https://doi.org/10.5281/zenodo.15050148',
      license: 'CC BY 4.0',
    },
    implementationGuidance: [AIJ_LES_GUIDELINE],
    processing: 'transcribed verbatim by scripts/convert-aij-case-a.py',
    disclaimer: AIJ_DISCLAIMER,
  };
}

describe('AIJ attribution contract', () => {
  it('accepts a complete block', () => {
    expect(() => validateAijAttribution(valid(), 'fixture')).not.toThrow();
  });

  it('names the fixture in the failure so the file to fix is obvious', () => {
    expect(() => validateAijAttribution(undefined, 'aij-case-a fixture')).toThrow(
      /aij-case-a fixture: missing attribution/,
    );
  });

  it('rejects a paraphrased or truncated data-paper citation', () => {
    expect(() =>
      validateAijAttribution({ ...valid(), dataPaper: 'Kikumoto et al. 2026' }, 'fixture'),
    ).toThrow(/data paper/);
  });

  it('rejects the data paper alone: the case experiment must be cited too', () => {
    expect(() => validateAijAttribution({ ...valid(), caseSources: [] }, 'fixture')).toThrow(
      /caseSources/,
    );
  });

  it("rejects a softened disclaimer — AIJ's wording is required verbatim", () => {
    const softened = AIJ_DISCLAIMER.replace(
      'does not guarantee their quality, accuracy, completeness, or suitability for any particular purpose',
      'has reviewed them',
    );
    expect(() => validateAijAttribution({ ...valid(), disclaimer: softened }, 'fixture')).toThrow(
      /disclaimer/,
    );
  });

  it('rejects a file that does not say what was done to the source data', () => {
    expect(() => validateAijAttribution({ ...valid(), processing: '  ' }, 'fixture')).toThrow(
      /processing/,
    );
  });

  it('rejects a dataset reference missing its DOI or license', () => {
    expect(() =>
      validateAijAttribution(
        { ...valid(), dataset: { title: 'Case A', doi: '', license: 'CC BY 4.0' } },
        'fixture',
      ),
    ).toThrow(/dataset/);
  });

  it('formats the citation as data paper first, then the case sources', () => {
    const line = formatAijCitation(valid());
    expect(line.startsWith(AIJ_DATA_PAPER)).toBe(true);
    expect(line).toContain('Meng, Y. & Hibi, K. (1998)');
  });

  it('carries the DOIs AIJ asked to be cited', () => {
    expect(AIJ_DATA_PAPER).toContain('https://doi.org/10.1002/2475-8876.70083');
    expect(AIJ_LES_GUIDELINE).toContain('https://doi.org/10.1016/j.jweia.2025.106321');
    expect(AIJ_DISCLAIMER).toContain('Architectural Institute of Japan (AIJ) does not guarantee');
  });
});

/**
 * The offline converters write these strings into the derived files; this module rejects
 * anything that differs by a character. Drift between the two would only surface the next
 * time someone re-ran a conversion — as fixtures that no longer load — so it is pinned
 * here instead. Only the strings the loader compares verbatim are covered.
 */
describe('scripts/aij_attribution.py agrees with this module', () => {
  const python = readFileSync(new URL('../../../scripts/aij_attribution.py', import.meta.url), {
    encoding: 'utf8',
  }).replace(/\r\n/g, '\n');

  /** Read `NAME = ( "..." "..." )` — Python implicit string concatenation. */
  function pythonConstant(name: string): string {
    const block = new RegExp(`^${name} = \\(\\n([\\s\\S]*?)\\n\\)$`, 'm').exec(python);
    if (!block) throw new Error(`scripts/aij_attribution.py: ${name} not found`);
    return block[1]
      .split('\n')
      .map((line) => JSON.parse(line.trim()) as string)
      .join('');
  }

  it.each([
    ['DATA_PAPER', AIJ_DATA_PAPER],
    ['LES_GUIDELINE', AIJ_LES_GUIDELINE],
    ['DISCLAIMER', AIJ_DISCLAIMER],
  ])('%s matches byte for byte', (name, expected) => {
    expect(pythonConstant(name)).toBe(expected);
  });
});
