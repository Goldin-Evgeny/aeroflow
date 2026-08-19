import { CellType, isSolid } from '../lattice.js';
import { D3Q19 } from '../lattice3d.js';
import type { BoundaryPopulationEvent, BoundaryRule } from '../cpu/boundaryDiagnostics.js';
import type { FreeSlipFaces } from '../cpu/freeslip.js';
import { materialConfigurationFingerprint } from './outletPolicy.js';

export type OutletLocalizationHypothesisId =
  | 'implementation-discrepancy'
  | 'boundary-intersection-dependent'
  | 'zero-gradient-formulation-feedback'
  | 'collision-amplified'
  | 'les-amplified';

export type OutletLocalizationBranch = OutletLocalizationHypothesisId | 'inconclusive';

export interface OutletLocalizationManifest {
  readonly id: 'near-floor-outlet-localization/v2';
  readonly version: 2;
  readonly hypotheses: readonly {
    readonly id: OutletLocalizationHypothesisId;
    readonly prediction: string;
    readonly requiredEvidence: readonly string[];
  }[];
  readonly arms: readonly {
    readonly id: string;
    readonly stage:
      'oracle' | 'flat' | 'perturbation' | 'topology' | 'collision' | 'les' | 'bounded';
    readonly topology: string;
    readonly outlet: 'pressure' | 'zero-gradient' | 'both';
    readonly executor: 'naive' | 'esoteric' | 'both';
  }[];
  readonly metrics: readonly string[];
  readonly tolerances: {
    readonly float64PopulationAbs: number;
    readonly float64MomentAbs: number;
    readonly repeatabilityAbs: number;
    readonly massModeRetainedGainMin: number;
    readonly massModeAnchoredGainMax: number;
    readonly outletMeanDensitySeparationAbsMin: number;
    readonly derivation: string;
  };
  readonly stopConditions: readonly string[];
  readonly branches: readonly OutletLocalizationBranch[];
}

const hypothesis = (
  id: OutletLocalizationHypothesisId,
  prediction: string,
  requiredEvidence: readonly string[],
): OutletLocalizationManifest['hypotheses'][number] => ({ id, prediction, requiredEvidence });

