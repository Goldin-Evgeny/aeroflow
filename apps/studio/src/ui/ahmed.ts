import { ForcePlot } from './forcePlot';
import {
  AHMED_ACCEPTANCE_PRECISION,
  AHMED_CD_BAND,
  AHMED_CD_STRETCH,
  AHMED_CD_TARGET,
  AHMED_LES_CS,
  type AhmedSceneSummary,
  type AhmedWorkerCommand,
  type AhmedWorkerEvent,
} from '../sim/ahmedRun';
import { AHMED_EXPERIMENTAL_RE } from '@aeroflow/core';
import {
  applyCellsOverride,
  hooks,
  lesCsOverride,
  precisionOverride,
  reOverride,
} from '../dev/testHooks';

/**
 * Ahmed 25° long-run page (route ?ahmed; M9 steps 2–6 + acceptance 1/4 harness). The sim
 * runs entirely in a dedicated worker (background-tab-safe stepping — worker timers are
 * not throttled); this page renders the progress panel, holds the screen wake lock, asks
 * the worker to checkpoint when the tab hides, and exposes the acceptance-4 chaos button
 * ("Simulate device loss"). Verdict line compares mean Cd against 0.285 ± 15% (stretch
 * ± 10%) once forceHistory reports convergence (20 T_conv within 3%).
 */

const BUDGETS: Record<string, number> = {
  '15.7M cells (M9 target tier)': 15_700_000,
  '8M cells (memory-short)': 8_000_000,
  '2M cells (smoke test)': 2_000_000,
};

