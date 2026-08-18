/**
 * The single machine-readable ledger of validation-case acceptance bands (M2–M11).
 *
 * `docs/VALIDATION.md`'s summary table is prose derived from this file, not the other
 * way around — a test (`bands.test.ts`) asserts the two stay in sync. Every band literal
 * elsewhere in the codebase (UI readouts, e2e specs) must import from here rather than
 * restate the numbers; a second copy of a band is exactly the drift this ledger exists
 * to prevent.
 *
 * `status: 'gated'` means some harness asserts this band as a hard pass/fail condition;
 * `'recording'` means a harness computes and records the comparison without failing the
 * run on it. A case is promoted from `'recording'` to `'gated'` only in the same change
 * that establishes it meets its band (openspec/changes/fix-confirmed-physics-defects).
 * `bands.test.ts` fails if a `'gated'` entry has no corresponding assertion.
 */

export type BandGateKind =
  | 'extrema-pct' // percent deviation on named extrema
  | 'coefficient-pct' // percent deviation on a single coefficient (Cd, St, ...)
  | 'coefficient-range' // coefficient must fall within an absolute range
  | 'profile-deviation-pct' // percent deviation on a sampled profile
  | 'hit-rate-correlation' // VDI hit rate q + Pearson r
  | 'qualitative'; // topology / convergence criteria without a single scalar band

export type BandStatus = 'gated' | 'recording';

export interface AcceptanceBand {
  /** Case id as used throughout docs/VALIDATION.md, e.g. "V11". */
  readonly id: string;
  readonly milestone: string;
  readonly quantity: string;
  /** Numeric band, when the gate reduces to one; omitted for qualitative gates. */
  readonly band?: readonly [number, number];
  readonly gateKind: BandGateKind;
  readonly status: BandStatus;
  /** Literature or standard the band derives from. */
  readonly source: string;
  /** One line summarizing the gate, matching docs/VALIDATION.md's "Gate" column. */
  readonly gateDescription: string;
}

export type BandComparison = 'pass' | 'fail' | 'unevaluated' | 'deferred';

export interface OutcomeMetric {
  readonly id: string;
  readonly value?: number | string;
  readonly unit?: string;
  readonly comparison: Exclude<BandComparison, 'deferred'>;
}

/** Durable, current interpretation of one acceptance case. Historical runs remain immutable. */
export interface ValidationOutcome {
  readonly caseId: string;
  readonly observedAt: string;
  readonly sourceRevision: string;
  readonly artifact: string;
  readonly conventions: Readonly<Record<string, string>>;
  readonly metrics: readonly OutcomeMetric[];
  readonly bandComparison: BandComparison;
  readonly summary: string;
}

export type HealthMetricDirection = 'max' | 'min' | 'abs-max';

export interface NumericalHealthMetricPolicy {
  readonly id:
    'nonFiniteCells' | 'densityMin' | 'densityMax' | 'relativeMassDrift' | 'boundaryFluxClosure';
  readonly direction: HealthMetricDirection;
  readonly limit: number;
  readonly unit: string;
  readonly provenance: string;
}

export interface NumericalHealthPolicy {
  readonly caseId: string;
  readonly metrics: readonly NumericalHealthMetricPolicy[];
}

export type DefectPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type DefectStatus = 'open' | 'mitigated' | 'closed' | 'superseded';

export interface ValidationDefect {
  readonly id: string;
  readonly title: string;
  readonly priority: DefectPriority;
  readonly status: DefectStatus;
  readonly closureCriterion: string;
  readonly evidence: readonly string[];
  /** Required for mitigated, closed, and superseded records. */
  readonly statusEvidence?: readonly string[];
  readonly relatedCaseIds: readonly string[];
}

