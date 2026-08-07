import { ahmedScene, CellType, D3Q19, EsotericPull3D, type AhmedScene } from '@aeroflow/core';
import { Lbm3D } from '../sim/lbm3d';
import { hooks } from './testHooks';

/**
 * M9 Phase 1 — matched-configuration CPU↔GPU reconciliation for the Ahmed body.
 *
 * ## The question
 *
 * After the single-parity force defect was fixed (H2 §4a), the corrected Ahmed Cd read
 * ~1.32–1.42 on the CPU reference and ~1.03–1.19 on the GPU. Before spending the
 * resolution ladder, one thing has to be settled: is that a genuine CPU/GPU discrepancy,
 * or is it entirely the two runs being different runs?
 *
 * They were never the same run. The known differences, all four of them:
 *
 *   - init:      CPU test `reset(1, uLattice, 0, 0)` (uniform flow) vs worker `reset(1,0,0,0)` (rest)
 *   - grid:      30k/60k cells (body ~20 cells long) vs 2M/8M (body ~124)
 *   - averaging: fixed 8·T…12·T window vs a block-agreement convergence stop
 *   - precision: Float64 vs fp16 storage at the acceptance tier
 *
 * ## Why this is two measurements and not one
 *
 * A separated bluff-body wake is chaotic. fp32 and Float64 seed different roundoff, and
 * that difference grows. So "do CPU and GPU agree?" has two different answers depending on
 * the horizon, and conflating them is how a roundoff artefact gets read as a solver bug (or
 * a solver bug gets excused as chaos):
 *
 *   **A. Trajectory parity (the discriminator).** Identical scene, identical config,
 *   identical rest init, compared at SHORT horizons. A structural CPU/GPU difference is
 *   O(1) immediately and visible at the first checkpoint. Roundoff is ~1e-6 and grows
 *   smoothly. Measuring at several horizons separates the two by the SHAPE of the growth,
 *   which a single number cannot do.
 *
 *   **B. Windowed Cd (the reconciliation).** The same averaging protocol on both sides,
 *   which is what actually reconciles a Cd against a Cd. Agreement here is statistical, not
 *   pointwise — two chaotic trajectories with the same statistics give the same mean Cd to
 *   within the sampling error of the window, and NOT to the parity bar. Reported with that
 *   caveat attached rather than gated against a tolerance it cannot be held to.
 *
 * ## The pair-averaging path is made identical, not merely similar
 *
 * `forceAveraged(k)` advances k steps and averages the last two, so repeated calls sample
 * pairs at steps (m·k−1, m·k). The CPU test's loop instead read f₁ at a multiple of k and
 * then took an EXTRA step for f₂ — pairs at (m·k, m·k+1), and one more step consumed per
 * sample, which shifts its entire trajectory relative to the GPU's. This harness drives the
 * CPU as `step(k−1)` → read f₁ → `step(1)` → read f₂, which reproduces `forceAveraged(k)`'s
 * grid exactly: same pair, same steps consumed.
 */

/** Both sides run this; every field is reported so the match is auditable, not asserted. */
export interface AhmedMatchConfig {
  maxCells: number;
  Re: number;
  /** Steps before sampling starts. */
  warmupSteps: number;
  /** `k` — steps per sample, and the argument to `forceAveraged`. */
  sampleInterval: number;
  /** Pair-averaged samples collected after warmup. */
  samples: number;
  /** Short horizons for the trajectory comparison (phase A). */
  horizons: number[];
}

export interface TrajectoryPoint {
  steps: number;
  /** max relative error on ρ over fluid cells. */
  maxRelRho: number;
  /** max |Δu| / u_inlet over fluid cells. */
  maxRelU: number;
  /** Pair-averaged body force at this horizon, both sides. */
  cpuPairFx: number;
  gpuPairFx: number;
  /** The two raw consecutive forces behind each pair mean. */
  cpuRaw: [number, number];
  gpuRaw: [number, number];
  relPairFx: number;
  cpuCd: number;
  gpuCd: number;
}

