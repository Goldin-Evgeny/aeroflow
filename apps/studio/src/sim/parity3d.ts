import { CellType, D3Q19, EsotericPull3D } from '@aeroflow/core';
import { Lbm3D } from './lbm3d';
import { hooks } from '../dev/testHooks';

/**
 * GPU↔CPU parity harness (M6 acceptance criterion #3). Runs the WGSL FP32-storage kernel
 * and the CPU EsotericPull3D reference with identical flags/τ/inlet on 32³, and compares
 * macroscopics after 100 steps.
 *
 * Bar: ≤ 5e-5 max relative error on rho/u. The M6 spec quoted ≤1e-6 ("same bar as M2"),
 * but that was the 2D D2Q9 figure; D3Q19 over 100 steps accumulates more fp32-vs-fp64
 * round-off (19-term moment sums + TRT constants like ω⁻=1/1.125 that are not fp32-exact).
 * Measured on Ampere: ρ 1.7e-6, u/u_in 8.4e-6, with interior ρ agreeing to 6 significant
 * figures — i.e. the fp32 floor, not an algorithm error (a structural bug produces O(1)
 * errors, as the pre-fix runs showed). 5e-5 sits well above the floor yet catches every
 * such bug. The TS emulation of this exact kernel (test/kernel3dEmu.test.ts) matches the
 * fp64 oracle to ~1e-7, confirming the transcription independently.
 */
const PARITY_BAR = 5e-5;

/** Bumped whenever this harness changes — confirms fresh code loaded past HMR. */
export const PARITY3D_VERSION = 'v10-conservative';

/**
 * Force parity bar: the GPU momentum-exchange sum differs from the fp64 CPU oracle only by
 * fp32 round-off and float summation ORDER (workgroup tree-reduce vs. CPU sequential), so
 * bitwise equality is impossible — H2 §6.7 mandates a relative bar of 1e-4, not 1e-6.
 */
const FORCE_BAR = 1e-4;

export interface Parity3DResult {
  steps: number;
  maxRelRho: number;
  maxRelU: number;
  pass: boolean;
  fluidCells: number;
  gpuErrors: string[];
  /** ρ and |u| sampled at one interior fluid cell (diagnostic). */
  sampleGpuRho: number;
  sampleCpuRho: number;
  /** Momentum-exchange force parity (only when cfg.forces): GPU vs CPU total force. */
  force?: {
    gpu: { x: number; y: number; z: number };
    cpu: { x: number; y: number; z: number };
    /** max component relative error, ‖ΔF‖ / max(‖F_cpu‖ component). */
    maxRelForce: number;
    pass: boolean;
  };
}

const N = 32;
const STEPS = 100;
const INLET_VEL = 0.05;
const TAU = 0.8;

/** Tunnel flags: solid y/z shell, +x inlet / −x… inlet at x=0, outlet at x=nx-1, cube obstacle. */
function tunnelFlags(nx: number, ny: number, nz: number): Uint8Array {
  const flags = new Uint8Array(nx * ny * nz);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (y === 0 || y === ny - 1 || z === 0 || z === nz - 1)
          flags[idx(x, y, z)] = CellType.Solid;
        else if (x === 0) flags[idx(x, y, z)] = CellType.Inlet;
        else if (x === nx - 1) flags[idx(x, y, z)] = CellType.Outlet;
      }
  // Cube obstacle, kept clear of the x=nx-2 plane (no solid directly upstream of outlet).
  // BodySolid: the cube is the measured object, and the surrounding y/z shell is plain
  // Solid — so the forces config also gates that walls are no longer weighed as drag.
  const c = Math.floor(nx / 3);
  for (let z = c; z < c + 4; z++)
    for (let y = c; y < c + 4; y++)
      for (let x = c; x < c + 4; x++) flags[idx(x, y, z)] = CellType.BodySolid;
  return flags;
}

