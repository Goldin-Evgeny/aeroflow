import {
  AHMED_FREESLIP_FACES,
  ahmedScene,
  fieldStats,
  lateralFlux,
  sectionStats,
  validateFreeSlip,
  type AhmedInletBC,
  type AhmedLateralBC,
  type FieldStats,
  type LateralFlux,
} from '@aeroflow/core';
import { Lbm3D } from '../sim/lbm3d';
import { hooks } from './testHooks';

/**
 * M9 force audit, phase 2 — the empty-tunnel control.
 *
 * ## The one question
 *
 * Phase 1 closed the CPU/GPU question: both implementations agree, so the residual Cd ≈ 1.2
 * is shared and cannot be chased in the kernel. That leaves the setup. Before attributing
 * anything to the body, the geometry or the resolution, the tunnel itself has to be shown
 * clean at the acceptance-tier τ₀ ≈ 0.5000: **is the nominally empty domain doing anything
 * it should not?**
 *
 * A drag coefficient is normalized by a commanded velocity and a frontal area. If the empty
 * tunnel does not hold ρ ≈ 1, does not conserve mass, does not deliver u ≈ u_in, or carries
 * a standing streamwise density gradient, then every Cd on record is normalized against a
 * flow that does not exist, and no amount of resolution fixes that.
 *
 * ## What is held fixed
 *
 * The scene is the acceptance tunnel with `omitBody`, so the domain is still sized by the
 * body's dimensions, blockage cap and fetch rule. Same ground (no-slip Solid y=0), same
 * hard-Dirichlet `Inlet` top and sides, same inlet/outlet, same u=0.05 (Ma 0.0866), same
 * τ₀ regime, Cs=0.1 LES, TRT, regularize + conserveMass, fp32, rest init. The ONLY change
 * from an acceptance run is that no body is pasted — and that no force is requested, since
 * there is no `BodySolid` to weigh and `Lbm3D`'s invariant on that is left untouched.
 *
 * ## What is measured, and why each
 *
 * - **mass drift vs time** — `conserveMass` (H13) is on; if it is not holding at this τ₀ the
 *   run is accumulating a systematic error that a Cd cannot see.
 * - **inlet/outlet flux mismatch** — a closed tunnel must pass what it takes. A mismatch is
 *   a boundary that is creating or destroying fluid.
 * - **ρ mean/min/max and the streamwise ρ profile** — a standing streamwise gradient is a
 *   pressure gradient, i.e. a body force on nothing. This is the single most diagnostic
 *   quantity here for an empty box.
 * - **u max, Ma, and overshoot over commanded** — `Inlet` is an equilibrium BC, not a
 *   flux-imposing one; M10 measured a frictionless duct settling at 0.660·u_in. Whether this
 *   tunnel over- or under-delivers is exactly the Cd normalization question.
 * - **period-2 detector** — the staggered momentum eigenmode is what phase 0 was about. It
 *   is a property of the collision at τ₀ → ½, not of the body, so it should be visible (or
 *   not) in an empty tunnel too. Interleaved even/odd subsequence means over consecutive
 *   steps, the T-STAGGER construction from `forceLedger.test.ts`: a smooth trend cancels and
 *   only a genuine period-2 oscillation survives.
 * - **early transient envelope** — an impulsive start from rest launches an acoustic wave.
 *   It must DECAY. A fine-cadence watch over the first convective times shows whether the
 *   boundaries absorb it or reflect it back.
 * - **non-finite count** — cheap, and the difference between "clean" and "clean so far".
 *
 * ## Phase 3: the same tunnel, twice, with one variable changed
 *
 * Phase 2's answer was "numerically clean, but not physically neutral". Two of its findings
 * point at the far field rather than at the solver:
 *
 *   1. a grid-independent ~1.3% inlet→outlet flux mismatch that global mass conservation
 *      nevertheless absorbed — only possible if the hard-Dirichlet `Inlet` top/side cells are
 *      supplying and absorbing the difference, i.e. acting as an infinite reservoir;
 *   2. a core velocity 2–4% ABOVE the commanded u_in, because those same cells clamp the flow
 *      to u_in throughout and hold the freestream up.
 *
 * The M9 specification calls for FREE-SLIP top and sides. So this harness now runs both arms —
 * `lateralBC: 'freestream'` and `lateralBC: 'freeslip'` — on the same grid, at the same τ₀,
 * with the same ground, the same body-derived domain and the same everything else, and reports
 * them side by side. `lateralFlux` is added for the occasion: `fluxMismatch` establishes that
 * something is unaccounted for, and the lateral budget establishes WHERE.
 *
 * Two disciplines this A/B is built around:
 *
 * - **`BOUNDS` is not touched, and no arm gets its own thresholds.** The free-slip arm is
 *   judged clean or not clean by the identical numbers the freestream arm was (hard rule 3).
 * - **`lateralFlux` carries no gate.** It is a proxy measured at the first fluid layer, not at
 *   the halfway wall (see its docstring), so it is read as a RELATIVE reduction between arms.
 *   The pass/fail authority stays with mass drift, density, Mach and the transient decay.
 *
 * And one thing this harness is watching FOR rather than hoping not to see: if free-slip
 * removes the cells that were holding the core at u_in, the core may sag toward the 0.660·u_in
 * M10 measured for a plain equilibrium `Inlet` in a frictionless duct. That would move the
 * EFFECTIVE Reynolds number (ν and τ₀ are fixed by the scene, so Re_eff ∝ u_core) and the two
 * arms would no longer be the same flow — which is a stop condition for the phase, not a
 * result to normalize away. `coreVelocityRatio` is the number that says so.
 */

