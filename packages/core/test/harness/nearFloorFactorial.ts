import { CellType } from '../../src/lattice.js';
import { Solver3D } from '../../src/cpu/solver3d.js';
import { type FreeSlipFaces } from '../../src/cpu/freeslip.js';
import { lesKFromCs, type LesNorm } from '../../src/cpu/collide.js';
import { type Outlet3D } from '../../src/cpu/outlet3d.js';
import { compareStrain } from '../../src/analysis/strainComparison.js';
import {
  freestreamEddyViscosity,
  type FreestreamEddyViscosity,
} from '../../src/analysis/freestreamEddyViscosity.js';

/**
 * The discriminating factorial (openspec/changes/discriminate-near-floor-instability, D4).
 *
 * `{regularize on|off} × {lesNorm legacy|spec} × {ω⁻ derived|raised}` at the acceptance-tier
 * τ₀ = 0.5000005, on the CPU empty tunnel. Two mechanisms have been on the table for the
 * near-floor destabilization since 2026-08-14 and two reverts failed to separate them, because
 * both predict the same signature when only τ₀ is varied — τ₀ → ½ degrades both at once. This
 * factorial varies them independently, which is the whole point of it.
 *
 * It measures a mechanism. It does not score a benchmark, and it takes no position on whether
 * the `lesNorm` default should be flipped — that stays deferred to
 * `fix-confirmed-physics-defects` task 6.9.
 */

/** τ₀ at the real acceptance operating point (Ahmed/AIJ sit at ≈ 0.5000042). */
export const TAU0 = 0.5000005;
export const CS = 0.1;
export const INLET_VELOCITY = 0.05;

export interface SceneSpec {
  label: string;
  nx: number;
  ny: number;
  nz: number;
  /** Boundary-influence exclusion for the freestream probe on this scene. */
  exclusionDistance: number;
}

/**
 * Sized for the freestream probe, not for the H14 mass ledger. The 10×8×7 ledger scene leaves
 * 8 cells after a distance-3 exclusion — a line, not a freestream (see
 * `freestreamEddyViscosity.test.ts` task 3.5). D3's risk register calls for exactly this
 * separation.
 */
export const PROBE_SCENE: SceneSpec = {
  label: 'probe-24x16x14',
  nx: 24,
  ny: 16,
  nz: 14,
  exclusionDistance: 3,
};

/**
 * The scene the near-floor destabilization was actually recorded on: `pressureOutlet3d.test.ts`
 * went non-finite between step 3000 and 3500 under `'spec'` here, and held to 6000 under
 * `'legacy'`. Kept as the REPRODUCTION CONTROL — a factorial run on a different grid that fails
 * to reproduce the motivating observation is measuring a different phenomenon, and there is no
 * way to know that without running this one.
 *
 * Exclusion 2 rather than 3: at 3 the freestream selection collapses to 8 cells. The probe
 * statistic from this scene is correspondingly weak and is reported as such.
 */
export const LEDGER_SCENE: SceneSpec = {
  label: 'ledger-10x8x7',
  nx: 10,
  ny: 8,
  nz: 7,
  exclusionDistance: 2,
};

/** Default scene for the factorial. */
export const SCENE = PROBE_SCENE;
export const EXCLUSION_DISTANCE = PROBE_SCENE.exclusionDistance;

/**
 * The raised ω⁻. At this τ₀ the derived value is ≈ 6.6e-3 against ω⁺ ≈ 1.995, so 1.0 is a
 * ~150× raise and sits well inside the admissible (0, 2). If the antisymmetric moments being
 * essentially unrelaxed is what destabilizes the tunnel, this is the arm that shows it.
 */
export const OMEGA_MINUS_RAISED = 1.0;

/** Past the ~3,500 divergence recorded for `'spec'` on the ledger tunnel. */
export const STEP_BUDGET = 4000;
/** How often the full field diagnostics are captured and kept as "last good". */
export const SAMPLE_INTERVAL = 250;

