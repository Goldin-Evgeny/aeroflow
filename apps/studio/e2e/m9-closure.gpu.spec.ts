import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AHMED_CD_BAND,
  auditRunProgress,
  blockMeans,
  blocksAgree,
  relSpread,
  requiredBlockLength,
  samplesPerUnitTime,
  type Block,
  type RunProgressEvent,
  type TimeSample,
} from '@aeroflow/core';
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
 *  - the declared independent-block rule, with the block sized to resolve its own gate;
 *  - the four-hour/background/device-loss acceptance on that same run; and
 *  - wake diagnostics AND the tau_eff / approach-strain readback from the final field.
 *
 * Cd and topology are recorded outcomes, not assertions.  A scientifically valid failure is
 * an M9 disposition.  Infrastructure invariants remain assertions because a harness failure
 * is not an Ahmed result.
 *
 * Five defects in the 2026-08-10 first run are fixed here.  Every one of them made the
 * harness report something other than what the solver did; none moves a physics tolerance.
 * The band stays [0.242, 0.328] and the block spread gate stays 3%.
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
 *
 * 4. ACCEPTANCE TERMINAL.  The 30-minute product budget was also used as the acceptance
 *    terminal, and the two are incompatible for this signal -- see PRODUCT_BUDGET_MS below.
 *    They are separated: the product budget is recorded as an observation, the acceptance
 *    terminal uses the endurance window less a readback reserve.
 *
 * 5. AGED RESILIENCE, and its ordering.  The checkpoint/loss/recovery cycle ran at step 726
 *    of 3,338,390 -- a field seconds old.  It now also runs on the aged field.  Because that
 *    cycle destroys the device on purpose and must precede the readbacks (which need a
 *    stopped run), the readback guards key off whether an error existed BEFORE it, so an
 *    error it provoked cannot suppress the tau snapshot this re-run exists to collect.
 */
const TARGET_CELLS = 15_700_000;
/**
 * The 30-minute figure is a PRODUCT budget — what a user waiting on the page would have —
 * and it is recorded as an observation, not used as the acceptance terminal.
 *
 * Replaying the 2026-08-10 samples through the corrected block rule shows why the two cannot
 * be the same number.  That run's live trigger opened at 184.88 T_conv, nine T_conv after the
 * 30-minute terminal expired at 176.07 — which is the entire reason it was recorded as having
 * no trigger.  Completing the four-plus blocks the contract requires, at the derived
 * 202-T_conv block length and ~10.4 s per T_conv, needs about three hours.  A 30-minute
 * acceptance terminal therefore cannot produce a verdict for this signal no matter what the
 * solver does, and its expiry says nothing about the flow.
 *
 * No physics tolerance moves here: the band and the 3% spread gate are untouched, and the
 * result this unblocks is still a FAIL (0.888 against [0.242, 0.328]).  What changes is that
 * the failure becomes a statement about the drag instead of a statement about the clock.
 */
const PRODUCT_BUDGET_MS = 30 * 60_000;
const ENDURANCE_MS = 4 * 60 * 60_000;
/** Reserve at the end of the endurance window for the aged-resilience cycle and readbacks. */
const READBACK_RESERVE_MS = 25 * 60_000;
const ACCEPTANCE_BUDGET_MS = ENDURANCE_MS - READBACK_RESERVE_MS;
const BACKGROUND_MS = 60 * 60_000;
const MIN_BLOCKS = 4;
const BLOCK_GATE = 0.03;
/** Single source: @aeroflow/core validation ledger, case V11. */
const CD_BAND = AHMED_CD_BAND;

/**
 * Block length floor/ceiling, passed to the centralized `requiredBlockLength` (`@aeroflow/core`).
 * The floor is the originally declared 20 T_conv, so a signal quiet enough for it is judged
 * exactly as before.  The ceiling keeps a pathologically noisy run from demanding a block the
 * budget can never fill -- it fails on the budget instead, which is the honest outcome.
 */
const BLOCK_TCONV_MIN = 20;
const BLOCK_TCONV_MAX = 400;

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