export interface TunnelSample {
  steps: number;
  tConv: number;
  field: FieldStats;
  /** Σρu_x at the first and last FLUID plane (x=1, x=nx−2). The Inlet/Outlet shell cells
   *  themselves carry no macroscopics, so flux is measured where the fluid is. */
  inFlux: number;
  outFlux: number;
  /** |out − in| / |in| — a closed tunnel passes what it takes. */
  fluxMismatch: number;
  /** Outward wall-normal flux at the top and both sides (phase 3). */
  lateral: LateralFlux;
  /**
   * `lateral.net / |inFlux|` — the lateral leak as a fraction of what the tunnel takes in, so
   * it is directly comparable against `fluxMismatch`. The reservoir hypothesis predicts these
   * two track each other in the freestream arm and both collapse in the free-slip arm.
   */
  lateralNetOverInflow: number;
}

export interface StreamwiseStation {
  x: number;
  meanRho: number;
  bulkUx: number;
  coreMeanUx: number;
  massFlux: number;
  nonUniformity: number;
  blThicknessCells: number;
}

export interface StaggerProbe {
  /** Consecutive single-step values of each metric. */
  totalMass: number[];
  rhoMean: number[];
  uMax: number[];
  /** |even-mean − odd-mean| / |overall mean| per metric — the period-2 amplitude. */
  staggerTotalMass: number;
  staggerRhoMean: number;
  staggerUMax: number;
  /** Population sd / |mean| per metric — catches longer-period wander the parity split misses. */
  cvTotalMass: number;
  cvRhoMean: number;
  cvUMax: number;
}

/**
 * The startup transient, measured as a decay rather than as a level.
 *
 * A tunnel filled from rest CANNOT have matched inlet/outlet flux before the flow has
 * crossed it — that takes one convective time by definition, so the mismatch is ~1 at
 * T_conv = 0.25 and mass necessarily rises as the box fills. Those are the initial
 * conditions, not a defect, and folding them into a steady-state bound (as the first
 * version of this harness did) reports a pathology that is not there.
 *
 * The real question the transient answers is the boundary-reflection one: does it DECAY?
 * A reflecting far field keeps re-exciting the domain and the mismatch plateaus. So the
 * transient is gated on its decay RATIO, and the levels are gated only after it.
 */
export interface TransientDecay {
  /** Worst values inside the transient window (the initial condition working itself out). */
  peakMassDrift: number;
  peakFluxMismatch: number;
  peakRhoMax: number;
  /** Steady values after it. */
  steadyMassDrift: number;
  steadyFluxMismatch: number;
  /** peak / steady — how many orders the startup wave decayed by. */
  massDriftDecay: number;
  fluxMismatchDecay: number;
  /** T_conv at which the transient window ends. */
  windowTConv: number;
  /**
   * Signed mass drift at the first and last POST-transient sample, and the per-T_conv slope
   * between them.
   *
   * This is what separates the two ways `massDriftDecay` can fail, which the ratio alone
   * cannot (measured 2026-08-07, phase-3 Stage A):
   *
   *  - **a reflecting far field** re-excites the domain, so the drift stays large but
   *     OSCILLATES around a level — slope ≈ 0 with a big magnitude;
   *  - **an incompatible inlet/outlet pair** fills the box, so the drift climbs
   *     MONOTONICALLY and never reaches a steady state at all — slope > 0, sustained.
   *
   * The free-slip empty tunnel hit the second and was reported as the first, which pointed
   * the diagnosis at the boundary that was working correctly.
   */
  steadyMassDriftFirst: number;
  steadyMassDriftLast: number;
  /** (last − first) / ΔT_conv over the post-transient window. */
  massDriftSlopePerTConv: number;
}

export interface EmptyTunnelRun {
  /** Which far field this arm ran (phase 3). */
  lateralBC: AhmedLateralBC;
  /** Which inlet formulation this arm ran (phase 3b). */
  inletBC: AhmedInletBC;
  cells: number;
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  Re: number;
  uLattice: number;
  mach: number;
  tau0: number;
  nu: number;
  lengthCells: number;
  convectiveTimeSteps: number;
  bodyVoxels: number;
  frontalCells: number;
  totalSteps: number;
  samples: TunnelSample[];
  streamwise: StreamwiseStation[];
  stagger: StaggerProbe;
  transient: TransientDecay;
  /** Worst values over the POST-TRANSIENT samples only — see `TransientDecay`. */
  worst: {
    absMassDrift: number;
    fluxMismatch: number;
    rhoMin: number;
    rhoMax: number;
    rhoSpan: number;
    uMax: number;
    machMax: number;
    nonFiniteCells: number;
    /** max|ρ(x) − 1| across the streamwise stations. */
    rhoDeviation: number;
    /** (max − min) of meanRho across stations — the standing streamwise gradient. */
    rhoGradient: number;
    /** max coreMeanUx / u_in − 1: overshoot (>0) or deficit (<0) of the commanded velocity. */
    coreVelocityRatio: number;
    /** Worst |lateral.net| / |inFlux| over the post-transient samples (phase 3, ungated). */
    lateralNetOverInflow: number;
  };
  ms: number;
}

