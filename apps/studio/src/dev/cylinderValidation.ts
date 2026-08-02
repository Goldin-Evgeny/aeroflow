import { CellType, D2Q9, coefficient, cylinderScene } from '@aeroflow/core';
import { Lbm2D } from '../sim/lbm2d';
import { analyzeCylinderForces, type CylinderStats } from '../sim/forces';
import type { ForcePlot } from '../ui/forcePlot';

/**
 * M4 cylinder validation runner (step 9). Builds the canonical scene, runs it on the GPU
 * with periodic momentum-exchange force sampling, feeds the live force plot, and scores
 * mean Cd / Cl amplitude / Strouhal against the published acceptance bands (M4 acceptance
 * 1–3). Registered for Re = 100 and Re = 200.
 *
 * All quantitative gates are measured HERE, on the GPU — this must run on real hardware
 * (WebGPU is unavailable in WSL). St uses the zero-crossing estimator (primary) with the
 * FFT peak as a 1 %-agreement cross-check (H7); the frequency is taken off Cl, not Cd.
 */

interface Band {
  min: number;
  max: number;
}

interface CaseBands {
  st: Band;
  cd: Band;
  cl?: Band; // Re=200 has no Cl band (2D references vary); St+Cd only.
}

const BANDS: Record<number, CaseBands> = {
  100: { st: { min: 0.16, max: 0.17 }, cd: { min: 1.3, max: 1.42 }, cl: { min: 0.28, max: 0.36 } },
  // Re=200: 2D references only (real flow goes 3D at Re≈190 — stated on the page).
  200: { st: { min: 0.19, max: 0.2 }, cd: { min: 1.25, max: 1.45 } },
};

export interface CylinderCaseResult {
  Re: number;
  stats: CylinderStats;
  bands: CaseBands;
  pass: boolean;
  summary: string;
}

export interface CylinderRunOptions {
  /** Total timesteps. Default 200_000 (M4 protocol). */
  totalSteps?: number;
  /** Transient steps discarded before analysis. Default 80_000. */
  transientSteps?: number;
  /** Timesteps per force sample; MUST be even (aliases the staggered mode). Default 40. */
  sampleInterval?: number;
  /** Live strip-chart to feed, if any. */
  plot?: ForcePlot;
  /** Progress callback: fraction ∈ [0,1] and the latest partial stats (post-transient). */
  onProgress?: (fraction: number, partial: CylinderStats | null) => void;
  /** Smagorinsky LES Cs (0/undefined = off). Used by the V6 non-interference check. */
  lesCs?: number;
  /** Projected H10 regularization. Off by default to preserve the recorded M4 cases. */
  regularize?: boolean;
}

const inBand = (x: number, b: Band) => x >= b.min && x <= b.max;

export async function runCylinderCase(
  device: GPUDevice,
  Re: number,
  opts: CylinderRunOptions = {},
): Promise<CylinderCaseResult> {
  const bands = BANDS[Re];
  if (!bands) throw new Error(`no acceptance bands for Re=${Re}`);
  const totalSteps = opts.totalSteps ?? 200_000;
  const transientSteps = opts.transientSteps ?? 80_000;
  const interval = opts.sampleInterval ?? 40;
  if (interval % 2 !== 0) throw new Error('sampleInterval must be even (H2 §4a)');

  const scene = cylinderScene({ Re });
  const { nx, ny, uLattice: u, diameter: D } = scene;

  const gpu = new Lbm2D(device, nx, ny, {
    omega: scene.omega,
    uin: u,
    collision: 'trt',
    lambda: 3 / 16,
    outlet: 'pressure',
    periodicY: true,
    lesCs: opts.lesCs,
    regularize: opts.regularize,
  });
  gpu.flags.set(Uint32Array.from(scene.flags));
  gpu.uploadFlags();
  gpu.resetFlow();

  const fx: number[] = [];
  const fy: number[] = [];
  const nSamples = Math.floor(totalSteps / interval);

  try {
    for (let s = 0; s < nSamples; s++) {
      const f = await gpu.sampleForce(interval);
      fx.push(f.fx);
      fy.push(f.fy);
      opts.plot?.push(coefficient(f.fx, u, D), coefficient(f.fy, u, D));

      if (opts.onProgress && (s % 100 === 99 || s === nSamples - 1)) {
        const stepsDone = (s + 1) * interval;
        // Live display: use a shrinking effective transient (half the elapsed run) so Cd
        // and a provisional St appear early. The FINAL scored result below always uses the
        // full `transientSteps` — this is display-only.
        const dispTransient = Math.min(transientSteps, Math.floor(stepsDone / 2));
        const partial =
          s >= 40
            ? analyzeCylinderForces(fx, fy, {
                u,
                D,
                sampleInterval: interval,
                transientSteps: dispTransient,
              })
            : null;
        if (partial)
          opts.plot?.setReadouts({
            meanCd: partial.meanCd,
            clAmplitude: partial.clAmplitude,
            st: Number.isFinite(partial.stZeroCross) ? partial.stZeroCross : null,
            periods: partial.periods,
          });
        opts.onProgress((s + 1) / nSamples, partial);
      }
    }
  } finally {
    gpu.destroy();
  }

  const stats = analyzeCylinderForces(fx, fy, { u, D, sampleInterval: interval, transientSteps });
  const cdPass = inBand(stats.meanCd, bands.cd);
  const stPass = inBand(stats.stZeroCross, bands.st);
  const clPass = bands.cl ? inBand(stats.clAmplitude, bands.cl) : true;
  const pass = cdPass && stPass && clPass && stats.estimatorsAgree;

  const b = (x: number, band: Band, ok: boolean) =>
    `${x.toFixed(4)}∈[${band.min},${band.max}] ${ok ? '✓' : '✗'}`;
  const summary =
    `cylinder-re${Re}: St ${b(stats.stZeroCross, bands.st, stPass)}  ` +
    `Cd ${b(stats.meanCd, bands.cd, cdPass)}  ` +
    (bands.cl ? `Cl ${b(stats.clAmplitude, bands.cl, clPass)}  ` : '') +
    `St(fft)=${stats.stFft.toFixed(4)} agree ${stats.estimatorsAgree ? '✓' : '✗'}  ` +
    `${pass ? 'PASS' : 'FAIL'}`;

  return { Re, stats, bands, pass, summary };
}

