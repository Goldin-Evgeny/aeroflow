import { GHIA_U, GHIA_V, formatGhiaComparison, type CavityRe } from '@aeroflow/core';
import { runCavity, formatCavityRun, type CavityRunResult } from '../sim/cases/cavityRun';
import { hooks } from '../dev/testHooks';

/**
 * M3 validation page — lid-driven cavity vs Ghia, Ghia & Shin 1982 (?cavity).
 *
 * Runs the two headline cases to the documented residual criterion and renders what M3
 * acceptance 3 and 6 ask for: the residual history on a log axis, and both centreline
 * profiles overlaid with the 17 published Ghia points.
 *
 * The pass/fail table states each extremum's bar and verdict. Rows the spec marks
 * "secondary (report, not gate)" are labelled `report` and never colour the verdict —
 * the milestone gate is exactly the criteria M3.md lists, no more and no less.
 *
 * Grid overrides (`?cavity&H=64`) exist so the e2e suite can exercise the whole path
 * cheaply. An overridden run is NOT an acceptance run and the page says so, because the
 * ±1.5 % bar is a statement about 256², not about whatever grid was passed in.
 */

/** Evenly thin a trace to at most `max` points, always keeping the first and the last. */
function decimate<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return [...xs];
  const stride = Math.ceil(xs.length / max);
  const out = xs.filter((_, i) => i % stride === 0);
  if (out[out.length - 1] !== xs[xs.length - 1]) out.push(xs[xs.length - 1]);
  return out;
}

/**
 * `minSteps` is a floor no stopping rule may fire below. Both values are chosen from
 * measurement, not habit: each is the point where the residual has reached the FP32 floor
 * (~2e-6 at Re=100, ~3.8e-6 at Re=1000) AND the Ghia extrema have stopped moving.
 *
 * Re=1000 needs the floor most. Its residual quietens early enough that the plateau rule
 * fired at 218 k steps while the extrema were still shifting (u_min 0.05 % → 0.30 %,
 * v_min 0.86 % → 0.55 % between 218 k and 600 k), which is exactly the "looks steady long
 * before the extrema settle" trap M3.md warns about. Both runs cost under 30 s here.
 */
const CASES: { Re: CavityRe; H: number; minSteps: number; testId: string; label: string }[] = [
  {
    Re: 100,
    H: 256,
    minSteps: 200_000,
    testId: 'cavity-run-Re100',
    label: 'Re=100 on 256² (acceptance 1)',
  },
  {
    Re: 1000,
    H: 512,
    minSteps: 600_000,
    testId: 'cavity-run-Re1000',
    label: 'Re=1000 on 512² (acceptance 2)',
  },
];

/** Residual history, log-y. The plot M3 acceptance 3 requires alongside the criterion. */
function drawResidual(canvas: HTMLCanvasElement, r: CavityRunResult): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || r.residualHistory.length === 0) return;
  const W = canvas.width;
  const Hpx = canvas.height;
  const pad = { l: 58, r: 10, t: 10, b: 26 };
  ctx.clearRect(0, 0, W, Hpx);

  const logs = r.residualHistory.map((s) => Math.log10(Math.max(s.residual, 1e-12)));
  const yMax = Math.max(...logs, Math.log10(1e-7));
  const yMin = Math.min(...logs, Math.log10(1e-7)) - 0.5;
  const xMax = r.residualHistory[r.residualHistory.length - 1].step;
  const px = (step: number) => pad.l + ((W - pad.l - pad.r) * step) / Math.max(xMax, 1);
  const py = (lg: number) =>
    pad.t + ((Hpx - pad.t - pad.b) * (yMax - lg)) / Math.max(yMax - yMin, 1e-9);

  ctx.strokeStyle = '#888';
  ctx.strokeRect(pad.l, pad.t, W - pad.l - pad.r, Hpx - pad.t - pad.b);
  ctx.fillStyle = '#888';
  ctx.font = '11px system-ui, sans-serif';
  for (let e = Math.ceil(yMin); e <= Math.floor(yMax); e++) {
    const y = py(e);
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(`1e${e}`, 6, y + 4);
  }

  // The convergence threshold itself.
  ctx.strokeStyle = '#d33';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.l, py(Math.log10(1e-7)));
  ctx.lineTo(W - pad.r, py(Math.log10(1e-7)));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#2a7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  r.residualHistory.forEach((s, i) => {
    const x = px(s.step);
    const y = py(Math.log10(Math.max(s.residual, 1e-12)));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#888';
  ctx.fillText(`steps → ${xMax.toLocaleString()}`, pad.l, Hpx - 8);
}

