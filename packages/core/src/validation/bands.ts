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

export function acceptanceBand(id: string): AcceptanceBand {
  const entry = ACCEPTANCE_BANDS.find((b) => b.id === id);
  if (!entry) throw new Error(`acceptanceBand: unknown case id "${id}"`);
  return entry;
}

/** The Ahmed body Cd band [0.242, 0.328] — see V11. Single source; do not restate literals. */
export const AHMED_CD_BAND: readonly [number, number] = acceptanceBand('V11').band!;