export const ACCEPTANCE_BANDS: readonly AcceptanceBand[] = [
  {
    id: 'V1',
    milestone: 'M2',
    quantity: '2D Poiseuille (body-force channel) velocity profile',
    gateKind: 'qualitative',
    status: 'gated',
    source: 'Exact parabolic solution',
    gateDescription:
      'BGK: order-2 convergence (16/32/64); TRT (Λ=3/16): ≤1e-4 rel. error, τ-independent over [0.51, 1.5]',
  },
  {
    id: 'V2',
    milestone: 'M3',
    quantity: 'Lid-driven cavity Re=100 centerline extrema',
    gateKind: 'extrema-pct',
    band: [-0.015, 0.015],
    status: 'recording',
    source: 'Ghia, Ghia & Shin 1982',
    gateDescription: '±1.5% on extrema (256²) — v_min currently FAILS at 2.31%',
  },
  {
    id: 'V3',
    milestone: 'M3',
    quantity: 'Lid-driven cavity Re=1000 centerline extrema',
    gateKind: 'extrema-pct',
    band: [-0.02, 0.02],
    status: 'recording',
    source: 'Ghia, Ghia & Shin 1982',
    gateDescription: '±2% on extrema (512²) — recorded by cavity.gpu.spec, not asserted there',
  },
  {
    id: 'V4',
    milestone: 'M4',
    quantity: 'Cylinder Re=100 St / Cd / Cl',
    gateKind: 'coefficient-range',
    status: 'recording',
    source: 'Tritton 1959',
    gateDescription:
      'St∈[0.160,0.170]; Cd∈[1.30,1.42]; Cl∈[0.28,0.36] — no automated harness asserts this today',
  },
  {
    id: 'V5',
    milestone: 'M4',
    quantity: 'Cylinder Re=200 St / Cd (2D refs)',
    gateKind: 'coefficient-range',
    status: 'recording',
    source: 'Braza, Liu, Russell & Wang',
    gateDescription:
      'St∈[0.190,0.200]; Cd∈[1.25,1.45] — requires LES to avoid Mach instability; no automated harness asserts the band today (cylinder-re200-repro.test.ts asserts divergence behavior only)',
  },
  {
    id: 'V6',
    milestone: 'M5',
    quantity: 'LES non-interference on V4/V5',
    gateKind: 'coefficient-pct',
    band: [-0.03, 0.03],
    status: 'recording',
    source: 'Internal — V4/V5 with LES enabled vs LES off',
    gateDescription:
      'St/Cd shift ≤3% vs LES-off — les.test.ts asserts this at Re=20, not V4’s documented Re=100, so it is a weaker proxy, not the gate itself',
  },
  {
    id: 'V7',
    milestone: 'M7',
    quantity: 'Sphere drag Re=100',
    gateKind: 'coefficient-pct',
    band: [-0.07, 0.07],
    status: 'recording',
    source: 'Schiller–Naumann (Cd≈1.09)',
    gateDescription: '±7%; force is the mean of two consecutive steps',
  },
  {
    id: 'V8',
    milestone: 'M7',
    quantity: 'Sphere drag Re=1000',
    gateKind: 'coefficient-pct',
    band: [-0.1, 0.1],
    status: 'recording',
    source: 'Standard drag curve (Cd≈0.46–0.47)',
    gateDescription: '±10%; force is the mean of two consecutive steps — currently FAILS',
  },
  {
    id: 'V9',
    milestone: 'M7',
    quantity: 'Sphere drag Re=10⁴ (LES)',
    gateKind: 'coefficient-range',
    band: [0.38, 0.5],
    status: 'recording',
    source: 'Newton-regime envelope',
    gateDescription:
      'mean consecutive-step-pair Cd inside envelope, running mean stable to <3% over last 20 T_conv — currently FAILS on both lateral BCs',
  },
  {
    id: 'V10',
    milestone: 'M7',
    quantity: 'FP16 vs FP32 storage A/B (V7–V9)',
    gateKind: 'coefficient-pct',
    band: [-0.02, 0.02],
    status: 'recording',
    source: 'Internal A/B',
    gateDescription:
      '≤2% difference on identically pair-averaged Cd values — post-outlet V7 and V9 PASS; V8 FAILS',
  },
  {
    id: 'V11',
    milestone: 'M9',
    quantity: 'Ahmed body 25° slant Cd',
    gateKind: 'coefficient-range',
    band: [0.242, 0.328],
    status: 'recording',
    source: 'Ahmed 1984 (SAE 840300); SimScale ref 0.2875',
    gateDescription:
      'constrained ≤5%-blockage/fetch scene; independent-block convergence + topology — currently FAILS at ≈3.2× the band (Cd 0.9011)',
  },
  {
    id: 'V12',
    milestone: 'M10',
    quantity: 'ABL fetch preservation (empty domain)',
    gateKind: 'profile-deviation-pct',
    band: [0, 0.05],
    status: 'recording',
    source: 'Internal — inlet profile vs measured profile at the building station',
    gateDescription:
      '≤5% profile deviation at the building station — GPU result MISSES at 66.19%, localized to the near-wall rows',
  },
  {
    id: 'V13',
    milestone: 'M10',
    quantity: 'AIJ Case A (isolated 1:1:2 building) hit rate / correlation',
    gateKind: 'hit-rate-correlation',
    status: 'recording',
    source: 'Meng & Hibi wind-tunnel data via AIJ; VDI 3783 Part 9',
    gateDescription:
      'VDI hit rate q≥0.66; Pearson r≥0.70 — b=24 settled cumulative time-mean MISSES at 83/126 (q=0.65873); r=0.85156 passes',
  },
  {
    id: 'V14',
    milestone: 'M11',
    quantity: 'AIJ Case C (9-building block + 2H tower) hit rate',
    gateKind: 'hit-rate-correlation',
    status: 'recording',
    source: 'AIJ wind-tunnel data',
    gateDescription: 'q≥0.66 — strict-grid Case C MISSES at 55/120 (q=0.45833); mechanism unknown',
  },
  {
    id: 'V15',
    milestone: 'M11',
    quantity: 'AIJ Case E (Niigata, 80 points) hit rate / correlation',
    gateKind: 'hit-rate-correlation',
    status: 'recording',
    source: 'AIJ wind-tunnel data; published "good" RANS r=0.71–0.84',
    gateDescription:
      'q≥0.66 and r≥0.70 at ≥2 wind directions — DEFERRED, infeasible on a uniform grid',
  },
] as const;