export interface EmptyTunnelReport {
  runs: EmptyTunnelRun[];
  pass: boolean;
  lines: string[];
  gpuErrors: string[];
}

/**
 * Bounds. These are DIAGNOSTIC thresholds for "is the tunnel clean", not acceptance
 * tolerances on a physical quantity — nothing in `docs/VALIDATION.md` is being weakened or
 * restated here. They are set where a violation would be an O(1)-class pathology rather
 * than a numerical detail, which is the question phase 2 was asked to answer.
 */
const BOUNDS = {
  /** H13 conserveMass is on; anything approaching a percent is a broken invariant. */
  massDrift: 1e-3,
  fluxMismatch: 0.05,
  /**
   * The startup wave must decay by at least this factor from its transient peak. This is the
   * boundary-reflection test: a far field that reflects keeps re-exciting the domain and the
   * mismatch plateaus instead of falling.
   */
  transientDecay: 10,
  /** ρ is a pressure proxy; 1% is already a large standing gradient for an empty box. */
  rhoDeviation: 0.01,
  rhoGradient: 0.01,
  /** Ma must stay well inside the weakly-compressible regime. */
  machMax: 0.3,
  /** |core u / u_in − 1|. Generous: this is a KNOWN property of the equilibrium Inlet
   *  (M10 measured 0.660 in a frictionless duct), so it is REPORTED prominently and bounded
   *  only against outright divergence. It is a headline finding, not a pass/fail. */
  coreVelocity: 1.0,
} as const;

const INV_CS = Math.sqrt(3);

/**
 * Convective times allowed for the box to fill from rest before any LEVEL is judged. The
 * flow needs one T_conv just to cross the domain, so nothing before that is a steady-state
 * statement; 5 gives the acoustic start-up wave several passes to leave.
 */
const TRANSIENT_TCONV = 5;

const meanOf = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);

function staggerOf(v: number[]): { stagger: number; cv: number } {
  const even = v.filter((_, i) => i % 2 === 0);
  const odd = v.filter((_, i) => i % 2 === 1);
  const m = meanOf(v);
  const denom = Math.max(Math.abs(m), 1e-30);
  const sd = Math.sqrt(meanOf(v.map((x) => (x - m) * (x - m))));
  return { stagger: Math.abs(meanOf(even) - meanOf(odd)) / denom, cv: sd / denom };
}