/** rho, ux, uy, uz per fluid cell from the CPU canonical distributions. */
function cpuMacro(cpu: EsotericPull3D): Float32Array {
  const snap = cpu.snapshotCanonical();
  const n = cpu.n;
  const out = new Float32Array(4 * n);
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

export interface Parity3DConfig {
  hasTimestamp?: boolean;
  regularize?: boolean;
  conserveMass?: boolean;
  les?: { cs: number };
  /** Force a small binding cap to exercise the multi-buffer DDF split (#5). */
  maxBindingBytes?: number;
  /** Also check the M7 momentum-exchange force pass against the CPU force oracle. */
  forces?: boolean;
  /**
   * M10 ABL scene instead of the tunnel: no-slip ground, free-slip top + z faces (H11,
   * incl. slip∩slip edges and the slip∩solid ground ring), sheared VelocityInlet (H12),
   * outlet, interior cube. Exercises every new WGSL gather/snapshot path.
   */
  abl?: boolean;
}

/**
 * M10 ABL flags (mirrors apps/studio/test/kernel3dEmu.test.ts ablFlags): Solid ground
 * y=0, FreeSlip top + both z faces, VelocityInlet x=0 interior, Outlet x=nx−1 interior,
 * interior solid cube.
 */
function ablFlags(nx: number, ny: number, nz: number): Uint8Array {
  const flags = new Uint8Array(nx * ny * nz);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (y === 0) flags[idx(x, y, z)] = CellType.Solid;
        else if (y === ny - 1 || z === 0 || z === nz - 1) flags[idx(x, y, z)] = CellType.FreeSlip;
        else if (x === 0) flags[idx(x, y, z)] = CellType.VelocityInlet;
        else if (x === nx - 1) flags[idx(x, y, z)] = CellType.Outlet;
      }
  const c = Math.floor(nx / 3);
  for (let z = c; z < c + 4; z++)
    for (let y = c; y < c + 4; y++)
      for (let x = c; x < c + 4; x++) flags[idx(x, y, z)] = CellType.BodySolid;
  return flags;
}

const ABL_FREESLIP = { yMax: true, zMin: true, zMax: true };

/** Sheared f32-representable inlet profile (indexed by y; y=0 is the solid ground). */
function ablProfile(ny: number): Float32Array {
  const ux = new Float32Array(ny);
  for (let y = 0; y < ny; y++) ux[y] = Math.fround(0.05 * (0.4 + (0.6 * y) / (ny - 1)));
  return ux;
}