const COMMON_LBM_CONVENTIONS = {
  force: 'consecutive-step pair average where applicable',
  collision: 'production configuration recorded by the cited artifact',
  interpretation: 'screening-grade; acceptance bands unchanged',
} as const;

/**
 * Current results only. The cited artifacts retain the complete historical record and raw
 * values; changing this array changes the current interpretation, never an old artifact.
 */
export const VALIDATION_OUTCOMES: readonly ValidationOutcome[] = [
  {
    caseId: 'V1',
    observedAt: '2026-08-18T09:10:20Z',
    sourceRevision: '3b38a08',
    artifact: 'packages/core/test/solver2d.test.ts',
    conventions: { ...COMMON_LBM_CONVENTIONS, lattice: 'D2Q9', operator: 'BGK and TRT' },
    metrics: [{ id: 'poiseuille-gates', value: 'all asserted gates pass', comparison: 'pass' }],
    bandComparison: 'pass',
    summary: 'The deterministic Poiseuille convergence and TRT tau-independence gates pass.',
  },
  {
    caseId: 'V2',
    observedAt: '2026-08-18T09:10:20Z',
    sourceRevision: '3b38a08',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, grid: '256^2', reference: 'Ghia 1982' },
    metrics: [{ id: 'v-min-deviation', value: 0.0231, unit: 'fraction', comparison: 'fail' }],
    bandComparison: 'fail',
    summary: 'v_min misses the +/-1.5% extrema band at 2.31%.',
  },
  {
    caseId: 'V3',
    observedAt: '2026-08-18T09:10:20Z',
    sourceRevision: '3b38a08',
    artifact: 'apps/studio/e2e/cavity.gpu.spec.ts',
    conventions: { ...COMMON_LBM_CONVENTIONS, grid: '512^2', reference: 'Ghia 1982' },
    metrics: [{ id: 'extrema', comparison: 'unevaluated' }],
    bandComparison: 'unevaluated',
    summary: 'The harness records the profile, but no durable current band verdict is asserted.',
  },
  {
    caseId: 'V4',
    observedAt: '2026-08-14T00:00:00Z',
    sourceRevision: '227afc0',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, reynolds: '100', les: 'off' },
    metrics: [{ id: 'st-cd-cl', comparison: 'unevaluated' }],
    bandComparison: 'unevaluated',
    summary: 'No durable full-resolution V4 harness currently asserts the documented bands.',
  },
  {
    caseId: 'V5',
    observedAt: '2026-08-14T00:00:00Z',
    sourceRevision: '227afc0',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, reynolds: '200', les: 'Cs=0.1; spec closure' },
    metrics: [
      { id: 'cd', value: 1.3768, comparison: 'pass' },
      { id: 'st', value: 0.1962, comparison: 'pass' },
    ],
    bandComparison: 'pass',
    summary: 'The recorded spec-closure cylinder result is inside both Cd and St bands.',
  },
  {
    caseId: 'V6',
    observedAt: '2026-08-14T00:00:00Z',
    sourceRevision: '227afc0',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, reynolds: '100', comparison: 'LES on versus off' },
    metrics: [{ id: 'maximum-shift', value: 0.002, unit: 'fraction', comparison: 'pass' }],
    bandComparison: 'pass',
    summary: 'The recorded spec-closure non-interference shift is 0.20%, below 3%.',
  },
  {
    caseId: 'V7',
    observedAt: '2026-08-14T00:00:00Z',
    sourceRevision: '227afc0',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, reynolds: '100', storage: 'FP32 verdict value' },
    metrics: [{ id: 'cd', value: 1.153, comparison: 'pass' }],
    bandComparison: 'pass',
    summary: 'The corrected-outlet pair-averaged Cd remains in band.',
  },
  {
    caseId: 'V8',
    observedAt: '2026-08-14T00:00:00Z',
    sourceRevision: '227afc0',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, reynolds: '1000', storage: 'FP32 verdict value' },
    metrics: [{ id: 'cd', value: 0.5652, comparison: 'fail' }],
    bandComparison: 'fail',
    summary: 'The converged corrected-outlet Cd remains above the literature band.',
  },
  {
    caseId: 'V9',
    observedAt: '2026-08-14T00:00:00Z',
    sourceRevision: '227afc0',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, reynolds: '10000', farField: 'freestream' },
    metrics: [{ id: 'cd', value: 0.606, comparison: 'fail' }],
    bandComparison: 'fail',
    summary: 'The freestream Cd remains above the Newton-regime envelope.',
  },
  {
    caseId: 'V10',
    observedAt: '2026-08-14T00:00:00Z',
    sourceRevision: '227afc0',
    artifact: 'docs/VALIDATION.md',
    conventions: { ...COMMON_LBM_CONVENTIONS, comparison: 'shifted FP16 versus FP32 storage' },
    metrics: [
      { id: 're100-relative-delta', value: 0.01967, unit: 'fraction', comparison: 'pass' },
      { id: 're1000-relative-delta', value: 0.03517, unit: 'fraction', comparison: 'fail' },
      { id: 're10000-relative-delta', value: 0.00422, unit: 'fraction', comparison: 'pass' },
    ],
    bandComparison: 'fail',
    summary: 'The A/B passes for V7 and V9 but fails for V8, so the aggregate V10 gate fails.',
  },
  {
    caseId: 'V11',
    observedAt: '2026-08-11T04:21:25Z',
    sourceRevision: 'a033193',
    artifact: 'docs/validation/runs/2026-08-14-1121-m9-closure-target.md',
    conventions: {
      ...COMMON_LBM_CONVENTIONS,
      scene: '15,731,936 cells; freestream far field; velocity inlet; pressure outlet',
      storage: 'FP16',
    },
    metrics: [{ id: 'cd', value: 0.9011, comparison: 'fail' }],
    bandComparison: 'fail',
    summary: 'The converged Cd is about 3.2 times the upper acceptance limit.',
  },
  {
    caseId: 'V12',
    observedAt: '2026-08-15T18:30:00Z',
    sourceRevision: '9591433',
    artifact: 'docs/validation/runs/2026-08-15-1620-v12-fetch-rows-control.md',
    conventions: {
      ...COMMON_LBM_CONVENTIONS,
      resolution: '16 cells/building',
      statistic: 'row maximum',
    },
    metrics: [{ id: 'profile-deviation', value: 0.6619, unit: 'fraction', comparison: 'fail' }],
    bandComparison: 'fail',
    summary: 'The near-wall rows set a 66.19% profile deviation against the 5% band.',
  },
  {
    caseId: 'V13',
    observedAt: '2026-08-15T21:30:00Z',
    sourceRevision: '9dc2ea9+dirty',
    artifact: 'docs/validation/runs/2026-08-15-2130-v13-caseA-b24-verdict.md',
    conventions: {
      ...COMMON_LBM_CONVENTIONS,
      resolution: '24 cells/building',
      statistic: 'settled cumulative time mean',
    },
    metrics: [
      { id: 'q', value: 0.65873, comparison: 'fail' },
      { id: 'r', value: 0.85156, comparison: 'pass' },
    ],
    bandComparison: 'fail',
    summary: 'Correlation passes; hit rate is one point short at 83/126.',
  },
  {
    caseId: 'V14',
    observedAt: '2026-08-15T22:16:00Z',
    sourceRevision: '2c31f81',
    artifact: 'docs/validation/runs/2026-08-16-0116-v14-caseC-strict-grid.md',
    conventions: {
      ...COMMON_LBM_CONVENTIONS,
      direction: '270 degrees',
      probeRule: 'strict third-node grid',
    },
    metrics: [{ id: 'q', value: 0.45833, comparison: 'fail' }],
    bandComparison: 'fail',
    summary: 'The completed strict-grid run records 55/120 hits.',
  },
  {
    caseId: 'V15',
    observedAt: '2026-08-18T09:10:20Z',
    sourceRevision: '3b38a08',
    artifact: 'docs/decisions/D1-resolution-wall.md',
    conventions: {
      ...COMMON_LBM_CONVENTIONS,
      probeRule: 'third fluid node',
      domain: 'uniform grid',
    },
    metrics: [{ id: 'q-and-r', comparison: 'unevaluated' }],
    bandComparison: 'deferred',
    summary: 'No benchmark-faithful uniform-grid measurement exists; a domain crop is required.',
  },
] as const;