export interface FactorialArm {
  regularize: boolean;
  lesNorm: LesNorm;
  omegaMinusRaised: boolean;
  outlet: Outlet3D;
}

/**
 * **The outlet axis is a deviation from design.md D4, added on evidence after D4's 2×2×2 was
 * run and its reproduction control failed.**
 *
 * D4 specified `{regularize} × {lesNorm} × {ω⁻}` and nothing else. Run that way against the
 * `pressureOutlet3d.test.ts` ledger scene with the PRESSURE outlet, every `regularize: true`
 * arm stayed finite through 6,000 steps under `'spec'` — i.e. the harness did not reproduce
 * the destabilization the whole change exists to explain, and its numbers were therefore
 * uninterpretable.
 *
 * Measured cause (2026-08-17, ledger scene, τ₀ = 0.5000005, regularize:true, LES Cs = 0.1):
 *
 *   outlet=pressure       rho0=1     legacy: finite@6000   spec: finite@6000
 *   outlet=pressure       rho0=1.05  legacy: finite@6000   spec: finite@6000
 *   outlet=zero-gradient  rho0=1     legacy: finite@6000   spec: DIVERGED@3346
 *   outlet=zero-gradient  rho0=1.05  legacy: finite@6000   spec: DIVERGED@2942
 *
 * The recorded observation is "non-finite between step 3000 and 3500 under `'spec'`", which
 * the zero-gradient rows match and the pressure rows contradict. The original test is an
 * `it.each` over three cases and only its third uses the zero-gradient outlet; the first
 * factorial run took the wrong one.
 *
 * So the near-floor `'spec'` destabilization at a regularized operating point is
 * **outlet-dependent** — an observation, recorded before any mechanism is claimed for it.
 */
export const OUTLETS: readonly Outlet3D[] = ['zero-gradient', 'pressure'];

export interface FactorialSample {
  step: number;
  rhoMean: number;
  rhoMin: number;
  rhoMax: number;
  maxSpeed: number;
  freestream: FreestreamEddyViscosity;
  /** `compareStrain`'s closure-implied over finite-difference strain ratio. */
  medianRatioSlope: number;
  /** The rates actually in force over the freestream selection. */
  omegaPlus: { min: number; mean: number; max: number };
  omegaMinus: { min: number; mean: number; max: number };
}

export interface FactorialCell {
  arm: FactorialArm;
  scene: SceneSpec;
  label: string;
  finite: boolean;
  /**
   * Step at which a non-finite τ_eff first appeared, or `null` if the arm completed. Detection
   * is a per-step scan of the solver's own τ_eff record over Fluid cells — τ_eff is a function
   * of ρ and ‖Π^neq‖, so a population going non-finite makes it non-finite in the same step.
   */
  divergenceStep: number | null;
  stepsCompleted: number;
  /** Diagnostics from the last clean sample — preserved even when the arm diverged. */
  lastSample: FactorialSample | null;
  samples: Array<{ step: number; rhoMean: number; maxSpeed: number; freestreamP50: number }>;
  wallClockMs: number;
  error: string | null;
}

/**
 * Predictions, stated before the factorial is run and written to the artifact directory before
 * the first arm starts, so the comparison afterwards is prediction-vs-result rather than a
 * story told over whatever came out. Copied from design.md D4.
 */
