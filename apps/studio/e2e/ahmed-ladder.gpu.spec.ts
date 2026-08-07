import { expect, test, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import type { AeroflowHooks } from '../src/dev/testHooks';
import {
  AHMED_LES_CS,
  type AhmedDiagnostics,
  type AhmedSceneSummary,
  type AhmedTauReport,
  type AhmedWorkerEvent,
} from '../src/sim/ahmedRun';
import { blocksAgree, relSpread, type FieldStats } from '@aeroflow/core';

/**
 * M9 acceptance-1 harness: the resolution / effective-Re ladder, plus the two diagnostics
 * that decide what its numbers mean.
 *
 * The ladder itself exists because the only Ahmed Cd on record was ≈7.6 at the 2M smoke
 * tier, attributed to under-resolution — an argument, not a measurement. Running the SAME
 * geometry and force pipeline at Reynolds numbers the grid resolves turned it into one, and
 * falsified the attribution: Cd got *worse* with resolution, and the real cause was the
 * force accounting fixed by `CellType.BodySolid`.
 *
 * Two things are measured alongside Cd now:
 *
 * 1. **Approach flow.** Cd is normalized by the COMMANDED lattice velocity, which only
 *    means something if the flow reaches it — and this scene still uses the plain
 *    equilibrium `Inlet` that M10 measured settling at 0.660·u_in. Each rung reports
 *    whole-section mass-flux and boundary-layer-excluded core velocities at three upstream
 *    stations. `cdCommanded` stays the acceptance coefficient; `cdBulk`/`cdCore` are
 *    diagnostics. Cd ∝ 1/U², so picking the flattering denominator would be exactly the
 *    tolerance-shopping hard rule 3 forbids.
 *
 * 2. **Whether "converged" means anything.** `isConverged(20, 3%)` fires on a running-mean
 *    drift, and the first ladder saw every rung stop at 1.73–2.97% — clustered just under
 *    the gate, with σ≈1.0 against a mean of 4.0. That is how M7's Cd 0.509 was recorded and
 *    later struck ("premature: read off a running mean still climbing"). So the trigger only
 *    OPENS an observation window, and the rung runs until INDEPENDENT block means agree.
 *
 *    **The stop rule (rewritten 2026-08-06).** A rung stops when the last two overlapping
 *    4-block windows both hold within the 3% gate — or when its simulation budget runs out,
 *    which is recorded as `budget` and is NOT convergence. Before this, the rung stopped on a
 *    clock (`trigger + 80 T_conv`, floored at `MIN_TCONV`) and the block verdict was merely
 *    printed afterwards: the first full 8M ladder consequently stopped all three surviving
 *    rungs at ~143 T_conv with spreads of 3.04%, 5.57% and 7.12% — every one above the gate —
 *    while leaving ~82 of each rung's 90 wall-clock minutes unspent. The window is rolling
 *    (not the whole post-trigger series, which its oldest blocks dominate forever) and must
 *    survive one further completed block, so a single lucky window cannot end a rung.
 *
 * 3. **Whole-field stability.** Mass drift, density extrema, Ma and non-finite cells, sampled on
 *    a coarse convective-time cadence. A rung that finishes is not thereby a valid measurement:
 *    with `conserveMass` on and τ₀ = 0.500144, "survived but marginal" is a distinct outcome from
 *    "clean", and nothing measured it until M9 step 7.
 *
 * **M9 step 7 — the Cs sweep.** Rungs now carry a Smagorinsky Cs and a storage precision, so the
 * falsifiable test of the freestream-SGS-activation finding runs through this same harness with
 * everything else held identical. Two consequences for how it behaves:
 *
 *  - A rung at reduced Cs is deliberately run with less than the dissipation this τ₀ is
 *    documented to require, so **divergence is an expected result, not a harness failure.** Rungs
 *    no longer abort the sweep; only baseline-configuration rungs are asserted to survive.
 *  - The end-of-run comparison table is the deliverable. The question is not what any one rung
 *    measured but which quantities moved *together* when Cs changed.
 *
 * Nothing here asserts a Cd band — at any Re but the experimental one there is none, and
 * the page suppresses its verdict for that reason (now also for any off-acceptance Cs or
 * precision, which is what keeps this sweep discrimination rather than calibration).
 */

/**
 * `<cells>@<Re>[@<Cs>[@<precision>]]`. Cs and precision are positional and optional, so every
 * pre-existing rung string keeps its exact meaning and defaults to the acceptance configuration.
 *
 * Cs is parsed with `>= 0` rather than `> 0`: Cs = 0 (LES fully off) is a legitimate rung.
 */
const RUNGS = (process.env.AHMED_RUNGS ?? '8000000@1000')
  .split(',')
  .map((spec) => spec.trim())
  .filter(Boolean)
  .map((spec) => {
    const [cellsRaw, reRaw, csRaw, precRaw] = spec.split('@');
    const cells = Number(cellsRaw);
    const Re = Number(reRaw);
    if (!Number.isFinite(cells) || !Number.isFinite(Re) || cells <= 0 || Re <= 0) {
      throw new Error(`AHMED_RUNGS entry "${spec}" is not <cells>@<Re>[@<Cs>[@<precision>]]`);
    }
    const lesCs = csRaw === undefined || csRaw === '' ? AHMED_LES_CS : Number(csRaw);
    if (!Number.isFinite(lesCs) || lesCs < 0) {
      throw new Error(`AHMED_RUNGS entry "${spec}" has a non-finite or negative Cs`);
    }
    const precision = precRaw === undefined || precRaw === '' ? 'fp16' : precRaw;
    if (precision !== 'fp16' && precision !== 'fp32') {
      throw new Error(`AHMED_RUNGS entry "${spec}" precision must be fp16 or fp32`);
    }
    return { cells, Re, lesCs, precision };
  });

/**
 * Wall-clock ceiling per rung, covering **the simulation only** — from `start` to the moment
 * stepping stops. Diagnostics and the τ_eff oracle run AFTER the physics is done and are
 * budgeted (and reported) separately, because the oracle streams the whole DDF image to the
 * host and gathers 19 directions per cell in scalar JS: at the 8M tier that is minutes. Folding
 * it into this ceiling would let an expensive readback consume — or overrun — a budget that
 * exists to bound how long the flow is allowed to develop, which is a different question.
 */
const RUNG_BUDGET_MS = Number(process.env.AHMED_RUNG_BUDGET_MS ?? 30 * 60_000);
/** Width of each independent block mean, in convective times. */
const BLOCK_TCONV = Number(process.env.AHMED_BLOCK_TCONV ?? 20);
/**
 * Blocks in the agreement window. The stop test needs `MIN_BLOCKS + 1` complete blocks and
 * requires BOTH overlapping windows to pass — see `blocksAgree`.
 */
const MIN_BLOCKS = Number(process.env.AHMED_MIN_BLOCKS ?? 4);
/**
 * The convergence criterion, as a relative block spread. **Never weaken this to make a rung
 * pass** (hard rule 3): a rung that cannot hold 3% is a rung that is not converged, and
 * reporting that is the entire point of the ladder.
 */
const BLOCK_GATE = 0.03;
/**
 * Capture the τ_eff snapshot per rung. On by default — it is the measurement M9 is currently
 * blocked on. `AHMED_TAU=0` skips it when only Cd is wanted, since the oracle streams the
 * whole DDF image to the host and costs minutes at the 8M tier.
 */
const WANT_TAU = process.env.AHMED_TAU !== '0';
/**
 * Common floor on total convective time across every rung, so the τ_eff snapshots are taken
 * at equivalent points in each flow's development.
 *
 * A FLOOR, NOT A STOP CONDITION. It can only delay a stop, never cause one: reaching it does
 * nothing for a rung whose blocks still disagree. (Until 2026-08-06 it *was* a stop condition,
 * and that is why the first full 8M ladder stopped all three surviving rungs at ~143 T_conv
 * with spreads of 3.04%, 5.57% and 7.12% — every one of them above the gate, every one of them
 * reported "DISAGREE", and ~82 of each rung's 90 wall-clock minutes left unspent.)
 */
const MIN_TCONV = Number(process.env.AHMED_MIN_TCONV ?? 0);
/** Stability-snapshot cadence, in convective times, at the acceptance Cs. */
const FIELD_TCONV = Number(process.env.AHMED_FIELD_TCONV ?? 20);
/**
 * Cadence for rungs below the acceptance Cs. Tighter because those runs carry less than the
 * dissipation this τ₀ is documented to need, so the interval between "healthy" and "NaN" can be
 * short — and the snapshot's entire purpose is to be the last record before that.
 */
const REDUCED_CS_FIELD_TCONV = Number(process.env.AHMED_FIELD_TCONV_REDUCED ?? 5);

type Sample = Extract<AhmedWorkerEvent, { type: 'sample' }>;
type Ready = Extract<AhmedWorkerEvent, { type: 'ready' }>;

const events = (h: AeroflowHooks): AhmedWorkerEvent[] =>
  (h.ahmedEvents ?? []) as AhmedWorkerEvent[];
const samples = (h: AeroflowHooks): Sample[] =>
  events(h).filter((e): e is Sample => e.type === 'sample');

/**
 * The stop test, bound to this ladder's configuration. Implementation and rationale live in
 * `@aeroflow/core` (analysis/blockConvergence.ts) so the predicate that decides "this rung is
 * converged" is unit-tested rather than only exercised by multi-hour GPU runs.
 */
const agrees = (blockVals: number[]): boolean =>
  blocksAgree(blockVals, { minBlocks: MIN_BLOCKS, gate: BLOCK_GATE });

/**
 * Why a rung stopped. Recorded per rung and printed, because "settled" and "ran out of clock
 * still disagreeing" produce tables that are otherwise indistinguishable — and conflating them
 * is exactly how M7's Cd 0.509 was recorded and later struck.
 */
type StopReason =
  /** Independent blocks agreed within the gate, twice over. The ONLY converged outcome. */
  | 'agreed'
  /** The simulation budget ran out with the blocks still disagreeing. A result, not an error. */
  | 'budget'
  /** The budget ran out before isConverged ever fired: no post-trigger window was ever opened. */
  | 'budget-no-trigger'
  /** The solver went non-finite. Expected at reduced Cs; see the end-of-test assertion. */
  | 'diverged';

/**
 * Has this rung settled?
 *
 * Judged on a ROLLING window of the most recent `MIN_BLOCKS` complete post-trigger blocks, not
 * on every block since the trigger. Spread over the whole post-trigger series is dominated by
 * its oldest blocks, so a rung that genuinely settles late can never satisfy it — the early
 * disagreement stays in the series forever and the rung would run to its deadline no matter
 * what the flow does.
 *
 * Agreement must then SURVIVE ONE MORE COMPLETED BLOCK: both overlapping windows
 * (`blocks[-5..-2]` and `blocks[-4..-1]`) must pass, which is why five blocks are required.
 * One four-block window passing is a coin that came up heads once — with a wandering mean and
 * a 3% gate, some window will eventually pass by luck, and stopping on it would reproduce the
 * original sin this harness exists to prevent: reading convergence off a statistic that had
 * not converged.
 */
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : '—');