const BASE_AIJ_HEALTH: readonly NumericalHealthMetricPolicy[] = [
  {
    id: 'nonFiniteCells',
    direction: 'max',
    limit: 0,
    unit: 'cells',
    provenance:
      'Finite state is a mathematical validity invariant; no non-finite cell is admissible.',
  },
  {
    id: 'densityMin',
    direction: 'min',
    limit: 0.5,
    unit: 'rho/rho0',
    provenance:
      'Pre-run weak-compressibility guard: density must remain positive and within 50% of rho0.',
  },
  {
    id: 'densityMax',
    direction: 'max',
    limit: 1.5,
    unit: 'rho/rho0',
    provenance: 'Pre-run weak-compressibility guard paired with densityMin; not a physics band.',
  },
  {
    id: 'relativeMassDrift',
    direction: 'abs-max',
    limit: 1e-3,
    unit: 'fraction',
    provenance: 'Numerical guard fixed at 0.1% of initial mass before this evidence change.',
  },
  {
    id: 'boundaryFluxClosure',
    direction: 'abs-max',
    limit: 1e-3,
    unit: 'fraction of initial mass',
    provenance: 'Complete-shell conservation residual guard fixed at 0.1% before scored reruns.',
  },
] as const;

export const NUMERICAL_HEALTH_POLICIES: readonly NumericalHealthPolicy[] = [
  { caseId: 'V12', metrics: BASE_AIJ_HEALTH },
  { caseId: 'V13', metrics: BASE_AIJ_HEALTH },
  { caseId: 'V14', metrics: BASE_AIJ_HEALTH },
  { caseId: 'V15', metrics: BASE_AIJ_HEALTH },
] as const;

