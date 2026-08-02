import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { ablProfileLattice } from '../src/abl.js';
import { PointTimeAverager } from '../src/validation/aijCaseA.js';

/**
 * Steadiness-predicate validation for the AIJ Case A fetch gate (M10, 2026-07-20).
 *
 * The first real-GPU run of acceptance 3 (empty-domain fetch) timed out with the
 * steadiness predicate `drift < 0.01` never becoming true, so the 5% gate was never
 * evaluated. The recorded trace showed drift = 165% at a near-wall node while the gated
 * profile was visibly settled (M10.md Status). `drift` normalizes each point's window-
 * to-window change by that point's OWN magnitude, so a near-ground node whose mean is
 * ~0 pins the max high forever — a conditioning defect, not a convergence-budget one
 * (more steps cannot fix it). `driftScaled` normalizes by the field's peak magnitude
 * instead and is well-conditioned there (unit-tested in aijCaseA.test.ts).
 *
 * Switching a steadiness predicate is safety-adjacent: it decides WHEN the physics gate
 * is read, so a too-loose one risks a premature verdict (Hard rule 3). This test runs the
 * fetch duct through the SAME PointTimeAverager the GPU runner uses to record what the CPU
 * reference actually shows. Findings (see the printed trace):
 *   1. `driftScaled ≤ drift` at every window — it is never inflated by a small-magnitude
 *      point, which is the whole conditioning defect that pinned `drift` at 165% on the
 *      GPU. This is the property that makes `driftScaled < 0.01` REACHABLE where `drift`
 *      is not.
 *   2. On this CLEAN laminar CPU duct `drift` also converges (to ~2e-4) — the near-wall
 *      pinning needs the GPU's LES turbulent fluctuation at a ~0 node, which the synthetic
 *      unit test in aijCaseA.test.ts isolates. So the CPU cannot reproduce the pathology
 *      directly; it can only prove driftScaled's conditioning is sound.
 *   3. CAVEAT the GPU trace must still resolve: a slow monotone sag (the compliant-BC
 *      momentum loss from abl-fetch) creeps the gated deviation upward with tiny per-
 *      window change, so ANY window-to-window predicate can read "steady" mid-transient.
 *      Here it stays well under 5% across the run; on the real grid the recorded
 *      convergence trace (CaseARun) is what confirms the sag has not crossed the gate.
 *
 * Duct = the abl-fetch VelocityInlet configuration (40×24×8, τ₀=0.505 + LES +
 * regularization), the one whose profile is preserved within 5% above the near-ground
 * adjustment zone. Column probed = streamwise ux at the station, mid-span, exactly as
 * CaseARun 'fetch' mode probes it.
 */

const NX = 40;
const MY = 24;
const NZ = 8;
const STEADY = 0.01; // CaseARun STEADY_DRIFT
const WINDOW_SAMPLES = 20; // CaseARun.WINDOW_SAMPLES
const STEPS_PER_SAMPLE = 10;
const atT = (x: number, y: number, z: number): number => x + NX * (y + MY * z);

function fetchDuct(): { solver: Solver3D; ux: Float64Array } {
  const { profile } = ablProfileLattice(
    { kind: 'power', uRef: 6, zRef: 10, alpha: 0.25 },
    MY,
    1,
    0.00706,
  );
  const ux = Float64Array.from(profile);
  const f = new Uint8Array(NX * MY * NZ);
  for (let z = 0; z < NZ; z++)
    for (let x = 0; x < NX; x++) f[atT(x, MY - 1, z)] = CellType.FreeSlip;
  for (let y = 0; y < MY; y++)
    for (let x = 0; x < NX; x++) {
      f[atT(x, y, 0)] = CellType.FreeSlip;
      f[atT(x, y, NZ - 1)] = CellType.FreeSlip;
    }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) f[atT(x, 0, z)] = CellType.Solid;
  for (let z = 1; z < NZ - 1; z++)
    for (let y = 1; y < MY - 1; y++) f[atT(0, y, z)] = CellType.VelocityInlet;
  for (let z = 0; z < NZ; z++) f[atT(0, MY - 1, z)] = CellType.Inlet;
  for (let y = 1; y < MY; y++) {
    f[atT(0, y, 0)] = CellType.Inlet;
    f[atT(0, y, NZ - 1)] = CellType.Inlet;
  }
  for (let z = 1; z < NZ - 1; z++)
    for (let y = 1; y < MY - 1; y++) f[atT(NX - 1, y, z)] = CellType.Outlet;

  const solver = new Solver3D({
    nx: NX,
    ny: MY,
    nz: NZ,
    omega: 1 / 0.505,
    flags: f,
    collision: 'trt',
    regularize: true,
    les: { cs: 0.1 },
    inletProfile: { axis: 'y', ux },
    freeSlip: { yMax: true, zMin: true, zMax: true },
  });
  solver.reset(1, 0.035, 0, 0);
  return { solver, ux };
}