function stopExplanation(reason: StopReason): string {
  switch (reason) {
    case 'agreed':
      return (
        `the last two overlapping ${MIN_BLOCKS}-block windows AND their ${MIN_BLOCKS + 1}-block ` +
        `union all held within the ${(BLOCK_GATE * 100).toFixed(0)}% gate. This rung is CONVERGED`
      );
    case 'budget':
      return (
        'the simulation budget was exhausted with the agreement test unsatisfied — the blocks ' +
        'still disagreed, or they agreed but the MIN_TCONV comparability floor was not yet ' +
        'reached (the per-rung windows above say which). NOT converged either way, and no ' +
        'figure taken from this rung may be quoted as one'
      );
    case 'budget-no-trigger':
      return (
        'the simulation budget was exhausted before isConverged ever fired, so no observation ' +
        'window was ever opened. NOT converged, and weaker evidence than "budget"'
      );
    case 'diverged':
      return 'the solver went non-finite';
  }
}

function sceneLine(scene: AhmedSceneSummary): string {
  return (
    `grid ${scene.nx}×${scene.ny}×${scene.nz} = ${(scene.totalCells / 1e6).toFixed(2)}M   ` +
    `dx ${scene.dxMm.toFixed(2)} mm   body ${scene.lengthCells.toFixed(0)} cells   ` +
    `blockage ${(scene.blockage * 100).toFixed(2)}%   frontal ${scene.frontalCells} cells²   ` +
    `Re ${scene.Re.toExponential(2)}   τ ${scene.tau.toFixed(6)}   ` +
    // Cs and precision are on the SCENE line, not buried in the τ block, because they are
    // configuration — every number below is conditional on them and a row without them is
    // uninterpretable.
    `Cs ${scene.lesCs}   ${scene.precision}   ` +
    `T_conv ${scene.convectiveTimeSteps} steps   noseX ${scene.noseX}   U ${scene.physU.toFixed(1)} m/s`
  );
}