export const OUTLET_LOCALIZATION_MANIFEST: OutletLocalizationManifest = {
  id: 'near-floor-outlet-localization/v2',
  version: 2,
  hypotheses: [
    hypothesis(
      'implementation-discrepancy',
      'The first captured production transform disagrees with an independently hand-executed rule.',
      ['oracle-mismatch', 'same-state-replay', 'unambiguous-ownership'],
    ),
    hypothesis(
      'boundary-intersection-dependent',
      'Flat faces remain bounded and one named edge or corner introduces the first abnormal response.',
      ['flat-control-bounded', 'single-intersection-abnormal', 'first-event-at-intersection'],
    ),
    hypothesis(
      'zero-gradient-formulation-feedback',
      'The H4 implementation matches its rule while the flat collision-neutral mass mode is abnormal.',
      ['oracle-match', 'flat-abnormal', 'collision-neutral-abnormal', 'les-off-abnormal'],
    ),
    hypothesis(
      'collision-amplified',
      'Boundary-only response is bounded and the abnormal response begins with a named collision stage.',
      ['oracle-match', 'neutral-bounded', 'collision-abnormal'],
    ),
    hypothesis(
      'les-amplified',
      'LES-off response is bounded and the abnormal response begins with a named LES closure.',
      ['oracle-match', 'collision-bounded', 'les-abnormal'],
    ),
  ],
  arms: [
    {
      id: 'manufactured-boundaries',
      stage: 'oracle',
      topology: 'single-link',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'flat-zgrad-repeat',
      stage: 'flat',
      topology: 'flat-x',
      outlet: 'zero-gradient',
      executor: 'both',
    },
    {
      id: 'flat-pressure-repeat',
      stage: 'flat',
      topology: 'flat-x',
      outlet: 'pressure',
      executor: 'both',
    },
    {
      id: 'rho-minus',
      stage: 'perturbation',
      topology: 'flat-x',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'rho-plus',
      stage: 'perturbation',
      topology: 'flat-x',
      outlet: 'both',
      executor: 'naive',
    },
    { id: 'ground', stage: 'topology', topology: 'x+ground', outlet: 'both', executor: 'naive' },
    {
      id: 'free-slip-y',
      stage: 'topology',
      topology: 'x+y-slip',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'free-slip-z',
      stage: 'topology',
      topology: 'x+z-slip',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'intersections',
      stage: 'topology',
      topology: 'near-floor-shell',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'collision-neutral',
      stage: 'collision',
      topology: 'flat-x',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'plain-trt',
      stage: 'collision',
      topology: 'near-floor-shell',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'regularized-trt',
      stage: 'collision',
      topology: 'near-floor-shell',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'les-off',
      stage: 'les',
      topology: 'near-floor-shell',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'les-legacy',
      stage: 'les',
      topology: 'near-floor-shell',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'les-spec',
      stage: 'les',
      topology: 'near-floor-shell',
      outlet: 'both',
      executor: 'naive',
    },
    {
      id: 'bounded-confirmation',
      stage: 'bounded',
      topology: 'ledger-10x8x7',
      outlet: 'both',
      executor: 'naive',
    },
  ],
  metrics: [
    'population-residual',
    'mass-delta',
    'momentum-delta',
    'mean-density-response',
    'boundary-exchange',
    'non-finite-step',
    'state-fingerprint',
  ],
  tolerances: {
    // 19 population reductions and quadratic equilibria remain below O(100 eps) in Float64.
    float64PopulationAbs: 128 * Number.EPSILON,
    float64MomentAbs: 512 * Number.EPSILON,
    repeatabilityAbs: 0,
    // A gain of one preserves the injected global mode and zero removes it; 0.5 is their
    // analytic midpoint. The anchored ceiling and density separation map the repository's
    // pre-existing 0.1% numerical-health scale through the ±1% perturbation amplitude.
    massModeRetainedGainMin: 0.5,
    massModeAnchoredGainMax: 0.1,
    outletMeanDensitySeparationAbsMin: 1e-3,
    derivation:
      'Float64 forward-error ceiling: 128 eps per reconstructed population and 512 eps after the 19-term moment reduction; deterministic repeats require exact equality. A unit global-mode gain means preservation and zero means anchoring, so 0.5 is the analytic midpoint; the 0.1 anchored-gain ceiling and 1e-3 outlet separation map the existing 0.1% health scale through the frozen ±1% perturbation.',
  },
  stopConditions: [
    'manifest-invalid',
    'oracle-fixture-failed',
    'same-outlet-repeatability-failed',
    'naive-esoteric-identity-failed',
    'ambiguous-boundary-ownership',
    'execution-invalid',
    'numerical-health-invalid',
  ],
  branches: [
    'implementation-discrepancy',
    'boundary-intersection-dependent',
    'zero-gradient-formulation-feedback',
    'collision-amplified',
    'les-amplified',
    'inconclusive',
  ],
};

export function outletLocalizationManifestFingerprint(
  manifest: OutletLocalizationManifest = OUTLET_LOCALIZATION_MANIFEST,
): string {
  return materialConfigurationFingerprint(manifest);
}