/**
 * Adapt this harness's `Sample` (convectiveTimes/cd) to the generic `TimeSample` (t/value)
 * `blockMeans`/`requiredBlockLength`/`samplesPerUnitTime` take. Block-mean statistics and
 * their tests live in `@aeroflow/core` (analysis/blockConvergence.ts) so the predicate that
 * decides "this run is
 * converged" is unit-tested and shared, rather than reimplemented per harness.
 */
const toTimeSamples = (post: Sample[]): TimeSample[] =>
  post.map((s) => ({ t: s.convectiveTimes, value: s.cd }));

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
        blocks: Block[];
        /** Trailing samples that didn't fill a complete block — dropped, not compared as full. */
        droppedSamples?: number;
        /** Block length actually used, derived from the run's own sigma/mean. */
        blockTConv?: number;
        /** The variance that set it, so the choice is auditable from the artifact alone. */
        postTriggerSigma?: number;
        postTriggerMean?: number;
        samplesPerTConv?: number;
        error?: string;
      }
    | undefined;
  /**
   * What a user watching the page would have had when the 30-minute product budget elapsed.
   * Recorded as an observation about the product, never as an acceptance verdict.
   */
  let productBudgetSnapshot:
    { tConv: number; totalSteps: number; meanCd: number; converged: boolean } | undefined;
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
        const ts = toTimeSamples(post);
        const cadence = samplesPerUnitTime(ts);
        const blockTConv = requiredBlockLength(ts, cadence, {
          gate: BLOCK_GATE,
          min: BLOCK_TCONV_MIN,
          max: BLOCK_TCONV_MAX,
        });
        const { blocks, droppedSamples } = blockMeans(ts, blockTConv);
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
            droppedSamples,
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
            droppedSamples,
            blockTConv,
            postTriggerSigma: postSigma,
            postTriggerMean: postMean,
            samplesPerTConv: cadence,
          };
        }
      }
    }

    if (!productBudgetSnapshot && Date.now() - acceptanceStartedAt >= PRODUCT_BUDGET_MS && final) {
      productBudgetSnapshot = {
        tConv: final.convectiveTimes,
        totalSteps: final.totalSteps,
        meanCd: final.meanCd,
        converged: final.converged,
      };
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
  //
  // This cycle deliberately destroys the GPU device, and it runs BEFORE the diagnostics and
  // tau readbacks because those need a stopped field and stopping ends the run.  So the
  // readback guards below key off whether an error existed BEFORE this cycle: an error the
  // aged cycle itself provoked must not suppress the tau snapshot, which is the measurement
  // this whole re-run exists to collect.
  const erroredBeforeAged = lastEvent(h, 'error') !== undefined;
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
  if (!erroredBeforeAged && (await page.getByTestId('ahmed-ckpt').isEnabled())) {
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
  let diagnosticsError: string | undefined;
  if (!erroredBeforeAged) {
    try {
      await page.getByTestId('ahmed-diag').click({ timeout: 30_000 });
      await expect
        .poll(async () => lastEvent(await readHooks(page), 'diagnostics') !== undefined, {
          timeout: 900_000,
        })
        .toBe(true);
      h = await readHooks(page);
      diagnostics = lastEvent(h, 'diagnostics')?.diagnostics;
    } catch (cause) {
      diagnosticsError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  // The tau_eff / approach-strain readback, on the same stopped field as the diagnostics.
  // Without it there is no way to say whether this run's Cd may be quoted against its nominal
  // Re at all (private b2b7fd9), and no way to test whether the subgrid model is responding to
  // resolved strain or to grid-scale content.  The first closure run omitted it.
  const tauStartedAt = Date.now();
  let tau: AhmedTauReport | undefined;
  let tauError: string | undefined;
  if (!erroredBeforeAged) {
    try {
      await page.getByTestId('ahmed-tau').click({ timeout: 30_000 });
      await expect
        .poll(async () => lastEvent(await readHooks(page), 'tau') !== undefined, {
          timeout: 1_800_000,
          intervals: [5_000],
        })
        .toBe(true);
      h = await readHooks(page);
      tau = lastEvent(h, 'tau')?.tau;
    } catch (cause) {
      tauError = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const tauMs = Date.now() - tauStartedAt;

  const all = samples(h);
  const final = all.at(-1);
  /**
   * Resilience audit (task 9.4 / design.md D8).  This replaced a global strict-monotonicity
   * assertion over every sample whose step value exceeded the FIRST recovery's step.  That
   * check was wrong twice over: it filtered by step VALUE where the intent was emission
   * POSITION, and the window it spanned contained both device-loss cycles this test induces
   * ON PURPOSE -- and restoring a checkpoint rewinds the step counter by construction, so the
   * steps between the checkpoint and the loss are replayed and their values emitted twice.
   * It failed flakily, only when a sample happened to land in the sub-second gap between the
   * checkpoint and the induced loss, which is why 2026-08-11 passed and 2026-08-14 failed on
   * identical code and reported INFRA=AMBER against a sound physics result.
   *
   * `auditRunProgress` states what is actually claimed: forward progress within each stretch
   * of uninterrupted running, every restore lossless, and every restore followed by real
   * progress.  The losslessness leg is an invariant the old assertion never expressed.
   *
   * Partitioning is positional, so the stream is walked in emission order and each `recovered`
   * event is paired with the most recent `checkpoint-saved` before it -- the checkpoint it
   * necessarily restored from.
   */
  let lastCheckpointStep = Number.NaN;
  const progressEvents: RunProgressEvent[] = [];
  for (const event of events(h)) {
    if (event.type === 'checkpoint-saved') lastCheckpointStep = event.totalSteps;
    else if (event.type === 'recovered') {
      progressEvents.push({
        kind: 'restore',
        restoredStep: event.totalSteps,
        checkpointStep: lastCheckpointStep,
      });
    } else if (event.type === 'sample') {
      progressEvents.push({ kind: 'progress', step: event.totalSteps });
    }
  }
  const progressAudit = auditRunProgress(progressEvents);
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
      // H13's correction is quantized away by the very next f16 store (docs/WGSL-NOTES.md
      // #23) — this frozen configuration requests conserveMass under fp16 storage, so the
      // correction is NOT actually active. Record both the request and the fact, rather
      // than let `conserveMass: true` alone be read as "the correction held".
      conserveMassEffective: false,
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
      productBudgetMs: PRODUCT_BUDGET_MS,
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
    productBudgetSnapshot,
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
      // Segment-aware; see the audit above.  The old scalar `monotonicAfterRecovery` is
      // deliberately gone rather than kept alongside: it reported a harness defect as a run
      // outcome, and leaving it in the artifact would keep that reading available.
      progressAudit,
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
    diagnosticsError,
    tau,
    tauMs,
    tauError,
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
  // Three legs, asserted separately so a failure names which invariant broke rather than
  // reporting a bare `false` (task 9.4 / design.md D8).
  expect(
    progressAudit.segmentsMonotonic,
    'a run segment reported a step counter that did not advance',
  ).toBe(true);
  expect(progressAudit.allLossless, 'a restore resumed below the checkpoint it restored').toBe(
    true,
  );
  expect(progressAudit.allAdvanced, 'the run did not advance after a restore').toBe(true);
  expect(Date.now() - wallStartedAt).toBeGreaterThanOrEqual(ENDURANCE_MS);
  expect(diagnostics?.field.nonFiniteCells ?? 1).toBe(0);
  // The tau snapshot is the reason this run exists (private b2b7fd9): without it there is no
  // basis for quoting the Cd against its nominal Re, so a run that loses it is a failed run
  // even though its Cd is recorded.  Everything above is already on disk either way.
  expect(tauError, 'tau readback failed').toBeUndefined();
  expect(tau, 'no tau report was captured').toBeDefined();
  // Scoped to errors that predate the deliberate aged device loss — that cycle provokes one
  // on purpose, and its own outcome is recorded in resilience.aged rather than asserted.
  expect(erroredBeforeAged, 'the solver errored during the acceptance window').toBe(false);
});