async function runOne(
  device: GPUDevice,
  maxCells: number,
  Re: number,
  tConvTotal: number,
  gpuErrors: string[],
  lateralBC: AhmedLateralBC,
  inletBC: AhmedInletBC,
): Promise<EmptyTunnelRun> {
  const t0 = performance.now();
  const scene = ahmedScene({ maxCells, Re, omitBody: true, lateralBC, inletBC });
  if (scene.bodyVoxels !== 0 || scene.frontalCells !== 0) {
    throw new Error(
      `empty tunnel still has a body: ${scene.bodyVoxels} voxels, ${scene.frontalCells} frontal`,
    );
  }
  const { nx, ny, nz, flags } = scene;
  const T = scene.convectiveTimeSteps;

  // Read the face set off the SCENE, never off the caller's argument: the flag array and the
  // kernel's freeSlipMask must describe the same boundary or the run is silently wrong, and
  // `Lbm3D.uploadFlags` only catches the direction where flags are ahead of the config.
  const freeSlip = scene.lateralBC === 'freeslip' ? AHMED_FREESLIP_FACES : undefined;
  const sim = new Lbm3D(device, {
    nx,
    ny,
    nz,
    omega: scene.omega,
    inletVel: scene.uLattice,
    collision: 'trt',
    les: { cs: 0.1 },
    regularize: true,
    conserveMass: true,
    precision: 'fp32',
    freeSlip,
    // H12: compiles the ABL kernel variant that carries the per-cell ρ snapshot the
    // VelocityInlet reads. Off unless the scene actually flagged VelocityInlet cells.
    velocityInlet: scene.inletBC === 'velocity',
    // NO `forces`. There is no BodySolid to weigh, and Lbm3D's invariant that a force run
    // must have one is deliberately left intact — the control just does not ask.
  });
  try {
    sim.flags.set(flags);
    if (freeSlip) validateFreeSlip(flags, nx, ny, nz, freeSlip);
    sim.uploadFlags();
    sim.reset(1, 0, 0, 0);

    const xIn = 1;
    const xOut = nx - 2;
    const samples: TunnelSample[] = [];
    const sampleNow = async (): Promise<void> => {
      const macro = await sim.readMacro();
      const field = fieldStats(macro, flags, nx, ny, nz);
      const a = sectionStats(macro, flags, nx, ny, nz, xIn);
      const b = sectionStats(macro, flags, nx, ny, nz, xOut);
      // Same readback as the section stats — the lateral budget must describe the same instant
      // as the streamwise one it is meant to close, or the two cannot be added.
      const lateral = lateralFlux(macro, flags, nx, ny, nz);
      const inScale = Math.max(Math.abs(a.massFlux), 1e-30);
      samples.push({
        steps: sim.totalSteps,
        tConv: sim.totalSteps / T,
        field,
        inFlux: a.massFlux,
        outFlux: b.massFlux,
        fluxMismatch: Math.abs(b.massFlux - a.massFlux) / inScale,
        lateral,
        lateralNetOverInflow: lateral.net / inScale,
      });
    };

    // Fine cadence over the first 5 T_conv — the acoustic transient from the impulsive
    // start lives here, and whether it DECAYS is the boundary-reflection question.
    const fine = Math.max(1, Math.round(T / 4));
    await sampleNow();
    for (let i = 0; i < 20; i++) {
      sim.submitSteps(fine);
      await sampleNow();
    }
    // Coarse cadence out to tConvTotal.
    const coarse = 2 * T;
    while (sim.totalSteps < tConvTotal * T) {
      sim.submitSteps(coarse);
      await sampleNow();
    }

    // Streamwise profile at the end: ~12 stations spanning the fluid interior.
    const streamwise: StreamwiseStation[] = [];
    const macro = await sim.readMacro();
    const nStations = 12;
    for (let i = 0; i < nStations; i++) {
      const x = Math.round(1 + ((nx - 3) * i) / (nStations - 1));
      const s = sectionStats(macro, flags, nx, ny, nz, x);
      streamwise.push({
        x,
        meanRho: s.meanRho,
        bulkUx: s.bulkUx,
        coreMeanUx: s.coreMeanUx,
        massFlux: s.massFlux,
        nonUniformity: s.nonUniformity,
        blThicknessCells: s.blThicknessCells,
      });
    }

    // Period-2 probe: 16 CONSECUTIVE single steps.
    const totalMass: number[] = [];
    const rhoMean: number[] = [];
    const uMax: number[] = [];
    for (let i = 0; i < 16; i++) {
      sim.submitSteps(1);
      const m = await sim.readMacro();
      const f = fieldStats(m, flags, nx, ny, nz);
      totalMass.push(f.totalMass);
      rhoMean.push(f.rhoMean);
      uMax.push(f.uMax);
    }
    const sM = staggerOf(totalMass);
    const sR = staggerOf(rhoMean);
    const sU = staggerOf(uMax);

    // Split at one transient window. Everything before it is the box filling from rest.
    const early = samples.filter((s) => s.tConv < TRANSIENT_TCONV);
    const steady = samples.filter((s) => s.tConv >= TRANSIENT_TCONV);
    if (steady.length === 0) throw new Error('empty tunnel: no post-transient samples');
    const transient: TransientDecay = {
      peakMassDrift: Math.max(...early.map((s) => Math.abs(s.field.massDriftRel)), 0),
      peakFluxMismatch: Math.max(...early.map((s) => s.fluxMismatch), 0),
      peakRhoMax: Math.max(...early.map((s) => s.field.rhoMax), 0),
      steadyMassDrift: Math.max(...steady.map((s) => Math.abs(s.field.massDriftRel))),
      steadyFluxMismatch: Math.max(...steady.map((s) => s.fluxMismatch)),
      massDriftDecay: 0,
      fluxMismatchDecay: 0,
      windowTConv: TRANSIENT_TCONV,
      steadyMassDriftFirst: steady[0].field.massDriftRel,
      steadyMassDriftLast: steady[steady.length - 1].field.massDriftRel,
      massDriftSlopePerTConv: 0,
    };
    {
      const dt = steady[steady.length - 1].tConv - steady[0].tConv;
      transient.massDriftSlopePerTConv =
        dt > 0 ? (transient.steadyMassDriftLast - transient.steadyMassDriftFirst) / dt : 0;
    }
    transient.massDriftDecay =
      transient.peakMassDrift / Math.max(transient.steadyMassDrift, 1e-30);
    transient.fluxMismatchDecay =
      transient.peakFluxMismatch / Math.max(transient.steadyFluxMismatch, 1e-30);

    const worst = {
      absMassDrift: Math.max(...steady.map((s) => Math.abs(s.field.massDriftRel))),
      fluxMismatch: Math.max(...steady.map((s) => s.fluxMismatch)),
      rhoMin: Math.min(...steady.map((s) => s.field.rhoMin)),
      rhoMax: Math.max(...steady.map((s) => s.field.rhoMax)),
      rhoSpan: 0,
      uMax: Math.max(...steady.map((s) => s.field.uMax)),
      machMax: Math.max(...steady.map((s) => s.field.machMax)),
      nonFiniteCells: Math.max(...samples.map((s) => s.field.nonFiniteCells)),
      rhoDeviation: Math.max(...streamwise.map((s) => Math.abs(s.meanRho - 1))),
      rhoGradient:
        Math.max(...streamwise.map((s) => s.meanRho)) - Math.min(...streamwise.map((s) => s.meanRho)),
      coreVelocityRatio:
        Math.max(...streamwise.map((s) => s.coreMeanUx)) / scene.uLattice - 1,
      lateralNetOverInflow: Math.max(...steady.map((s) => Math.abs(s.lateralNetOverInflow))),
    };
    worst.rhoSpan = worst.rhoMax - worst.rhoMin;

    return {
      lateralBC: scene.lateralBC,
      inletBC: scene.inletBC,
      cells: nx * ny * nz,
      nx,
      ny,
      nz,
      dx: scene.dx,
      Re: scene.Re,
      uLattice: scene.uLattice,
      mach: scene.uLattice * INV_CS,
      tau0: 1 / scene.omega,
      nu: scene.nu,
      lengthCells: scene.lengthCells,
      convectiveTimeSteps: T,
      bodyVoxels: scene.bodyVoxels,
      frontalCells: scene.frontalCells,
      totalSteps: sim.totalSteps,
      samples,
      streamwise,
      transient,
      stagger: {
        totalMass,
        rhoMean,
        uMax,
        staggerTotalMass: sM.stagger,
        staggerRhoMean: sR.stagger,
        staggerUMax: sU.stagger,
        cvTotalMass: sM.cv,
        cvRhoMean: sR.cv,
        cvUMax: sU.cv,
      },
      worst,
      ms: performance.now() - t0,
    };
  } finally {
    sim.destroy();
    void gpuErrors;
  }
}