export function validateOutletLocalizationManifest(manifest: OutletLocalizationManifest): void {
  if (manifest.id !== 'near-floor-outlet-localization/v2' || manifest.version !== 2) {
    throw new Error('outlet localization manifest identity is unsupported');
  }
  const unique = (values: readonly string[], label: string): void => {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${label} id`);
  };
  unique(
    manifest.hypotheses.map((entry) => entry.id),
    'hypothesis',
  );
  unique(
    manifest.arms.map((entry) => entry.id),
    'arm',
  );
  unique(manifest.metrics, 'metric');
  unique(manifest.branches, 'branch');
  for (const entry of manifest.hypotheses) {
    if (!entry.prediction || entry.requiredEvidence.length === 0) {
      throw new Error(`hypothesis ${entry.id} is missing prediction evidence`);
    }
  }
  for (const [key, value] of Object.entries(manifest.tolerances)) {
    if (key === 'derivation') continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('manifest tolerance is invalid');
    }
  }
  if (manifest.stopConditions.length === 0) throw new Error('manifest stop conditions missing');
}

export interface IndependentBoundaryOracleInput {
  readonly rule: BoundaryRule;
  readonly direction: number;
  readonly populations?: readonly number[];
  readonly canonicalOutgoing?: number;
  readonly inletDensity?: number;
  readonly inletVelocity?: number;
  readonly forcingShift?: readonly [number, number, number];
}

function equilibriumIndependent(
  direction: number,
  rho: number,
  ux: number,
  uy: number,
  uz: number,
): number {
  const eu = D3Q19.ex[direction] * ux + D3Q19.ey[direction] * uy + D3Q19.ez[direction] * uz;
  const usq = ux * ux + uy * uy + uz * uz;
  return D3Q19.w[direction] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * usq);
}

export function independentBoundaryPopulation(input: IndependentBoundaryOracleInput): number {
  const { rule, direction } = input;
  if (!Number.isInteger(direction) || direction < 0 || direction >= D3Q19.q) {
    throw new Error('independent boundary oracle direction invalid');
  }
  if (rule === 'no-slip-bounce') {
    if (input.canonicalOutgoing === undefined) throw new Error('no-slip oracle needs outgoing');
    return input.canonicalOutgoing;
  }
  if (rule === 'free-slip-redirect' || rule === 'zero-gradient-outlet') {
    if (!input.populations || input.populations.length !== D3Q19.q) {
      throw new Error(`${rule} oracle needs 19 populations`);
    }
    return input.populations[direction];
  }
  if (rule === 'plain-inlet' || rule === 'velocity-inlet') {
    const rho = rule === 'plain-inlet' ? 1 : input.inletDensity;
    if (rho === undefined || !Number.isFinite(rho)) throw new Error('inlet oracle needs density');
    return equilibriumIndependent(direction, rho, input.inletVelocity ?? 0, 0, 0);
  }
  if (!input.populations || input.populations.length !== D3Q19.q) {
    throw new Error('pressure oracle needs 19 populations');
  }
  let rho = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < D3Q19.q; i++) {
    const value = input.populations[i];
    rho += value;
    mx += D3Q19.ex[i] * value;
    my += D3Q19.ey[i] * value;
    mz += D3Q19.ez[i] * value;
  }
  const shift = input.forcingShift ?? [0, 0, 0];
  const ux = mx / rho - shift[0];
  const uy = my / rho - shift[1];
  const uz = mz / rho - shift[2];
  return (
    equilibriumIndependent(direction, 1, ux, uy, uz) +
    input.populations[direction] -
    equilibriumIndependent(direction, rho, ux, uy, uz)
  );
}

export type IndependentOwnershipResult =
  | {
      readonly state: 'resolved';
      readonly sx: number;
      readonly sy: number;
      readonly sz: number;
      readonly direction: number;
      readonly fallback: boolean;
      readonly intersection: string;
    }
  | { readonly state: 'ambiguous'; readonly reason: string };

/** Independent H11 walk: deliberately does not call the production resolveFreeSlipPull helper. */
export function independentFreeSlipOwnership(input: {
  readonly flags: Uint8Array;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly faces: FreeSlipFaces;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly direction: number;
}): IndependentOwnershipResult {
  const { sx } = input;
  let { sy, sz } = input;
  let direction = input.direction;
  const labels: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const index = sx + input.nx * (sy + input.ny * sz);
    const flag = input.flags[index];
    if (flag !== CellType.FreeSlip) {
      return {
        state: 'resolved',
        sx,
        sy,
        sz,
        direction,
        fallback: isSolid(flag),
        intersection: labels.length ? labels.join('&') : 'free-slip-face',
      };
    }
    let reflected = false;
    if (
      ((sy === 0 && input.faces.yMin) || (sy === input.ny - 1 && input.faces.yMax)) &&
      D3Q19.ey[direction] !== 0
    ) {
      labels.push(sy === 0 ? 'y-min' : 'y-max');
      sy += D3Q19.ey[direction];
      direction = D3Q19.reflectY[direction];
      reflected = true;
    }
    if (
      ((sz === 0 && input.faces.zMin) || (sz === input.nz - 1 && input.faces.zMax)) &&
      D3Q19.ez[direction] !== 0
    ) {
      labels.push(sz === 0 ? 'z-min' : 'z-max');
      sz += D3Q19.ez[direction];
      direction = D3Q19.reflectZ[direction];
      reflected = true;
    }
    if (!reflected) return { state: 'ambiguous', reason: 'free-slip-face-or-direction-mismatch' };
  }
  return { state: 'ambiguous', reason: 'free-slip-reflection-did-not-resolve' };
}

export interface OutletLocalizationEvidence {
  readonly executionValid: boolean;
  readonly numericalHealthValid: boolean;
  readonly controlsRepeatable: boolean;
  readonly executorsEquivalent: boolean;
  readonly ownershipAmbiguous: boolean;
  readonly oracleMismatchRepeated: boolean;
  readonly oracleMatches: boolean;
  readonly flatBounded: boolean;
  readonly flatAbnormal: boolean;
  readonly intersectionName: string | null;
  readonly firstEventAtIntersection: boolean;
  readonly neutralBounded: boolean;
  readonly neutralAbnormal: boolean;
  readonly collisionBounded: boolean;
  readonly collisionAbnormal: boolean;
  readonly lesOffAbnormal: boolean;
  readonly lesAbnormal: boolean;
  readonly boundedConfirmed: boolean;
  readonly missingEvidence: readonly string[];
}

export interface OutletLocalizationResult {
  readonly branch: OutletLocalizationBranch;
  readonly compatibleBranches: readonly OutletLocalizationHypothesisId[];
  readonly rejectedBranches: readonly OutletLocalizationHypothesisId[];
  readonly reasons: readonly string[];
  readonly boundedConfirmed: boolean;
  readonly repairAuthorized: false;
}

export function classifyOutletLocalization(
  evidence: OutletLocalizationEvidence,
): OutletLocalizationResult {
  const all = OUTLET_LOCALIZATION_MANIFEST.hypotheses.map((entry) => entry.id);
  const inconclusive = (
    reasons: readonly string[],
    compatible = all,
  ): OutletLocalizationResult => ({
    branch: 'inconclusive',
    compatibleBranches: compatible,
    rejectedBranches: all.filter((id) => !compatible.includes(id)),
    reasons,
    boundedConfirmed: evidence.boundedConfirmed,
    repairAuthorized: false,
  });
  if (!evidence.executionValid || !evidence.numericalHealthValid) {
    return inconclusive(['execution-or-numerical-health-invalid']);
  }
  if (!evidence.controlsRepeatable || !evidence.executorsEquivalent) {
    return inconclusive(['control-repeatability-or-executor-identity-failed']);
  }
  if (evidence.ownershipAmbiguous) return inconclusive(['ambiguous-boundary-ownership']);
  if (evidence.missingEvidence.length) {
    return inconclusive(evidence.missingEvidence.map((entry) => `missing:${entry}`));
  }
  const compatible: OutletLocalizationHypothesisId[] = [];
  if (evidence.oracleMismatchRepeated) compatible.push('implementation-discrepancy');
  if (
    evidence.flatBounded &&
    evidence.intersectionName !== null &&
    evidence.firstEventAtIntersection
  ) {
    compatible.push('boundary-intersection-dependent');
  }
  if (
    evidence.oracleMatches &&
    evidence.flatAbnormal &&
    evidence.neutralAbnormal &&
    evidence.lesOffAbnormal
  ) {
    compatible.push('zero-gradient-formulation-feedback');
  }
  if (evidence.oracleMatches && evidence.neutralBounded && evidence.collisionAbnormal) {
    compatible.push('collision-amplified');
  }
  if (evidence.oracleMatches && evidence.collisionBounded && evidence.lesAbnormal) {
    compatible.push('les-amplified');
  }
  if (compatible.length !== 1) {
    return inconclusive(
      compatible.length === 0 ? ['no-branch-satisfied'] : ['multiple-compatible-branches'],
      compatible,
    );
  }
  if (!evidence.boundedConfirmed) {
    return inconclusive(['bounded-confirmation-missing'], compatible);
  }
  const branch = compatible[0];
  return {
    branch,
    compatibleBranches: compatible,
    rejectedBranches: all.filter((id) => id !== branch),
    reasons: [`evidence-satisfies:${branch}`],
    boundedConfirmed: evidence.boundedConfirmed,
    repairAuthorized: false,
  };
}

export interface OutletLocalizationArmRecord {
  readonly id: string;
  readonly status: 'passed' | 'failed' | 'not-run-upstream-failed';
  readonly configurationFingerprint: string;
  readonly initialStateFingerprint: string;
  readonly finalStateFingerprint: string;
  readonly metrics: Readonly<Record<string, number | string | boolean | null>>;
  readonly events: readonly BoundaryPopulationEvent[];
}

export interface OutletLocalizationArtifact {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly manifestId: OutletLocalizationManifest['id'];
  readonly manifestFingerprint: string;
  readonly source: {
    readonly revision: string;
    readonly dirty: boolean;
    readonly diffSha256?: string;
  };
  readonly arms: readonly OutletLocalizationArmRecord[];
  readonly result: OutletLocalizationResult;
  readonly originalEvidence: {
    readonly aggregateSeparationStep: 25;
    readonly divergenceStep: 3346;
  };
  readonly nonClaims: readonly string[];
}

export function validateOutletLocalizationArtifact(
  artifact: OutletLocalizationArtifact,
  manifest: OutletLocalizationManifest = OUTLET_LOCALIZATION_MANIFEST,
): OutletLocalizationArtifact {
  validateOutletLocalizationManifest(manifest);
  if (artifact.schemaVersion !== 1) throw new Error('localization artifact schema unsupported');
  if (artifact.manifestId !== manifest.id)
    throw new Error('localization artifact manifest id mismatch');
  if (artifact.manifestFingerprint !== outletLocalizationManifestFingerprint(manifest)) {
    throw new Error('localization artifact reinterpreted under a changed manifest');
  }
  if (!Number.isFinite(Date.parse(artifact.generatedAt)))
    throw new Error('artifact timestamp invalid');
  const ids = artifact.arms.map((arm) => arm.id);
  if (new Set(ids).size !== ids.length) throw new Error('artifact contains duplicate arm ids');
  for (const arm of artifact.arms) {
    if (!arm.configurationFingerprint) throw new Error(`arm ${arm.id} fingerprint missing`);
    if (!arm.initialStateFingerprint || !arm.finalStateFingerprint) {
      throw new Error(`arm ${arm.id} state fingerprint missing`);
    }
    for (const event of arm.events) {
      if (!event.intersection) throw new Error(`arm ${arm.id} event ownership missing`);
    }
  }
  if (artifact.result.repairAuthorized !== false)
    throw new Error('localization cannot authorize repair');
  if (artifact.nonClaims.length === 0) throw new Error('localization artifact non-claims missing');
  return artifact;
}
