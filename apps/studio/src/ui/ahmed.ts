import { ForcePlot } from './forcePlot';
import {
  AHMED_CD_BAND,
  AHMED_CD_STRETCH,
  AHMED_CD_TARGET,
  type AhmedSceneSummary,
  type AhmedWorkerCommand,
  type AhmedWorkerEvent,
} from '../sim/ahmedRun';
import { applyCellsOverride, hooks } from '../dev/testHooks';

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
  root.style.cssText =
    'font:13px/1.5 ui-monospace,monospace;color:#e6edf3;padding:16px;max-width:860px';

  const h = document.createElement('h2');
  h.textContent = 'M9 — Ahmed body 25° (Re 4.29×10⁶) long run';
  const sub = document.createElement('p');
  sub.style.color = '#8b949e';
  sub.textContent =
    'Screening-grade uniform grid, no wall functions: published band is ±15% around Cd 0.285. ' +
    'Runs in a worker (background-tab safe), checkpoints to IndexedDB every 5 min and on tab-hide, ' +
    'auto-recovers from GPU device loss.';

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center';
  const mkBtn = (label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:6px 10px;background:#21262d;color:#e6edf3;border:1px solid #444c56;border-radius:4px;cursor:pointer';
    controls.append(b);
    return b;
  };
  const budgetSel = document.createElement('select');
  budgetSel.style.cssText =
    'background:#21262d;color:#e6edf3;border:1px solid #444c56;border-radius:4px;padding:5px';
  for (const k of Object.keys(BUDGETS)) budgetSel.append(new Option(k, k));
  applyCellsOverride(BUDGETS, budgetSel);
  controls.append(budgetSel);
  const fp16Box = document.createElement('input');
  fp16Box.type = 'checkbox';
  fp16Box.checked = true;
  const fp16Label = document.createElement('label');
  fp16Label.style.color = '#8b949e';
  fp16Label.append(fp16Box, ' FP16 storage (falls back if not granted)');
  controls.append(fp16Label);
  const startBtn = mkBtn('Start fresh');
  const resumeBtn = mkBtn('Resume from checkpoint');
  const stopBtn = mkBtn('Stop');
  const ckptBtn = mkBtn('Checkpoint now');
  const chaosBtn = mkBtn('Simulate device loss');
  startBtn.dataset.testid = 'ahmed-start';
  resumeBtn.dataset.testid = 'ahmed-resume';
  stopBtn.dataset.testid = 'ahmed-stop';
  ckptBtn.dataset.testid = 'ahmed-ckpt';
  chaosBtn.dataset.testid = 'ahmed-chaos';
  stopBtn.disabled = ckptBtn.disabled = chaosBtn.disabled = true;

  const info = document.createElement('pre');
  info.style.cssText =
    'background:#0b0e13;border:1px solid #2d333b;border-radius:4px;padding:10px;white-space:pre-wrap';
  info.textContent = 'idle';
  const panel = document.createElement('pre');
  panel.style.cssText = info.style.cssText + ';font-size:14px';
  const plot = new ForcePlot(640, 200);
  const verdict = document.createElement('div');
  verdict.style.cssText = 'margin-top:10px;font-size:15px;font-weight:bold';
  const log = document.createElement('pre');
  log.style.cssText = info.style.cssText + ';max-height:180px;overflow-y:auto;color:#8b949e';

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
    stopBtn.disabled = ckptBtn.disabled = chaosBtn.disabled = !running;
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
        scene: { maxCells: BUDGETS[budgetSel.value] },
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
          `Re ${scene.Re.toExponential(2)} (U≈${scene.physU.toFixed(1)} m/s)   τ ${scene.tau.toFixed(6)} (LES+regularized+conservative)   u ${scene.uLattice}`,
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
          const inBand = m.meanCd >= AHMED_CD_BAND[0] && m.meanCd <= AHMED_CD_BAND[1];
          const inStretch = m.meanCd >= AHMED_CD_STRETCH[0] && m.meanCd <= AHMED_CD_STRETCH[1];
          verdict.style.color = inBand ? '#3fb950' : '#f85149';
          verdict.textContent =
            `${inBand ? (inStretch ? 'PASS (stretch ±10%)' : 'PASS (±15%)') : 'OUT OF BAND'}  ` +
            `mean Cd ${m.meanCd.toFixed(4)} vs ${AHMED_CD_TARGET} [${AHMED_CD_BAND[0]}, ${AHMED_CD_BAND[1]}]`;
        }
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
        verdict.style.color = '#f85149';
        verdict.textContent = m.message;
        setRunning(false);
        break;
    }
  };
}