/** One line of whole-field health — the "did this rung stay clean?" evidence. */
function fieldLine(f: FieldStats, label: string): string {
  return (
    `  ${label}: mass drift ${f.massDriftRel.toExponential(3)}   ` +
    `ρ [${f.rhoMin.toFixed(6)}, ${f.rhoMax.toFixed(6)}]   ρ̄ ${f.rhoMean.toFixed(6)}   ` +
    `u_max ${f.uMax.toFixed(5)}   Ma_max ${f.machMax.toFixed(4)}   ` +
    `non-finite ${f.nonFiniteCells}   fluid ${f.fluidCells.toLocaleString()}`
  );
}

/**
 * Independent (non-overlapping) block means of the INSTANTANEOUS Cd, over samples taken
 * after the first convergence trigger. Independent blocks are the point: a running mean
 * cannot disagree with itself, but consecutive block means can, and that disagreement is
 * the honest statistical error bar.
 */
function blockMeans(
  post: Sample[],
  blockTConv: number,
): { blocks: { t0: number; t1: number; mean: number; n: number }[]; droppedSamples: number } {
  if (post.length === 0) return { blocks: [], droppedSamples: 0 };
  const blocks: { t0: number; t1: number; mean: number; n: number }[] = [];
  let start = post[0].convectiveTimes;
  let sum = 0;
  let n = 0;
  let last = start;
  for (const s of post) {
    if (s.convectiveTimes - start >= blockTConv && n > 0) {
      blocks.push({ t0: start, t1: last, mean: sum / n, n });
      start = s.convectiveTimes;
      sum = 0;
      n = 0;
    }
    sum += s.cd;
    n++;
    last = s.convectiveTimes;
  }
  // The trailing remainder is NOT a block: it spans less than blockTConv, so its mean has
  // a different (larger) sampling error and comparing it against full blocks manufactures
  // spread. Measured: a 2-T_conv / n=13 tail turned a genuine 2.43% into a reported
  // 14.52%, i.e. it inverted the verdict. Dropped, and its size is reported so the drop is
  // visible rather than silent.
  return { blocks, droppedSamples: n };
}

function diagnosticsLines(d: AhmedDiagnostics): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `  approach flow (u_commanded ${d.uCommanded}):`,
    ...d.stations.map(
      (s) =>
        `    x=${String(s.x).padStart(4)}  (+${s.cellsFromInlet} from inlet, −${s.cellsToNose} to nose)  ` +
        `bulk ${s.bulkUx.toFixed(5)} (${pct(s.bulkUx / d.uCommanded)} of cmd)  ` +
        `core ${s.coreMeanUx.toFixed(5)} (${pct(s.coreMeanUx / d.uCommanded)})  ` +
        `area ${s.areaMeanUx.toFixed(5)}  ρ̄ ${s.meanRho.toFixed(5)}  ` +
        `flux ${s.massFlux.toExponential(3)}  nonunif ${s.nonUniformity.toFixed(3)}  ` +
        `δ99 y=${s.yCore} (${s.blThicknessCells} cells)`,
    ),
    `  Cd_commanded ${d.cdCommanded.toFixed(4)}  [ACCEPTANCE]   ` +
      `Cd_bulk ${d.cdBulk.toFixed(4)}   Cd_core ${d.cdCore.toFixed(4)}   (diagnostic only)`,
    `  Re_nominal ${d.reNominal.toExponential(2)}   Re_bulk ${d.reBulk.toExponential(2)}   ` +
      `Re_core ${d.reCore.toExponential(2)}   ref station x=${d.referenceStationX}`,
  ];
  return lines.join('\n');
}

/**
 * The τ_eff block. This is the measurement that decides whether the nominal Reynolds number
 * still controls the physics, so it prints more than min/mean/max:
 *
 *  - full percentiles and the maximum, per region;
 *  - the fraction of cells at the τ₀ floor (τ_t ≥ 0, so τ₀ IS the floor — there is no clamp);
 *  - ν_LES/ν_mol percentiles, which is the ratio that actually matters: ν_mol falls 10× from
 *    Re 1e4 to Re 1e5, so the same eddy viscosity is 10× more dominant at the higher Re;
 *  - per-y-layer profiles at the same three stations as the δ99 velocity profiles, because
 *    δ99 growing 6 → 43 cells across that step is backwards for a physical boundary layer and
 *    only a layer-by-layer ν_LES can say whether the model is doing the thickening.
 */
