import { ahmedScene, fieldStats, sectionStats, type FieldStats } from '@aeroflow/core';
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
}

export interface EmptyTunnelRun {
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
): Promise<EmptyTunnelRun> {
  const t0 = performance.now();
  const scene = ahmedScene({ maxCells, Re, omitBody: true });
  if (scene.bodyVoxels !== 0 || scene.frontalCells !== 0) {
    throw new Error(
      `empty tunnel still has a body: ${scene.bodyVoxels} voxels, ${scene.frontalCells} frontal`,
    );
  }
  const { nx, ny, nz, flags } = scene;
  const T = scene.convectiveTimeSteps;

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
    // NO `forces`. There is no BodySolid to weigh, and Lbm3D's invariant that a force run
    // must have one is deliberately left intact — the control just does not ask.
  });
  try {
    sim.flags.set(flags);
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
      samples.push({
        steps: sim.totalSteps,
        tConv: sim.totalSteps / T,
        field,
        inFlux: a.massFlux,
        outFlux: b.massFlux,
        fluxMismatch: Math.abs(b.massFlux - a.massFlux) / Math.max(Math.abs(a.massFlux), 1e-30),
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
    };
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
    };
    worst.rhoSpan = worst.rhoMax - worst.rhoMin;

    return {
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

export async function runEmptyTunnel(
  device: GPUDevice,
  tiers: number[] = [250_000, 2_000_000],
  tConvTotal = 40,
): Promise<EmptyTunnelReport> {
  const gpuErrors: string[] = [];
  const onErr = (e: Event) => gpuErrors.push(String((e as GPUUncapturedErrorEvent).error.message));
  device.addEventListener('uncapturederror', onErr);
  const runs: EmptyTunnelRun[] = [];
  try {
    for (const cells of tiers) {
      runs.push(await runOne(device, cells, 4.29e6, tConvTotal, gpuErrors));
    }
  } finally {
    device.removeEventListener('uncapturederror', onErr);
  }

  const verdict = (r: EmptyTunnelRun): { ok: boolean; why: string[] } => {
    const why: string[] = [];
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
    // Boundary reflection: the startup wave must have decayed, not plateaued.
    if (r.transient.massDriftDecay < BOUNDS.transientDecay)
      why.push(
        `mass-drift transient decayed only ${r.transient.massDriftDecay.toFixed(1)}× ` +
          `(< ${BOUNDS.transientDecay}) — boundary may be reflecting`,
      );
    if (r.transient.fluxMismatchDecay < BOUNDS.transientDecay)
      why.push(
        `flux-mismatch transient decayed only ${r.transient.fluxMismatchDecay.toFixed(1)}× ` +
          `(< ${BOUNDS.transientDecay})`,
      );
    return { ok: why.length === 0, why };
  };

  const lines: string[] = [];
  let pass = gpuErrors.length === 0;
  for (const r of runs) {
    const v = verdict(r);
    pass = pass && v.ok;
    lines.push(
      `${v.ok ? 'PASS' : 'FAIL'} empty tunnel ${r.nx}x${r.ny}x${r.nz} (${r.cells} cells) ` +
        `tau0=${r.tau0.toFixed(9)} T_conv=${r.convectiveTimeSteps} steps=${r.totalSteps} ` +
        `(${(r.ms / 1000).toFixed(1)} s)` +
        (v.ok ? '' : `\n     ${v.why.join('; ')}`),
    );
    lines.push(
      `     steady (T>=${r.transient.windowTConv}): massDrift=${r.worst.absMassDrift.toExponential(2)} ` +
        `fluxMismatch=${r.worst.fluxMismatch.toExponential(2)} ` +
        `rho[${r.worst.rhoMin.toFixed(6)}, ${r.worst.rhoMax.toFixed(6)}] span=${r.worst.rhoSpan.toExponential(2)}`,
    );
    lines.push(
      `     transient: massDrift ${r.transient.peakMassDrift.toExponential(2)}→${r.transient.steadyMassDrift.toExponential(2)} ` +
        `(${r.transient.massDriftDecay.toFixed(0)}x); fluxMismatch ${r.transient.peakFluxMismatch.toExponential(2)}→` +
        `${r.transient.steadyFluxMismatch.toExponential(2)} (${r.transient.fluxMismatchDecay.toFixed(0)}x); ` +
        `peak rhoMax=${r.transient.peakRhoMax.toFixed(6)}`,
    );
    lines.push(
      `     streamwise |rho-1|max=${r.worst.rhoDeviation.toExponential(2)} rhoSpan(x)=${r.worst.rhoGradient.toExponential(2)} ` +
        `uMax=${r.worst.uMax.toFixed(6)} Ma=${r.worst.machMax.toFixed(4)} coreU/u_in-1=${r.worst.coreVelocityRatio.toFixed(4)}`,
    );
    lines.push(
      `     period-2: mass=${r.stagger.staggerTotalMass.toExponential(2)} rhoMean=${r.stagger.staggerRhoMean.toExponential(2)} ` +
        `uMax=${r.stagger.staggerUMax.toExponential(2)} | cv: mass=${r.stagger.cvTotalMass.toExponential(2)} ` +
        `rhoMean=${r.stagger.cvRhoMean.toExponential(2)} uMax=${r.stagger.cvUMax.toExponential(2)}`,
    );
    lines.push(`     nonFinite=${r.worst.nonFiniteCells}`);
  }
  return { runs, pass, lines, gpuErrors };
}

export async function mountEmptyTunnel(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running the Ahmed empty-tunnel control (M9 phase 2)…</p>';
  try {
    const r = await runEmptyTunnel(device);
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
        <h3>${run.nx}×${run.ny}×${run.nz} — streamwise profile</h3>
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
        <h3>${run.nx}×${run.ny}×${run.nz} — time series</h3>
        ${tbl(
          `<tr><th>T_conv</th><th>massDrift</th><th>rhoMin</th><th>rhoMax</th><th>uMax</th><th>Ma</th><th>fluxMismatch</th><th>NaN</th></tr>` +
            run.samples
              .map(
                (s) =>
                  `<tr><td>${s.tConv.toFixed(2)}</td><td>${s.field.massDriftRel.toExponential(2)}</td>` +
                  `<td>${s.field.rhoMin.toFixed(6)}</td><td>${s.field.rhoMax.toFixed(6)}</td>` +
                  `<td>${s.field.uMax.toFixed(6)}</td><td>${s.field.machMax.toFixed(4)}</td>` +
                  `<td>${s.fluxMismatch.toExponential(2)}</td><td>${s.field.nonFiniteCells}</td></tr>`,
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