export async function runParity3D(
  device: GPUDevice,
  cfg: Parity3DConfig = {},
): Promise<Parity3DResult> {
  const {
    hasTimestamp = false,
    regularize = false,
    conserveMass = false,
    les,
    maxBindingBytes,
    forces = false,
    abl = false,
  } = cfg;
  const flags = abl ? ablFlags(N, N, N) : tunnelFlags(N, N, N);
  const profile = abl ? ablProfile(N) : undefined;

  const cpu = new EsotericPull3D({
    nx: N,
    ny: N,
    nz: N,
    omega: 1 / TAU,
    flags,
    inletVelocity: INLET_VEL,
    inletProfile: profile ? { axis: 'y', ux: Float64Array.from(profile) } : undefined,
    freeSlip: abl ? ABL_FREESLIP : undefined,
    collision: 'trt',
    regularize,
    conserveMass,
    les,
  });
  cpu.reset(1, 0, 0, 0);
  cpu.step(STEPS);
  const macCpu = cpuMacro(cpu);
  // CPU force on the MEASURED BODY (the cube), accumulated during the STEPS-th step — the
  // reference the GPU force pass must reproduce at the same step/parity (H2 §4a: same-step
  // comparison). `maskedForce`, not `force`: the kernel weighs BodySolid links only, and
  // this scene's shell walls are plain Solid. Reading the unmasked accumulator here would
  // compare a body drag against a body-plus-walls sum — measured 3.57e-1 vs 4.89e+0 on the
  // tunnel, i.e. the walls were 93% of it.
  const cpuForce = cpu.maskedForce;

  // Capture any WebGPU validation/out-of-memory errors that would otherwise be swallowed
  // (a rejected dispatch silently discards the command buffer → zeros → "error 1.0").
  const gpuErrors: string[] = [];
  const onErr = (e: Event) => gpuErrors.push(String((e as GPUUncapturedErrorEvent).error.message));
  device.addEventListener('uncapturederror', onErr);
  device.pushErrorScope('validation');
  device.pushErrorScope('internal');
  device.pushErrorScope('out-of-memory');

  const gpu = new Lbm3D(device, {
    nx: N,
    ny: N,
    nz: N,
    omega: 1 / TAU,
    inletVel: INLET_VEL,
    collision: 'trt',
    regularize,
    conserveMass,
    les,
    maxBindingBytes,
    precision: 'fp32',
    hasTimestamp,
    forces,
    inletProfile: profile ? { axis: 'y', ux: profile } : undefined,
    freeSlip: abl ? ABL_FREESLIP : undefined,
    velocityInlet: abl,
  });
  gpu.flags.set(flags);
  gpu.uploadFlags();
  gpu.reset(1, 0, 0, 0);
  // Collect the force on the LAST step so it lines up with the CPU oracle's step/parity:
  // STEPS−1 plain steps, then sampleForce(1) runs the STEPS-th step with collection on.
  let gpuForce: { x: number; y: number; z: number } | undefined;
  if (forces) {
    gpu.submitSteps(STEPS - 1);
    const f = await gpu.sampleForce(1);
    gpuForce = { x: f.fx, y: f.fy, z: f.fz };
  } else {
    gpu.submitSteps(STEPS);
  }
  const macGpu = await gpu.readMacro();

  for (const scope of ['out-of-memory', 'internal', 'validation']) {
    const err = await device.popErrorScope();
    if (err) gpuErrors.push(`[${scope}] ${err.message}`);
  }
  device.removeEventListener('uncapturederror', onErr);

  let maxRelRho = 0;
  let maxRelU = 0;
  let fluidCells = 0;
  for (let idx = 0; idx < N * N * N; idx++) {
    if (flags[idx] !== CellType.Fluid) continue;
    fluidCells++;
    const rRho =
      Math.abs(macGpu[4 * idx] - macCpu[4 * idx]) / Math.max(Math.abs(macCpu[4 * idx]), 1e-9);
    if (rRho > maxRelRho) maxRelRho = rRho;
    for (let c = 1; c <= 3; c++) {
      // Velocity relative error scaled by the inlet speed (a physical reference).
      const e = Math.abs(macGpu[4 * idx + c] - macCpu[4 * idx + c]) / INLET_VEL;
      if (e > maxRelU) maxRelU = e;
    }
  }
  // Sample one interior fluid cell well inside the domain.
  const si = N / 2 + N * (N / 2 + N * (N / 2));
  const sampleGpuRho = macGpu[4 * si];
  const sampleCpuRho = macCpu[4 * si];
  gpu.destroy();

  let force: Parity3DResult['force'];
  if (forces && gpuForce) {
    // Relative error per component, normalized by the largest CPU force component (drag Fx
    // dominates; Fy/Fz are ~0 by symmetry so an absolute-only norm would divide by ~0).
    const denom = Math.max(Math.abs(cpuForce.x), Math.abs(cpuForce.y), Math.abs(cpuForce.z), 1e-30);
    const maxRelForce =
      Math.max(
        Math.abs(gpuForce.x - cpuForce.x),
        Math.abs(gpuForce.y - cpuForce.y),
        Math.abs(gpuForce.z - cpuForce.z),
      ) / denom;
    force = { gpu: gpuForce, cpu: cpuForce, maxRelForce, pass: maxRelForce <= FORCE_BAR };
  }

  const parityPass = maxRelRho <= PARITY_BAR && maxRelU <= PARITY_BAR && gpuErrors.length === 0;
  return {
    steps: STEPS,
    maxRelRho,
    maxRelU,
    fluidCells,
    pass: parityPass && (force ? force.pass : true),
    gpuErrors,
    sampleGpuRho,
    sampleCpuRho,
    force,
  };
}