/**
 * M5 V6 non-interference gate: run the Re=100 cylinder with LES off and on, and require
 * the resolved St / Cd / Cl to shift by ≤ 3 %. The subgrid model must be inert in a
 * fully-resolved laminar flow. Reduced step budget vs. the M4 scoring run (still well
 * past the transient) so the paired A/B fits an interactive click.
 */
export interface V6Result {
  pass: boolean;
  summary: string;
  off: CylinderStats;
  on: CylinderStats;
}

export async function runV6NonInterference(
  device: GPUDevice,
  opts: { onProgress?: (frac: number) => void } = {},
): Promise<V6Result> {
  const runOpts = { totalSteps: 150_000, transientSteps: 70_000 } as const;
  const off = await runCylinderCase(device, 100, {
    ...runOpts,
    onProgress: (f) => opts.onProgress?.(0.5 * f),
  });
  const on = await runCylinderCase(device, 100, {
    ...runOpts,
    lesCs: 0.1,
    onProgress: (f) => opts.onProgress?.(0.5 + 0.5 * f),
  });
  const shift = (a: number, b: number) => (a === 0 ? 0 : Math.abs(b - a) / Math.abs(a));
  const dCd = shift(off.stats.meanCd, on.stats.meanCd);
  const dSt = shift(off.stats.stZeroCross, on.stats.stZeroCross);
  const dCl = shift(off.stats.clAmplitude, on.stats.clAmplitude);
  const worst = Math.max(dCd, dSt, dCl);
  const pass = worst <= 0.03;
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const summary =
    `V6 Re=100 ±LES: Cd ${off.stats.meanCd.toFixed(4)}→${on.stats.meanCd.toFixed(4)} (${pct(dCd)})  ` +
    `St ${off.stats.stZeroCross.toFixed(4)}→${on.stats.stZeroCross.toFixed(4)} (${pct(dSt)})  ` +
    `Cl ${off.stats.clAmplitude.toFixed(3)}→${on.stats.clAmplitude.toFixed(3)} (${pct(dCl)})  ` +
    `max ${pct(worst)} ≤3% ${pass ? 'PASS' : 'FAIL'}`;
  return { pass, summary, off: off.stats, on: on.stats };
}

/**
 * M5 high-Re stability gate: run a cylinder at Re = 10⁴ or 10⁵ with LES on for ≥ 10⁵
 * steps and require the force samples to stay finite and bounded (no NaN, no divergence).
 * τ_eff ≥ τ₀ > 0.5 holds by construction (H1 §3); this confirms it end-to-end on the GPU.
 */
export interface HighReResult {
  pass: boolean;
  summary: string;
}