export const FACTORIAL_PREDICTIONS = {
  statedBefore: 'Written to disk before the first arm executes; see runFactorial().',
  d1Result:
    'The ω⁻-inertness null test returned BIT-IDENTICAL over a Λ sweep (Λ = 3/16 vs 3, ' +
    'regularize:true, 300 steps, 0 of 13,300 populations differing), so mechanism (A) cannot ' +
    'operate in any regularize:true arm. The two ω⁻ arms in the regularize:true half are ' +
    'therefore predicted DYNAMICALLY identical, and are kept as a regression detector for ' +
    'that invariant (task 4.3).',
  d1Qualification:
    'Measured while building this harness, and NOT known when D1 was run: the projection is ' +
    'even exactly, but is reconstructed as fl(f_eq + 4.5·w·Q:Π), and the two roundings of an ' +
    'opposite-direction pair do not cancel — leaving an O(ulp) antisymmetric residual that ω⁻ ' +
    'multiplies. On this scene at 20 steps it changes NO population for ω⁻ ∈ ' +
    '{1e-3, 1e-2, 0.1, 0.5} and changes populations at the 1e-15 relative level for ω⁻ ∈ ' +
    '{1.0, 1.9}: a threshold at ω⁻ ≈ 1, where ω⁻ × (½-ulp-scale residual) first reaches half ' +
    'an ulp of the population. The raised arm here uses ω⁻ = 1.0, i.e. just above that ' +
    'threshold, so its regularize:true half is expected to agree to rounding, not bit for ' +
    'bit. This is a roundoff-magnitude effect and carries no dynamical content; it does not ' +
    'reinstate mechanism (A).',
  hypotheses: [
    {
      mechanism: '(A) ω⁻ collapse',
      raisingOmegaMinusWithRegularizeOff: 'stabilizes, and freestream ν_t falls',
      regularizeOffAtLesNormSpec: 'still unstable — regularization was not the cause',
    },
    {
      mechanism: '(B) projected-regularization anti-dissipation',
      raisingOmegaMinusWithRegularizeOff: 'no effect on stability',
      regularizeOffAtLesNormSpec: 'stabilizes — the projection was the cause',
    },
    {
      mechanism: 'Both, additively',
      raisingOmegaMinusWithRegularizeOff: 'partial improvement',
      regularizeOffAtLesNormSpec: 'partial improvement',
    },
    {
      mechanism: 'Neither',
      raisingOmegaMinusWithRegularizeOff: 'no effect',
      regularizeOffAtLesNormSpec: 'no effect — a third mechanism is indicated',
    },
  ],
  invariant:
    'Every regularize:true arm must be DYNAMICALLY identical across its two ω⁻ settings (equal ' +
    'to floating-point rounding; see d1Qualification for why bit-identity is the wrong bar at ' +
    'ω⁻ = 1.0). A dynamical difference there falsifies the D1 null test and outranks ' +
    'everything else in this factorial.',
  outletAxisProvenance:
    'The outlet axis is NOT from D4. It was added after D4s 2x2x2 was run and its ' +
    'reproduction control failed: with the pressure outlet, no regularize:true arm ' +
    'destabilizes under spec on either scene, so the harness was not reproducing the ' +
    'phenomenon under investigation. See the OUTLETS docstring for the measurement that ' +
    'established the zero-gradient outlet as the reproducing configuration. Predictions above ' +
    'were stated for the D4 axes and are compared on the reproducing (zero-gradient) half.',
} as const;

/** The M9 free-slip empty tunnel: no-slip ground, free-slip roof and sides, pressure outlet. */
export function factorialFlags(scene: SceneSpec = SCENE): Uint8Array {
  const { nx, ny, nz } = scene;
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const flags = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      flags[at(x, 0, z)] = CellType.Solid;
      flags[at(x, ny - 1, z)] = CellType.FreeSlip;
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      flags[at(x, y, 0)] = CellType.FreeSlip;
      flags[at(x, y, nz - 1)] = CellType.FreeSlip;
    }
  }
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      flags[at(0, y, z)] = CellType.VelocityInlet;
      flags[at(nx - 1, y, z)] = CellType.Outlet;
    }
  }
  for (let z = 0; z < nz; z++) flags[at(0, ny - 1, z)] = CellType.Inlet;
  for (let y = 1; y < ny; y++) {
    flags[at(0, y, 0)] = CellType.Inlet;
    flags[at(0, y, nz - 1)] = CellType.Inlet;
  }
  return flags;
}

