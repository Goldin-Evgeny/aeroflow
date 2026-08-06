import type { ParityReport } from './parity';
import type { BenchRow } from '../ui/benchmark';
import type { AhmedWorkerEvent } from '../sim/ahmedRun';
import type { SphereCaseName, LateralBC } from '@aeroflow/core';
import type { CheckpointParityResult } from '../sim/checkpointParity';
import type { TauOracleCheckResult } from '../sim/tauOracleCheck';

/**
 * Write-only observation hooks for the Playwright e2e suite (docs/E2E.md). Pages mirror
 * results they already render into `window.__aeroflow` so tests assert on structured
 * data instead of scraping formatted panel text. Never read by app code.
 */
export interface AeroflowHooks {
  /** Set when the 2D playground (`?playground2d` / `?dev`) reaches its rAF loop. */
  ready?: boolean;
  /** Set when initWebGPU fails and the fallback page is shown. */
  bootError?: string;
  /**
   * Set when the GPU device is lost, with its reason. A dead device does NOT stop the 2D
   * playground's step counter (that is CPU-side), so without this a boot check asserting
   * "totalSteps increases" passes against a device that died 200 ms in — which is exactly
   * what happened on SwiftShader until 2026-07-27.
   */
  deviceLost?: string;
  /**
   * Negotiated device limits, mirrored at boot on EVERY route, so one Tier-B page load
   * records the hardware facts that gate the resolution-wall decision
   * (docs/decisions/D1-resolution-wall.md): what the device actually grants for
   * `maxStorageBufferBindingSize` / `maxStorageBuffersPerShaderStage`, and how many cells
   * that admits with and without the self-imposed 1 GiB clamp.
   */
  caps?: {
    adapter: string;
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxStorageBuffersPerShaderStage: number;
    hasF16: boolean;
    hasTimestamp: boolean;
    /** The cap the layout planner uses: min(binding, buffer). */
    bindingCap: number;
    /** Largest lattice the kernel can address on this device (`maxAddressableCells`). */
    addressableCells: { fp32: number; fp16: number };
    /** Storage bindings the worst-case kernel config needs (4 DDF + forces + ABL). */
    worstCaseStorageBindings: number;
  };
  /** Updated each HUD stats window (~500 ms) on the 2D playground. */
  sim2d?: { totalSteps: number; mlups: number };
  /** Last CPU↔GPU parity matrix result (?dev panel, H6). */
  parityReport?: ParityReport;
  /**
   * Why the last parity run produced no report. Without this a crashed run is
   * indistinguishable from a slow one: `parityReport` simply stays `undefined` and the e2e
   * spec times out with "expected undefined to be truthy", which is what hid a SwiftShader
   * device loss behind a "the matrix is too slow" diagnosis for days. Poll both.
   */
  parityError?: string;
  /** Last matrix cell the parity run STARTED — names the failing cell when it throws. */
  parityProgress?: string;
  /** Last M4/M5 force-section result line (?dev panel). */
  m4?: { summary: string; pass: boolean };
  /** ?parity3d panel: per-config one-line summaries (the rule-0 parity-panel lines). */
  parity3d?: { version: string; allPass: boolean; lines: string[] };
  /** ?checkpointparity: M9 raw-fp16 restore and density-field bit-identity result. */
  checkpointParity?: CheckpointParityResult;
  checkpointParityError?: string;
  /** ?tauoracle: M9 τ_eff reconstruction validation (moment identity + CPU reference). */
  tauOracleCheck?: TauOracleCheckResult;
  tauOracleCheckError?: string;
  /** ?bench3d ladder results. */
  benchRows?: BenchRow[];
  benchMarkdown?: string;
  benchDone?: boolean;
  /** Every worker event received by the ?ahmed page, in order. */
  ahmedEvents?: AhmedWorkerEvent[];
  /** ?aij page: latest sample of the running mode + the demo preview plot max. */
  aij?: {
    /** Increments every (re)start — restart detection without step-count races. */
    runId?: number;
    mode?: 'score' | 'fetch' | 'demo';
    synthetic?: boolean;
    /** Grid below the spec's ≥16 cells/b ⇒ no pass/fail verdict is printed. */
    underResolved?: boolean;
    totalSteps?: number;
    windows?: number;
    drift?: number;
    steady?: boolean;
    q?: number;
    r?: number;
    fetchMaxRel?: number;
    fetchPass?: boolean;
    previewUMax?: number;
    /** Convergence trace: one entry per completed averaging window. */
    trace?: {
      steps: number;
      windows: number;
      drift: number;
      driftIndex: number;
      driftScaled: number;
      fetchMaxRel?: number;
      q?: number;
    }[];
  };
  /** ?urban page: M11 Case C/E scene, progress, suppression, and report evidence. */
  urban?: {
    ready: boolean;
    caseId?: 'C' | 'E';
    direction?: number;
    resumed?: boolean;
    underResolved?: boolean;
    grid?: { nx: number; ny: number; nz: number };
    dx?: number;
    requiredCells?: number;
    totalSteps?: number;
    averagingFlowThroughs?: number;
    q?: number;
    r?: number | null;
    verdict?: 'pass' | 'fail' | 'suppressed';
    reportRows?: number;
    complete?: boolean;
    elapsedMs?: number;
    voxelizationMs?: number;
    /**
     * Wall-clock since the run started, against which `elapsedMs` is the compute duty
     * cycle. The 2026-07-28 strict Case C attempt spent only 43% of its wall time in
     * `submitSteps + readMacroPoints`, and nothing recorded where the rest went — these
     * four fields exist so Wall 3 is measured rather than inferred
     * (docs/decisions/D1-resolution-wall.md).
     */
    wallMs?: number;
    /** Checkpoints written so far, and their cumulative cost. */
    checkpointCount?: number;
    checkpointTotalMs?: number;
    /** Bytes written by the most recent checkpoint (scales with grid, not with time). */
    lastCheckpointBytes?: number;
    error?: string;
  };
  /** ?spheredrag page: latest per-case run / A/B result (M7 acceptance 1–4). */
  sphereDrag?: {
    /** Increments every (re)start — restart detection without step-count races. */
    runId?: number;
    case?: SphereCaseName;
    kind?: 'run' | 'ab' | 'stlab';
    /** True once the run/AB has finished and the numbers below are final. */
    done?: boolean;
    lateralBC?: LateralBC;
    totalConvectiveTimes?: number;
    totalSteps?: number;
    /** Post-transient mean Cd (single run, or the fp32 leg of an A/B). */
    meanCd?: number;
    /** Running-mean drift over the final 20 T_c (the Re=10⁴ < 3% convergence gate). */
    driftPct?: number;
    /** Symmetry check: mean |Fy|,|Fz| ≪ Fx (a free opp[]/direction-table check). */
    meanAbsFy?: number;
    meanAbsFz?: number;
    /** True if the solver diverged (non-finite Cd). */
    diverged?: boolean;
    /** Literature pass band [lo, hi] and whether meanCd fell inside it. */
    band?: [number, number];
    inBand?: boolean;
    /** A/B legs (kind==='ab' or 'stlab'): the second Cd and the relative difference. */
    cdA?: number;
    cdB?: number;
    relDiff?: number;
    /** A/B gate: relDiff ≤ 0.02. */
    abPass?: boolean;
  };
  /** ?cavity page: M3 Ghia lid-driven-cavity headline runs (acceptance 1–3). */
  cavity?: {
    /** Increments every (re)start — restart detection without step-count races. */
    runId?: number;
    Re?: 100 | 1000;
    H?: number;
    tau?: number;
    regularize?: boolean;
    conserveMass?: boolean;
    /** True once the run has finished and the numbers below are final. */
    done?: boolean;
    totalSteps?: number;
    elapsedMs?: number;
    /** Residual criterion outcome. `false` means it hit the step/time budget instead. */
    converged?: boolean;
    /**
     * Which stopping rule fired. `threshold` = the documented 1e-7; `plateau` = the FP32
     * residual floor (see stats/steadyState.ts); `budget` = ran out, numbers not a result.
     */
    stoppedOn?: 'running' | 'threshold' | 'plateau' | 'budget';
    diverged?: boolean;
    residual?: number;
    residualSamples?: number;
    /**
     * Decimated residual trajectory (≤60 points, always including the last). The stopping
     * rule is precision-dependent, so the evidence for WHY a run stopped has to travel
     * with the result instead of living only in a canvas.
     */
    residualTrace?: { step: number; residual: number }[];
    /** The documented convergence criterion, verbatim (M3 acceptance 3). */
    criterion?: string;
    /** Per-extremum Ghia scoring; `tolerance: null` rows are report-only. */
    extrema?: {
      name: string;
      coord: number;
      reference: number;
      simulated: number;
      relError: number;
      tolerance: number | null;
      pass: boolean | null;
    }[];
    /** True when every GATED extremum passed. */
    ghiaPass?: boolean;
    maxAbsErrorU?: number;
    maxAbsErrorV?: number;
    initialMass?: number;
    finalMass?: number;
    /** Signed relative density change over non-solid cells. */
    massDriftRel?: number;
    diagnostics?: {
      steps: number;
      residual: number;
      mass: number;
      massDriftRel: number;
      uMin: number;
      movingWallRoundoffDelta: number;
    }[];
    error?: string;
  };
  /** ?import3d voxelization + live-run readouts. */
  import3d?: {
    voxMs?: number;
    solidCells?: number;
    sample?: { steps: number; cd: number; meanCd: number; newtons: number };
  };
}

