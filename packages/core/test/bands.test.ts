import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_BANDS,
  NUMERICAL_HEALTH_POLICIES,
  VALIDATION_DEFECTS,
  VALIDATION_OUTCOMES,
  acceptanceBand,
  isDefectStatusTransitionAllowed,
  numericalHealthPolicy,
  renderValidationDefectTable,
  renderValidationOutcomeTable,
  validateValidationLedger,
  validationDefect,
  validationOutcome,
} from '../src/validation/bands.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

function generatedSection(doc: string, name: string): string {
  const startMarker = `<!-- ${name}:START -->`;
  const endMarker = `<!-- ${name}:END -->`;
  const start = doc.indexOf(startMarker);
  const end = doc.indexOf(endMarker);
  expect(start, `${startMarker} is missing`).toBeGreaterThan(-1);
  expect(end, `${endMarker} is missing`).toBeGreaterThan(start);
  return doc.slice(start + startMarker.length, end).trim();
}

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

  it('the authoritative outcomes, health policies, and defect inventory are internally valid', () => {
    expect(validateValidationLedger()).toEqual([]);
    expect(VALIDATION_OUTCOMES).toHaveLength(ACCEPTANCE_BANDS.length);
    expect(NUMERICAL_HEALTH_POLICIES.map((policy) => policy.caseId)).toEqual([
      'V12',
      'V13',
      'V14',
      'V15',
    ]);
  });

  it('resolves outcome, health-policy, and defect records by stable id', () => {
    expect(validationOutcome('V13').bandComparison).toBe('fail');
    expect(numericalHealthPolicy('V14').metrics.map((metric) => metric.id)).toContain(
      'boundaryFluxClosure',
    );
    expect(validationDefect('gpu-operation-stall-survivability').status).toBe('mitigated');
    expect(() => validationOutcome('V999')).toThrow(/unknown case id/);
    expect(() => numericalHealthPolicy('V1')).toThrow(/unknown case id/);
    expect(() => validationDefect('missing')).toThrow(/unknown defect id/);
  });

  it('rejects duplicate stable ids', () => {
    expect(
      validateValidationLedger({ outcomes: [VALIDATION_OUTCOMES[0], VALIDATION_OUTCOMES[0]] }),
    ).toContain('duplicate outcome id: V1');
    expect(
      validateValidationLedger({ defects: [VALIDATION_DEFECTS[0], VALIDATION_DEFECTS[0]] }),
    ).toContain(`duplicate defect id: ${VALIDATION_DEFECTS[0].id}`);
  });

  it('rejects missing outcome provenance and inconsistent band comparisons', () => {
    const base = VALIDATION_OUTCOMES[0];
    expect(
      validateValidationLedger({ outcomes: [{ ...base, sourceRevision: '', artifact: '' }] }),
    ).toEqual(
      expect.arrayContaining(['V1: missing source revision', 'V1: missing evidence artifact']),
    );
    expect(validateValidationLedger({ outcomes: [{ ...base, bandComparison: 'fail' }] })).toContain(
      'V1: band comparison fail contradicts metric comparison pass',
    );
  });

  it('rejects status closure without evidence and disallows terminal claim reversal', () => {
    const open = VALIDATION_DEFECTS[0];
    expect(
      validateValidationLedger({
        defects: [{ ...open, status: 'closed', statusEvidence: undefined }],
      }),
    ).toContain(`${open.id}: closed status requires status evidence`);
    expect(isDefectStatusTransitionAllowed('open', 'mitigated')).toBe(true);
    expect(isDefectStatusTransitionAllowed('closed', 'open')).toBe(true);
    expect(isDefectStatusTransitionAllowed('superseded', 'open')).toBe(false);
  });

  it('keeps generated current-outcome and defect tables identical to the typed ledger', () => {
    const doc = readFileSync(resolve(REPO_ROOT, 'docs/VALIDATION.md'), 'utf8');
    expect(generatedSection(doc, 'VALIDATION_OUTCOMES')).toBe(renderValidationOutcomeTable());
    expect(generatedSection(doc, 'VALIDATION_DEFECTS')).toBe(renderValidationDefectTable());
  });

  it('keeps every current outcome and defect evidence reference resolvable', () => {
    const references = [
      ...VALIDATION_OUTCOMES.map((outcome) => outcome.artifact),
      ...VALIDATION_DEFECTS.flatMap((defect) => [
        ...defect.evidence,
        ...(defect.statusEvidence ?? []),
      ]),
    ];
    for (const reference of references) {
      expect(
        existsSync(resolve(REPO_ROOT, reference)),
        `missing ledger evidence: ${reference}`,
      ).toBe(true);
    }
  });

  it('records the Q27 supersession and preserves the historical near-floor measurement', () => {
    const physics = readFileSync(resolve(REPO_ROOT, 'docs/PHYSICS.md'), 'utf8');
    expect(physics).toContain('q27-mirror-rounding-explanation');
    expect(physics).toContain('SUPERSEDED');
    expect(physics).toContain('q27-periodic-momentum-drift');
    expect(physics).toContain('OPEN');

    const historical = readFileSync(
      resolve(REPO_ROOT, 'docs/validation/runs/2026-08-17-1832-near-floor-factorial.md'),
      'utf8',
    );
    expect(historical).toContain('20,000');
    expect(historical).toContain('5 441.2');
    expect(historical).toContain('ADDENDUM 2026-08-18 — analytic-zero qualification');
    expect(historical).toContain('boundary-contaminated');
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

  it('pins the recorded V10–V14 outcomes so stale ledger prose cannot return', () => {
    expect(acceptanceBand('V10').gateDescription).toContain('V7 and V9 PASS; V8 FAILS');
    expect(acceptanceBand('V12').gateDescription).toContain('66.19%');
    expect(acceptanceBand('V12').gateDescription).toContain('near-wall rows');
    expect(acceptanceBand('V13').gateDescription).toContain('83/126');
    expect(acceptanceBand('V13').gateDescription).toContain('cumulative time-mean');
    expect(acceptanceBand('V14').gateDescription).toContain('55/120');

    const doc = readFileSync(resolve(REPO_ROOT, 'docs/VALIDATION.md'), 'utf8');
    for (const evidence of ['1.967%', '3.517%', '66.19%', '83/126']) {
      expect(doc, `docs/VALIDATION.md lost recorded evidence ${evidence}`).toContain(evidence);
    }
  });
});
