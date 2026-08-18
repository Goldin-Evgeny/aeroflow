import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Solver3D } from '../src/cpu/solver3d.js';
import {
  FACTORIAL_PREDICTIONS,
  FREE_SLIP,
  LEDGER_SCENE,
  OMEGA_MINUS_RAISED,
  PROBE_SCENE,
  SCENE,
  STEP_BUDGET,
  TAU0,
  armLabel,
  factorialArms,
  factorialFlags,
  runArm,
  runFactorial,
} from './harness/nearFloorFactorial.js';

/**
 * Driver for the discriminating factorial (design.md D4).
 *
 * The full run is 16 arms across three blocks — several minutes of CPU, too slow to belong in
 * `npm test` and not a gate in any case (it measures a mechanism, it does not check one). It
 * runs on demand:
 *
 *     AEROFLOW_FACTORIAL=1 npx vitest run packages/core/test/nearFloorFactorial.test.ts
 *
 * and writes its own machine-readable record to
 * `docs/validation/runs/artifacts/<run-id>/`. CLAUDE.md is explicit that a harness which
 * cannot emit its own durable record is defective — results that survive only in a reporter's
 * scrollback are one flag away from being lost.
 *
 * What always runs is the cheap part: that the harness assembles the right sixteen arms and
 * that an arm executes end to end. A harness that has silently stopped working is worse than no
 * harness, because its output still looks like data.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

describe('near-floor factorial harness', () => {
  it('enumerates the full 2×2×2×2 design in a stable order', () => {
    const arms = factorialArms();
    expect(arms).toHaveLength(16);
    expect(new Set(arms.map(armLabel)).size).toBe(16);
    // Task 4.3: the regularize:on × ω⁻ raised arms are KEPT even though D1 proved them null.
    // A null that stops being null is a regression detector for the projection's evenness.
    expect(arms.filter((a) => a.regularize && a.omegaMinusRaised)).toHaveLength(4);
    // The reproducing configuration must be present — see OUTLETS in the harness.
    expect(arms.filter((a) => a.outlet === 'zero-gradient')).toHaveLength(8);
  });

  it('runs one arm end to end and reports the diagnostics the factorial needs', async () => {
    const cell = await runArm(
      { regularize: true, lesNorm: 'legacy', omegaMinusRaised: false, outlet: 'zero-gradient' },
      { stepBudget: 60, sampleInterval: 30 },
    );
    expect(cell.error).toBeNull();
    expect(cell.finite).toBe(true);
    expect(cell.stepsCompleted).toBe(60);
    expect(cell.lastSample).not.toBeNull();
    const sample = cell.lastSample;
    if (sample === null) throw new Error('unreachable');
    expect(sample.freestream.survivingCells).toBeGreaterThan(200);
    expect(sample.boundaryInfluence.step).toBe(60);
    expect(sample.analyticZero.largestSupportedDistance).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(sample.medianRatioSlope)).toBe(true);
    // The near-floor signature this whole change is about: ω⁺ ≈ 2 against a collapsed ω⁻.
    expect(sample.omegaPlus.max).toBeGreaterThan(1.5);
    expect(sample.omegaMinus.max).toBeLessThan(0.1);
  });

  /**
   * Task 4.3 as an executable check rather than a note: under regularization the ω⁻ setting has
   * no dynamical effect, so the two arms must agree on every diagnostic.
   *
   * **Agreement here is to floating-point rounding, not bit-identity, and the distinction is a
   * measured result rather than a hedge.** The projection is exactly even in `e_i`, so its
   * antisymmetric part is zero in exact arithmetic — but it is reconstructed as
   * `f_i = fl(f_i^eq + 4.5·w_i·Q_i:Π)`, and the two roundings of an opposite-direction pair do
   * not cancel. That leaves an O(ulp) antisymmetric residual which ω⁻ multiplies. Measured on
   * this scene at 20 steps: the residual changes no population at all for ω⁻ ∈
   * {1e-3, 1e-2, 0.1, 0.5}, and changes populations at the 1e-15 relative level for ω⁻ ∈
   * {1.0, 1.9} — a threshold at ω⁻ ≈ 1, which is where `ω⁻ · (½·ulp-scale residual)` first
   * reaches half an ulp of the population it is added to.
   *
   * So D1's conclusion stands as physics — ω⁻ carries no dynamical content under
   * regularization, and mechanism (A) cannot operate at a regularized operating point — while
   * the *strict* bit-identity claim holds only below ω⁻ ≈ 1. D1's Λ sweep could never have
   * exposed this: near the floor every Λ derives an ω⁻ of order 1e-3.
   *
   * Both facts are asserted, because each catches a different regression: a dynamical ω⁻
   * coupling would break the 1e-12 bound, and a projection that stopped being even would break
   * the exact-equality half.
   */
  it('keeps the regularize:on ω⁻ arms dynamically identical', async () => {
    const budget = { stepBudget: 60, sampleInterval: 60 };
    const derived = await runArm(
      { regularize: true, lesNorm: 'legacy', omegaMinusRaised: false, outlet: 'zero-gradient' },
      budget,
    );
    const raised = await runArm(
      { regularize: true, lesNorm: 'legacy', omegaMinusRaised: true, outlet: 'zero-gradient' },
      budget,
    );

    const close = (a: number | undefined, b: number | undefined, what: string): void => {
      if (a === undefined || b === undefined) throw new Error(`${what}: missing sample`);
      const scale = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
      expect(Math.abs(a - b) / scale, `${what}: ${a} vs ${b}`).toBeLessThan(1e-12);
    };
    close(raised.lastSample?.rhoMean, derived.lastSample?.rhoMean, 'rhoMean');
    close(
      raised.lastSample?.freestream.ratio.p50,
      derived.lastSample?.freestream.ratio.p50,
      'freestream nu_t/nu_mol p50',
    );
    close(
      raised.lastSample?.medianRatioSlope,
      derived.lastSample?.medianRatioSlope,
      'strain medianRatioSlope',
    );
    expect(raised.finite).toBe(derived.finite);

    // And the override really was applied — otherwise this compares a run with itself.
    expect(raised.lastSample?.omegaMinus.max).toBe(OMEGA_MINUS_RAISED);
    expect(derived.lastSample?.omegaMinus.max).toBeLessThan(0.1);
  });

  /**
   * The exact half of the invariant, at an ω⁻ below the ulp threshold measured above. This is
   * the projection's evenness itself, stated where a change to `collide.ts` would trip it.
   */
  it('is bit-identical under regularization for ω⁻ below the ulp threshold', () => {
    const steps = 20;
    const populations = (omegaMinus: number | undefined): Float64Array => {
      const solver = new Solver3D({
        nx: SCENE.nx,
        ny: SCENE.ny,
        nz: SCENE.nz,
        omega: 1 / TAU0,
        flags: factorialFlags(),
        inletVelocity: 0.05,
        collision: 'trt',
        omegaMinus,
        les: { cs: 0.1, norm: 'legacy' },
        regularize: true,
        conserveMass: true,
        outlet: 'pressure',
        freeSlip: FREE_SLIP,
      });
      solver.reset(1);
      solver.step(steps);
      return solver.snapshotPostCollision();
    };
    const derived = populations(undefined);
    // 0.5 is ~75× the derived ω⁻ at this τ₀ and still leaves every population untouched.
    const raised = populations(0.5);
    let differing = 0;
    for (let i = 0; i < derived.length; i++) if (!Object.is(derived[i], raised[i])) differing++;
    expect(differing, `${differing} populations differed at ω⁻ = 0.5`).toBe(0);
  });
});