export const FREE_SLIP: FreeSlipFaces = { yMax: true, zMin: true, zMax: true };

/** All sixteen arms, in a fixed order so two runs are comparable line by line. */
export function factorialArms(): FactorialArm[] {
  const arms: FactorialArm[] = [];
  for (const outlet of OUTLETS) {
    for (const regularize of [true, false]) {
      for (const lesNorm of ['legacy', 'spec'] as const) {
        for (const omegaMinusRaised of [false, true]) {
          arms.push({ regularize, lesNorm, omegaMinusRaised, outlet });
        }
      }
    }
  }
  return arms;
}

export function armLabel(arm: FactorialArm): string {
  return [
    `out=${arm.outlet === 'zero-gradient' ? 'zgrad' : 'press'}`,
    `reg=${arm.regularize ? 'on' : 'off'}`,
    `norm=${arm.lesNorm}`,
    `om=${arm.omegaMinusRaised ? `raised(${OMEGA_MINUS_RAISED})` : 'derived'}`,
  ].join(' ');
}

function statsOf(
  values: Float64Array,
  select: (idx: number) => boolean,
): { min: number; mean: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let idx = 0; idx < values.length; idx++) {
    if (!select(idx)) continue;
    const v = values[idx];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    count++;
  }
  return count > 0
    ? { min, mean: sum / count, max }
    : { min: Number.NaN, mean: Number.NaN, max: Number.NaN };
}

export interface RunArmOptions {
  stepBudget?: number;
  sampleInterval?: number;
  scene?: SceneSpec;
}