interface WindowTrace {
  windows: number;
  steps: number;
  drift: number;
  driftScaled: number;
  driftIndex: number;
  fetchMaxRel: number;
}

describe('AIJ fetch steadiness predicate (M10 acceptance 3, CPU)', () => {
  it(
    'driftScaled is well-conditioned and reachable; the sag is slow and bounded',
    { timeout: 120_000 },
    () => {
      const { solver, ux } = fetchDuct();
      const station = 4;
      const zMid = 4;
      // Probe points y = 1 .. MY-2, exactly the column CaseARun 'fetch' mode averages.
      const ys: number[] = [];
      for (let y = 1; y < MY - 1; y++) ys.push(y);
      const avg = new PointTimeAverager(ys.length, WINDOW_SAMPLES);

      // Gated heights: node 5 up to the reference height (H at zRef in this duct is well
      // above node 5); nodes 2..4 are the documented adjustment zone (abl-fetch), which
      // the idealized power-law inlet leaves > 5% — excluded here so fetchMaxRel measures
      // the settlement of the *gated* profile, which is what steadiness must protect.
      const gatedYs: number[] = [];
      for (let y = 5; y <= MY - 2; y++) gatedYs.push(y);

      let steps = 0;
      const trace: WindowTrace[] = [];
      let lastWindow = 0;
      const totalWindows = 40;
      while (trace.length < totalWindows) {
        solver.step(STEPS_PER_SAMPLE);
        steps += STEPS_PER_SAMPLE;
        const m = solver.macroscopics();
        const sample = ys.map((y) => m.ux[atT(station, y, zMid)]);
        avg.add(sample);
        const s = avg.stats();
        if (s && s.windows > lastWindow) {
          lastWindow = s.windows;
          // Worst deviation of the current windowed means from the inlet profile, gated.
          let fetchMaxRel = 0;
          for (const y of gatedYs) {
            const sim = s.means[y - 1]; // ys[] starts at y = 1
            fetchMaxRel = Math.max(fetchMaxRel, Math.abs(sim - ux[y]) / ux[y]);
          }
          trace.push({
            windows: s.windows,
            steps,
            drift: s.drift,
            driftScaled: s.driftScaled,
            driftIndex: s.driftIndex,
            fetchMaxRel,
          });
        }
      }

      // Print the convergence curve so a reviewer can see drift vs driftScaled directly.
      console.log(
        'window steps   drift      driftScaled driftIdx fetchMaxRel\n' +
          trace
            .map(
              (t) =>
                `${String(t.windows).padEnd(6)} ${String(t.steps).padEnd(7)} ` +
                `${t.drift.toExponential(2).padEnd(10)} ${t.driftScaled
                  .toExponential(2)
                  .padEnd(11)} ${String(t.driftIndex).padEnd(8)} ${(t.fetchMaxRel * 100).toFixed(
                  2,
                )}%`,
            )
            .join('\n'),
      );

      const finite = trace.filter((t) => Number.isFinite(t.drift));

      // 1. WELL-CONDITIONED: driftScaled is never larger than drift (a small-magnitude
      //    point can only ever inflate drift, never driftScaled). This is the exact
      //    property that keeps driftScaled reachable where drift gets pinned on the GPU.
      for (const t of finite) {
        expect(t.driftScaled, `window ${t.windows}`).toBeLessThanOrEqual(t.drift * (1 + 1e-9));
      }

      // 2. REACHABLE: driftScaled crosses the steadiness bar on this converged duct, and
      //    once below it, stays below (no re-drift) — a genuine steady regime.
      const firstSteady = trace.find((t) => t.driftScaled < STEADY);
      expect(firstSteady, 'driftScaled never reached the steadiness bar').toBeDefined();
      const steadyIdx = trace.indexOf(firstSteady!);
      for (let i = steadyIdx; i < trace.length; i++) {
        expect(
          trace[i].driftScaled,
          `driftScaled re-drifted at window ${trace[i].windows}`,
        ).toBeLessThan(2 * STEADY);
      }

      // 3. The gated profile stays within the 5% physics gate across the whole run (this
      //    is the abl-fetch PASS configuration, re-confirmed through the averager)...
      for (const t of trace) {
        expect(t.fetchMaxRel, `window ${t.windows}`).toBeLessThan(0.05);
      }
      // ...but it is NOT stationary: the compliant-BC sag creeps it monotonically upward.
      // Documented, not a failure — it is exactly why the GPU run records a convergence
      // trace, so a real-grid sag that crossed 5% would be visible rather than hidden.
      const sag = trace[trace.length - 1].fetchMaxRel - firstSteady!.fetchMaxRel;
      expect(sag, 'expected the documented slow upward sag').toBeGreaterThan(0);
    },
  );
});
