import { CellType, Solver2D } from '@aeroflow/core';
import { Lbm2D } from '../sim/lbm2d';

/**
 * CPU↔GPU momentum-exchange force parity (M4 acceptance 4; docs/handoff/H2 §5–6). Runs
 * the Float64 CPU oracle and the WGSL kernel + GPU reduction on an identical small
 * periodic-Y cylinder scene and compares the two-step-averaged obstacle force (Fx, Fy).
 *
 * Two-step averaging on BOTH sides removes the period-2 staggered momentum eigenmode
 * (H2 §4a) so the comparison is of the physical force, not the ±Nyquist ripple. Float
 * summation order differs (GPU tree-reduce vs CPU sequential), so at longer horizons the
 * gate is 1e-4 relative, not bitwise (H2 §6.7); at n=10 the 1e-5 gate of M4 acceptance 4
 * holds. The cylinder is the only solid, so total force == obstacle force (H2 §2).
 *
 * WebGPU cannot run in WSL — execute this in a browser (same as the parity panel).
 */

export interface ForceParityRun {
  n: number;
  gate: number;
  cpu: { fx: number; fy: number };
  gpu: { fx: number; fy: number };
  relErr: number;
  pass: boolean;
}

export interface ForceParityReport {
  runs: ForceParityRun[];
  pass: boolean;
  summary: string;
}

// periodicY channel (no walls — matches the cylinder scene and avoids the pressure-outlet
// corner singularity) with an ASYMMETRIC obstacle: a disk plus a downstream tab on one
// side only. The asymmetry is essential — a shape mirror-symmetric about a horizontal
// line produces net Fy ≈ 0, which both ill-conditions the relative error AND lets a
// diagonal-link lift-sign bug cancel top-vs-bottom in the sum (H2 §6.1). The tab breaks
// that mirror, so Fy is genuinely nonzero and the sign is exercised.
const FORCE_PARITY_SCENE = {
  nx: 64,
  ny: 32,
  D: 8,
  cx: 20,
  cy: 16,
  uin: 0.05,
  Re: 20,
  tab: { x0: 20, x1: 26, y0: 20, y1: 22 }, // lower-right tab → no horizontal mirror symmetry
} as const;

/** Flags: inlet col 0, outlet col nx−1, periodicY, disk + asymmetric tab. */
function cylinderParityFlags(): Uint8Array {
  const { nx, ny, D, cx, cy, tab } = FORCE_PARITY_SCENE;
  const flags = new Uint8Array(nx * ny);
  const r2 = (D / 2) * (D / 2);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) flags[y * nx + x] = CellType.Solid;
    }
  }
  for (let y = tab.y0; y <= tab.y1; y++) {
    for (let x = tab.x0; x <= tab.x1; x++) flags[y * nx + x] = CellType.Solid;
  }
  for (let y = 0; y < ny; y++) {
    flags[y * nx] = CellType.Inlet;
    flags[y * nx + nx - 1] = CellType.Outlet;
  }
  return flags;
}

const FORCE_PARITY_GATES = [
  { n: 10, gate: 1e-5 },
  { n: 200, gate: 1e-4 },
] as const;

/** Relative error of the force VECTOR — normalized by its magnitude, so a near-zero
 * component (e.g. Fy in a nearly-symmetric case) can't blow the ratio up (the bug that
 * made a symmetric-disk scene report ~1e5). */
const vecRelErr = (g: { fx: number; fy: number }, c: { fx: number; fy: number }): number =>
  Math.hypot(g.fx - c.fx, g.fy - c.fy) / Math.max(Math.hypot(c.fx, c.fy), 1e-9);

export async function runForceParity(device: GPUDevice): Promise<ForceParityReport> {
  const { nx, ny, D, uin, Re } = FORCE_PARITY_SCENE;
  const nu = (uin * D) / Re;
  const tau = 3 * nu + 0.5;
  const flags = cylinderParityFlags();

  const gpu = new Lbm2D(device, nx, ny, {
    omega: 1 / tau,
    uin,
    collision: 'trt',
    lambda: 3 / 16,
    outlet: 'pressure',
    periodicY: true,
  });

  const runs: ForceParityRun[] = [];
  try {
    for (const { n, gate } of FORCE_PARITY_GATES) {
      // CPU oracle: two-step average of the force at steps n and n+1.
      const cpu = new Solver2D({
        nx,
        ny,
        omega: 1 / tau,
        flags: flags.slice(),
        inletVelocity: uin,
        periodicY: true,
        collision: 'trt',
        lambda: 3 / 16,
        outlet: 'pressure',
      });
      cpu.reset(1, uin, 0);
      cpu.step(n);
      const c1 = cpu.force;
      cpu.step(1);
      const c2 = cpu.force;
      const cpuF = { fx: 0.5 * (c1.x + c2.x), fy: 0.5 * (c1.y + c2.y) };

      // GPU: same scene, reset, run n−1 steps, then two force-collecting steps.
      gpu.flags.set(Uint32Array.from(flags));
      gpu.uploadFlags();
      gpu.resetFlow();
      if (n > 1) gpu.submitSteps(n - 1);
      const g1 = await gpu.sampleForce(1);
      const g2 = await gpu.sampleForce(1);
      const gpuF = { fx: 0.5 * (g1.fx + g2.fx), fy: 0.5 * (g1.fy + g2.fy) };

      const relErr = vecRelErr(gpuF, cpuF);
      runs.push({ n, gate, cpu: cpuF, gpu: gpuF, relErr, pass: relErr <= gate });
    }
  } finally {
    gpu.destroy();
  }

  const pass = runs.every((r) => r.pass);
  const summary =
    `force-parity ${nx}x${ny} cyl: ` +
    runs.map((r) => `${r.n}=${r.relErr.toExponential(1)}`).join('/') +
    `  ${pass ? 'PASS' : 'FAIL'}`;
  return { runs, pass, summary };
}
