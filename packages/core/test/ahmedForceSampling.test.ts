import { describe, expect, it } from 'vitest';
import { ahmedScene, EsotericPull3D } from '../src/index.js';

/**
 * M9 acceptance-1 root cause: the Ahmed Cd was sampled on ONE parity of a period-2
 * oscillation, so the reported number was the true drag plus an arbitrary slice of the
 * staggered momentum eigenmode.
 *
 * `forceLedger.test.ts` establishes the two halves abstractly — the momentum-exchange
 * functional is exact at every τ (T-FORCE-LEDGER), while a single-parity *sample* of it
 * carries a 60% error as τ₀ → ½ (T-STAGGER). This test shows what that does to the actual
 * acceptance quantity on the actual scene, and it is the reason the Re ladder looked like
 * a physics result.
 *
 * The four-rung table below is a SEPARATE recorded sweep on a 60k-cell scene — it is NOT
 * what this test computes. The test body runs a 30k scene at two rungs, and its numbers are
 * in the paragraph after the table. Both are kept: the 60k sweep is the one that spans four
 * decades of Re, which is the claim being made. Quote either by its scene size.
 *
 *   Re      τ₀        Cd single-parity   Cd pair-averaged
 *   1e3     0.502466       0.8597            1.3195
 *   1e4     0.500247       0.2226            1.4233
 *   1e5     0.500025      -0.3933            1.4196
 *   4.29e6  0.500001      -0.4415            1.4194
 *   (60k-cell scene, 2026-08-07; the recorded 8M GPU ladder is the same shape with the
 *    opposite sign — 0.9971 → 3.6989 → 3.9873 — because its even sample interval lands on
 *    the other parity.)
 *
 * Two things to read off it. **Pair-averaging makes Cd Reynolds-independent across four
 * decades**, which is what a bluff body in the fully-separated regime must do and what the
 * single-parity series conspicuously did not do. And **single-parity Cd goes negative** at
 * the high-Re end — a body in a uniform stream being pushed upstream. That is not a noisy
 * measurement, it is not a measurement.
 *
 * The sign is not stable and must not be read as a bias. This test runs a 30k scene, where
 * the same sweep gives -0.6619 (Re 1e3) and +0.7225 (Re 4.29e6) against pair-averaged
 * 1.2582 / 1.1879 — the negative one has moved to the other rung. Which parity the sampling
 * grid lands on is a function of T_conv, the sample interval and the grid, so the offset
 * takes whichever sign that accident produces. The 8M GPU ladder landing consistently
 * positive (3.99) is the same coin, not a different mechanism.
 *
 * The residual is not addressed here: pair-averaged Cd ≈ 1.42 is still ~5× the 0.285 band,
 * on a scene whose body is ~20 cells long. That gap is the one a resolution study is
 * actually entitled to attack — after this fix, and from a baseline of 1.42, not 3.99.
 *
 * KNOWN, BENIGN: like `groundForceContamination.test.ts`, this file's body is ~90 s of
 * UNBROKEN synchronous CPU, so vitest's birpc `onTaskUpdate` ack times out at 60 s and the
 * run prints `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`. It is reporter
 * plumbing, not the test — the assertions run and pass. See that file's header for the full
 * diagnosis; do not silence it by raising the RPC timeout.
 */

/** Re values chosen to straddle the τ₀ ≈ 0.5025 threshold where the mode takes over. */
const RE_LOW = 1e3;
const RE_ACCEPTANCE = 4.29e6;

interface Sampled {
  singleParity: number;
  pairAveraged: number;
  tau0: number;
}

/**
 * Runs the CPU Ahmed reference and reports Cd sampled both ways from the SAME run, so the
 * two numbers differ only in whether the second step of each sample pair is included.
 */
