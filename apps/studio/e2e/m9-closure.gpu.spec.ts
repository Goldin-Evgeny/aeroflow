import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocksAgree, relSpread } from '@aeroflow/core';
import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';
import {
  AHMED_ACCEPTANCE_INLET_BC,
  AHMED_ACCEPTANCE_LATERAL_BC,
  AHMED_ACCEPTANCE_OUTLET,
  AHMED_ACCEPTANCE_PRECISION,
} from '../src/sim/ahmedRun';
import type {
  AhmedDiagnostics,
  AhmedSceneSummary,
  AhmedTauReport,
  AhmedWorkerEvent,
} from '../src/sim/ahmedRun';

/**
 * M9 hard-closure run.  This is deliberately a single-case acceptance/endurance harness,
 * not another Ahmed ladder:
 *
 *  - one fresh 15.7M-cell target-tier scene;
 *  - the acceptance configuration (freestream far field + H12 + H14, D3Q19 production);
 *  - the declared independent-block rule and 30-minute production budget;
 *  - the four-hour/background/device-loss acceptance on that same run; and
 *  - wake diagnostics AND the tau_eff / approach-strain readback from the final field.
 *
 * Cd and topology are recorded outcomes, not assertions.  A scientifically valid failure is
 * an M9 disposition.  Infrastructure invariants remain assertions because a harness failure
 * is not an Ahmed result.
 *
 * Three defects in the 2026-08-10 first run are fixed here.  All three made the harness
 * report something other than what the solver did; none of them move a physics tolerance.
 *
 * 1. BLOCK LENGTH.  The 20-T_conv block was declared before the force signal's variance was
 *    known.  That run measured sigma(Cd) = 1.212 against a stationary mean of 0.889 at ~10
 *    samples/T_conv, so a 20-T_conv block holds ~200 samples and has a standard error of
 *    1.212/sqrt(200) ~ 0.086 -- about 10% of the mean, against a 3% spread gate.  The gate
 *    was unreachable by construction, and its failure was reported as "the flow did not
 *    converge" when four independent 300-T_conv windows of that same run agree to 0.3%
 *    (0.8864 / 0.8894 / 0.8879 / 0.8911).
 *
 *    The 3% gate is UNCHANGED.  The block is now long enough to resolve it: to get the
 *    block SE under the gate needs n >= (sigma / (gate * mean))^2 ~ 2,100 samples ~ 210
 *    T_conv.  BLOCK_TCONV is derived from the run's own observed sigma/mean at the trigger
 *    rather than pinned, so a quieter signal is not made to wait for no reason and a noisier
 *    one is not passed on a block that cannot resolve it.
 *
 * 2. TAU READBACK.  The first run took no tau_eff snapshot at all, which is the one
 *    measurement that decides whether a Cd at nominal Re 4.29e6 may be quoted against that
 *    Re (private b2b7fd9: the subgrid model backfills what tau0 gives up, so the >=1e5 rungs
 *    do not run at their nominal Re).  It is taken here on the stopped, settled field --
 *    alongside the approach strain/stress/scale comparisons -- exactly as
 *    ahmed-baseline-2m.gpu.spec.ts already does.
 *
 * 3. TOPOLOGY GATE.  `slantReverseFraction > 0 && gammaLeft*gammaRight < 0` is satisfied by
 *    any turbulent field; the first run classified TOPOLOGY_PASS while reporting a
 *    recirculation length of exactly zero.  The wake numbers are still recorded in full, but
 *    the classification now requires a measured recirculation length and a base reverse
 *    fraction consistent with a separation bubble, and reports TOPOLOGY_RECORDED when the
 *    features are present but too weak to call.
 */
const TARGET_CELLS = 15_700_000;
const ACCEPTANCE_BUDGET_MS = 30 * 60_000;
const ENDURANCE_MS = 4 * 60 * 60_000;
const BACKGROUND_MS = 60 * 60_000;
const MIN_BLOCKS = 4;
const BLOCK_GATE = 0.03;
const CD_BAND = [0.242, 0.328] as const;