export async function runHighReStability(
  device: GPUDevice,
  Re: number,
  opts: {
    totalSteps?: number;
    sampleInterval?: number;
    cs?: number;
    uLattice?: number;
    diameter?: number;
    nx?: number;
    ny?: number;
    regularize?: boolean;
    onProgress?: (frac: number) => void;
  } = {},
): Promise<HighReResult> {
  const totalSteps = opts.totalSteps ?? 100_000;
  const interval = opts.sampleInterval ?? 100;
  const cs = opts.cs ?? 0.1;
  const scene = cylinderScene({
    Re,
    uLattice: opts.uLattice ?? 0.05,
    diameter: opts.diameter,
    nx: opts.nx,
    ny: opts.ny,
  });
  const { nx, ny, uLattice: u, diameter: D } = scene;
  const gpu = new Lbm2D(device, nx, ny, {
    omega: scene.omega,
    uin: u,
    collision: 'trt',
    lambda: 3 / 16,
    outlet: 'pressure',
    periodicY: true,
    lesCs: cs,
    regularize: opts.regularize,
  });
  gpu.flags.set(Uint32Array.from(scene.flags));
  gpu.uploadFlags();
  gpu.resetFlow();

  const nSamples = Math.floor(totalSteps / interval);
  // The impulsive start produces a large but benign drag transient; only enforce the
  // bounded-force check after it decays. True LBM divergence is explosive (→NaN/Inf in
  // tens of steps), so non-finite is the hard failure at any time.
  const transientSamples = Math.ceil(10_000 / interval);
  let maxCdStartup = 0; // peak |Cd| during the transient (reported, never fatal)
  let maxCdSteady = 0; // peak |Cd| after the transient
  let failStep = -1;
  let failReason = '';
  let minRho = Number.POSITIVE_INFINITY;
  let maxSpeed = 0;
  let minTauEff = Number.POSITIVE_INFINITY;
  try {
    for (let s = 0; s < nSamples; s++) {
      const f = await gpu.sampleForce(interval);
      const cd = coefficient(f.fx, u, D);
      const step = (s + 1) * interval;
      if (!Number.isFinite(cd)) {
        failStep = step;
        failReason = 'NaN/Inf';
        break;
      }
      if (s < transientSamples) {
        maxCdStartup = Math.max(maxCdStartup, Math.abs(cd));
      } else {
        maxCdSteady = Math.max(maxCdSteady, Math.abs(cd));
        if (Math.abs(cd) > 50) {
          failStep = step;
          failReason = `|Cd|=${cd.toFixed(1)}>50`;
          break;
        }
      }
      if (opts.onProgress && (s % 50 === 49 || s === nSamples - 1)) {
        opts.onProgress((s + 1) / nSamples);
      }
    }

    if (failStep < 0) {
      const distributions = await gpu.readDistributions();
      const tauRatios = await gpu.readTauField();
      const cells = scene.nx * scene.ny;
      for (let idx = 0; idx < cells && failStep < 0; idx++) {
        if (scene.flags[idx] === CellType.Solid) continue;
        let rho = 0;
        let mx = 0;
        let my = 0;
        for (let direction = 0; direction < D2Q9.q; direction++) {
          const value = distributions[direction * cells + idx];
          if (!Number.isFinite(value)) {
            failStep = gpu.totalSteps;
            failReason = `non-finite final distribution at cell ${idx}, dir ${direction}`;
            break;
          }
          rho += value;
          mx += D2Q9.ex[direction] * value;
          my += D2Q9.ey[direction] * value;
        }
        if (failStep >= 0) break;
        if (!Number.isFinite(rho) || rho <= 0) {
          failStep = gpu.totalSteps;
          failReason = `non-positive final density at cell ${idx}: ${rho}`;
          break;
        }
        const speed = Math.hypot(mx / rho, my / rho);
        if (!Number.isFinite(speed)) {
          failStep = gpu.totalSteps;
          failReason = `non-finite final velocity at cell ${idx}`;
          break;
        }
        minRho = Math.min(minRho, rho);
        maxSpeed = Math.max(maxSpeed, speed);

        if (scene.flags[idx] === CellType.Fluid) {
          const tauEff = scene.tau * (1 + tauRatios[idx]);
          if (!Number.isFinite(tauEff) || tauEff <= 0.5) {
            failStep = gpu.totalSteps;
            failReason = `invalid final τ_eff at cell ${idx}: ${tauEff}`;
            break;
          }
          minTauEff = Math.min(minTauEff, tauEff);
        }
      }
    }
  } finally {
    gpu.destroy();
  }
  const pass = failStep < 0;
  const tag =
    `Re=${Re} D=${scene.diameter} Cs=${cs} H10=${opts.regularize ? 'on' : 'off'} ` +
    `u=${scene.uLattice} (τ₀=${scene.tau.toFixed(5)})`;
  const summary = pass
    ? `high-Re ${tag}: ${totalSteps.toLocaleString()} steps, no NaN, ` +
      `|Cd| startup≤${maxCdStartup.toFixed(1)} steady≤${maxCdSteady.toFixed(2)}, ` +
      `final ρmin=${minRho.toFixed(4)} |u|max=${maxSpeed.toFixed(3)} ` +
      `τeff,min=${minTauEff.toFixed(5)} — PASS`
    : `high-Re ${tag}: DIVERGED at step ${failStep.toLocaleString()} (${failReason}), ` +
      `startup |Cd|≤${maxCdStartup.toFixed(1)} — FAIL`;
  return { pass, summary };
}