declare global {
  interface Window {
    __aeroflow?: AeroflowHooks;
  }
}

export function hooks(): AeroflowHooks {
  return (window.__aeroflow ??= {});
}

/**
 * e2e-only cell-budget override (`?cells=N`): the smallest built-in budgets are sized for
 * real GPUs; SwiftShader CI runs need tiny grids. Returns the selected key or null.
 */
export function applyCellsOverride(
  budgets: Record<string, number>,
  budgetSel: HTMLSelectElement,
): string | null {
  const cells = Number(new URLSearchParams(location.search).get('cells'));
  if (!Number.isFinite(cells) || cells <= 0) return null;
  const key = `${(cells / 1e6).toFixed(2)}M cells (e2e override)`;
  budgets[key] = cells;
  budgetSel.append(new Option(key, key));
  budgetSel.value = key;
  return key;
}

/**
 * Reynolds-number override (`?Re=N`), for the M9 acceptance-1 resolution/effective-Re
 * ladder. The experimental Re = 4.29e6 leaves τ₀ at 0.500002 on every affordable grid, so
 * a screening run needs to be able to ask for an effective Re the grid actually resolves —
 * and the low-Re sanity anchor needs it too. Returns null when the param is absent or not
 * a positive finite number, i.e. "keep the scene default".
 */