function summarize(result: Awaited<ReturnType<typeof runFactorial>>): string {
  return result.cells
    .map((c) =>
      [
        c.label.padEnd(34),
        (c.finite ? 'FINITE' : `DIVERGED@${c.divergenceStep}`).padEnd(14),
        `steps=${String(c.stepsCompleted).padStart(6)}`,
        `analyticZero=${c.lastSample?.analyticZero.state ?? 'unsampled'}`,
        `boundaryDistance=${c.lastSample?.analyticZero.largestSupportedDistance ?? 0}`,
        `nu_t/nu_mol p50=${(c.lastSample?.freestream.ratio.p50 ?? Number.NaN).toPrecision(6)}`,
        `p99=${(c.lastSample?.freestream.ratio.p99 ?? Number.NaN).toPrecision(6)}`,
        `cells=${c.lastSample?.freestream.survivingCells ?? 0}`,
        `strainRatio=${(c.lastSample?.medianRatioSlope ?? Number.NaN).toPrecision(6)}`,
        `omega+=${(c.lastSample?.omegaPlus.mean ?? Number.NaN).toPrecision(6)}`,
        `omega-=${(c.lastSample?.omegaMinus.mean ?? Number.NaN).toPrecision(6)}`,
        c.error ? `ERROR=${c.error}` : '',
      ].join(' '),
    )
    .join('\n');
}