/**
 * Block length floor/ceiling.  The floor is the originally declared 20 T_conv, so a signal
 * quiet enough for it is judged exactly as before.  The ceiling keeps a pathologically noisy
 * run from demanding a block the budget can never fill -- it fails on the budget instead,
 * which is the honest outcome.
 */
const BLOCK_TCONV_MIN = 20;
const BLOCK_TCONV_MAX = 400;

/**
 * Block length that makes the declared 3% spread gate resolvable for the observed noise.
 * n >= (sigma / (gate * |mean|))^2 independent samples; converted to T_conv at the run's own
 * sampling cadence and clamped.  Samples inside a block are correlated, so this is a lower
 * bound on the block length, never an optimistic one.
 */
function requiredBlockTConv(post: Sample[], samplesPerTConv: number): number {
  if (post.length < 2 || !Number.isFinite(samplesPerTConv) || samplesPerTConv <= 0) {
    return BLOCK_TCONV_MIN;
  }
  const values = post.map((s) => s.cd);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!Number.isFinite(mean) || mean === 0) return BLOCK_TCONV_MAX;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, values.length - 1);
  const sigma = Math.sqrt(variance);
  if (!Number.isFinite(sigma)) return BLOCK_TCONV_MAX;
  const needed = (sigma / (BLOCK_GATE * Math.abs(mean))) ** 2;
  const tconv = needed / samplesPerTConv;
  return Math.min(BLOCK_TCONV_MAX, Math.max(BLOCK_TCONV_MIN, Math.ceil(tconv)));
}

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-results',
  'm9-closure',
);

type Sample = Extract<AhmedWorkerEvent, { type: 'sample' }>;
type Ready = Extract<AhmedWorkerEvent, { type: 'ready' }>;

const events = (h: AeroflowHooks): AhmedWorkerEvent[] =>
  (h.ahmedEvents ?? []) as AhmedWorkerEvent[];
const samples = (h: AeroflowHooks): Sample[] =>
  events(h).filter((e): e is Sample => e.type === 'sample');

/** Samples per T_conv, measured from the run rather than assumed. */
function samplesPerTConv(post: Sample[]): number {
  if (post.length < 2) return NaN;
  const span = post[post.length - 1].convectiveTimes - post[0].convectiveTimes;
  return span > 0 ? (post.length - 1) / span : NaN;
}

function blockMeans(
  post: Sample[],
  blockTConv: number,
): { t0: number; t1: number; mean: number; n: number }[] {
  if (post.length === 0) return [];
  const complete: { t0: number; t1: number; mean: number; n: number }[] = [];
  let start = post[0].convectiveTimes;
  let last = start;
  let sum = 0;
  let n = 0;
  for (const sample of post) {
    if (sample.convectiveTimes - start >= blockTConv && n > 0) {
      complete.push({ t0: start, t1: last, mean: sum / n, n });
      start = sample.convectiveTimes;
      sum = 0;
      n = 0;
    }
    sum += sample.cd;
    n++;
    last = sample.convectiveTimes;
  }
  return complete; // the trailing partial block is intentionally excluded
}

function lastEvent<T extends AhmedWorkerEvent['type']>(
  h: AeroflowHooks,
  type: T,
): Extract<AhmedWorkerEvent, { type: T }> | undefined {
  return [...events(h)].reverse().find((e) => e.type === type) as
    Extract<AhmedWorkerEvent, { type: T }> | undefined;
}