export async function runArm(
  arm: FactorialArm,
  options: RunArmOptions = {},
): Promise<FactorialCell> {
  const stepBudget = options.stepBudget ?? STEP_BUDGET;
  const sampleInterval = options.sampleInterval ?? SAMPLE_INTERVAL;
  const scene = options.scene ?? SCENE;
  const { nx, ny, nz, exclusionDistance } = scene;
  const n = nx * ny * nz;
  const flags = factorialFlags(scene);
  const started = Date.now();

  const cell: FactorialCell = {
    arm,
    scene,
    label: armLabel(arm),
    finite: true,
    divergenceStep: null,
    stepsCompleted: 0,
    lastSample: null,
    samples: [],
    wallClockMs: 0,
    error: null,
  };

  try {
    const solver = new Solver3D({
      nx,
      ny,
      nz,
      omega: 1 / TAU0,
      flags,
      inletVelocity: INLET_VELOCITY,
      collision: 'trt',
      omegaMinus: arm.omegaMinusRaised ? OMEGA_MINUS_RAISED : undefined,
      les: { cs: CS, norm: arm.lesNorm },
      regularize: arm.regularize,
      conserveMass: true,
      outlet: arm.outlet,
      freeSlip: FREE_SLIP,
    });
    solver.reset(1);

    const tauEff = new Float64Array(n);
    const omegaPlus = new Float64Array(n);
    const omegaMinus = new Float64Array(n);
    solver.tauEffRecord = tauEff;
    solver.omegaPlusRecord = omegaPlus;
    solver.omegaMinusRecord = omegaMinus;

    const evaluated = new Uint8Array(n);
    const fluidIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (flags[i] === CellType.Fluid) {
        evaluated[i] = 1;
        fluidIndices.push(i);
      }
    }
    const isFluid = (idx: number): boolean => evaluated[idx] === 1;
    const lesK = lesKFromCs(CS);

    const takeSample = (step: number): void => {
      const m = solver.macroscopics();
      let rhoSum = 0;
      let rhoMin = Infinity;
      let rhoMax = -Infinity;
      let maxSpeed = 0;
      for (const idx of fluidIndices) {
        const r = m.rho[idx];
        rhoSum += r;
        if (r < rhoMin) rhoMin = r;
        if (r > rhoMax) rhoMax = r;
        const speed = Math.hypot(m.ux[idx], m.uy[idx], m.uz[idx]);
        if (speed > maxSpeed) maxSpeed = speed;
      }
      const freestream = freestreamEddyViscosity({
        nx,
        ny,
        nz,
        tauEff,
        evaluated,
        tau0: TAU0,
        exclusionDistance,
      });
      const strain = compareStrain({
        nx,
        ny,
        nz,
        tauEff,
        evaluated,
        ux: m.ux,
        uy: m.uy,
        uz: m.uz,
        rho: m.rho,
        tau0: TAU0,
        lesK,
        lesNorm: arm.lesNorm,
      });
      cell.lastSample = {
        step,
        rhoMean: rhoSum / fluidIndices.length,
        rhoMin,
        rhoMax,
        maxSpeed,
        freestream,
        medianRatioSlope: strain.medianRatioSlope,
        omegaPlus: statsOf(omegaPlus, isFluid),
        omegaMinus: statsOf(omegaMinus, isFluid),
      };
      cell.samples.push({
        step,
        rhoMean: rhoSum / fluidIndices.length,
        maxSpeed,
        freestreamP50: freestream.ratio.p50,
      });
    };

    for (let step = 1; step <= stepBudget; step++) {
      solver.step();
      cell.stepsCompleted = step;
      // Per-step divergence detection on the solver's own τ_eff record: τ_eff is a function of
      // ρ and ‖Π^neq‖, so a population going non-finite makes τ_eff non-finite the same step.
      // Scanning n values rather than 19n keeps the check ~5% of the step cost.
      let bad = false;
      for (const idx of fluidIndices) {
        if (!Number.isFinite(tauEff[idx])) {
          bad = true;
          break;
        }
      }
      if (bad) {
        cell.finite = false;
        cell.divergenceStep = step;
        break;
      }
      if (step % sampleInterval === 0 || step === stepBudget) takeSample(step);
      // The loaded 20,000-step arm took at most 5.67 ms/step; 1,000 steps is about 5.67 s,
      // below the 15 s design ceiling, and gives Vitest IPC a real macrotask.
      if (step % 1000 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } catch (e) {
    cell.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  cell.wallClockMs = Date.now() - started;
  return cell;
}

export interface FactorialResult {
  predictions: typeof FACTORIAL_PREDICTIONS;
  configuration: {
    tau0: number;
    cs: number;
    lesK: number;
    inletVelocity: number;
    collision: 'trt';
    conserveMass: true;
    outlets: readonly Outlet3D[];
    freeSlip: FreeSlipFaces;
    scene: SceneSpec;
    cellCount: number;
    exclusionDistance: number;
    omegaMinusRaised: number;
    stepBudget: number;
    sampleInterval: number;
  };
  cells: FactorialCell[];
  totalWallClockMs: number;
}

export async function runFactorial(options: RunArmOptions = {}): Promise<FactorialResult> {
  const started = Date.now();
  const scene = options.scene ?? SCENE;
  const cells: FactorialCell[] = [];
  for (const arm of factorialArms()) cells.push(await runArm(arm, options));
  return {
    predictions: FACTORIAL_PREDICTIONS,
    configuration: {
      tau0: TAU0,
      cs: CS,
      lesK: lesKFromCs(CS),
      inletVelocity: INLET_VELOCITY,
      collision: 'trt',
      conserveMass: true,
      outlets: OUTLETS,
      freeSlip: FREE_SLIP,
      scene,
      cellCount: scene.nx * scene.ny * scene.nz,
      exclusionDistance: scene.exclusionDistance,
      omegaMinusRaised: OMEGA_MINUS_RAISED,
      stepBudget: options.stepBudget ?? STEP_BUDGET,
      sampleInterval: options.sampleInterval ?? SAMPLE_INTERVAL,
    },
    cells,
    totalWallClockMs: Date.now() - started,
  };
}