function tauLines(t: AhmedTauReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `  τ_eff @ ${t.convectiveTimes.toFixed(1)} T_conv  τ₀ ${t.tau0.toFixed(6)}  ` +
      `ν_mol ${t.nuMolecular.toExponential(3)}  lesK ${t.lesK.toFixed(4)}  parity ${t.parity}  ` +
      `fluid ${t.fluidCells.toLocaleString()}  skipped(freeSlip) ${t.freeSlipAdjacentSkipped.toLocaleString()}` +
      (t.nonFinite ? `  *** NON-FINITE ${t.nonFinite} — SNAPSHOT INVALID ***` : ''),
    `    ${'region'.padEnd(30)} ${'n'.padStart(9)}  ` +
      `${'τ p50'.padStart(9)} ${'τ p99'.padStart(9)} ${'τ max'.padStart(9)}  ` +
      `${'ν p50'.padStart(8)} ${'ν p90'.padStart(8)} ${'ν p99'.padStart(8)} ${'ν max'.padStart(9)}  ` +
      `${'floor'.padStart(7)} ${'dom'.padStart(7)} ${'ovwhlm'.padStart(7)}`,
    ...t.regions.map((r) => {
      const s = r.stats;
      return (
        `    ${r.name.padEnd(30)} ${String(s.cells).padStart(9)}  ` +
        `${s.tauPercentiles[3].toFixed(6).padStart(9)} ${s.tauPercentiles[7].toFixed(6).padStart(9)} ` +
        `${s.tauMax.toFixed(6).padStart(9)}  ` +
        `${s.nuRatioPercentiles[3].toFixed(2).padStart(8)} ${s.nuRatioPercentiles[5].toFixed(2).padStart(8)} ` +
        `${s.nuRatioPercentiles[7].toFixed(2).padStart(8)} ${s.nuRatioMax.toFixed(1).padStart(9)}  ` +
        `${pct(s.atFloorFraction).padStart(7)} ${pct(s.lesDominantFraction).padStart(7)} ` +
        `${pct(s.lesOverwhelmingFraction).padStart(7)}`
      );
    }),
    ...t.layers.flatMap((l) => [
      `    y-layers at x=${l.x} (ν_LES/ν_mol per ground-parallel layer):`,
      ...l.layers
        // Every 4th layer near the ground, then coarser — the full 64-layer dump is noise.
        .filter((y) => y.y < 16 || y.y % 4 === 0)
        .map(
          (y) =>
            `      y=${String(y.y).padStart(3)}  n=${String(y.cells).padStart(5)}  ` +
            `τ̄ ${Number.isNaN(y.tauMean) ? '     —   ' : y.tauMean.toFixed(6)}  ` +
            `τmax ${Number.isNaN(y.tauMax) ? '     —   ' : y.tauMax.toFixed(6)}  ` +
            `ν_LES/ν_mol ${Number.isNaN(y.nuRatioMean) ? '  —  ' : y.nuRatioMean.toFixed(2)}`,
        ),
    ]),
  ];
  return lines.join('\n');
}

/**
 * Cross-rung comparison. The per-rung blocks above are complete but unreadable side by side,
 * and this experiment IS a side-by-side: the question is not what any rung measured but which
 * quantities moved TOGETHER when Cs changed.
 *
 * Deliberately reports Cd as its block means and spread rather than as a single mean. With the
 * Re 1e5 blocks already spreading 5.57%, a lone number would invite reading a Cs delta smaller
 * than the run-to-run scatter as a real effect.
 */
