import { describe, expect, it } from 'vitest';
import { Solver2D } from '../src/cpu/solver2d.js';
import { cylinderScene } from '../src/scenes/cylinder2d.js';

/**
 * Cylinder Re=200 divergence — diagnosis + regression guard (M10, 2026-07-20).
 *
 * The first real-GPU execution of the V5 case produced `Cd NaN, St NaN`. M5's envelope
 * note claimed "Re=200 known stable ≥200k from M4", but that was an assumption: the case
 * had never actually been run. This reproduces it on the CPU Float64 reference to settle
 * whether the divergence is physics (collision stability) or GPU-specific. VERDICT:
 * physics — plain TRT diverges on the CPU oracle, so it is not an FP32/GPU/BC artifact.
 * Both a velocity-stable collision (H10 regularization) and Smagorinsky LES tame it. The
 * recorded V5 GPU result used LES; H10 reached the 2D GPU kernel later as the explicit M5
 * high-Re retry path. See M4/M5 Status.
 *
 * On the full 512×192, D=20 grid (τ=0.515) plain TRT diverged at step 5000, maxSpeed 1.17,
 * while regularized (0.071) and LES Cs=0.1 (0.090) held — recorded in Status. This guard
 * runs a smaller, MORE aggressive grid (D=16 ⇒ τ=0.512, even closer to the 0.5 floor) so
 * it is fast and CI-cheap: if LES holds the harder case, it holds the real one. The step
 * loop is chunked with an event-loop yield — a minutes-long synchronous loop starves
 * vitest's worker RPC heartbeat and shows up as a spurious "onTaskUpdate" timeout.
 */

const GRID = { nx: 200, ny: 64, diameter: 16, uLattice: 0.05 } as const; // τ = 3·(0.05·16/Re)+0.5

async function runCase(
  Re: number,
  opts: { regularize?: boolean; lesCs?: number },
  steps: number,
): Promise<{ allFinite: boolean; maxSpeed: number; tau: number }> {
  const scene = cylinderScene({ Re, ...GRID });
  const s = new Solver2D({
    nx: scene.nx,
    ny: scene.ny,
    omega: scene.omega,
    flags: scene.flags,
    forceMask: scene.forceMask,
    inletVelocity: scene.uLattice,
    periodicY: true,
    outlet: 'pressure',
    collision: 'trt',
    lambda: 3 / 16,
    regularize: opts.regularize ?? false,
    les: opts.lesCs !== undefined ? { cs: opts.lesCs } : undefined,
  });
  s.reset(1, scene.uLattice, 0);
  const chunk = 500;
  for (let done = 0; done < steps; done += chunk) {
    s.step(Math.min(chunk, steps - done));
    await new Promise((r) => setImmediate(r)); // yield so the worker heartbeat survives
  }
  const { ux, uy } = s.macroscopics();
  let allFinite = true;
  let maxSpeed = 0;
  for (let k = 0; k < ux.length; k++) {
    if (!Number.isFinite(ux[k]) || !Number.isFinite(uy[k])) {
      allFinite = false;
      continue;
    }
    maxSpeed = Math.max(maxSpeed, Math.hypot(ux[k], uy[k]));
  }
  return { allFinite, maxSpeed, tau: 1 / scene.omega };
}

// A run "held" if it stayed finite and comfortably subsonic (no Mach-instability runaway).
const held = (r: { allFinite: boolean; maxSpeed: number }) => r.allFinite && r.maxSpeed < 0.3;

describe('cylinder Re=200 divergence repro (diagnostic)', () => {
  it(
    'plain TRT at Re=200 DIVERGES (the V5 GPU failure, on the CPU reference)',
    { timeout: 60_000 },
    async () => {
      const r = await runCase(200, {}, 8000);
      console.log('Re=200 plain TRT:', JSON.stringify(r));
      expect(held(r), 'plain TRT should go Mach-unstable at Re=200').toBe(false);
    },
  );

  it(
    'LES (Cs=0.1) at Re=200 stays finite — the lever used by the recorded V5 run',
    { timeout: 60_000 },
    async () => {
      // The recorded V5 GPU fix was LES; this proves that configuration tames the same
      // divergence on CPU independently of the later 2D H10 port.
      const r = await runCase(200, { lesCs: 0.1 }, 8000);
      console.log('Re=200 LES Cs=0.1:', JSON.stringify(r));
      expect(held(r)).toBe(true);
    },
  );

  it(
    'plain TRT at Re=100 stays finite (control — same harness, M4-validated Re)',
    { timeout: 60_000 },
    async () => {
      const r = await runCase(100, {}, 8000);
      console.log('Re=100 plain TRT:', JSON.stringify(r));
      expect(held(r)).toBe(true);
    },
  );
});