export interface WindowedCd {
  samples: number;
  cpuCd: number;
  gpuCd: number;
  cpuStd: number;
  gpuStd: number;
  relCd: number;
  /** Standard error of each mean — the scale agreement can be expected at. */
  cpuSem: number;
  gpuSem: number;
}

export interface AhmedMatchReport {
  config: AhmedMatchConfig;
  scene: {
    nx: number;
    ny: number;
    nz: number;
    cells: number;
    lengthCells: number;
    bodyVoxels: number;
    frontalCells: number;
    blockage: number;
    noseX: number;
    dx: number;
    Re: number;
    uLattice: number;
    mach: number;
    tau0: number;
    omega: number;
    nu: number;
    convectiveTimeSteps: number;
  };
  /** Every solver knob, both sides, so "matched" is checkable rather than claimed. */
  solver: Record<string, string>;
  trajectory: TrajectoryPoint[];
  windowed: WindowedCd;
  /** Phase A verdict: no structural discrepancy at the shortest horizon. */
  trajectoryPass: boolean;
  gpuErrors: string[];
  lines: string[];
  ms: number;
}

/**
 * Phase A bar. This is the `parity3d` bar (5e-5, the measured fp32 floor for D3Q19 over 100
 * steps) applied at the SHORTEST horizon only. Later horizons are reported, never gated:
 * they are expected to grow, and gating them would be gating chaos.
 */
const TRAJECTORY_BAR = 5e-5;

const CS2_INV_SQRT = Math.sqrt(3); // 1/c_s

/** ρ, ux, uy, uz per fluid cell from the CPU canonical distributions (mirrors parity3d). */
function cpuMacro(cpu: EsotericPull3D): Float64Array {
  const snap = cpu.snapshotCanonical();
  const n = cpu.n;
  const out = new Float64Array(4 * n);
  for (let idx = 0; idx < n; idx++) {
    if (cpu.flags[idx] !== CellType.Fluid) continue;
    let rho = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let i = 0; i < D3Q19.q; i++) {
      const fi = snap[i * n + idx];
      rho += fi;
      mx += D3Q19.ex[i] * fi;
      my += D3Q19.ey[i] * fi;
      mz += D3Q19.ez[i] * fi;
    }
    out[4 * idx] = rho;
    out[4 * idx + 1] = mx / rho;
    out[4 * idx + 2] = my / rho;
    out[4 * idx + 3] = mz / rho;
  }
  return out;
}

/**
 * One pair-averaged sample on the CPU, on `forceAveraged(k)`'s exact grid: k−1 steps, read
 * f₁, one step, read f₂. Consumes exactly k steps, like the GPU call.
 */
function cpuPairSample(cpu: EsotericPull3D, k: number): { pair: number; raw: [number, number] } {
  if (k > 1) cpu.step(k - 1);
  const f1 = cpu.maskedForce.x;
  cpu.step(1);
  const f2 = cpu.maskedForce.x;
  return { pair: 0.5 * (f1 + f2), raw: [f1, f2] };
}

function buildCpu(scene: AhmedScene): EsotericPull3D {
  const cpu = new EsotericPull3D({
    nx: scene.nx,
    ny: scene.ny,
    nz: scene.nz,
    omega: scene.omega,
    flags: scene.flags.slice(), // the GPU gets its own copy too; neither may mutate the other's
    inletVelocity: scene.uLattice,
    collision: 'trt',
    les: { cs: AHMED_CS },
    regularize: true,
    conserveMass: true,
    // No `forceMask`: `isMeasured` already selects CellType.BodySolid, which is exactly the
    // mask the kernel applies. Passing one would be a second, redundant definition.
  });
  cpu.reset(1, 0, 0, 0); // rest, matching the worker — NOT the uniform-flow init the old test used
  return cpu;
}