function sampleCd(Re: number, maxCells: number): Sampled {
  const scene = ahmedScene({ maxCells, Re });
  const { nx, ny, nz, flags, uLattice } = scene;
  const sim = new EsotericPull3D({
    nx,
    ny,
    nz,
    omega: scene.omega,
    flags,
    inletVelocity: uLattice,
    collision: 'trt',
    // The production recipe (sim/ahmedWorker.ts buildSim).
    les: { cs: 0.1 },
    regularize: true,
    conserveMass: true,
    // NO `freeSlip` here, deliberately. An earlier version of this file passed
    // `freeSlip: { yMax, zMin, zMax }`, which read as "the CPU runs the M9 spec's slip far
    // field and the GPU does not". It did not: free-slip is driven ENTIRELY by
    // `CellType.FreeSlip` cells in the flag array (cpu/esoteric.ts, cpu/freeslip.ts —
    // `resolveFreeSlipPull` is only ever reached from a `flags[n] === FreeSlip` branch, and
    // `validateFreeSlip` only inspects cells already carrying that flag). `ahmedScene`
    // writes `CellType.Inlet` on the top and side faces, so the option configured a mask no
    // cell consumed. Removing it changes no number here; it removes a false implication.
    //
    // The real state of affairs, recorded so it is not rediscovered a third time: BOTH the
    // CPU reference and the GPU worker run hard-Dirichlet equilibrium `Inlet` on top/sides.
    // That is a documented deviation from the M9 spec, not a CPU/GPU difference, and it is
    // measured against a free-slip variant separately.
  });
  sim.reset(1, uLattice, 0, 0);

  const T = scene.convectiveTimeSteps;
  const totalSteps = 12 * T;
  const averageFrom = 8 * T;
  // ahmedWorker.ts uses max(2, 2·round(T/20)) — always EVEN, hence always one parity.
  const sampleInterval = Math.max(2, 2 * Math.round(T / 20));

  let singleSum = 0;
  let pairSum = 0;
  let samples = 0;
  let s = 0;
  while (s < totalSteps) {
    sim.step();
    s++;
    if (s > averageFrom && s % sampleInterval === 0) {
      const f1 = sim.maskedForce.x;
      sim.step();
      s++;
      pairSum += 0.5 * (f1 + sim.maskedForce.x);
      singleSum += f1;
      samples++;
    }
  }
  const norm = 0.5 * uLattice * uLattice * scene.frontalCells * samples;
  return { singleParity: singleSum / norm, pairAveraged: pairSum / norm, tau0: 1 / scene.omega };
}

describe('M9: Ahmed Cd is a sampling artefact below τ₀ ≈ 0.5025', () => {
  it(
    'pair-averaging makes Cd Reynolds-independent; single-parity sampling does not',
    { timeout: 600_000 },
    () => {
      const low = sampleCd(RE_LOW, 30_000);
      const high = sampleCd(RE_ACCEPTANCE, 30_000);

      console.log(
        `\nahmed Cd sampling (30k-cell CPU reference)\n` +
          `  Re ${RE_LOW.toExponential(0)}  τ₀=${low.tau0.toFixed(6)}  ` +
          `single ${low.singleParity.toFixed(4)}  pair ${low.pairAveraged.toFixed(4)}\n` +
          `  Re ${RE_ACCEPTANCE.toExponential(2)}  τ₀=${high.tau0.toFixed(6)}  ` +
          `single ${high.singleParity.toFixed(4)}  pair ${high.pairAveraged.toFixed(4)}\n`,
      );

      // The physics claim: a bluff body's Cd is essentially Re-independent once the flow is
      // fully separated. Pair-averaged must satisfy that across ~3.5 decades.
      const pairGap = Math.abs(high.pairAveraged - low.pairAveraged);
      const pairSpread = pairGap / (0.5 * (high.pairAveraged + low.pairAveraged));
      expect(pairSpread).toBeLessThan(0.15);

      // Both pair-averaged values must at least be drags.
      expect(low.pairAveraged).toBeGreaterThan(0);
      expect(high.pairAveraged).toBeGreaterThan(0);

      // The defect, pinned: single-parity sampling has no such Re-independence. Its spread
      // across the same two rungs is an order of magnitude larger — which is precisely the
      // "Cd rises with Re" signal that was read as physics.
      const singleGap = Math.abs(high.singleParity - low.singleParity);
      expect(singleGap).toBeGreaterThan(5 * pairGap);

      // And at BOTH rungs the single-parity reading is wrong by tens of percent or more.
      // The SIGN is deliberately not asserted: it depends on which parity the sampling grid
      // happens to land on, which is a function of T_conv, the sample interval and the grid.
      // That is why this 30k scene reads -0.66/+0.72 where the 60k scene read +0.86/-0.44
      // and the 8M GPU ladder reads +3.99 — one mode, arbitrary phase, no stable sign.
      for (const s of [low, high]) {
        expect(Math.abs(s.singleParity - s.pairAveraged) / s.pairAveraged).toBeGreaterThan(0.3);
      }
    },
  );
});