/** One cell of the phase-3b 2×2: a far field crossed with an inlet formulation. */
export interface TunnelArm {
  lateralBC: AhmedLateralBC;
  inletBC: AhmedInletBC;
}

/**
 * The full 2×2. Each pair answers a different question, and the reason all four are run
 * rather than just the interesting one is that no single pair is interpretable alone:
 *
 *  - freestream/equilibrium → freeslip/equilibrium   reproduces the phase-3 Stage A result
 *  - freeslip/equilibrium   → freeslip/velocity      isolates the inlet correction
 *  - freestream/velocity    → freeslip/velocity      the CLEAN lateral-BC A/B
 *  - freestream/equilibrium → freestream/velocity    how much the historical lateral
 *                                                    reservoir was masking the inlet
 */
export const TUNNEL_2X2: TunnelArm[] = [
  { lateralBC: 'freestream', inletBC: 'equilibrium' },
  { lateralBC: 'freeslip', inletBC: 'equilibrium' },
  { lateralBC: 'freestream', inletBC: 'velocity' },
  { lateralBC: 'freeslip', inletBC: 'velocity' },
];

export async function runEmptyTunnel(
  device: GPUDevice,
  tiers: number[] = [250_000, 2_000_000],
  tConvTotal = 40,
  arms: TunnelArm[] = TUNNEL_2X2,
): Promise<EmptyTunnelReport> {
  const gpuErrors: string[] = [];
  const onErr = (e: Event) => gpuErrors.push(String((e as GPUUncapturedErrorEvent).error.message));
  device.addEventListener('uncapturederror', onErr);
  const runs: EmptyTunnelRun[] = [];
  try {
    // Tier-major, so a tier's arms sit next to each other in the output and in time. The
    // comparison is between arms at a FIXED tier; interleaving tiers would put the runs that
    // have to be read together at opposite ends of the log.
    for (const cells of tiers) {
      for (const arm of arms) {
        runs.push(
          await runOne(device, cells, 4.29e6, tConvTotal, gpuErrors, arm.lateralBC, arm.inletBC),
        );
      }
    }
  } finally {
    device.removeEventListener('uncapturederror', onErr);
  }

  const verdict = verdictOf;

  const lines: string[] = [];
  let pass = gpuErrors.length === 0;
  for (const r of runs) {
    const v = verdict(r);
    pass = pass && v.ok;
    lines.push(...perRunLines(r, v));
  }
  lines.push(...abLines(runs));
  return { runs, pass, lines, gpuErrors };
}

/**
 * Health verdict for one arm, against the UNCHANGED `BOUNDS`. Module-scope so the 2×2 table
 * can print a PASS/FAIL row per arm from the same predicate the headline lines use — one
 * definition, so the table and the lines can never disagree.
 */