export const VALIDATION_DEFECTS: readonly ValidationDefect[] = [
  {
    id: 'gpu-operation-natural-stall-cause',
    title: 'Natural long-running GPU operation stalls have no isolated initiating cause',
    priority: 'P1',
    status: 'open',
    closureCriterion:
      'A bounded reproducer isolates the initiating browser, driver, kernel, or application cause and a targeted repair prevents it.',
    evidence: ['docs/validation/runs/2026-08-15-2100-v14-caseC-stall-reproduced.md'],
    relatedCaseIds: ['V14'],
  },
  {
    id: 'gpu-operation-stall-survivability',
    title: 'Long-running GPU operations must preserve evidence and recover from a detected stall',
    priority: 'P1',
    status: 'mitigated',
    closureCriterion:
      'Bounded recovery proves exact restore, forward progress, torn-checkpoint fallback, and durable artifact preservation.',
    evidence: ['docs/validation/runs/2026-08-15-2100-v14-caseC-stall-reproduced.md'],
    statusEvidence: ['docs/validation/runs/2026-08-18-0553-gpu-recovery-final.md'],
    relatedCaseIds: ['V14'],
  },
  {
    id: 'near-floor-zero-gradient-outlet-cause',
    title:
      'Outlet-dependent feedback is observed from the first sampled boundary interval, but its internal cause remains unknown',
    priority: 'P1',
    status: 'open',
    closureCriterion:
      'A controlled outlet pair localizes the first repeatable separation and a separate repair proposal names the measured mechanism.',
    evidence: [
      'docs/validation/runs/2026-08-17-1832-near-floor-factorial.md',
      'docs/validation/runs/2026-08-18-outlet-feedback-discriminator.md',
      'docs/validation/runs/artifacts/2026-08-18-outlet-feedback-discriminator/outlet-feedback.json',
    ],
    relatedCaseIds: ['V11', 'V12', 'V13', 'V14'],
  },
  {
    id: 'analytic-zero-wall-contamination',
    title:
      'Fixed-distance wall-bounded sampling cannot support the long-run analytic-zero LES claim',
    priority: 'P1',
    status: 'open',
    closureCriterion:
      'A periodic uniform-flow oracle and time-valid wall selector replace the fixed three-cell interpretation without rewriting the raw sample.',
    evidence: ['docs/validation/runs/2026-08-17-1832-near-floor-factorial.md'],
    relatedCaseIds: ['V11', 'V12', 'V13', 'V14'],
  },
  {
    id: 'q27-periodic-momentum-drift',
    title: 'D3Q27 periodic momentum drift exceeds its predeclared gate and grows superlinearly',
    priority: 'P2',
    status: 'open',
    closureCriterion:
      'A normalized, precision-appropriate momentum gate passes across step and wavelength scaling with durable CPU/GPU parity evidence.',
    evidence: [
      'docs/validation/runs/artifacts/2026-08-16-q27-drift-scaling-analysis/drift-scaling.json',
    ],
    relatedCaseIds: [],
  },
  {
    id: 'q27-mirror-rounding-explanation',
    title: 'Mirror-direction f32 summation order explains the D3Q27 periodic momentum drift',
    priority: 'P2',
    status: 'superseded',
    closureCriterion:
      'Step-scaling evidence distinguishes roundoff-like linear accumulation from a superlinear collision-carried defect.',
    evidence: ['docs/PHYSICS.md'],
    statusEvidence: [
      'docs/validation/runs/artifacts/2026-08-16-q27-drift-scaling-analysis/drift-scaling.json',
    ],
    relatedCaseIds: [],
  },
] as const;

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export function expectedOutcomeComparison(outcome: ValidationOutcome): BandComparison {
  if (outcome.bandComparison === 'deferred') return 'deferred';
  if (outcome.metrics.some((metric) => metric.comparison === 'fail')) return 'fail';
  if (
    outcome.metrics.length > 0 &&
    outcome.metrics.every((metric) => metric.comparison === 'pass')
  ) {
    return 'pass';
  }
  return 'unevaluated';
}