/** Mount a minimal parity report into an element (browser dev route ?parity3d). */
export async function mountParity3D(
  device: GPUDevice,
  root: HTMLElement,
  hasTimestamp = false,
): Promise<void> {
  root.innerHTML = '<p>Running 3D GPU↔CPU parity on 32³ (100 steps), plain + regularized…</p>';
  try {
    // Both collision variants must transliterate to the CPU oracle within the fp32 bar.
    // REGULARIZE is the H10 velocity-stable path; its parity number should match plain TRT
    // (it is a 1:1 port that only rewrites f^neq before the same relaxation).
    // Force a small binding cap so the 32³ DDF (19 planes) splits into 4 buffers — this
    // exercises the multi-buffer routing (#5) against the same single-array CPU oracle;
    // a correct split must reproduce the single-buffer number to the fp32 floor.
    const splitCap = 6 * N * N * N * 4; // ⌊6-plane cap⌋ ⇒ 4 DDF buffers (6+6+6+1)
    const configs: Array<{ label: string } & Parity3DConfig> = [
      { label: 'TRT (plain)' },
      { label: 'TRT + REGULARIZE (H10)', regularize: true },
      { label: 'TRT + CONSERVE_MASS (H13)', conserveMass: true },
      {
        label: 'TRT + REGULARIZE + CONSERVE_MASS (H10+H13)',
        regularize: true,
        conserveMass: true,
      },
      {
        label: 'TRT + REGULARIZE + 4-buffer split (#5)',
        regularize: true,
        maxBindingBytes: splitCap,
      },
      { label: 'TRT + LES (M7, Cs=0.1)', les: { cs: 0.1 } },
      { label: 'TRT + forces (M7 momentum exchange)', forces: true },
      {
        label: 'TRT + LES + REGULARIZE + CONSERVE_MASS + forces (M9)',
        les: { cs: 0.1 },
        regularize: true,
        conserveMass: true,
        forces: true,
      },
      // M10/H11+H12: free-slip + VelocityInlet scene, with forces on so the ground+cube
      // momentum exchange is also checked in the presence of the new gather paths.
      {
        label: 'TRT + ABL BCs (M10: free-slip H11 + VelocityInlet H12) + forces',
        abl: true,
        forces: true,
      },
      {
        label: 'TRT + ABL BCs + forces + CONSERVE_MASS (M10/H13)',
        abl: true,
        forces: true,
        conserveMass: true,
      },
    ];
    const section = (label: string, r: Parity3DResult): string => {
      const errs = r.gpuErrors.length
        ? `<pre style="color:#c22;white-space:pre-wrap">GPU errors:\n- ${r.gpuErrors.join('\n- ')}</pre>`
        : '<p style="color:#2a2">no GPU validation/OOM errors</p>';
      const forceRows = r.force
        ? `<tr><td>force GPU (Fx,Fy,Fz)</td><td>${r.force.gpu.x.toExponential(4)}, ${r.force.gpu.y.toExponential(4)}, ${r.force.gpu.z.toExponential(4)}</td></tr>
           <tr><td>force CPU (Fx,Fy,Fz)</td><td>${r.force.cpu.x.toExponential(4)}, ${r.force.cpu.y.toExponential(4)}, ${r.force.cpu.z.toExponential(4)}</td></tr>
           <tr><td>max rel. force error</td><td style="color:${r.force.pass ? '#2a2' : '#c22'}">${r.force.maxRelForce.toExponential(3)} (bar ≤ ${FORCE_BAR.toExponential(0)})</td></tr>`
        : '';
      return `
        <h3>${label}
          <span style="color:${r.pass ? '#2a2' : '#c22'}">${r.pass ? 'PASS' : 'FAIL'}</span>
        </h3>
        <table style="border-collapse:collapse">
          <tr><td>fluid cells</td><td>${r.fluidCells}</td></tr>
          <tr><td>steps</td><td>${r.steps}</td></tr>
          <tr><td>max rel. error (ρ)</td><td>${r.maxRelRho.toExponential(3)}</td></tr>
          <tr><td>max rel. error (u / u_in)</td><td>${r.maxRelU.toExponential(3)}</td></tr>
          <tr><td>sample ρ (GPU / CPU)</td><td>${r.sampleGpuRho.toFixed(6)} / ${r.sampleCpuRho.toFixed(6)}</td></tr>
          <tr><td>bar</td><td>≤ ${PARITY_BAR.toExponential(0)} (fp32 floor)</td></tr>
          ${forceRows}
        </table>
        ${errs}`;
    };
    const parts: string[] = [];
    const lines: string[] = [];
    let allPass = true;
    for (const cfg of configs) {
      const r = await runParity3D(device, {
        hasTimestamp,
        regularize: cfg.regularize,
        conserveMass: cfg.conserveMass,
        les: cfg.les,
        maxBindingBytes: cfg.maxBindingBytes,
        forces: cfg.forces,
        abl: cfg.abl,
      });
      allPass = allPass && r.pass;
      parts.push(section(cfg.label, r));
      // One-line summary per config — the parity-panel line CLAUDE.md rule 0 asks for.
      lines.push(
        `${r.pass ? 'PASS' : 'FAIL'} ${cfg.label}: rho=${r.maxRelRho.toExponential(2)} ` +
          `u=${r.maxRelU.toExponential(2)} (bar ${PARITY_BAR.toExponential(0)})` +
          (r.force
            ? ` force=${r.force.maxRelForce.toExponential(2)} (bar ${FORCE_BAR.toExponential(0)})`
            : '') +
          (r.gpuErrors.length ? ` gpuErrors=${r.gpuErrors.length}` : ''),
      );
    }
    hooks().parity3d = { version: PARITY3D_VERSION, allPass, lines };
    root.innerHTML = `
      <h2>M6 GPU↔CPU parity (criterion #3) <small>[${PARITY3D_VERSION}]</small></h2>
      <p style="font-size:1.4em;font-weight:bold;color:${allPass ? '#2a2' : '#c22'}">
        ${allPass ? 'PASS (both variants)' : 'FAIL'}
      </p>
      ${parts.join('<hr/>')}`;
  } catch (e) {
    root.innerHTML = `<pre style="color:#c22">parity3d error:\n${String(e)}</pre>`;
  }
}