function verdictOf(r: EmptyTunnelRun): { ok: boolean; why: string[] } {
  const why: string[] = [];
  {
    if (r.worst.nonFiniteCells > 0) why.push(`${r.worst.nonFiniteCells} non-finite cells`);
    if (r.worst.absMassDrift > BOUNDS.massDrift)
      why.push(`mass drift ${r.worst.absMassDrift.toExponential(2)} > ${BOUNDS.massDrift}`);
    if (r.worst.fluxMismatch > BOUNDS.fluxMismatch)
      why.push(`flux mismatch ${r.worst.fluxMismatch.toExponential(2)} > ${BOUNDS.fluxMismatch}`);
    if (r.worst.rhoDeviation > BOUNDS.rhoDeviation)
      why.push(`|rho-1| ${r.worst.rhoDeviation.toExponential(2)} > ${BOUNDS.rhoDeviation}`);
    if (r.worst.rhoGradient > BOUNDS.rhoGradient)
      why.push(`streamwise rho span ${r.worst.rhoGradient.toExponential(2)} > ${BOUNDS.rhoGradient}`);
    if (r.worst.machMax > BOUNDS.machMax)
      why.push(`Ma ${r.worst.machMax.toFixed(3)} > ${BOUNDS.machMax}`);
    if (Math.abs(r.worst.coreVelocityRatio) > BOUNDS.coreVelocity)
      why.push(`core u/u_in−1 = ${r.worst.coreVelocityRatio.toFixed(3)}`);
    // The startup wave must have decayed. WHY it did not is two different diagnoses, and
    // naming the wrong one sends the investigation at the wrong boundary — which is exactly
    // what happened on 2026-08-07, when a free-slip run that was filling monotonically was
    // reported as "boundary may be reflecting" and the free-slip BC was the prime suspect for
    // a defect that turned out to be the inlet's. The slope tells them apart.
    if (r.transient.massDriftDecay < BOUNDS.transientDecay) {
      const t = r.transient;
      // Monotonic growth across the whole post-transient window, still going at the end.
      const accumulating =
        Math.abs(t.steadyMassDriftLast) > Math.abs(t.steadyMassDriftFirst) &&
        Math.sign(t.massDriftSlopePerTConv) === Math.sign(t.steadyMassDriftLast) &&
        t.massDriftSlopePerTConv !== 0;
      why.push(
        `mass-drift transient decayed only ${t.massDriftDecay.toFixed(2)}× ` +
          `(< ${BOUNDS.transientDecay}) — ` +
          (accumulating
            ? `mass is ACCUMULATING MONOTONICALLY (${t.steadyMassDriftFirst.toExponential(2)} → ` +
              `${t.steadyMassDriftLast.toExponential(2)}, slope ` +
              `${t.massDriftSlopePerTConv.toExponential(2)}/T_conv): the run never reaches a ` +
              `steady state. This is an inlet/outlet incompatibility — the inlet is delivering ` +
              `mass the outlet does not remove and no boundary relieves — NOT a reflecting far ` +
              `field. Check the inlet formulation before suspecting the lateral BC`
            : `the drift is not decaying but is not growing either (${t.steadyMassDriftFirst.toExponential(2)} → ` +
              `${t.steadyMassDriftLast.toExponential(2)}, slope ` +
              `${t.massDriftSlopePerTConv.toExponential(2)}/T_conv): consistent with a far field ` +
              `that keeps re-exciting the domain`),
      );
    }
    if (r.transient.fluxMismatchDecay < BOUNDS.transientDecay)
      why.push(
        `flux-mismatch transient decayed only ${r.transient.fluxMismatchDecay.toFixed(1)}× ` +
          `(< ${BOUNDS.transientDecay})`,
      );
    return { ok: why.length === 0, why };
  }
}

/** The per-arm headline block: verdict line plus the six diagnostic lines under it. */
function perRunLines(r: EmptyTunnelRun, v: { ok: boolean; why: string[] }): string[] {
  const last = r.samples.at(-1);
  return [
    `${v.ok ? 'PASS' : 'FAIL'} empty tunnel [${armLabel(r)}] ${r.nx}x${r.ny}x${r.nz} ` +
      `(${r.cells} cells) ` +
      `tau0=${r.tau0.toFixed(9)} T_conv=${r.convectiveTimeSteps} steps=${r.totalSteps} ` +
      `(${(r.ms / 1000).toFixed(1)} s)` +
      (v.ok ? '' : `\n     ${v.why.join('; ')}`),
    `     steady (T>=${r.transient.windowTConv}): massDrift=${r.worst.absMassDrift.toExponential(2)} ` +
      `fluxMismatch=${r.worst.fluxMismatch.toExponential(2)} ` +
      `rho[${r.worst.rhoMin.toFixed(6)}, ${r.worst.rhoMax.toFixed(6)}] span=${r.worst.rhoSpan.toExponential(2)}`,
    `     transient: massDrift ${r.transient.peakMassDrift.toExponential(2)}→${r.transient.steadyMassDrift.toExponential(2)} ` +
      `(${r.transient.massDriftDecay.toFixed(2)}x); fluxMismatch ${r.transient.peakFluxMismatch.toExponential(2)}→` +
      `${r.transient.steadyFluxMismatch.toExponential(2)} (${r.transient.fluxMismatchDecay.toFixed(0)}x); ` +
      `peak rhoMax=${r.transient.peakRhoMax.toFixed(6)}`,
    `     streamwise |rho-1|max=${r.worst.rhoDeviation.toExponential(2)} rhoSpan(x)=${r.worst.rhoGradient.toExponential(2)} ` +
      `uMax=${r.worst.uMax.toFixed(6)} Ma=${r.worst.machMax.toFixed(4)} coreU/u_in=${(r.worst.coreVelocityRatio + 1).toFixed(4)}`,
    `     period-2: mass=${r.stagger.staggerTotalMass.toExponential(2)} rhoMean=${r.stagger.staggerRhoMean.toExponential(2)} ` +
      `uMax=${r.stagger.staggerUMax.toExponential(2)} | cv: mass=${r.stagger.cvTotalMass.toExponential(2)} ` +
      `rhoMean=${r.stagger.cvRhoMean.toExponential(2)} uMax=${r.stagger.cvUMax.toExponential(2)}`,
    `     lateral flux (outward, last sample): top=${fmtE(last?.lateral.top)} ` +
      `zMin=${fmtE(last?.lateral.zMin)} zMax=${fmtE(last?.lateral.zMax)} ` +
      `net=${fmtE(last?.lateral.net)} (ground EXCLUDED — not a through-wall flux; ` +
      `its near-wall layer u_y term=${fmtE(last?.lateral.groundLayerUy)}) | ` +
      `worst |net|/inFlux=${r.worst.lateralNetOverInflow.toExponential(2)} (UNGATED proxy)`,
    `     budget: in=${fmtE(last?.inFlux)} out=${fmtE(last?.outFlux)} ` +
      `in-out=${fmtE((last?.inFlux ?? 0) - (last?.outFlux ?? 0))} vs lateral net=${fmtE(last?.lateral.net)} ` +
      `| steady massDrift ${r.transient.steadyMassDriftFirst.toExponential(2)}→` +
      `${r.transient.steadyMassDriftLast.toExponential(2)} ` +
      `(slope ${r.transient.massDriftSlopePerTConv.toExponential(2)}/T_conv)`,
    `     nonFinite=${r.worst.nonFiniteCells}`,
  ];
}