export function isDefectStatusTransitionAllowed(from: DefectStatus, to: DefectStatus): boolean {
  const allowed: Readonly<Record<DefectStatus, readonly DefectStatus[]>> = {
    open: ['open', 'mitigated', 'closed', 'superseded'],
    mitigated: ['mitigated', 'open', 'closed', 'superseded'],
    closed: ['closed', 'open'],
    superseded: ['superseded'],
  };
  return allowed[from].includes(to);
}

export interface ValidationLedgerInput {
  readonly bands?: readonly AcceptanceBand[];
  readonly outcomes?: readonly ValidationOutcome[];
  readonly healthPolicies?: readonly NumericalHealthPolicy[];
  readonly defects?: readonly ValidationDefect[];
}

/** Returns every structural/provenance error so CI can report the full drift in one run. */
export function validateValidationLedger(input: ValidationLedgerInput = {}): readonly string[] {
  const bands = input.bands ?? ACCEPTANCE_BANDS;
  const outcomes = input.outcomes ?? VALIDATION_OUTCOMES;
  const healthPolicies = input.healthPolicies ?? NUMERICAL_HEALTH_POLICIES;
  const defects = input.defects ?? VALIDATION_DEFECTS;
  const errors: string[] = [];

  for (const id of duplicateIds(bands.map((entry) => entry.id)))
    errors.push(`duplicate band id: ${id}`);
  for (const id of duplicateIds(outcomes.map((entry) => entry.caseId)))
    errors.push(`duplicate outcome id: ${id}`);
  for (const id of duplicateIds(healthPolicies.map((entry) => entry.caseId))) {
    errors.push(`duplicate health-policy id: ${id}`);
  }
  for (const id of duplicateIds(defects.map((entry) => entry.id)))
    errors.push(`duplicate defect id: ${id}`);

  const bandIds = new Set(bands.map((entry) => entry.id));
  const outcomeIds = new Set(outcomes.map((entry) => entry.caseId));
  for (const id of bandIds) {
    if (!outcomeIds.has(id)) errors.push(`missing current outcome: ${id}`);
  }
  for (const outcome of outcomes) {
    if (!bandIds.has(outcome.caseId))
      errors.push(`outcome has no acceptance band: ${outcome.caseId}`);
    if (!outcome.sourceRevision.trim()) errors.push(`${outcome.caseId}: missing source revision`);
    if (!outcome.artifact.trim()) errors.push(`${outcome.caseId}: missing evidence artifact`);
    if (!Number.isFinite(Date.parse(outcome.observedAt)))
      errors.push(`${outcome.caseId}: invalid observation time`);
    if (Object.keys(outcome.conventions).length === 0)
      errors.push(`${outcome.caseId}: missing material conventions`);
    const expected = expectedOutcomeComparison(outcome);
    if (outcome.bandComparison !== expected) {
      errors.push(
        `${outcome.caseId}: band comparison ${outcome.bandComparison} contradicts metric comparison ${expected}`,
      );
    }
  }

  for (const policy of healthPolicies) {
    if (!bandIds.has(policy.caseId))
      errors.push(`health policy has no acceptance band: ${policy.caseId}`);
    for (const id of duplicateIds(policy.metrics.map((metric) => metric.id))) {
      errors.push(`${policy.caseId}: duplicate health metric: ${id}`);
    }
    for (const metric of policy.metrics) {
      if (!Number.isFinite(metric.limit))
        errors.push(`${policy.caseId}/${metric.id}: limit is not finite`);
      if (!metric.unit.trim()) errors.push(`${policy.caseId}/${metric.id}: missing unit`);
      if (!metric.provenance.trim())
        errors.push(`${policy.caseId}/${metric.id}: missing provenance`);
    }
  }

  for (const defect of defects) {
    if (!defect.closureCriterion.trim()) errors.push(`${defect.id}: missing closure criterion`);
    if (defect.evidence.length === 0) errors.push(`${defect.id}: missing evidence`);
    if (
      (defect.status === 'mitigated' ||
        defect.status === 'closed' ||
        defect.status === 'superseded') &&
      (!defect.statusEvidence || defect.statusEvidence.length === 0)
    ) {
      errors.push(`${defect.id}: ${defect.status} status requires status evidence`);
    }
  }
  return errors;
}