export function reOverride(): number | null {
  const Re = Number(new URLSearchParams(location.search).get('Re'));
  return Number.isFinite(Re) && Re > 0 ? Re : null;
}

/**
 * Smagorinsky Cs override (`?lesCs=N`), for the M9 step-7 sensitivity sweep. Returns null when
 * absent or invalid, i.e. "keep the acceptance default".
 *
 * NOTE the guard is `>= 0`, not `> 0` as in `reOverride`: **Cs = 0 is a meaningful rung** (LES
 * fully off), and rejecting it would silently substitute the default — turning a deliberate
 * LES-off run into an unlabelled duplicate of the baseline.
 */
export function lesCsOverride(): number | null {
  const raw = new URLSearchParams(location.search).get('lesCs');
  if (raw === null || raw.trim() === '') return null;
  const cs = Number(raw);
  return Number.isFinite(cs) && cs >= 0 ? cs : null;
}

/**
 * DDF storage precision override (`?precision=fp16|fp32`). Criterion 1′ specifies FP16, so
 * fp32 is a diagnostic configuration — it exists to test whether FP16 quantization is behind
 * the subgrid activation measured in the undisturbed approach freestream.
 */
/**
 * Stability-snapshot cadence override (`?fieldEvery=N`, convective times). The ladder tightens
 * this on reduced-Cs rungs, where the run can go from healthy to NaN fast enough that a coarse
 * cadence would leave the last healthy record uselessly far before the failure.
 */
export function fieldEveryOverride(): number | null {
  const v = Number(new URLSearchParams(location.search).get('fieldEvery'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function precisionOverride(): 'fp16' | 'fp32' | null {
  const p = new URLSearchParams(location.search).get('precision');
  return p === 'fp16' || p === 'fp32' ? p : null;
}