export function mountAhmed(root: HTMLElement): void {
  root.innerHTML = '';
  root.classList.add('page');

  const h = document.createElement('h2');
  h.className = 'page-title';
  // Re is a control now, so it is not in the title — the readout prints the Re the scene
  // was actually built with, which is the only number that should be quoted anywhere.
  h.textContent = 'M9 — Ahmed body 25° long run';
  const sub = document.createElement('p');
  sub.className = 'subtitle';
  sub.textContent =
    'Screening-grade uniform grid, no wall functions: published band is ±15% around Cd 0.285. ' +
    'Runs in a worker (background-tab safe), checkpoints to IndexedDB every 5 min and on tab-hide, ' +
    'auto-recovers from GPU device loss.';

  const controls = document.createElement('div');
  controls.className = 'button-row';
  const mkBtn = (label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    controls.append(b);
    return b;
  };
  const budgetSel = document.createElement('select');
  for (const k of Object.keys(BUDGETS)) budgetSel.append(new Option(k, k));
  applyCellsOverride(BUDGETS, budgetSel);
  controls.append(budgetSel);
  // Re override (`?Re=N`, M9 acceptance-1 ladder). At the experimental 4.29e6 every
  // affordable grid pins τ₀ to ~0.500002, so the ladder needs to ask for an effective Re
  // the grid resolves — and the low-Re sanity anchor needs it too. Off the experimental
  // value the Cd verdict is suppressed below: 0.285 is only defined at 4.29e6.
  const reInput = document.createElement('input');
  reInput.type = 'number';
  reInput.step = 'any';
  reInput.min = '1';
  reInput.size = 10;
  reInput.value = String(reOverride() ?? AHMED_EXPERIMENTAL_RE);
  reInput.dataset.testid = 'ahmed-re';
  const reLabel = document.createElement('label');
  reLabel.className = 'muted';
  reLabel.append('Re ', reInput);
  controls.append(reLabel);
  const chosenRe = (): number => {
    const v = Number(reInput.value);
    return Number.isFinite(v) && v > 0 ? v : AHMED_EXPERIMENTAL_RE;
  };
  // Smagorinsky Cs control (`?lesCs=N`, M9 step 7). The sweep that discriminates the
  // freestream-SGS-activation mechanism varies this and nothing else; like Re, moving it off
  // the acceptance value suppresses the Cd verdict below.
  const csInput = document.createElement('input');
  csInput.type = 'number';
  csInput.step = 'any';
  csInput.min = '0'; // 0 = LES off, a legitimate rung
  csInput.size = 6;
  csInput.value = String(lesCsOverride() ?? AHMED_LES_CS);
  csInput.dataset.testid = 'ahmed-cs';
  const csLabel = document.createElement('label');
  csLabel.className = 'muted';
  csLabel.append('Cs ', csInput);
  controls.append(csLabel);
  const chosenCs = (): number => {
    const v = Number(csInput.value);
    return Number.isFinite(v) && v >= 0 ? v : AHMED_LES_CS;
  };
  const fp16Box = document.createElement('input');
  fp16Box.type = 'checkbox';
  fp16Box.checked = (precisionOverride() ?? AHMED_ACCEPTANCE_PRECISION) === 'fp16';
  fp16Box.dataset.testid = 'ahmed-fp16';
  const fp16Label = document.createElement('label');
  fp16Label.className = 'muted';
  fp16Label.append(fp16Box, ' FP16 storage (falls back if not granted)');
  controls.append(fp16Label);
  const startBtn = mkBtn('Start fresh');
  const resumeBtn = mkBtn('Resume from checkpoint');
  const stopBtn = mkBtn('Stop');
  const ckptBtn = mkBtn('Checkpoint now');
  const diagBtn = mkBtn('Approach-flow diagnostics');
  const tauBtn = mkBtn('τ_eff / LES diagnostics');
  const chaosBtn = mkBtn('Simulate device loss');
  startBtn.dataset.testid = 'ahmed-start';
  resumeBtn.dataset.testid = 'ahmed-resume';
  stopBtn.dataset.testid = 'ahmed-stop';
  ckptBtn.dataset.testid = 'ahmed-ckpt';
  diagBtn.dataset.testid = 'ahmed-diag';
  tauBtn.dataset.testid = 'ahmed-tau';
  chaosBtn.dataset.testid = 'ahmed-chaos';
  stopBtn.disabled =
    ckptBtn.disabled =
    diagBtn.disabled =
    tauBtn.disabled =
    chaosBtn.disabled =
      true;

  const info = document.createElement('pre');
  info.className = 'readout';
  info.textContent = 'idle';
  const panel = document.createElement('pre');
  panel.className = 'readout';
  panel.style.fontSize = '14px';
  const plot = new ForcePlot(640, 200);
  const verdict = document.createElement('div');
  verdict.className = 'verdict';
  const setVerdict = (text: string, status: 'ok' | 'bad' | 'warn' | 'muted'): void => {
    verdict.className = status === 'muted' ? 'verdict muted' : `verdict status-${status}`;
    verdict.textContent = text;
  };
  const log = document.createElement('pre');
  log.className = 'readout';
  log.style.cssText = 'max-height:180px;overflow-y:auto;color:var(--muted)';

  root.append(h, sub, controls, info, panel, plot.element, verdict, log);

  const worker = new Worker(new URL('../sim/ahmedWorker.ts', import.meta.url), {
    type: 'module',
  });
  const send = (c: AhmedWorkerCommand): void => worker.postMessage(c);

  const startedAt = { t: 0 };
  let scene: AhmedSceneSummary | null = null;
  let lastCheckpoint = 'never';
  let recoveries = 0;
  const logLine = (s: string): void => {
    log.textContent = `${new Date().toLocaleTimeString()}  ${s}\n${log.textContent}`.slice(0, 8000);
  };

  // Wake lock (step 6): hold while running, re-acquire when the tab becomes visible.
  let wakeLock: { release(): Promise<void> } | null = null;
  let shouldHoldLock = false;
  const acquireLock = async (): Promise<void> => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
      };
      if (shouldHoldLock && nav.wakeLock && document.visibilityState === 'visible') {
        wakeLock = await nav.wakeLock.request('screen');
      }
    } catch {
      /* wake lock is best-effort */
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && shouldHoldLock) {
      send({ type: 'checkpoint' }); // spec: checkpoint on tab-hide
    } else {
      void acquireLock();
    }
  });

  const setRunning = (running: boolean): void => {
    startBtn.disabled = resumeBtn.disabled = running;
    stopBtn.disabled =
      ckptBtn.disabled =
      diagBtn.disabled =
      tauBtn.disabled =
      chaosBtn.disabled =
        !running;
    shouldHoldLock = running;
    if (running) void acquireLock();
    else void wakeLock?.release().catch(() => undefined);
  };

  const start = (resume: boolean): void => {
    setRunning(true);
    startedAt.t = performance.now();
    verdict.textContent = '';
    info.textContent = 'starting…';
    send({
      type: 'start',
      opts: {
        scene: { maxCells: BUDGETS[budgetSel.value], Re: chosenRe() },
        lesCs: chosenCs(),
        precision: fp16Box.checked ? 'fp16' : 'fp32',
        checkpointEveryMs: 5 * 60 * 1000,
        resume,
      },
    });
  };
  startBtn.onclick = () => start(false);
  resumeBtn.onclick = () => start(true);
  stopBtn.onclick = () => send({ type: 'stop' });
  ckptBtn.onclick = () => send({ type: 'checkpoint' });
  diagBtn.onclick = () => send({ type: 'diagnostics' });
  tauBtn.onclick = () => send({ type: 'tau' });
  chaosBtn.onclick = () => {
    logLine('CHAOS: forcing device loss (acceptance 4)');
    send({ type: 'simulate-device-loss' });
  };

  worker.onmessage = (ev: MessageEvent<AhmedWorkerEvent>) => {
    const m = ev.data;
    (hooks().ahmedEvents ??= []).push(m);
    switch (m.type) {
      case 'status':
        info.textContent = m.message;
        logLine(m.message);
        break;
      case 'ready':
        scene = m.scene;
        info.textContent = [
          `GPU: ${m.gpu}   DDF storage: ${m.precision}`,
          `grid ${scene.nx}×${scene.ny}×${scene.nz} = ${(scene.totalCells / 1e6).toFixed(1)}M cells   dx ${scene.dxMm.toFixed(2)} mm   body ${scene.lengthCells.toFixed(0)} cells`,
          `Re ${scene.Re.toExponential(2)} (U≈${scene.physU.toFixed(1)} m/s)   τ ${scene.tau.toFixed(6)} (LES Cs=${scene.lesCs}+regularized+conservative)   u ${scene.uLattice}`,
          `blockage ${(scene.blockage * 100).toFixed(2)}%   frontal ${scene.frontalCells} cells²   body ${scene.bodyVoxels.toLocaleString()} voxels`,
          `T_conv = ${scene.convectiveTimeSteps} steps   band Cd ${AHMED_CD_TARGET} ±15% [${AHMED_CD_BAND[0]}, ${AHMED_CD_BAND[1]}]`,
        ].join('\n');
        logLine('run ready');
        break;
      case 'sample': {
        plot.push(m.cd, m.meanCd);
        plot.setReadouts({ meanCd: m.meanCd, clAmplitude: NaN, st: null, periods: 0 });
        const elapsed = (performance.now() - startedAt.t) / 1000;
        panel.textContent = [
          `step ${m.totalSteps.toLocaleString()}   ${m.convectiveTimes.toFixed(1)} T_conv   ${m.mlups.toFixed(0)} MLUPs   elapsed ${(elapsed / 60).toFixed(1)} min`,
          `Cd(t) ${m.cd.toFixed(4)}   mean(20 T_conv) ${m.meanCd.toFixed(4)} ± ${m.stdCd.toFixed(4)}   drift ${(m.drift * 100).toFixed(2)}% (gate <3%)`,
          `drag ${m.newtons.toFixed(2)} N (mean ${m.meanNewtons.toFixed(2)} N at U≈${scene?.physU.toFixed(0)} m/s)`,
          `converged: ${m.converged ? 'YES' : 'not yet'}   checkpoints: last ${lastCheckpoint}   recoveries: ${recoveries}`,
        ].join('\n');
        if (m.converged) {
          // Cd 0.285 was measured at Re 4.29e6 with the M7 LES recipe and FP16 storage. A run
          // at any other Re, Cs or precision is a diagnostic, so it reports its number without
          // a verdict rather than a misleading pass/fail — the same suppression discipline the
          // urban runner applies to under-resolved grids. Every value read here is what the
          // solver actually BUILT with, not what was typed.
          //
          // Cs and precision joined this test for the M9 step-7 sweep, and the reason is
          // structural rather than cosmetic: that sweep varies Cs looking for a MECHANISM, and
          // a lowered-Cs rung could plausibly land near 0.285 by coincidence. If the page could
          // print PASS for it, the sweep would have become a tuning exercise the moment it
          // succeeded. It cannot.
          const offSpec = scene
            ? [
                scene.Re !== AHMED_EXPERIMENTAL_RE
                  ? `Re ${scene.Re.toExponential(2)} ≠ ${AHMED_EXPERIMENTAL_RE.toExponential(2)}`
                  : null,
                scene.lesCs !== AHMED_LES_CS ? `Cs ${scene.lesCs} ≠ ${AHMED_LES_CS}` : null,
                scene.precision !== AHMED_ACCEPTANCE_PRECISION
                  ? `${scene.precision} storage ≠ ${AHMED_ACCEPTANCE_PRECISION}`
                  : null,
              ].filter((s): s is string => s !== null)
            : [];
          if (offSpec.length > 0) {
            setVerdict(
              `NOT AN ACCEPTANCE RUN — ${offSpec.join('; ')}. mean Cd ${m.meanCd.toFixed(4)} ` +
                `is a diagnostic, not a verdict against ${AHMED_CD_TARGET}`,
              'warn',
            );
          } else {
            const inBand = m.meanCd >= AHMED_CD_BAND[0] && m.meanCd <= AHMED_CD_BAND[1];
            const inStretch = m.meanCd >= AHMED_CD_STRETCH[0] && m.meanCd <= AHMED_CD_STRETCH[1];
            setVerdict(
              `${inBand ? (inStretch ? 'PASS (stretch ±10%)' : 'PASS (±15%)') : 'OUT OF BAND'}  ` +
                `mean Cd ${m.meanCd.toFixed(4)} vs ${AHMED_CD_TARGET} [${AHMED_CD_BAND[0]}, ${AHMED_CD_BAND[1]}]`,
              inBand ? 'ok' : 'bad',
            );
          }
        }
        break;
      }
      case 'diagnostics': {
        const d = m.diagnostics;
        const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
        // Cd_commanded is the acceptance number and is labelled as such; the other two are
        // shown to expose the normalization question (this scene uses the plain equilibrium
        // Inlet that M10 measured settling at 0.660·u_in), never to restate the verdict.
        info.textContent = [
          `approach flow at ${d.convectiveTimes.toFixed(1)} T_conv — u_commanded ${d.uCommanded}`,
          ...d.stations.map(
            (s) =>
              `  x=${String(s.x).padStart(4)} (−${s.cellsToNose} to nose)  ` +
              `bulk ${s.bulkUx.toFixed(5)} (${pct(s.bulkUx / d.uCommanded)})  ` +
              `core ${s.coreMeanUx.toFixed(5)} (${pct(s.coreMeanUx / d.uCommanded)})  ` +
              `ρ̄ ${s.meanRho.toFixed(5)}  nonunif ${s.nonUniformity.toFixed(3)}  ` +
              `δ99 y=${s.yCore} (${s.blThicknessCells} cells)`,
          ),
          `  Cd_commanded ${d.cdCommanded.toFixed(4)} [ACCEPTANCE]   ` +
            `Cd_bulk ${d.cdBulk.toFixed(4)}   Cd_core ${d.cdCore.toFixed(4)} — diagnostic only`,
          `  Re_nominal ${d.reNominal.toExponential(2)}   Re_bulk ${d.reBulk.toExponential(2)}   ` +
            `Re_core ${d.reCore.toExponential(2)}`,
          `  stability: mass drift ${d.field.massDriftRel.toExponential(3)}   ` +
            `ρ [${d.field.rhoMin.toFixed(5)}, ${d.field.rhoMax.toFixed(5)}]   ` +
            `Ma_max ${d.field.machMax.toFixed(4)}   ` +
            `non-finite ${d.field.nonFiniteCells}`,
        ].join('\n');
        logLine(
          `diagnostics @ ${d.convectiveTimes.toFixed(1)} T_conv: ` +
            `bulk/cmd ${pct(d.cdBulk > 0 ? Math.sqrt(d.cdCommanded / d.cdBulk) : NaN)}`,
        );
        break;
      }
      case 'tau': {
        const t = m.tau;
        const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
        // ν_LES/ν_mol is the number that decides whether nominal Re still reaches the
        // physics. τ₀ is the floor (τ_t ≥ 0, no clamp anywhere), so "at floor" = LES silent.
        info.textContent = [
          `τ_eff @ ${t.convectiveTimes.toFixed(1)} T_conv — Re ${t.Re.toExponential(2)}  ` +
            `Cs ${t.lesCs.toFixed(4)}  ` +
            `τ₀ ${t.tau0.toFixed(6)}  ν_mol ${t.nuMolecular.toExponential(3)}  ` +
            `parity ${t.parity}  fluid ${t.fluidCells.toLocaleString()}  ` +
            `skipped(freeSlip) ${t.freeSlipAdjacentSkipped.toLocaleString()}` +
            (t.nonFinite ? `  NON-FINITE ${t.nonFinite} — SNAPSHOT INVALID` : ''),
          ...t.regions.map((r) => {
            const s = r.stats;
            return (
              `  ${r.name.padEnd(30)} n=${String(s.cells).padStart(9)}  ` +
              `τ p50 ${s.tauPercentiles[3].toFixed(5)} p99 ${s.tauPercentiles[7].toFixed(5)} ` +
              `max ${s.tauMax.toFixed(5)}  ` +
              `ν_LES/ν_mol p50 ${s.nuRatioPercentiles[3].toFixed(2)} ` +
              `p99 ${s.nuRatioPercentiles[7].toFixed(2)} max ${s.nuRatioMax.toFixed(1)}  ` +
              `floor ${pct(s.atFloorFraction)} dom ${pct(s.lesDominantFraction)} ` +
              `overwhelm ${pct(s.lesOverwhelmingFraction)}`
            );
          }),
        ].join('\n');
        logLine(
          `τ_eff @ ${t.convectiveTimes.toFixed(1)} T_conv: whole-domain ν_LES/ν_mol p50 ` +
            `${t.regions[0].stats.nuRatioPercentiles[3].toFixed(2)}, ` +
            `LES-dominant ${pct(t.regions[0].stats.lesDominantFraction)}`,
        );
        break;
      }
      case 'stability': {
        const f = m.field;
        // Logged, not shown in the main readout: it is a periodic health line, and its value
        // is the TRAIL it leaves — the last entries before a divergence are the only record of
        // how the field looked while it was still healthy.
        logLine(
          `stability @ ${m.convectiveTimes.toFixed(1)} T_conv: ` +
            `mass drift ${f.massDriftRel.toExponential(3)}  ` +
            `ρ [${f.rhoMin.toFixed(5)}, ${f.rhoMax.toFixed(5)}]  ` +
            `Ma_max ${f.machMax.toFixed(4)}  non-finite ${f.nonFiniteCells}`,
        );
        break;
      }
      case 'checkpoint-saved':
        lastCheckpoint = `${new Date(m.savedAt).toLocaleTimeString()} (${(m.bytes / 1e6).toFixed(0)} MB in ${(m.ms / 1000).toFixed(1)} s)`;
        logLine(`checkpoint saved at step ${m.totalSteps.toLocaleString()} — ${lastCheckpoint}`);
        break;
      case 'resumed':
        logLine(`resumed from checkpoint at step ${m.totalSteps.toLocaleString()}`);
        break;
      case 'device-lost':
        logLine(`DEVICE LOST (${m.reason}) — recovering…`);
        break;
      case 'recovered':
        recoveries = m.recoveries;
        logLine(`recovered (#${m.recoveries}) at step ${m.totalSteps.toLocaleString()}`);
        break;
      case 'stopped':
        logLine(`stopped at step ${m.totalSteps.toLocaleString()}`);
        setRunning(false);
        break;
      case 'error':
        logLine(`ERROR: ${m.message}`);
        setVerdict(m.message, 'bad');
        setRunning(false);
        break;
    }
  };
}
