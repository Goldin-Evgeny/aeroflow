import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_BANDS, acceptanceBand } from '../src/validation/bands.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/**
 * Which test file asserts (not merely records) each `status: 'gated'` case's band, as a
 * hard pass/fail condition. Extend this map in the same commit that promotes a case —
 * `bands.ts`'s docstring and openspec/changes/fix-confirmed-physics-defects both require
 * promotion and assertion to land together. A case with no entry here cannot be 'gated'.
 */
const GATED_ASSERTIONS: Record<string, { file: string; matches: RegExp[] }> = {
  V1: {
    file: 'packages/core/test/solver2d.test.ts',
    matches: [/TRT.*τ-INDEPENDENT/, /negative control/],
  },
};

describe('acceptance band ledger', () => {
  it('every gated case has a registered assertion, and the assertion file exists and contains it', () => {
    for (const b of ACCEPTANCE_BANDS) {
      if (b.status !== 'gated') continue;
      const assertion = GATED_ASSERTIONS[b.id];
      expect(
        assertion,
        `case ${b.id} is 'gated' but has no entry in GATED_ASSERTIONS`,
      ).toBeDefined();
      const path = resolve(REPO_ROOT, assertion.file);
      const contents = readFileSync(path, 'utf8');
      for (const re of assertion.matches) {
        expect(
          re.test(contents),
          `${assertion.file} no longer matches ${re} for gated case ${b.id}`,
        ).toBe(true);
      }
    }
  });

  it('every recording case has no stale assertion entry', () => {
    for (const b of ACCEPTANCE_BANDS) {
      if (b.status === 'recording') {
        expect(
          GATED_ASSERTIONS[b.id],
          `case ${b.id} is 'recording' but has a GATED_ASSERTIONS entry — promote it to 'gated' or remove the entry`,
        ).toBeUndefined();
      }
    }
  });

  it('case ids are unique', () => {
    const ids = ACCEPTANCE_BANDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('acceptanceBand throws on an unknown id', () => {
    expect(() => acceptanceBand('V999')).toThrow(/unknown case id/);
  });

  it('acceptanceBand resolves a known id', () => {
    expect(acceptanceBand('V11').milestone).toBe('M9');
  });

  it("docs/VALIDATION.md's summary table matches the ledger band-for-band", () => {
    const doc = readFileSync(resolve(REPO_ROOT, 'docs/VALIDATION.md'), 'utf8');
    const tableStart = doc.indexOf('## Summary table');
    expect(tableStart, 'docs/VALIDATION.md: "## Summary table" section not found').toBeGreaterThan(
      -1,
    );
    const tableSection = doc.slice(tableStart, tableStart + 6000);
    for (const b of ACCEPTANCE_BANDS) {
      const rowPattern = new RegExp(`\\|\\s*${b.id}\\s*\\|`);
      expect(
        rowPattern.test(tableSection),
        `docs/VALIDATION.md summary table has no row for ${b.id}`,
      ).toBe(true);
    }
    // No case id in the ledger's summary table that isn't in the ledger, and vice versa —
    // catches a case being added to one but not the other.
    const docIds = [...tableSection.matchAll(/\|\s*(V\d+)\s*\|/g)].map((m) => m[1]);
    const ledgerIds = new Set(ACCEPTANCE_BANDS.map((b) => b.id));
    for (const id of docIds) {
      expect(
        ledgerIds.has(id),
        `docs/VALIDATION.md references ${id}, which is not in bands.ts`,
      ).toBe(true);
    }
  });
});