function comparisonTable(
  rows: {
    rung: { cells: number; Re: number; lesCs: number; precision: string };
    errored: boolean;
    lastTConv: number;
    blocks: number[];
    spread: number;
    allBlocks: number[];
    allSpread: number;
    triggerTConv?: number;
    stopReason: StopReason;
    simMs: number;
    diagMs: number;
    tauMs: number;
    diagnostics?: AhmedDiagnostics;
    tau?: AhmedTauReport;
    lastField?: FieldStats;
  }[],
): string {
  const region = (t: AhmedTauReport | undefined, name: string): string => {
    const r = t?.regions.find((x) => x.name === name);
    return r ? r.stats.nuRatioPercentiles[3].toFixed(2) : '—';
  };
  const num = (x: number | undefined, digits: number): string =>
    x === undefined || Number.isNaN(x) ? '—' : x.toFixed(digits);

  const header =
    `${'Cs'.padStart(5)} ${'prec'.padStart(5)} ${'T_conv'.padStart(7)} ${'trig'.padStart(6)} ` +
    `${'stop'.padStart(17)} ${'sim min'.padStart(7)}  ` +
    `${`ALL complete ${BLOCK_TCONV}-T_conv Cd block means`.padEnd(46)} ` +
    `${'range(all)'.padStart(10)} ${'blocks?'.padStart(8)}  ` +
    `${'δ99'.padStart(5)} ${'ν appr'.padStart(7)} ${'ν whole'.padStart(8)} ${'ν body'.padStart(7)} ` +
    `${'dom%'.padStart(6)} ${'τ p50'.padStart(9)}  ` +
    `${'massdrift'.padStart(10)} ${'ρ min'.padStart(9)} ${'ρ max'.padStart(9)} ${'Ma'.padStart(6)} ${'NaN'.padStart(5)}`;

  const lines = rows.map((r) => {
    const whole = r.tau?.regions.find((x) => x.name === 'whole domain');
    const ref = r.diagnostics?.stations.at(-1);
    // Settled-field stats when the rung finished; the last periodic snapshot when it did not
    // (a diverged rung has no settled field to reduce).
    const f = r.diagnostics?.field ?? r.lastField;
    const blocks = r.allBlocks.length > 0 ? r.allBlocks.map((b) => b.toFixed(4)).join(' ') : '—';
    // "blocks?" is the stop test itself: both trailing windows within the gate. It agrees with
    // the "stop" column by construction on a converged rung — that is the point, not redundancy.
    const blocksVerdict =
      r.blocks.length < MIN_BLOCKS + 1 ? 'no data' : agrees(r.blocks) ? 'agree' : 'DISAGREE';
    return (
      `${String(r.rung.lesCs).padStart(5)} ${r.rung.precision.padStart(5)} ` +
      `${num(r.lastTConv, 1).padStart(7)} ${num(r.triggerTConv, 1).padStart(6)} ` +
      `${r.stopReason.padStart(17)} ${(r.simMs / 60_000).toFixed(1).padStart(7)}  ` +
      `${blocks.padEnd(46)} ` +
      `${(Number.isFinite(r.allSpread) ? `${(r.allSpread * 100).toFixed(2)}%` : '—').padStart(10)} ` +
      `${blocksVerdict.padStart(8)}  ` +
      `${(ref ? String(ref.blThicknessCells) : '—').padStart(5)} ` +
      `${region(r.tau, 'approach freestream').padStart(7)} ` +
      `${region(r.tau, 'whole domain').padStart(8)} ` +
      `${region(r.tau, 'around body').padStart(7)} ` +
      `${(whole ? `${(whole.stats.lesDominantFraction * 100).toFixed(1)}%` : '—').padStart(6)} ` +
      `${(r.tau ? r.tau.regions[0].stats.tauPercentiles[3].toFixed(6) : '—').padStart(9)}  ` +
      `${(f ? f.massDriftRel.toExponential(2) : '—').padStart(10)} ` +
      `${(f ? f.rhoMin.toFixed(6) : '—').padStart(9)} ` +
      `${(f ? f.rhoMax.toFixed(6) : '—').padStart(9)} ` +
      `${(f ? f.machMax.toFixed(4) : '—').padStart(6)} ` +
      `${(f ? String(f.nonFiniteCells) : '—').padStart(5)}` +
      (r.errored ? '   *** DIVERGED ***' : '')
    );
  });

  return [
    '## Cross-rung comparison (M9 step 7 — Cs sensitivity)',
    '',
    'ν columns are ν_LES/ν_mol p50 by region; δ99 is at the reference station (cells);',
    'dom% is the LES-dominant cell fraction over the whole domain; stability from the settled',
    'final field, or from the last in-run snapshot for a rung that diverged.',
    '',
    '"trig" is the convective time of the rung\'s first isConverged(20, 3%) trigger, or "—" if',
    'it never fired. The Cd column lists EVERY complete block mean over the whole run.',
    '',
    '  "range(all)" IS NOT A CONVERGENCE FIGURE. It is the range of that whole series, which',
    '  STARTS AT t=0 AND THEREFORE INCLUDES THE STARTUP TRANSIENT — the first block or two',
    '  are taken while the flow is still developing and routinely sit far above the settled',
    '  value, so this number reads tens of percent on a rung whose settled blocks agree to',
    '  ~1%. It is here to show whether Cd WANDERED across the run, which the post-trigger',
    '  tail alone can hide; read it against the block series beside it, never on its own.',
    '',
    '"stop" IS THE COLUMN TO READ FIRST. It is why the rung stopped, and only one value means',
    'converged:',
    '',
    `  agreed             the last two overlapping ${MIN_BLOCKS}-block windows both held within the`,
    `                     ${(BLOCK_GATE * 100).toFixed(0)}% gate. CONVERGED.`,
    '  budget             the simulation ceiling ran out with the blocks still disagreeing.',
    '                     NOT converged. A real result about the criterion — not a harness',
    '                     failure — and no figure from such a rung may be quoted as converged.',
    '  budget-no-trigger  the ceiling ran out before isConverged ever fired; no observation',
    '                     window was ever opened. NOT converged, and weaker than "budget".',
    '  diverged           the solver went non-finite.',
    '',
    '"sim min" is SIMULATION wall-clock only. The diagnostics and τ_eff readbacks run after the',
    'physics has stopped and are reported per rung above, deliberately outside the budget: the',
    'ceiling bounds how long the flow may develop, and an expensive oracle must not eat it.',
    '',
    '"blocks?" is the stop test itself — both trailing windows inside the gate. Note it is NOT',
    'the "range(all)" column, and not the whole post-trigger spread either:',
    '',
    '  NO RUNG IS CONVERGED UNLESS ITS OWN INDEPENDENT BLOCKS SAY SO. The common T_conv floor',
    '  every rung is held to exists to make the snapshots COMPARABLE — same point in each',
    "  flow's development, same masks. It is a FLOOR, NOT A STOP CONDITION: it can delay a",
    "  stop, never cause one, and reaching it is not evidence about any rung's convergence.",
    '  `isConverged` reads a running-mean drift that decays as 1/N whether or not the mean is',
    '  moving, so its trigger firing is not evidence either — the trigger only opens the',
    '  observation window. Agreement of independent blocks is the only evidence that counts.',
    '',
    header,
    '-'.repeat(header.length),
    ...lines,
    '',
    'READ THIS AS MECHANISM DISCRIMINATION, NOT CALIBRATION. The hypothesis under test is that',
    'the Re 1e4 → 1e5 Cd step is geometric — the body (31 cells tall) going from clean',
    'freestream into a ground shear layer thickened by subgrid viscosity. It is supported only',
    'if the ν columns, δ99 and Cd move TOGETHER as Cs falls. A Cd that moves while δ99 does not',
    '(or a Cd shift smaller than the block spread beside it) is not support. And a rung whose',
    'mass drift, ρ range or Ma_max degrades is a marginal run, not a data point — no Cs is',
    'selected here for producing a better Cd.',
  ].join('\n');
}