function buildGpu(device: GPUDevice, scene: AhmedScene): Lbm3D {
  const gpu = new Lbm3D(device, {
    nx: scene.nx,
    ny: scene.ny,
    nz: scene.nz,
    omega: scene.omega,
    inletVel: scene.uLattice,
    collision: 'trt',
    les: { cs: AHMED_CS },
    regularize: true,
    conserveMass: true,
    forces: true,
    // fp32, NOT the acceptance tier's fp16: this run is asking whether the two
    // implementations agree, and fp16 storage noise would answer a different question.
    precision: 'fp32',
  });
  gpu.flags.set(scene.flags);
  gpu.uploadFlags();
  gpu.reset(1, 0, 0, 0);
  return gpu;
}

/** The Ahmed run's Smagorinsky constant (sim/ahmedRun.ts AHMED_LES_CS), inlined to keep
 *  this dev harness free of a worker-module import. */
const AHMED_CS = 0.1;

export async function runAhmedMatch(
  device: GPUDevice,
  cfg: Partial<AhmedMatchConfig> = {},
): Promise<AhmedMatchReport> {
  const t0 = performance.now();
  const maxCells = cfg.maxCells ?? 30_000;
  const Re = cfg.Re ?? 4.29e6;
  const scene = ahmedScene({ maxCells, Re });
  const T = scene.convectiveTimeSteps;

  const config: AhmedMatchConfig = {
    maxCells,
    Re,
    warmupSteps: cfg.warmupSteps ?? 8 * T,
    sampleInterval: cfg.sampleInterval ?? Math.max(2, 2 * Math.round(T / 20)),
    samples: cfg.samples ?? 20,
    horizons: cfg.horizons ?? [25, 50, 100, 200, 400],
  };

  const gpuErrors: string[] = [];
  const onErr = (e: Event) => gpuErrors.push(String((e as GPUUncapturedErrorEvent).error.message));
  device.addEventListener('uncapturederror', onErr);

  const norm = 0.5 * scene.uLattice * scene.uLattice * scene.frontalCells;
  const trajectory: TrajectoryPoint[] = [];
  let windowed: WindowedCd;

  try {
    // ---- Phase A: trajectory parity at increasing short horizons ----------------------
    // Each horizon is an INDEPENDENT pair of runs from the same rest state, so a horizon's
    // number is the divergence after exactly that many steps and not a running total
    // contaminated by the readbacks of the previous one.
    for (const h of config.horizons) {
      const cpu = buildCpu(scene);
      const gpu = buildGpu(device, scene);
      try {
        // Advance both to h−2, then take the pair over steps h−1 and h on each side.
        if (h > 2) {
          cpu.step(h - 2);
          gpu.submitSteps(h - 2);
        }
        const cpuS = cpuPairSample(cpu, 2);
        const gf = await gpu.forceAveraged(2);
        const gpuRaw = await (async () => {
          // forceAveraged returns only the mean; recover the two raw readings by replaying
          // the same two steps on a second GPU instance. Same kernel, same order — the
          // semantics gate measured this replay as bitwise-identical.
          const g2 = buildGpu(device, scene);
          try {
            if (h > 2) g2.submitSteps(h - 2);
            const a = await g2.sampleForce(1);
            const b = await g2.sampleForce(1);
            return [a.fx, b.fx] as [number, number];
          } finally {
            g2.destroy();
          }
        })();

        const macCpu = cpuMacro(cpu);
        const macGpu = await gpu.readMacro();
        let maxRelRho = 0;
        let maxRelU = 0;
        for (let idx = 0; idx < scene.nx * scene.ny * scene.nz; idx++) {
          if (scene.flags[idx] !== CellType.Fluid) continue;
          const rc = macCpu[4 * idx];
          const r = Math.abs(macGpu[4 * idx] - rc) / Math.max(Math.abs(rc), 1e-9);
          if (r > maxRelRho) maxRelRho = r;
          for (let c = 1; c <= 3; c++) {
            const e = Math.abs(macGpu[4 * idx + c] - macCpu[4 * idx + c]) / scene.uLattice;
            if (e > maxRelU) maxRelU = e;
          }
        }
        const relPairFx =
          Math.abs(gf.fx - cpuS.pair) / Math.max(Math.abs(cpuS.pair), 1e-30);
        trajectory.push({
          steps: h,
          maxRelRho,
          maxRelU,
          cpuPairFx: cpuS.pair,
          gpuPairFx: gf.fx,
          cpuRaw: cpuS.raw,
          gpuRaw,
          relPairFx,
          cpuCd: cpuS.pair / norm,
          gpuCd: gf.fx / norm,
        });
      } finally {
        gpu.destroy();
      }
    }

    // ---- Phase B: windowed Cd under an identical averaging protocol -------------------
    const cpu = buildCpu(scene);
    const gpu = buildGpu(device, scene);
    try {
      cpu.step(config.warmupSteps);
      gpu.submitSteps(config.warmupSteps);
      const cpuCds: number[] = [];
      const gpuCds: number[] = [];
      for (let s = 0; s < config.samples; s++) {
        cpuCds.push(cpuPairSample(cpu, config.sampleInterval).pair / norm);
        const g = await gpu.forceAveraged(config.sampleInterval);
        gpuCds.push(g.fx / norm);
      }
      const stat = (v: number[]): { mean: number; std: number } => {
        const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
        const std = Math.sqrt(
          v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, v.length),
        );
        return { mean, std };
      };
      const c = stat(cpuCds);
      const g = stat(gpuCds);
      windowed = {
        samples: config.samples,
        cpuCd: c.mean,
        gpuCd: g.mean,
        cpuStd: c.std,
        gpuStd: g.std,
        cpuSem: c.std / Math.sqrt(Math.max(1, config.samples)),
        gpuSem: g.std / Math.sqrt(Math.max(1, config.samples)),
        relCd: Math.abs(g.mean - c.mean) / Math.max(Math.abs(c.mean), 1e-30),
      };
    } finally {
      gpu.destroy();
    }
  } finally {
    device.removeEventListener('uncapturederror', onErr);
  }

  const first = trajectory[0];
  const trajectoryPass =
    first !== undefined &&
    first.maxRelRho <= TRAJECTORY_BAR &&
    first.maxRelU <= TRAJECTORY_BAR &&
    gpuErrors.length === 0;

  const solver: Record<string, string> = {
    'grid (nx×ny×nz)': `${scene.nx}×${scene.ny}×${scene.nz} = ${scene.nx * scene.ny * scene.nz} cells`,
    'body': `${scene.bodyVoxels} voxels, ${scene.lengthCells.toFixed(1)} cells long, frontal ${scene.frontalCells} cells²`,
    'blockage': `${(scene.blockage * 100).toFixed(2)} %`,
    'dx': `${(scene.dx * 1e3).toFixed(2)} mm`,
    'Re (on body length)': scene.Re.toExponential(3),
    'u_lattice / Mach': `${scene.uLattice} / ${(scene.uLattice * CS2_INV_SQRT).toFixed(4)}`,
    'τ₀ / ω': `${(1 / scene.omega).toFixed(9)} / ${scene.omega.toFixed(6)}`,
    'ν_lattice': scene.nu.toExponential(4),
    'LES Cs': `${AHMED_CS} (both)`,
    'collision': 'TRT (both), default Λ',
    'regularize / conserveMass': 'true / true (both)',
    'precision': 'CPU Float64 / GPU fp32 storage',
    'BCs': 'Inlet x=0 + top/sides (hard Dirichlet), Outlet x=nx−1, Solid ground y=0 — identical flags array',
    'force mask': 'CellType.BodySolid both sides (CPU isMeasured, GPU cellForce mask)',
    'init': 'reset(1, 0, 0, 0) — rest, both sides',
    'T_conv': `${T} steps`,
    'warmup / interval / samples': `${config.warmupSteps} / ${config.sampleInterval} / ${config.samples}`,
    'pair path': 'GPU forceAveraged(k); CPU step(k−1)→f₁→step(1)→f₂ — same grid, same steps consumed',
  };

  const lines = [
    `${trajectoryPass ? 'PASS' : 'FAIL'} ahmed-match trajectory @${first?.steps ?? 0} steps: ` +
      `rho=${(first?.maxRelRho ?? NaN).toExponential(2)} u=${(first?.maxRelU ?? NaN).toExponential(2)} ` +
      `(bar ${TRAJECTORY_BAR.toExponential(0)})`,
    ...trajectory.map(
      (t) =>
        `  @${String(t.steps).padStart(4)}: rho=${t.maxRelRho.toExponential(2)} ` +
        `u=${t.maxRelU.toExponential(2)} pairFx rel=${t.relPairFx.toExponential(2)} ` +
        `Cd cpu=${t.cpuCd.toFixed(4)} gpu=${t.gpuCd.toFixed(4)}`,
    ),
    `  windowed Cd (${windowed!.samples} samples): cpu=${windowed!.cpuCd.toFixed(4)}±${windowed!.cpuSem.toFixed(4)} ` +
      `gpu=${windowed!.gpuCd.toFixed(4)}±${windowed!.gpuSem.toFixed(4)} rel=${(windowed!.relCd * 100).toFixed(1)}%`,
  ];

  return {
    config,
    scene: {
      nx: scene.nx,
      ny: scene.ny,
      nz: scene.nz,
      cells: scene.nx * scene.ny * scene.nz,
      lengthCells: scene.lengthCells,
      bodyVoxels: scene.bodyVoxels,
      frontalCells: scene.frontalCells,
      blockage: scene.blockage,
      noseX: scene.noseX,
      dx: scene.dx,
      Re: scene.Re,
      uLattice: scene.uLattice,
      mach: scene.uLattice * CS2_INV_SQRT,
      tau0: 1 / scene.omega,
      omega: scene.omega,
      nu: scene.nu,
      convectiveTimeSteps: T,
    },
    solver,
    trajectory,
    windowed: windowed!,
    trajectoryPass,
    gpuErrors,
    lines,
    ms: performance.now() - t0,
  };
}