export function assertValidValidationLedger(input: ValidationLedgerInput = {}): void {
  const errors = validateValidationLedger(input);
  if (errors.length > 0) throw new Error(`invalid validation ledger:\n- ${errors.join('\n- ')}`);
}

export function validationOutcome(id: string): ValidationOutcome {
  const entry = VALIDATION_OUTCOMES.find((outcome) => outcome.caseId === id);
  if (!entry) throw new Error(`validationOutcome: unknown case id "${id}"`);
  return entry;
}

export function numericalHealthPolicy(id: string): NumericalHealthPolicy {
  const entry = NUMERICAL_HEALTH_POLICIES.find((policy) => policy.caseId === id);
  if (!entry) throw new Error(`numericalHealthPolicy: unknown case id "${id}"`);
  return entry;
}

export function validationDefect(id: string): ValidationDefect {
  const entry = VALIDATION_DEFECTS.find((defect) => defect.id === id);
  if (!entry) throw new Error(`validationDefect: unknown defect id "${id}"`);
  return entry;
}

function markdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Compact generated view used by docs/VALIDATION.md; the typed ledger remains authoritative. */
export function renderValidationOutcomeTable(): string {
  return [
    '| Case | Current comparison | Evidence | Observed at / revision | Current interpretation |',
    '| --- | --- | --- | --- | --- |',
    ...VALIDATION_OUTCOMES.map(
      (outcome) =>
        `| ${outcome.caseId} | ${outcome.bandComparison} | \`${markdownCell(outcome.artifact)}\` | ${outcome.observedAt} / \`${markdownCell(outcome.sourceRevision)}\` | ${markdownCell(outcome.summary)} |`,
    ),
  ].join('\n');
}

/** Compact generated view of defect state, closure proof, and the current causal claim. */
export function renderValidationDefectTable(): string {
  return [
    '| Stable ID | Priority / status | Current causal claim | Closure criterion | Evidence | Status evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    ...VALIDATION_DEFECTS.map((defect) => {
      const evidence = defect.evidence.map((path) => `\`${markdownCell(path)}\``).join('<br>');
      const statusEvidence =
        defect.statusEvidence?.map((path) => `\`${markdownCell(path)}\``).join('<br>') ?? '—';
      return `| \`${defect.id}\` | ${defect.priority} / ${defect.status} | ${markdownCell(defect.title)} | ${markdownCell(defect.closureCriterion)} | ${evidence} | ${statusEvidence} |`;
    }),
  ].join('\n');
}

export function acceptanceBand(id: string): AcceptanceBand {
  const entry = ACCEPTANCE_BANDS.find((b) => b.id === id);
  if (!entry) throw new Error(`acceptanceBand: unknown case id "${id}"`);
  return entry;
}

/** The Ahmed body Cd band [0.242, 0.328] — see V11. Single source; do not restate literals. */
export const AHMED_CD_BAND: readonly [number, number] = acceptanceBand('V11').band!;