test('M9 closure: one target Ahmed acceptance plus four-hour resilience', async ({
  gpuPage: page,
}, testInfo) => {
  test.setTimeout(5 * 60 * 60_000);
  mkdirSync(OUT_DIR, { recursive: true });

  await page.goto(
    `${BASE_URL}/?ahmed&cells=${TARGET_CELLS}&Re=4.29e6&lesCs=0.1&precision=fp16` +
      `&lateralBC=${AHMED_ACCEPTANCE_LATERAL_BC}&inletBC=${AHMED_ACCEPTANCE_INLET_BC}` +
      `&outlet=${AHMED_ACCEPTANCE_OUTLET}&fieldEvery=20`,
  );
  const wallStartedAt = Date.now();
  await page.getByTestId('ahmed-start').click();
  await expect
    .poll(async () => events(await readHooks(page)).map((e) => e.type), { timeout: 600_000 })
    .toContain('ready');

  let h = await readHooks(page);
  const ready = lastEvent(h, 'ready') as Ready;
  const scene = ready.scene as AhmedSceneSummary;

  // Frozen configuration: assert what the worker actually built, never merely the URL.
  expect(scene.totalCells).toBeGreaterThan(0.98 * TARGET_CELLS);
  expect(scene.totalCells).toBeLessThanOrEqual(1.02 * TARGET_CELLS);
  expect(scene.Re).toBeCloseTo(4.29e6, -3);
  expect(scene.uLattice).toBe(0.05);
  expect(scene.lesCs).toBe(0.1);
  expect(scene.precision).toBe(AHMED_ACCEPTANCE_PRECISION);
  expect(scene.lateralBC).toBe(AHMED_ACCEPTANCE_LATERAL_BC);
  expect(scene.inletBC).toBe(AHMED_ACCEPTANCE_INLET_BC);
  expect(scene.outlet).toBe(AHMED_ACCEPTANCE_OUTLET);
  expect(events(h).some((e) => e.type === 'resumed')).toBe(false);

  // Establish a nonzero checkpoint and exercise loss/recovery before the unattended window.
  await expect
    .poll(async () => samples(await readHooks(page)).length, { timeout: 600_000 })
    .toBeGreaterThanOrEqual(2);
  await page.getByTestId('ahmed-ckpt').click();
  await expect
    .poll(async () => lastEvent(await readHooks(page), 'checkpoint-saved')?.totalSteps ?? -1, {
      timeout: 900_000,
    })
    .toBeGreaterThan(0);
  h = await readHooks(page);
  const checkpoint = lastEvent(h, 'checkpoint-saved')!;

  await page.getByTestId('ahmed-chaos').click();
  await expect
    .poll(async () => events(await readHooks(page)).some((e) => e.type === 'device-lost'), {
      timeout: 600_000,
    })
    .toBe(true);
  await expect
    .poll(async () => lastEvent(await readHooks(page), 'recovered')?.totalSteps ?? -1, {
      timeout: 900_000,
    })
    .toBeGreaterThan(0);
  h = await readHooks(page);
  const recovered = lastEvent(h, 'recovered')!;
  await expect
    .poll(async () => lastEvent(await readHooks(page), 'sample')?.totalSteps ?? -1, {
      timeout: 600_000,
    })
    .toBeGreaterThan(recovered.totalSteps);

  // Put the solver page behind a second tab. Chromium under remote automation deliberately
  // keeps every target's Page Visibility state at `visible`, even in a normal headed window.
  // Inject the standard hidden-state getters + visibilitychange event that the application
  // receives in a real tab switch, while also keeping a distinct cover target in front for
  // the whole interval. This exercises checkpoint-on-hide and the worker-owned stepping loop;
  // the artifact names the emulation explicitly rather than claiming native browser telemetry.
  const cover = await page.context().newPage();
  await cover.goto('about:blank');
  await cover.bringToFront();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const backgroundStartedAt = Date.now();
  const backgroundStartStep = lastEvent(await readHooks(page), 'sample')?.totalSteps ?? -1;
  const hiddenAtStart = await page.evaluate(() => document.visibilityState === 'hidden');

  // Checkpoint/recovery is an infrastructure gate, not simulation budget. Give the acceptance
  // computation its complete predeclared 30-minute window after recovery.
  const acceptanceStartedAt = Date.now();
  const acceptanceDeadline = acceptanceStartedAt + ACCEPTANCE_BUDGET_MS;
  const enduranceDeadline = wallStartedAt + ENDURANCE_MS;
  let acceptance:
    | {
        outcome:
          | 'AHMED_CD_PASS'
          | 'AHMED_CD_FAIL'
          | 'AHMED_CONVERGENCE_FAIL'
          | 'AHMED_SOLVER_LIMITATION_FAIL';
        recordedAt: number;
        triggerTConv?: number;
        stopTConv: number;
        cd?: number;
        blockSpread?: number;
        blocks: ReturnType<typeof blockMeans>;
        /** Block length actually used, derived from the run's own sigma/mean. */
        blockTConv?: number;
        /** The variance that set it, so the choice is auditable from the artifact alone. */
        postTriggerSigma?: number;
        postTriggerMean?: number;
        samplesPerTConv?: number;
        error?: string;
      }
    | undefined;
  let backgroundEndedAt: number | undefined;
  let backgroundEndStep = -1;
  let hiddenAtEnd = false;

  while (Date.now() < enduranceDeadline) {
    h = await readHooks(page);
    const error = lastEvent(h, 'error');
    const all = samples(h);
    const final = all.at(-1);

    if (!acceptance) {
      if (error) {
        acceptance = {
          outcome: 'AHMED_SOLVER_LIMITATION_FAIL',
          recordedAt: Date.now(),
          stopTConv: final?.convectiveTimes ?? 0,
          blocks: [],
          error: error.message,
        };
      } else {
        const trigger = all.find((s) => s.converged);
        const post = trigger ? all.filter((s) => s.convectiveTimes > trigger.convectiveTimes) : [];
        // Derived, not declared: the block must be long enough for its mean's standard error
        // to sit under the same 3% gate the contract has always used.  Recomputed each poll
        // as the variance estimate improves, so it is the run that sets it, not a guess made
        // before the run existed.
        const cadence = samplesPerTConv(post);
        const blockTConv = requiredBlockTConv(post, cadence);
        const blocks = blockMeans(post, blockTConv);
        const values = blocks.map((b) => b.mean);
        const postMean =
          post.length > 0 ? post.reduce((a, s) => a + s.cd, 0) / post.length : undefined;
        const postSigma =
          post.length > 1 && postMean !== undefined
            ? Math.sqrt(
                post.reduce((a, s) => a + (s.cd - postMean) * (s.cd - postMean), 0) /
                  (post.length - 1),
              )
            : undefined;
        if (trigger && blocksAgree(values, { minBlocks: MIN_BLOCKS, gate: BLOCK_GATE })) {
          const cd = values.at(-1)!; // the final complete block mean, as declared
          acceptance = {
            outcome: cd >= CD_BAND[0] && cd <= CD_BAND[1] ? 'AHMED_CD_PASS' : 'AHMED_CD_FAIL',
            recordedAt: Date.now(),
            triggerTConv: trigger.convectiveTimes,
            stopTConv: final?.convectiveTimes ?? 0,
            cd,
            blockSpread: relSpread(values.slice(-(MIN_BLOCKS + 1))),
            blocks,
            blockTConv,
            postTriggerSigma: postSigma,
            postTriggerMean: postMean,
            samplesPerTConv: cadence,
          };
        } else if (Date.now() >= acceptanceDeadline) {
          acceptance = {
            outcome: 'AHMED_CONVERGENCE_FAIL',
            recordedAt: Date.now(),
            triggerTConv: trigger?.convectiveTimes,
            stopTConv: final?.convectiveTimes ?? 0,
            blocks,
            blockSpread:
              values.length >= MIN_BLOCKS + 1
                ? relSpread(values.slice(-(MIN_BLOCKS + 1)))
                : undefined,
            blockTConv,
            postTriggerSigma: postSigma,
            postTriggerMean: postMean,
            samplesPerTConv: cadence,
          };
        }
      }
    }

    if (!backgroundEndedAt && Date.now() - backgroundStartedAt >= BACKGROUND_MS) {
      hiddenAtEnd = await page.evaluate(() => document.visibilityState === 'hidden');
      backgroundEndStep = final?.totalSteps ?? -1;
      backgroundEndedAt = Date.now();
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.bringToFront();
      await cover.close();
    }

    if (error) break;
    await page.waitForTimeout(15_000);
  }

  h = await readHooks(page);

  // Aged checkpoint/recovery.  The cycle above runs within seconds of start -- the
  // 2026-08-10 run recovered from step 726 of 3,338,390 -- which proves the plumbing works
  // on a fresh field and nothing about a field that has been running for hours.  Repeat it
  // here, on the aged state, so criterion 4 covers what it claims to cover.  Failures are
  // recorded rather than thrown: an aged-recovery failure is a real finding, not a reason to
  // discard the acceptance evidence the run already produced.
  const agedStartStep = lastEvent(h, 'sample')?.totalSteps ?? -1;
  let agedResilience:
    | {
        attempted: boolean;
        startStep: number;
        checkpoint?: Extract<AhmedWorkerEvent, { type: 'checkpoint-saved' }>;
        recovered?: Extract<AhmedWorkerEvent, { type: 'recovered' }>;
        advancedAfterRecovery?: boolean;
        error?: string;
      }
    | undefined;
  if (!lastEvent(h, 'error') && (await page.getByTestId('ahmed-ckpt').isEnabled())) {
    const before = lastEvent(h, 'checkpoint-saved')?.savedAt ?? 0;
    const recoveriesBefore = lastEvent(h, 'recovered')?.recoveries ?? 0;
    try {
      await page.getByTestId('ahmed-ckpt').click();
      await expect
        .poll(async () => lastEvent(await readHooks(page), 'checkpoint-saved')?.savedAt ?? 0, {
          timeout: 900_000,
        })
        .toBeGreaterThan(before);
      await page.getByTestId('ahmed-chaos').click();
      await expect
        .poll(async () => lastEvent(await readHooks(page), 'recovered')?.recoveries ?? 0, {
          timeout: 900_000,
        })
        .toBeGreaterThan(recoveriesBefore);
      const agedRecovered = lastEvent(await readHooks(page), 'recovered')!;
      await expect
        .poll(async () => lastEvent(await readHooks(page), 'sample')?.totalSteps ?? -1, {
          timeout: 600_000,
        })
        .toBeGreaterThan(agedRecovered.totalSteps);
      h = await readHooks(page);
      agedResilience = {
        attempted: true,
        startStep: agedStartStep,
        checkpoint: lastEvent(h, 'checkpoint-saved'),
        recovered: agedRecovered,
        advancedAfterRecovery: true,
      };
    } catch (cause) {
      h = await readHooks(page);
      agedResilience = {
        attempted: true,
        startStep: agedStartStep,
        checkpoint: lastEvent(h, 'checkpoint-saved'),
        recovered: lastEvent(h, 'recovered'),
        advancedAfterRecovery: false,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  } else {
    agedResilience = { attempted: false, startStep: agedStartStep };
  }

  h = await readHooks(page);
  if (!acceptance) {
    const all = samples(h);
    const final = all.at(-1);
    acceptance = {
      outcome: 'AHMED_CONVERGENCE_FAIL',
      recordedAt: Date.now(),
      stopTConv: final?.convectiveTimes ?? 0,
      blocks: [],
    };
  }

  const runningButton = page.getByTestId('ahmed-stop');
  if (await runningButton.isEnabled()) {
    await runningButton.click();
    await expect
      .poll(async () => events(await readHooks(page)).some((e) => e.type === 'stopped'), {
        timeout: 600_000,
      })
      .toBe(true);
  }

  h = await readHooks(page);
  let diagnostics: AhmedDiagnostics | undefined;
  if (!lastEvent(h, 'error')) {
    await page.getByTestId('ahmed-diag').click();
    await expect
      .poll(async () => lastEvent(await readHooks(page), 'diagnostics') !== undefined, {
        timeout: 900_000,
      })
      .toBe(true);
    h = await readHooks(page);
    diagnostics = lastEvent(h, 'diagnostics')?.diagnostics;
  }

  // The tau_eff / approach-strain readback, on the same stopped field as the diagnostics.
  // Without it there is no way to say whether this run's Cd may be quoted against its nominal
  // Re at all (private b2b7fd9), and no way to test whether the subgrid model is responding to
  // resolved strain or to grid-scale content.  The first closure run omitted it.
  const tauStartedAt = Date.now();
  let tau: AhmedTauReport | undefined;
  if (!lastEvent(h, 'error')) {
    await page.getByTestId('ahmed-tau').click({ timeout: 30_000 });
    await expect
      .poll(async () => lastEvent(await readHooks(page), 'tau') !== undefined, {
        timeout: 1_800_000,
        intervals: [5_000],
      })
      .toBe(true);
    h = await readHooks(page);
    tau = lastEvent(h, 'tau')?.tau;
  }
  const tauMs = Date.now() - tauStartedAt;

  const all = samples(h);
  const final = all.at(-1);
  const postRecovery = all.filter((s) => s.totalSteps >= recovered.totalSteps);
  const monotonicAfterRecovery = postRecovery.every(
    (sample, i) => i === 0 || sample.totalSteps > postRecovery[i - 1].totalSteps,
  );
  /**
   * V11's qualitative criterion asks for a slant separation bubble and a counter-rotating
   * C-pillar pair.  `slantReverseFraction > 0 && gammaLeft*gammaRight < 0` does not test that:
   * any turbulent field has some reverse flow somewhere and some left/right sign difference,
   * which is how the 2026-08-10 run reported TOPOLOGY_PASS while measuring a recirculation
   * length of exactly zero.
   *
   * A separation BUBBLE has a measurable streamwise extent, and the Ahmed base recirculation
   * occupies a substantial share of the near-wake rather than a few percent of it.  Both
   * thresholds below are deliberately weak -- they only exclude "no bubble was resolved at
   * all", which is the case the old gate could not see.  Anything present but under them is
   * TOPOLOGY_RECORDED: the features are there, the field does not resolve them well enough to
   * call the criterion met.  The full wake numbers are recorded either way.
   */
  const MIN_RECIRC_LENGTH_CELLS = 1;
  const MIN_BASE_REVERSE_FRACTION = 0.15;
  const topology = diagnostics
    ? (() => {
        const w = diagnostics.wake;
        const slantSeparationObserved = w.slantReverseFraction > 0;
        const counterRotatingCPillarPairObserved = w.gammaLeft * w.gammaRight < 0;
        const bubbleResolved =
          w.recircLengthCells >= MIN_RECIRC_LENGTH_CELLS &&
          w.baseReverseFraction >= MIN_BASE_REVERSE_FRACTION;
        return {
          slantSeparationObserved,
          counterRotatingCPillarPairObserved,
          bubbleResolved,
          minRecircLengthCells: MIN_RECIRC_LENGTH_CELLS,
          minBaseReverseFraction: MIN_BASE_REVERSE_FRACTION,
          classification:
            !slantSeparationObserved || !counterRotatingCPillarPairObserved
              ? ('TOPOLOGY_FAIL' as const)
              : bubbleResolved
                ? ('TOPOLOGY_PASS' as const)
                : ('TOPOLOGY_RECORDED' as const),
          wake: w,
        };
      })()
    : { classification: 'TOPOLOGY_FAIL' as const };

  const artifact = {
    artifactSchema: 'aeroflow-m9-hard-closure-v1',
    frozenConfiguration: {
      collision: 'D3Q19 TRT',
      equilibrium: 'quadratic',
      regularization: 'projected second-order',
      conserveMass: true,
      lesCs: 0.1,
      precision: 'fp16',
      forceOwnership: 'BodySolid only',
      forceSampling: 'two consecutive steps',
      convergence:
        `${MIN_BLOCKS}+1 complete blocks; previous/current/union <= ${BLOCK_GATE}. ` +
        `Block length derived from the run's own sigma/mean so the block SE sits under the ` +
        `gate, clamped to [${BLOCK_TCONV_MIN}, ${BLOCK_TCONV_MAX}] T_conv ` +
        `(actual: ${acceptance?.blockTConv ?? 'n/a'}).`,
      acceptanceBudgetMs: ACCEPTANCE_BUDGET_MS,
      acceptanceStartedAt,
      requestedCells: TARGET_CELLS,
      // Reported from what the worker actually BUILT, never from what this file expects.
      lateralBC: scene.lateralBC,
      inletBC: scene.inletBC,
      outlet: scene.outlet,
      ground: 'no-slip halfway bounce-back',
    },
    gpu: ready.gpu,
    scene,
    acceptance,
    acceptanceBand: CD_BAND,
    topology,
    resilience: {
      wallStartedAt,
      endedAt: Date.now(),
      elapsedMs: Date.now() - wallStartedAt,
      checkpoint,
      recovered,
      // The early cycle proves the plumbing; the aged one proves it on a multi-hour field.
      aged: agedResilience,
      postRecoveryFinalStep: final?.totalSteps,
      monotonicAfterRecovery,
      backgroundStartedAt,
      backgroundEndedAt,
      backgroundMs: backgroundEndedAt ? backgroundEndedAt - backgroundStartedAt : 0,
      hiddenAtStart,
      hiddenAtEnd,
      backgroundStartStep,
      backgroundEndStep,
      advancedWhileBackgrounded: backgroundEndStep > backgroundStartStep,
      visibilityMethod:
        'cover target foreground + standard hidden/visibilitychange emulation (Chromium automation reports every target visible)',
    },
    finalSample: final,
    diagnostics,
    tau,
    tauMs,
    eventCounts: Object.fromEntries(
      [...new Set(events(h).map((e) => e.type))].map((type) => [
        type,
        events(h).filter((e) => e.type === type).length,
      ]),
    ),
  };

  writeFileSync(resolve(OUT_DIR, 'm9-final-acceptance.json'), JSON.stringify(artifact, null, 1));
  writeFileSync(
    resolve(OUT_DIR, 'm9-final-samples.json'),
    JSON.stringify({ samples: all }, null, 1),
  );
  const screenshot = await page.screenshot({ fullPage: true });
  writeFileSync(resolve(OUT_DIR, 'm9-final-panel.png'), screenshot);
  await testInfo.attach('m9-final-acceptance', {
    body: JSON.stringify(artifact, null, 1),
    contentType: 'application/json',
  });
  await testInfo.attach('m9-final-panel', { body: screenshot, contentType: 'image/png' });

  console.log(`\nM9 FINAL ACCEPTANCE\n${JSON.stringify(artifact, null, 1)}\n`);

  expect(hiddenAtStart, 'solver tab was not hidden behind the cover tab').toBe(true);
  expect(hiddenAtEnd, 'solver tab did not remain hidden for the full background window').toBe(true);
  expect(backgroundEndedAt! - backgroundStartedAt).toBeGreaterThanOrEqual(BACKGROUND_MS);
  expect(backgroundEndStep).toBeGreaterThan(backgroundStartStep);
  expect(checkpoint.totalSteps).toBeGreaterThan(0);
  expect(recovered.totalSteps).toBeGreaterThan(0);
  expect(monotonicAfterRecovery).toBe(true);
  expect(Date.now() - wallStartedAt).toBeGreaterThanOrEqual(ENDURANCE_MS);
  expect(diagnostics?.field.nonFiniteCells ?? 1).toBe(0);
  expect(lastEvent(h, 'error')).toBeUndefined();
});