const fmtE = (x: number | undefined): string =>
  x === undefined || !Number.isFinite(x) ? '—' : x.toExponential(3);

/** `freeslip/velocity` — short enough for a row label, unambiguous about both variables. */
export const armLabel = (r: { lateralBC: AhmedLateralBC; inletBC: AhmedInletBC }): string =>
  `${r.lateralBC}/${r.inletBC === 'velocity' ? 'velocity' : 'equilib'}`;

/**
 * The phase-3 comparison: the two arms of each tier, side by side.
 *
 * Deliberately prints the two arms' values rather than a single "improvement" figure. The
 * hypothesis under test is that free-slip removes the top/side mass reservoir, and that is
 * supported only if the lateral budget and the flux mismatch fall TOGETHER — one of them
 * moving alone is a different story (a lateral budget that collapses while the mismatch does
 * not means the leak went somewhere else, not that it stopped).
 *
 * The core-velocity column is here for a different reason and must not be read as a success
 * metric: if free-slip moves it, the effective Reynolds number moved with it and the arms are
 * no longer the same flow. See the module docstring.
 */
function abLines(runs: EmptyTunnelRun[]): string[] {
  const tiers = [...new Set(runs.map((r) => r.cells))];
  const out: string[] = [
    '',
    '## Phase 3b 2x2 — far field x inlet formulation (empty tunnel)',
    '',
    'Held identical across all four arms: grid, dx, tau0, nu, no-slip ground, outlet, u_in,',
    'Cs, precision, initial condition, T_conv. Two structural differences follow from the BCs',
    'themselves: free-slip keeps the outlet one row in (H11 3.2), and VelocityInlet occupies',
    'the strict interior of the x=0 face with the edge ring left as plain Inlet (H12 2).',
    '',
    'WHY FOUR ARMS. No pair is interpretable alone:',
    '  freestream/equilib -> freeslip/equilib    reproduces the phase-3 Stage A result',
    '  freeslip/equilib   -> freeslip/velocity   isolates the inlet correction',
    '  freestream/velocity-> freeslip/velocity   the CLEAN lateral-BC A/B',
    '  freestream/equilib -> freestream/velocity how much the historical lateral reservoir',
    '                                            was masking the inlet',
    '',
    '  coreU/u_in IS THE HEADLINE, and not as a score. nu and tau0 are fixed by the scene, so',
    '  Re_eff ~ u_core: an arm that does not deliver u_in is running a different Reynolds',
    '  number, and cannot be compared against one that does. No tolerance is asserted here —',
    '  the residual is reported and judged afterwards.',
    '',
    '  |net|/inFlux is the UNGATED lateral proxy (ground excluded — a bounce-back wall passes',
    '  no mass). Read the ratio between arms. Health is decided by the BOUNDS columns.',
    '',
  ];

  for (const cells of tiers) {
    const tier = TUNNEL_2X2.map((arm) =>
      runs.find(
        (r) => r.cells === cells && r.lateralBC === arm.lateralBC && r.inletBC === arm.inletBC,
      ),
    ).filter((r): r is EmptyTunnelRun => r !== undefined);
    if (tier.length === 0) continue;
    const head = tier[0];

    const row = (label: string, get: (r: EmptyTunnelRun) => number, exp = true): string =>
      `    ${label.padEnd(21)}` +
      tier
        .map((r) => {
          const v = get(r);
          return (exp ? v.toExponential(2) : v.toFixed(4)).padStart(14);
        })
        .join('');

    out.push(
      `  ${head.nx}x${head.ny}x${head.nz} (${cells} cells)  tau0=${head.tau0.toFixed(9)}  ` +
        `T_conv=${head.convectiveTimeSteps}  steps=${head.totalSteps}`,
      `    ${''.padEnd(21)}${tier.map((r) => armLabel(r).padStart(14)).join('')}`,
      `    ${'VERDICT'.padEnd(21)}${tier
        .map((r) => (verdictOf(r).ok ? 'PASS' : 'FAIL').padStart(14))
        .join('')}`,
      row('coreU/u_in', (r) => r.worst.coreVelocityRatio + 1, false),
      row('rho mean (last)', (r) => r.samples.at(-1)?.field.rhoMean ?? Number.NaN, false),
      row('massDrift (steady)', (r) => r.worst.absMassDrift),
      row('massDrift slope/Tc', (r) => r.transient.massDriftSlopePerTConv),
      row('fluxMismatch', (r) => r.worst.fluxMismatch),
      row('inFlux', (r) => r.samples.at(-1)?.inFlux ?? Number.NaN),
      row('outFlux', (r) => r.samples.at(-1)?.outFlux ?? Number.NaN),
      row('lat net (no ground)', (r) => r.samples.at(-1)?.lateral.net ?? Number.NaN),
      row('|lat net|/inFlux', (r) => r.worst.lateralNetOverInflow),
      row('rho span', (r) => r.worst.rhoSpan),
      row('streamwise rho span', (r) => r.worst.rhoGradient),
      row('rho min', (r) => r.worst.rhoMin, false),
      row('rho max', (r) => r.worst.rhoMax, false),
      row('uMax', (r) => r.worst.uMax, false),
      row('Ma max', (r) => r.worst.machMax, false),
      row('massDrift decay', (r) => r.transient.massDriftDecay, false),
      row('fluxMism decay', (r) => r.transient.fluxMismatchDecay, false),
      row('period-2 mass', (r) => r.stagger.staggerTotalMass),
      row('period-2 rhoMean', (r) => r.stagger.staggerRhoMean),
      row('period-2 uMax', (r) => r.stagger.staggerUMax),
      row('nonFinite', (r) => r.worst.nonFiniteCells, false),
      '',
    );
  }
  return out;
}