/** Centreline profile with the published Ghia points overlaid (acceptance 6). */
function drawProfile(
  canvas: HTMLCanvasElement,
  simCoord: readonly number[],
  simValue: readonly number[],
  refCoord: readonly number[],
  refValue: readonly number[],
  title: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const Hpx = canvas.height;
  const pad = { l: 44, r: 10, t: 20, b: 26 };
  ctx.clearRect(0, 0, W, Hpx);

  const all = [...simValue, ...refValue];
  const vMin = Math.min(...all);
  const vMax = Math.max(...all);
  const px = (v: number) =>
    pad.l + ((W - pad.l - pad.r) * (v - vMin)) / Math.max(vMax - vMin, 1e-9);
  const py = (c: number) => Hpx - pad.b - (Hpx - pad.t - pad.b) * c;

  ctx.strokeStyle = '#888';
  ctx.strokeRect(pad.l, pad.t, W - pad.l - pad.r, Hpx - pad.t - pad.b);
  ctx.fillStyle = '#888';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(title, pad.l, 14);
  ctx.fillText(vMin.toFixed(2), pad.l - 4, Hpx - 10);
  ctx.fillText(vMax.toFixed(2), W - pad.r - 24, Hpx - 10);

  ctx.strokeStyle = '#2a7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < simCoord.length; i++) {
    const x = px(simValue[i]);
    const y = py(simCoord[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = '#d33';
  for (let k = 0; k < refCoord.length; k++) {
    ctx.beginPath();
    ctx.arc(px(refValue[k]), py(refCoord[k]), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function mountCavity(device: GPUDevice, root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const hOverride = Number(params.get('H'));
  const maxSteps = Number(params.get('maxSteps'));
  const minSteps = Number(params.get('minSteps'));
  const regularize = params.get('regularize') === '1';
  const conserveMass = params.get('conserveMass') === '1';
  const diagnostic = params.get('diagnostic') === '1';
  const overridden = Number.isFinite(hOverride) && hOverride > 0;

  root.classList.add('page');
  root.innerHTML = `
    <h2 class="page-title">M3 — lid-driven cavity vs Ghia, Ghia &amp; Shin (1982)</h2>
    <p class="subtitle">Validation harness. Each case runs the shared cavity scene
    (TRT, Λ=3/16, u<sub>lid</sub>=0.1) to the documented residual criterion, then compares both
    centrelines against the published 17-point tables. Convergence is decided by the residual
    alone — the flow looks steady long before the extrema settle.</p>
    ${
      overridden
        ? `<p class="callout status-warn"><b>Grid override active (H=${hOverride}).</b> This is a
           plumbing run, not an acceptance run: the ±1.5 % / ±2 % bars are statements about
           256² and 512² respectively.</p>`
        : ''
    }
    ${diagnostic ? `<p class="muted"><b>Long-run diagnostic:</b> H10 ${regularize ? 'on' : 'off'}, H13 ${conserveMass ? 'on' : 'off'}; fixed checkpoints record u_min and mass drift.</p>` : ''}
    <div id="cavity-buttons" class="button-row"></div>
    <pre id="cavity-out" class="readout"></pre>
    <div id="cavity-plots" style="display:flex;gap:var(--space-md);flex-wrap:wrap;margin-top:var(--space-md)"></div>`;

  const out = root.querySelector('#cavity-out') as HTMLElement;
  const plots = root.querySelector('#cavity-plots') as HTMLElement;
  const buttons = root.querySelector('#cavity-buttons') as HTMLElement;

  for (const c of CASES) {
    const btn = document.createElement('button');
    const H = overridden ? hOverride : c.H;
    btn.textContent = overridden ? `${c.label} — overridden to ${H}²` : `Run ${c.label}`;
    btn.dataset.testid = c.testId;
    btn.addEventListener('click', async () => {
      for (const b of buttons.querySelectorAll('button')) b.disabled = true;
      const h = hooks();
      h.cavity = {
        runId: (h.cavity?.runId ?? 0) + 1,
        Re: c.Re,
        H,
        regularize,
        conserveMass,
        done: false,
      };
      out.textContent = `Running Re=${c.Re} on ${H}²…\n`;
      plots.innerHTML = '';

      try {
        const r = await runCavity(device, {
          H,
          Re: c.Re,
          maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : undefined,
          minSteps: Number.isFinite(minSteps) && minSteps > 0 ? minSteps : c.minSteps,
          regularize,
          conserveMass,
          diagnosticSteps: diagnostic ? [20_000, 200_000, 1_000_000, 4_000_000] : undefined,
          onProgress: ({ steps, residual, elapsedMs }) => {
            out.textContent =
              `Running Re=${c.Re} on ${H}²…\n` +
              `  ${steps.toLocaleString()} steps · residual ${residual.toExponential(2)} ` +
              `· ${(elapsedMs / 1000).toFixed(0)} s`;
            const hh = hooks().cavity;
            if (hh) {
              hh.totalSteps = steps;
              hh.residual = residual;
            }
          },
        });

        out.textContent = `${formatCavityRun(r)}\n\n${formatGhiaComparison(r.comparison)}`;
        if (!r.converged) {
          out.textContent +=
            `\n\nNOT CONVERGED — the run hit its step/time budget with the residual still ` +
            `falling. These numbers are not a result; raise the budget, never the bar.`;
        }

        const mk = (w: number, hgt: number) => {
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = hgt;
          cv.style.border = '1px solid var(--border)';
          plots.append(cv);
          return cv;
        };
        drawResidual(mk(460, 240), r);
        drawProfile(
          mk(300, 240),
          r.centerlines.y,
          r.centerlines.u,
          GHIA_U.y,
          c.Re === 100 ? GHIA_U.re100 : GHIA_U.re1000,
          'u/uLid on x=0.5 (y up)',
        );
        drawProfile(
          mk(300, 240),
          r.centerlines.x,
          r.centerlines.v,
          GHIA_V.x,
          c.Re === 100 ? GHIA_V.re100 : GHIA_V.re1000,
          'v/uLid on y=0.5 (x up)',
        );

        Object.assign(hooks().cavity!, {
          done: true,
          tau: r.tau,
          totalSteps: r.totalSteps,
          elapsedMs: r.elapsedMs,
          converged: r.converged,
          stoppedOn: r.stoppedOn,
          diverged: r.diverged,
          residual: r.residual,
          residualSamples: r.residualHistory.length,
          residualTrace: decimate(r.residualHistory, 60),
          criterion: r.criterion,
          extrema: r.comparison.extrema,
          ghiaPass: r.comparison.pass,
          maxAbsErrorU: r.comparison.maxAbsErrorU,
          maxAbsErrorV: r.comparison.maxAbsErrorV,
          initialMass: r.initialMass,
          finalMass: r.finalMass,
          massDriftRel: r.massDriftRel,
          diagnostics: r.diagnostics,
        });
      } catch (e) {
        const msg = String(e);
        out.textContent += `\nERROR: ${msg}`;
        Object.assign(hooks().cavity!, { done: true, error: msg });
      } finally {
        for (const b of buttons.querySelectorAll('button')) b.disabled = false;
      }
    });
    buttons.append(btn);
  }
}