/**
 * Retry the original M5 high-Re gate with the H10 collision port as the only new lever:
 * canonical D=25/u=0.05 grid, Smagorinsky Cs=0.1, 100k steps at both Re=10^4 and 10^5.
 * The report preserves a measured FAIL; it never substitutes the easier H10 O5 scene.
 */
export async function runH10HighReRetry(
  device: GPUDevice,
  opts: { onProgress?: (frac: number, label: string) => void } = {},
): Promise<HighReResult> {
  const reynolds = [10_000, 100_000] as const;
  const lines: string[] = [];
  let pass = true;
  for (let i = 0; i < reynolds.length; i++) {
    const Re = reynolds[i];
    const label = `Re=${Re.toExponential(0)}`;
    const result = await runHighReStability(device, Re, {
      totalSteps: 100_000,
      cs: 0.1,
      uLattice: 0.05,
      diameter: 25,
      nx: 1536,
      ny: 512,
      regularize: true,
      onProgress: (frac) => opts.onProgress?.((i + frac) / reynolds.length, label),
    });
    pass = pass && result.pass;
    lines.push(result.summary.replace(/^high-Re /, ''));
  }
  return {
    pass,
    summary: `H10 retry (LES + regularization):\n${lines.join('\n')}\n${pass ? 'PASS' : 'FAIL'}`,
  };
}

/**
 * M5 high-Re stability sweep: the Cs=0.1/u=0.05 baseline diverges at Re=10⁴ (τ₀≈0.5004
 * is razor-thin above 0.5). This walks two legitimate stability knobs — a larger
 * Smagorinsky Cs (more subgrid dissipation) and a larger inlet u (more free-stream τ₀
 * margin, still ≤ Mach limit) — one change per row, to locate the smallest config that
 * survives ≥10⁵ steps. Whatever passes must then be re-checked against the V6 gate.
 */
/**
 * M5 stability envelope: the Cs/u sweep showed neither knob rescues Re=10⁴ at D=25 (Cs
 * barely moved the failure step; higher u made it worse). This walks the two axes that
 * actually set whether the wake is resolvable — grid resolution (D, with the domain
 * scaled to hold blockage ≈5%) and Reynolds number — at the standard Cs=0.1/u=0.05, to
 * locate where plain Smagorinsky-TRT holds ≥10⁵ steps. The result defines the honest
 * high-Re claim for M5 and informs whether M6's 3D spine needs a regularized/cumulant
 * collision (physics-validation.md §37: "advanced collision operators extend the stable
 * envelope").
 */
export async function runStabilityEnvelope(
  device: GPUDevice,
  opts: { onProgress?: (frac: number, label: string) => void } = {},
): Promise<{ pass: boolean; summary: string }> {
  // Bound the D=25 LES-on stable envelope. NOTE (M10, 2026-07-20): an earlier version of
  // this comment claimed "Re=200 holds ≥200k steps (M4 validation runs)" as the lower
  // bracket — that was an ASSUMPTION, never run. The 2026-07-20 GPU run of V5 (Re=200,
  // plain TRT, no LES) actually DIVERGED, and the CPU reference reproduces it (plain TRT
  // diverges ~step 5000; LES or H10 regularization both hold it — see
  // packages/core/test/cylinder-re200-repro.test.ts). The configs below all run LES on.
  const configs = [
    { Re: 500, diameter: 25, nx: 1536, ny: 512 },
    { Re: 1_000, diameter: 25, nx: 1536, ny: 512 },
    { Re: 2_000, diameter: 25, nx: 1536, ny: 512 },
  ];
  const lines: string[] = [];
  let anyPass = false;
  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    const label = `Re=${c.Re} D=${c.diameter}`;
    const r = await runHighReStability(device, c.Re, {
      diameter: c.diameter,
      nx: c.nx,
      ny: c.ny,
      cs: 0.1,
      uLattice: 0.05,
      totalSteps: 100_000,
      onProgress: (f) => opts.onProgress?.((i + f) / configs.length, label),
    });
    anyPass = anyPass || r.pass;
    lines.push(r.summary.replace(/^high-Re /, ''));
  }
  return { pass: anyPass, summary: lines.join('\n') };
}