test('M9 acceptance-1 ladder: Cd vs resolution and effective Re', async ({
  gpuPage: page,
}, testInfo) => {
  // THE WHOLE LADDER IS ONE TEST — every rung runs inside this single timeout, so it must cover
  // their SUM, not one rung. Hence the RUNGS.length factor; `test.setTimeout` overrides the
  // project's 30-min default at runtime, so no --timeout is needed on the command line.
  //
  // Per rung: the simulation ceiling, plus the readbacks that deliberately sit OUTSIDE it —
  // 300 s stop-drain + 300 s diagnostics + 900 s τ oracle at the 8M tier — plus boot, page load
  // and the screenshot. 30 min of allowance covers all of it.
  // (6 rungs at a 90-min budget ⇒ 12 h; that is intended for a full sweep.)
  test.setTimeout(RUNGS.length * (RUNG_BUDGET_MS + 1_800_000));

  const rows: string[] = [];
  /** One record per rung, reduced into the comparison table at the end. */
  const table: {
    rung: (typeof RUNGS)[number];
    errored: boolean;
    lastTConv: number;
    blocks: number[];
    spread: number;
    /** Every complete block over the whole run — the cross-rung comparison basis. */
    allBlocks: number[];
    allSpread: number;
    triggerTConv?: number;
    stopReason: StopReason;
    /** Simulation wall-clock (the budgeted part) and the two unbudgeted readbacks. */
    simMs: number;
    diagMs: number;
    tauMs: number;
    diagnostics?: AhmedDiagnostics;
    tau?: AhmedTauReport;
    lastField?: FieldStats;
  }[] = [];

  // The rung loop runs inside try/finally so the summary is emitted even when the sweep fails
  // partway. A multi-hour run that produced three good rungs and then timed out must not
  // discard those three: the data is expensive and the failure is usually in the harness.
  try {
    for (const rung of RUNGS) {
      // Tighter stability cadence wherever the run is below the acceptance dissipation: those
      // rungs are the ones that can go from healthy to NaN quickly, and a coarse cadence would
      // leave the "last healthy" record too far before the failure to show the approach to it.
      const fieldEvery = rung.lesCs < AHMED_LES_CS ? REDUCED_CS_FIELD_TCONV : FIELD_TCONV;
      await page.goto(
        `${BASE_URL}/?ahmed&cells=${rung.cells}&Re=${rung.Re}` +
          `&lesCs=${rung.lesCs}&precision=${rung.precision}&fieldEvery=${fieldEvery}`,
      );
      const startedAt = Date.now();
      await page.getByTestId('ahmed-start').click();

      await expect
        .poll(async () => events(await readHooks(page)).map((e) => e.type), { timeout: 300_000 })
        .toContain('ready');
      const scene = (events(await readHooks(page)).find((e) => e.type === 'ready') as Ready).scene;

      // Every rung must begin from the SAME fresh state, or the comparison is not controlled.
      // `ahmed-start` posts resume:false, which clears IndexedDB checkpoints before stepping, and
      // the previous rung's `page.goto` tore down its worker and GPU device. Assert it rather
      // than trust it: a rung that silently resumed another rung's (possibly diverged) field
      // would produce numbers that look like physics.
      expect(
        events(await readHooks(page)).some((e) => e.type === 'resumed'),
        `rung Cs ${rung.lesCs} resumed from a checkpoint instead of starting fresh`,
      ).toBe(false);
      expect(
        scene.lesCs,
        `rung asked for Cs ${rung.lesCs} but the solver built ${scene.lesCs}`,
      ).toBeCloseTo(rung.lesCs, 12);

      // ── Run the physics under ONE absolute deadline ──────────────────────────────────
      //
      // The rung runs until its independent blocks agree, it diverges, or the simulation
      // budget is exhausted — whichever comes first. Every exit is a legitimate outcome and
      // is recorded as `stopReason`; none of them fails the sweep. The trigger's only job is
      // to OPEN the post-trigger observation window: it decides where the measurement starts,
      // never when the rung is done.
      //
      // This is deliberately not `expect.poll`, whose timeout throws. Running out of budget
      // while still disagreeing is the single most informative thing this ladder can report
      // about criterion 1′, and it must survive into the summary rather than abort the sweep.
      const deadline = startedAt + RUNG_BUDGET_MS;
      let h = await readHooks(page);
      const errored = () =>
        events(h).find((e) => e.type === 'error') as
          Extract<AhmedWorkerEvent, { type: 'error' }> | undefined;
      const triggerOf = (hh: AeroflowHooks): Sample | undefined =>
        samples(hh).find((s) => s.converged);

      let stopReason: StopReason;
      for (;;) {
        h = await readHooks(page);
        if (errored()) {
          stopReason = 'diverged';
          break;
        }
        const all = samples(h);
        const trig = triggerOf(h);
        const tConv = all.at(-1)?.convectiveTimes ?? 0;
        if (trig) {
          const post = all.filter((s) => s.convectiveTimes > trig.convectiveTimes);
          const { blocks } = blockMeans(post, BLOCK_TCONV);
          // MIN_TCONV is a floor on comparability, ANDed in — it can delay this stop but can
          // never cause one. A rung that reaches the floor while still disagreeing keeps running.
          if (agrees(blocks.map((b) => b.mean)) && tConv >= MIN_TCONV) {
            stopReason = 'agreed';
            break;
          }
        }
        if (Date.now() >= deadline) {
          stopReason = trig ? 'budget' : 'budget-no-trigger';
          break;
        }
        await page.waitForTimeout(5_000);
      }
      const simMs = Date.now() - startedAt;
      const trigger = triggerOf(h);

      // Stop stepping before the readbacks. Beyond honesty about what the budget bought, this
      // is what makes the diagnostics and τ snapshots describe ONE field: the loop does not
      // pause itself for either readback, so a still-running sim would advance underneath them
      // and hand back two measurements of two different instants.
      //
      // `stop` is ASYNCHRONOUS — the command only flips `run.running`, and the loop finishes its
      // current step, its sample and (if due) its checkpoint before posting `stopped`. Clicking
      // and immediately reading back would race exactly the advance this is here to prevent, so
      // wait for the event. A diverged rung has already posted it, hence no click and no wait.
      const stopBtn = page.getByTestId('ahmed-stop');
      if (await stopBtn.isEnabled()) {
        await stopBtn.click();
        await expect
          .poll(async () => events(await readHooks(page)).some((e) => e.type === 'stopped'), {
            // Generous: the in-flight step plus a possible auto-checkpoint (~0.5 GB at the 8M
            // tier) can both land between the flag flip and the event.
            timeout: 300_000,
            intervals: [1_000],
          })
          .toBe(true);
      }
      h = await readHooks(page);

      // Diagnostics last, so the approach flow is measured on the settled field. Timed and
      // reported separately from `simMs`: this is post-physics overhead, deliberately OUTSIDE
      // the rung budget (see RUNG_BUDGET_MS), and its cost should be visible rather than
      // silently folded into a ceiling that means something else.
      const diagStart = Date.now();
      let diagnostics: AhmedDiagnostics | undefined;
      if (!errored()) {
        // `timeout` is explicit because Playwright's default action timeout is 0 = WAIT FOREVER.
        // Measured 2026-08-06: stopping the run before the readbacks left this button disabled
        // (the page gated diagnostics on `running`), and the sweep hung here with no diagnostic
        // of its own until the 10-minute outer kill. A disabled button must fail fast and loud.
        await page.getByTestId('ahmed-diag').click({ timeout: 30_000 });
        await expect
          .poll(
            async () => {
              const hh = await readHooks(page);
              return events(hh).some((e) => e.type === 'diagnostics');
            },
            { timeout: 300_000, intervals: [2_000] },
          )
          .toBe(true);
        h = await readHooks(page);
        diagnostics = (
          [...events(h)].reverse().find((e) => e.type === 'diagnostics') as
            Extract<AhmedWorkerEvent, { type: 'diagnostics' }> | undefined
        )?.diagnostics;
      }

      const diagMs = Date.now() - diagStart;

      // τ_eff on the same settled field, immediately after the approach-flow diagnostics. Since
      // 2026-08-06 the sim is STOPPED before either readback, so "the same field" is now
      // literally true: previously the loop kept stepping underneath both, and the τ report was
      // stamped tens of T_conv apart from the diagnostics it was meant to accompany.
      const tauStart = Date.now();
      let tau: AhmedTauReport | undefined;
      if (!errored() && WANT_TAU) {
        await page.getByTestId('ahmed-tau').click({ timeout: 30_000 });
        await expect
          .poll(
            async () => {
              const hh = await readHooks(page);
              return events(hh).some((e) => e.type === 'tau');
            },
            // The oracle streams the whole DDF image to the host and gathers 19 directions per
            // cell in scalar JS; at the 8M tier that is minutes, not seconds.
            { timeout: 900_000, intervals: [5_000] },
          )
          .toBe(true);
        h = await readHooks(page);
        tau = (
          [...events(h)].reverse().find((e) => e.type === 'tau') as
            Extract<AhmedWorkerEvent, { type: 'tau' }> | undefined
        )?.tau;
      }

      const tauMs = Date.now() - tauStart;

      const all = samples(h);
      const final = all.at(-1);
      const post = trigger ? all.filter((s) => s.convectiveTimes > trigger.convectiveTimes) : [];

      // Post-trigger blocks: the convergence verdict, unchanged. Comparing blocks from before the
      // trigger against ones after would mix the startup transient into the spread.
      const { blocks, droppedSamples } = blockMeans(post, BLOCK_TCONV);
      const blockVals = blocks.map((b) => b.mean);
      const spread = relSpread(blockVals);

      // EVERY complete block over the whole run, trigger or no trigger. Two reasons this exists
      // beside the post-trigger set:
      //   - A rung that never fires the 3% trigger has NO post-trigger blocks at all, so without
      //     this it would contribute nothing to the cross-rung comparison — and at reduced Cs,
      //     failing to trigger is a plausible outcome.
      //   - The whole series shows whether a rung's Cd was wandering across the run, which the
      //     post-trigger tail alone can hide.
      const { blocks: allBlocks } = blockMeans(all, BLOCK_TCONV);
      const allBlockVals = allBlocks.map((b) => b.mean);
      const allSpread = relSpread(allBlockVals);
      const wallMin = (Date.now() - startedAt) / 60_000;

      const err = errored();
      // The most recent stability snapshot. For a rung that ran clean this is redundant with the
      // diagnostics block; for a rung that DIVERGED it is the only surviving evidence, because
      // the post-mortem readback sees a field that is already poison.
      const lastField = (
        [...events(h)].reverse().find((e) => e.type === 'stability') as
          Extract<AhmedWorkerEvent, { type: 'stability' }> | undefined
      )?.field;

      table.push({
        rung,
        errored: err !== undefined,
        lastTConv: final?.convectiveTimes ?? Number.NaN,
        blocks: blockVals,
        spread,
        allBlocks: allBlockVals,
        allSpread,
        triggerTConv: trigger?.convectiveTimes,
        stopReason,
        simMs,
        diagMs,
        tauMs,
        diagnostics,
        tau,
        lastField,
      });

      rows.push(
        `### ${(rung.cells / 1e6).toFixed(1)}M cells @ Re ${rung.Re.toExponential(2)} ` +
          `Cs ${rung.lesCs} ${rung.precision}\n` +
          `${sceneLine(scene)}\n` +
          (err
            ? `DIVERGED / ERROR: ${err.message}\n` +
              (lastField
                ? `${fieldLine(lastField, 'last healthy snapshot')}\n`
                : '  (no stability snapshot was taken before the failure)\n')
            : `steps ${final?.totalSteps.toLocaleString()}   ${final?.convectiveTimes.toFixed(1)} T_conv   ` +
              `${final?.mlups.toFixed(0)} MLUPs   wall ${wallMin.toFixed(1)} min\n` +
              `STOPPED: ${stopReason} — ` +
              stopExplanation(stopReason) +
              `\n` +
              `  sim ${(simMs / 60_000).toFixed(1)} min of the ${(RUNG_BUDGET_MS / 60_000).toFixed(0)}-min budget` +
              `   +diagnostics ${(diagMs / 1000).toFixed(0)} s   +τ oracle ${(tauMs / 1000).toFixed(0)} s` +
              `   (readbacks are outside the budget)\n` +
              `mean Cd ${final?.meanCd.toFixed(4)} ± ${final?.stdCd.toFixed(4)}   ` +
              `drift ${((final?.drift ?? NaN) * 100).toFixed(2)}%   drag ${final?.meanNewtons.toFixed(1)} N\n` +
              `  first 3% trigger at ${trigger?.convectiveTimes.toFixed(1)} T_conv, ` +
              `Cd ${trigger?.meanCd.toFixed(4)} — opened the observation window\n` +
              `  independent ${BLOCK_TCONV}-T_conv block means (${blocks.length} complete` +
              `${droppedSamples > 0 ? `, ${droppedSamples} trailing samples dropped as a partial block` : ''}): ` +
              `${blocks.map((b) => `${b.mean.toFixed(4)} [${b.t0.toFixed(0)}–${b.t1.toFixed(0)}, n=${b.n}]`).join('  ')}\n` +
              // The stop test reads the LAST two overlapping windows, so report those, not just
              // the whole-series spread the earlier harness stopped on.
              `  agreement test (last ${MIN_BLOCKS + 1} blocks; ALL THREE must be ≤ ${(BLOCK_GATE * 100).toFixed(0)}%): ` +
              `previous ${pct(relSpread(blockVals.slice(-(MIN_BLOCKS + 1), -1)))}  ` +
              `current ${pct(relSpread(blockVals.slice(-MIN_BLOCKS)))}  ` +
              `whole ${pct(relSpread(blockVals.slice(-(MIN_BLOCKS + 1))))}  ⇒ ` +
              `${agrees(blockVals) ? 'AGREE' : 'DISAGREE'}\n` +
              `  whole post-trigger spread ${pct(spread)} (context only — NOT the stop test: it is ` +
              `dominated by its oldest blocks, so a rung that settles late can never satisfy it)\n` +
              // The full series, so the cross-rung comparison rests on every complete block and
              // not on a single end-of-run figure.
              `  ALL complete ${BLOCK_TCONV}-T_conv blocks over the whole run (${allBlocks.length}): ` +
              `${allBlocks.map((b) => `${b.mean.toFixed(4)} [${b.t0.toFixed(0)}–${b.t1.toFixed(0)}]`).join('  ')}\n` +
              `  whole-run block spread ${(allSpread * 100).toFixed(2)}%\n` +
              (diagnostics ? `${diagnosticsLines(diagnostics)}\n` : '') +
              // Prefer the diagnostics' own reduction: it is taken on the SAME readback as the
              // approach-flow stations, i.e. the settled final field. The periodic snapshot is
              // up to FIELD_SNAPSHOT_TCONV older.
              (diagnostics?.field
                ? `${fieldLine(diagnostics.field, 'stability (final field)')}\n`
                : lastField
                  ? `${fieldLine(lastField, 'stability (last in-run snapshot)')}\n`
                  : '') +
              (tau ? `${tauLines(tau)}\n` : '')),
      );

      await testInfo.attach(
        `ahmed-${(rung.cells / 1e6).toFixed(1)}M-Re${rung.Re}-Cs${rung.lesCs}-${rung.precision}.png`,
        { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' },
      );
      // (The run was already stopped before the readbacks, guarded by `isEnabled` — a rung that
      // self-terminated, which is exactly what a diverged rung does, has already posted 'stopped'
      // and the page disables the button on that event. Clicking it unconditionally waits for an
      // element that will never become enabled, i.e. the sweep hangs on precisely the outcome it
      // exists to capture. Measured: that burned an entire 18-minute smoke run.)

      // NO per-rung assertion here — see the end-of-test assertion. A rung that diverges must not
      // prevent the remaining rungs from running, because in a Cs sweep divergence is a RESULT.
    }
  } finally {
    const summary = `${rows.join('\n')}\n\n${comparisonTable(table)}`;
    await testInfo.attach('ahmed-ladder', { body: summary, contentType: 'text/plain' });
    console.log(`\n${summary}\n`);
  }

  // Only the acceptance-configuration rungs are required to survive. A rung at a reduced Cs is
  // deliberately being run with less than the stabilizing dissipation this τ₀ is documented to
  // need, so its divergence is data about the scheme — not a broken harness — and failing the
  // test on it would discard the other rungs' results along with it.
  const brokenBaselines = table.filter(
    (r) => r.errored && r.rung.lesCs === AHMED_LES_CS && r.rung.precision === 'fp16',
  );
  expect(
    brokenBaselines.map((r) => `${r.rung.cells}@${r.rung.Re}`),
    'baseline-configuration rungs (Cs = AHMED_LES_CS, fp16) must not error',
  ).toEqual([]);
});