export async function mountAhmedMatch(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running matched-config Ahmed CPU↔GPU reconciliation (M9 Phase 1)…</p>';
  try {
    const r = await runAhmedMatch(device);
    hooks().ahmedMatch = r;
    const rows = (o: Record<string, string>): string =>
      Object.entries(o)
        .map(([k, v]) => `<tr><td style="padding-right:1em"><b>${k}</b></td><td>${v}</td></tr>`)
        .join('');
    root.innerHTML = `
      <h2>Ahmed CPU↔GPU matched-config reconciliation <small>(M9 Phase 1)</small></h2>
      <p style="font-size:1.3em;font-weight:bold;color:${r.trajectoryPass ? '#2a2' : '#c22'}">
        trajectory parity ${r.trajectoryPass ? 'PASS' : 'FAIL'} — ${(r.ms / 1000).toFixed(1)} s
      </p>
      <h3>Configuration (identical unless stated)</h3>
      <table style="border-collapse:collapse">${rows(r.solver)}</table>
      <h3>A — trajectory parity</h3>
      <pre style="white-space:pre-wrap">${r.lines.join('\n')}</pre>
      <h3>B — raw consecutive forces per horizon</h3>
      <table style="border-collapse:collapse">
        <tr><th>steps</th><th>CPU f₁, f₂</th><th>CPU pair</th><th>GPU f₁, f₂</th><th>GPU pair</th><th>rel</th></tr>
        ${r.trajectory
          .map(
            (t) =>
              `<tr><td>${t.steps}</td>
                 <td>${t.cpuRaw[0].toExponential(4)}, ${t.cpuRaw[1].toExponential(4)}</td>
                 <td>${t.cpuPairFx.toExponential(4)}</td>
                 <td>${t.gpuRaw[0].toExponential(4)}, ${t.gpuRaw[1].toExponential(4)}</td>
                 <td>${t.gpuPairFx.toExponential(4)}</td>
                 <td>${t.relPairFx.toExponential(2)}</td></tr>`,
          )
          .join('')}
      </table>
      ${r.gpuErrors.length ? `<pre style="color:#c22">GPU errors:\n- ${r.gpuErrors.join('\n- ')}</pre>` : ''}`;
  } catch (e) {
    hooks().ahmedMatchError = String(e);
    root.innerHTML = `<pre style="color:#c22">ahmed-match error:\n${String(e)}</pre>`;
  }
}
