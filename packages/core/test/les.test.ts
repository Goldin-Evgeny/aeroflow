import { describe, expect, it } from 'vitest';
import { Solver2D, cylinderScene, coefficient } from '../src/index.js';

/**
 * M5 LES acceptance checks on the CPU reference (the GPU kernel is a 1:1 transliteration
 * gated by the H6 parity panel, which already runs the bgk+les / trt+les configs).
 *
 * These are reduced-grid CI proxies for the two headline M5 gates; the full-resolution
 * runs (Re=10⁴/10⁵ cylinder to ≥10⁵ steps; Re=100 St/Cd non-interference) execute on the
 * GPU and are recorded in the M5 status log.
 */

async function runScene(scene: ReturnType<typeof cylinderScene>, steps: number, les: boolean) {
  const solver = new Solver2D({
    nx: scene.nx,
    ny: scene.ny,
    omega: scene.omega,
    flags: scene.flags,
    forceMask: scene.forceMask,
    inletVelocity: scene.uLattice,
    periodicY: true,
    collision: 'trt',
    lambda: 3 / 16,
    outlet: 'pressure',
    les: les ? { cs: 0.1 } : undefined,
  });
  solver.reset(1, scene.uLattice, 0);
  const chunk = 500;
  for (let done = 0; done < steps; done += chunk) {
    solver.step(Math.min(chunk, steps - done));
    await new Promise((r) => setImmediate(r));
  }
  return solver;
}

describe('M5 LES: moderate-Re stability (within the proven envelope)', () => {
  // M5 finding (the M5 status log): plain Smagorinsky-TRT is Mach-unstable in
  // under-resolved HIGH-Re flow — local velocity overshoots to Ma≈0.5 and it diverges by
  // Re≈3000 at D=25 (Float64-confirmed). Re=10⁴–10⁵ needs a velocity-stable collision,
  // deferred to M6. So this test stays INSIDE the envelope LES genuinely holds: Re=1000
  // runs long and subsonic, with τ_eff ≥ τ₀ > 0.5 by construction (assert, never clamp).
  it(
    'Re=1000 cylinder with LES runs finite and subsonic (reduced grid)',
    { timeout: 120_000 },
    async () => {
      const scene = cylinderScene({ Re: 1_000, nx: 240, ny: 96, diameter: 20 });
      expect(scene.tau).toBeGreaterThan(0.5); // τ₀ floor; τ_eff ≥ τ₀ everywhere under LES
      const solver = await runScene(scene, 12_000, true);
      const { ux, uy } = solver.macroscopics();
      let maxSpeed = 0;
      for (let i = 0; i < ux.length; i++) {
        expect(Number.isFinite(ux[i]) && Number.isFinite(uy[i])).toBe(true);
        maxSpeed = Math.max(maxSpeed, Math.hypot(ux[i], uy[i]));
      }
      // Bounded and subsonic (Ma<0.52). The high-Re failure mode is UNBOUNDED growth to
      // NaN; a finite, steady peak here confirms LES holds this Re with no Mach runaway.
      expect(maxSpeed).toBeLessThan(0.3);
    },
  );
});

describe('M5 LES: V6 non-interference (steady-drag proxy)', () => {
  // The subgrid model must not pollute resolved laminar flow. Re=20 is steady (no
  // shedding), so its drag is a clean deterministic target: enabling LES must shift Cd by
  // ≤3% (the M5 V6 gate; the full Re=100 St+Cd version runs on GPU — see Status).
  it('Re=20 cylinder Cd shifts by ≤3% when LES is enabled', { timeout: 90_000 }, async () => {
    const opts = { Re: 20, nx: 200, ny: 80, diameter: 8 } as const;
    const cd = async (les: boolean) => {
      const scene = cylinderScene(opts);
      const solver = await runScene(scene, 6_000, les);
      const f1 = { ...solver.maskedForce };
      solver.step(1);
      const f2 = { ...solver.maskedForce };
      return coefficient(0.5 * (f1.x + f2.x), scene.uLattice, scene.diameter);
    };
    const cdOff = await cd(false);
    const cdOn = await cd(true);
    expect(Math.abs(cdOn - cdOff) / cdOff).toBeLessThanOrEqual(0.03);
  });
});