describe.runIf(process.env.AEROFLOW_FACTORIAL === '1')('near-floor factorial run', () => {
  // Timeout convention: abl-fetch.test.ts. Worst 1,560.206 s (20-worker load, 2026-08-17 UTC);
  // ceil5(max(3*1,560.206, 1,560.206+30)) = 4,685 s.
  it(
    'runs the factorial on both scenes and persists the record',
    { timeout: 4_685_000 },
    async () => {
      const runId = process.env.AEROFLOW_RUN_ID ?? 'near-floor-factorial';
      const outDir = resolve(REPO_ROOT, 'docs/validation/runs/artifacts', runId);
      mkdirSync(outDir, { recursive: true });

      // Task 4.4: predictions on disk BEFORE the first arm executes, so what follows is
      // prediction-vs-result and cannot be reshaped around whatever comes out.
      writeFileSync(
        resolve(outDir, 'predictions.json'),
        JSON.stringify(
          { writtenAtUtc: new Date().toISOString(), predictions: FACTORIAL_PREDICTIONS },
          null,
          2,
        ),
        'utf8',
      );

      /**
       * The ledger scene FIRST, and at the 6,000-step budget the original observation used. A
       * factorial that cannot reproduce the motivating destabilization on the grid it was
       * recorded on is measuring something else, and the probe-scene numbers would be
       * uninterpretable without knowing that.
       */
      const ledger = await runFactorial({
        scene: LEDGER_SCENE,
        stepBudget: 6000,
        sampleInterval: 250,
      });
      const probe = await runFactorial({ scene: PROBE_SCENE, stepBudget: STEP_BUDGET });

      /**
       * The probe scene is 2.4× longer streamwise, so 4,000 steps there is ~8 flow-throughs
       * against the ledger scene's ~17 at 3,500. This arm re-runs the configuration whose
       * stability is the whole question at a budget matched in flow-throughs, so "stable" is not
       * confused with "not yet developed".
       */
      const probeLong = await runFactorial({
        scene: PROBE_SCENE,
        stepBudget: 20000,
        sampleInterval: 1000,
      });

      const record = {
        completedAtUtc: new Date().toISOString(),
        ledgerScene: ledger,
        probeScene: probe,
        probeSceneLongBudget: probeLong,
      };
      writeFileSync(resolve(outDir, 'factorial.json'), JSON.stringify(record, null, 2), 'utf8');

      const summary = [
        `# LEDGER SCENE (reproduction control) ${LEDGER_SCENE.nx}x${LEDGER_SCENE.ny}x${LEDGER_SCENE.nz}, budget 6000`,
        summarize(ledger),
        '',
        `# PROBE SCENE ${PROBE_SCENE.nx}x${PROBE_SCENE.ny}x${PROBE_SCENE.nz}, budget ${STEP_BUDGET}`,
        summarize(probe),
        '',
        `# PROBE SCENE, budget 20000 (flow-through matched)`,
        summarize(probeLong),
      ].join('\n');
      writeFileSync(resolve(outDir, 'summary.txt'), `${summary}\n`, 'utf8');
      console.log(`\n${summary}\n`);
      console.log(`artifacts written to ${outDir}`);

      for (const r of [ledger, probe, probeLong]) {
        expect(r.cells).toHaveLength(16);
        for (const c of r.cells) expect(c.error).toBeNull();
      }
    },
  );
});