/**
 * `?lateralBC=` and `?inletBC=` narrow the 2×2; absent means run all four, because the
 * deliverable is the COMPARISON — a single arm produces numbers with nothing to read them
 * against. `?tiers=250000,2000000` overrides the cell budgets (phase 3b runs the cheap tier
 * first and escalates only if the conclusion needs it).
 */
function armsFromUrl(): TunnelArm[] {
  const q = new URLSearchParams(location.search);
  const lat = q.get('lateralBC');
  const inl = q.get('inletBC');
  return TUNNEL_2X2.filter(
    (a) =>
      (lat === null || lat === a.lateralBC) &&
      (inl === null || inl === a.inletBC),
  );
}

function tiersFromUrl(): number[] | undefined {
  const raw = new URLSearchParams(location.search).get('tiers');
  if (!raw) return undefined;
  const tiers = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return tiers.length > 0 ? tiers : undefined;
}

export async function mountEmptyTunnel(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running the Ahmed empty-tunnel control (M9 phase 2/3/3b)…</p>';
  try {
    const r = await runEmptyTunnel(device, tiersFromUrl(), undefined, armsFromUrl());
    hooks().emptyTunnel = r;
    const tbl = (rows: string) => `<table style="border-collapse:collapse">${rows}</table>`;
    root.innerHTML = `
      <h2>Ahmed empty-tunnel control <small>(M9 phase 2)</small></h2>
      <p style="font-size:1.3em;font-weight:bold;color:${r.pass ? '#2a2' : '#c22'}">
        ${r.pass ? 'CLEAN' : 'PATHOLOGY'}
      </p>
      <pre style="white-space:pre-wrap">${r.lines.join('\n')}</pre>
      ${r.runs
        .map(
          (run) => `
        <h3>${run.nx}×${run.ny}×${run.nz} [${armLabel(run)}] — streamwise profile</h3>
        ${tbl(
          `<tr><th>x</th><th>meanRho</th><th>bulkUx</th><th>coreUx</th><th>massFlux</th><th>nonUnif</th><th>δ99 cells</th></tr>` +
            run.streamwise
              .map(
                (s) =>
                  `<tr><td>${s.x}</td><td>${s.meanRho.toFixed(6)}</td><td>${s.bulkUx.toFixed(6)}</td>` +
                  `<td>${s.coreMeanUx.toFixed(6)}</td><td>${s.massFlux.toExponential(4)}</td>` +
                  `<td>${s.nonUniformity.toFixed(4)}</td><td>${s.blThicknessCells}</td></tr>`,
              )
              .join(''),
        )}
        <h3>${run.nx}×${run.ny}×${run.nz} [${armLabel(run)}] — time series</h3>
        ${tbl(
          `<tr><th>T_conv</th><th>massDrift</th><th>rhoMin</th><th>rhoMax</th><th>uMax</th><th>Ma</th><th>fluxMismatch</th><th>lat net/in</th><th>NaN</th></tr>` +
            run.samples
              .map(
                (s) =>
                  `<tr><td>${s.tConv.toFixed(2)}</td><td>${s.field.massDriftRel.toExponential(2)}</td>` +
                  `<td>${s.field.rhoMin.toFixed(6)}</td><td>${s.field.rhoMax.toFixed(6)}</td>` +
                  `<td>${s.field.uMax.toFixed(6)}</td><td>${s.field.machMax.toFixed(4)}</td>` +
                  `<td>${s.fluxMismatch.toExponential(2)}</td>` +
                  `<td>${s.lateralNetOverInflow.toExponential(2)}</td>` +
                  `<td>${s.field.nonFiniteCells}</td></tr>`,
              )
              .join(''),
        )}`,
        )
        .join('')}
      ${r.gpuErrors.length ? `<pre style="color:#c22">GPU errors:\n- ${r.gpuErrors.join('\n- ')}</pre>` : ''}`;
  } catch (e) {
    hooks().emptyTunnelError = String(e);
    root.innerHTML = `<pre style="color:#c22">empty-tunnel error:\n${String(e)}</pre>`;
  }
}
