import {
  AIJ_CASE_A,
  formatAijCitation,
  powerLawProfile,
  logLawProfile,
  type AblSpec,
} from '@aeroflow/core';
import {
  AIJ_FIXTURE,
  CASE_A_GATES,
  MIN_CELLS_PER_B,
  CaseARun,
  STEADY_DRIFT,
  type CaseARunOptions,
  type CaseASampleResult,
} from '../sim/cases/aijCaseA';
import type { GpuCapabilities } from '../gpu/context';
import { hooks } from '../dev/testHooks';
import { deviceBindingCap } from '../gpu/ddfLayout';

/**
 * M10 validation + demo page (route ?aij): AIJ Case A scoring run (acceptance 4),
 * the empty-domain fetch check (acceptance 3), and the demo scene (acceptance 5 —
 * wind-direction dial + ABL profile editor with a live preview plot).
 *
 * e2e override: `?b=N` sets cells-per-building-width (SwiftShader needs tiny grids;
 * the acceptance runs use ≥16 on real GPUs).
 */

const COLORS = { bg: '#0b0e13', border: '#2d333b', dim: '#8b949e', ok: '#3fb950', bad: '#f85149' };

export function mountAij(device: GPUDevice, caps: GpuCapabilities, root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText =
    'font:13px/1.5 ui-monospace,monospace;color:#e6edf3;padding:16px;max-width:900px';

  const h = document.createElement('h2');
  h.textContent = 'M10 — ABL wind tunnel: AIJ Case A (1:1:2 building)';
  const sub = document.createElement('p');
  sub.style.color = COLORS.dim;
  sub.textContent =
    'VDI 3783/9 gates: hit rate q ≥ 0.66 (allowed 0.25), Pearson r ≥ 0.70 on time-averaged ' +
    'mean speeds; empty-domain fetch ≤ 5%. Screening-grade LES, never compliance-grade.';
  root.append(h, sub);

  if (AIJ_FIXTURE.synthetic) {
    const warn = document.createElement('p');
    warn.style.cssText = 'color:#d29922;border:1px solid #d29922;border-radius:4px;padding:8px';
    warn.dataset.testid = 'aij-synthetic-warning';
    warn.textContent =
      'SYNTHETIC fixture loaded — the AIJ download page needs a real browser (WAF). Runs below ' +
      'exercise the pipeline only and are NOT validation results. See the fixture source field.';
    root.append(warn);
  }

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center';
  const mkBtn = (label: string, testid: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.testid = testid;
    b.style.cssText =
      'padding:6px 10px;background:#21262d;color:#e6edf3;border:1px solid #444c56;border-radius:4px;cursor:pointer';
    controls.append(b);
    return b;
  };
  const scoreBtn = mkBtn('Run Case A (score)', 'aij-score');
  const fetchBtn = mkBtn('Empty-domain fetch check', 'aij-fetch');
  const demoBtn = mkBtn('Demo scene', 'aij-demo');
  const stopBtn = mkBtn('Stop', 'aij-stop');
  stopBtn.disabled = true;

  const bSel = document.createElement('select');
  bSel.style.cssText =
    'background:#21262d;color:#e6edf3;border:1px solid #444c56;border-radius:4px;padding:5px';
  for (const b of [16, 24, 32]) bSel.append(new Option(`${b} cells / b`, String(b)));
  const bOverride = Number(new URLSearchParams(location.search).get('b'));
  if (Number.isFinite(bOverride) && bOverride > 0) {
    bSel.append(new Option(`${bOverride} cells / b (e2e override)`, String(bOverride)));
    bSel.value = String(bOverride);
  }
  controls.append(bSel);
  root.append(controls);

  // Demo controls (acceptance 5): wind dial + ABL editor with a live preview plot.
  const demoBox = document.createElement('div');
  demoBox.style.cssText = `border:1px solid ${COLORS.border};border-radius:4px;padding:10px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:14px;align-items:center`;
  const dial = document.createElement('input');
  dial.type = 'range';
  dial.min = '0';
  dial.max = '360';
  dial.value = '0';
  dial.dataset.testid = 'aij-dial';
  const dialLabel = document.createElement('label');
  dialLabel.style.color = COLORS.dim;
  dialLabel.append('wind ', dial);
  const dialDeg = document.createElement('span');
  dialDeg.textContent = '0°';
  dialLabel.append(dialDeg);

  const kindSel = document.createElement('select');
  kindSel.append(new Option('power law', 'power'), new Option('log law', 'log'));
  kindSel.dataset.testid = 'aij-kind';
  const num = (v: number, step: string, testid: string): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'number';
    i.value = String(v);
    i.step = step;
    i.dataset.testid = testid;
    i.style.cssText = 'width:64px;background:#21262d;color:#e6edf3;border:1px solid #444c56';
    return i;
  };
  const alphaIn = num(0.25, '0.05', 'aij-alpha');
  const z0In = num(0.5, '0.1', 'aij-z0');
  const uRefIn = num(6, '0.5', 'aij-uref');
  const zRefIn = num(10, '1', 'aij-zref');
  const lbl = (text: string, el: HTMLElement): HTMLLabelElement => {
    const l = document.createElement('label');
    l.style.color = COLORS.dim;
    l.append(`${text} `, el);
    return l;
  };
  const preview = document.createElement('canvas');
  preview.width = 180;
  preview.height = 120;
  preview.style.cssText = `background:${COLORS.bg};border:1px solid ${COLORS.border}`;
  demoBox.append(
    dialLabel,
    lbl('profile', kindSel),
    lbl('α', alphaIn),
    lbl('z0 (m)', z0In),
    lbl('uRef (m/s)', uRefIn),
    lbl('zRef (m)', zRefIn),
    preview,
  );
  root.append(demoBox);

  const spec = (): AblSpec => ({
    kind: kindSel.value as 'power' | 'log',
    uRef: Number(uRefIn.value) || 6,
    zRef: Number(zRefIn.value) || 10,
    alpha: Number(alphaIn.value) || 0.25,
    z0: Number(z0In.value) || 0.5,
    uStar: 0.6,
  });

  const drawPreview = (): void => {
    const ctx = preview.getContext('2d')!;
    const { width: w, height: hh } = preview;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, hh);
    const s = spec();
    const zMax = 3 * s.zRef;
    let uMax = 0;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const z = (i / 60) * zMax;
      const u =
        s.kind === 'power'
          ? powerLawProfile(z, s.zRef, s.uRef, s.alpha)
          : logLawProfile(z, s.z0 ?? 0.5, s.uStar ?? 0.6);
      uMax = Math.max(uMax, u);
      pts.push([u, z]);
    }
    ctx.strokeStyle = '#58a6ff';
    ctx.beginPath();
    for (const [u, z] of pts) {
      const px = 6 + (u / (uMax || 1)) * (w - 12);
      const py = hh - 6 - (z / zMax) * (hh - 12);
      if (z === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`u(z) 0…${uMax.toFixed(1)} m/s, z 0…${zMax.toFixed(0)} m`, 6, 12);
    hooks().aij = { ...(hooks().aij ?? {}), previewUMax: uMax };
  };
  drawPreview();
  for (const el of [kindSel, alphaIn, z0In, uRefIn, zRefIn]) {
    el.addEventListener('input', () => {
      drawPreview();
      if (mode === 'demo') restart('demo');
    });
  }
  dial.addEventListener('input', () => {
    dialDeg.textContent = `${dial.value}°`;
    if (mode === 'demo') restart('demo');
  });

  const info = document.createElement('pre');
  info.style.cssText = `background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:4px;padding:10px;white-space:pre-wrap`;
  info.textContent = 'idle — pick a run';
  const verdict = document.createElement('div');
  verdict.style.cssText = 'margin:10px 0;font-size:15px;font-weight:bold';
  verdict.dataset.testid = 'aij-verdict';
  const slice = document.createElement('canvas');
  slice.style.cssText = `image-rendering:pixelated;border:1px solid ${COLORS.border};max-width:100%`;
  const table = document.createElement('pre');
  table.style.cssText = info.style.cssText;
  root.append(info, verdict, slice, table);

  // AIJ allows redistribution of the derived Case A fixture on condition that users are
  // told what to cite and that AIJ does not warrant it (see NOTICE). Both render here,
  // beside the score, rather than only in the repository's licensing files.
  const attribution = AIJ_FIXTURE.attribution;
  if (attribution) {
    const credit = document.createElement('footer');
    credit.style.cssText = `margin-top:14px;padding-top:10px;border-top:1px solid ${COLORS.border};color:${COLORS.dim};font-size:11px;overflow-wrap:anywhere`;
    credit.dataset.testid = 'aij-attribution';
    const cite = document.createElement('p');
    cite.textContent = `Cite: ${formatAijCitation(attribution)}`;
    const warranty = document.createElement('p');
    warranty.textContent = attribution.disclaimer;
    credit.append(cite, warranty);
    root.append(credit);
  }

  let run: CaseARun | null = null;
  let mode: CaseARunOptions['mode'] | null = null;
  let timer = 0;

  const stop = (): void => {
    clearTimeout(timer);
    timer = 0;
    run?.destroy();
    run = null;
    mode = null;
    stopBtn.disabled = true;
    scoreBtn.disabled = fetchBtn.disabled = demoBtn.disabled = false;
  };

  const drawSlice = (r: CaseASampleResult): void => {
    // Top view at the measurement plane: |u| over (x, z), building visible as a hole.
    if (!run) return;
    const s = run.scene;
    slice.width = s.nx;
    slice.height = s.nz;
    const ctx = slice.getContext('2d')!;
    const img = ctx.createImageData(s.nx, s.nz);
    const y = Math.max(1, Math.round(s.heightToY(AIJ_CASE_A.measurementZ)));
    for (let z = 0; z < s.nz; z++)
      for (let x = 0; x < s.nx; x++) {
        const i = x + s.nx * (y + s.ny * z);
        const mag = Math.hypot(r.macro.ux[i], r.macro.uy[i], r.macro.uz[i]) / s.uLattice;
        const o = 4 * (x + s.nx * z);
        img.data[o] = Math.min(255, 40 + mag * 400);
        img.data[o + 1] = Math.min(255, 20 + mag * 240);
        img.data[o + 2] = 80;
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  };

  const restart = (m: CaseARunOptions['mode']): void => {
    stop();
    mode = m;
    stopBtn.disabled = false;
    scoreBtn.disabled = fetchBtn.disabled = demoBtn.disabled = true;
    hooks().aij = {
      ...(hooks().aij ?? {}),
      runId: (hooks().aij?.runId ?? 0) + 1,
      mode: m,
      totalSteps: 0,
      windows: 0,
    };
    verdict.textContent = '';
    table.textContent = '';
    try {
      run = new CaseARun(device, {
        mode: m,
        cellsPerB: Number(bSel.value),
        windDeg: Number(dial.value),
        demoSpec: spec(),
        precision: 'fp32',
        hasF16: caps.hasF16,
        maxBindingBytes: deviceBindingCap(caps),
        maxStorageBuffersPerStage: caps.maxStorageBuffersPerShaderStage,
      });
    } catch (err) {
      info.textContent = `failed to build scene: ${err instanceof Error ? err.message : String(err)}`;
      stop();
      return;
    }
    const s = run.scene;
    info.textContent = [
      `mode ${m}   grid ${s.nx}×${s.ny}×${s.nz} = ${((s.nx * s.ny * s.nz) / 1e6).toFixed(1)}M cells   dx ${(s.dx * 1000).toFixed(1)} mm`,
      `building b=${s.bCells} H=${s.hCells} cells   wind ${s.windDeg}°   blockage ${(s.blockage * 100).toFixed(2)}%`,
      `τ ${s.tau.toFixed(6)} (LES+regularized)   u_lat ${s.uLattice}   T_conv ${s.convectiveTimeSteps} steps`,
      `averaging: cumulative time-mean after a 3-flow-through transient discard (AIJ ≥10 flow-throughs)`,
      `steadiness gate: driftScaled (peak-normalized change of the cumulative mean between checkpoints) < ${STEADY_DRIFT * 100}%`,
    ].join('\n');
    const stepsPerSample = Math.max(10, Math.round(s.convectiveTimeSteps / 10));
    const tick = async (): Promise<void> => {
      if (!run) return;
      const r = await run.advance(stepsPerSample);
      drawSlice(r);
      // driftScaled is the steadiness gate quantity (peak-normalized); the raw per-point
      // `drift` is shown only in parentheses as a diagnostic because it can be pinned high
      // forever by a near-zero near-wall mean — it is NOT what decides steadiness anymore
      // (M10, 2026-07-20). Leading with drift here would read as "drift 150% … steady YES".
      const last = r.trace?.at(-1);
      const scaled =
        last && Number.isFinite(last.driftScaled) ? (last.driftScaled * 100).toFixed(2) + '%' : '—';
      const driftDiag =
        r.drift === Infinity
          ? ''
          : `   (raw drift ${(r.drift * 100).toFixed(2)}%${last ? ` @node ${last.driftIndex + 1}` : ''})`;
      const head = `step ${r.totalSteps.toLocaleString()}   windows ${r.windows}   driftScaled ${scaled}${driftDiag}   steady ${r.steady ? 'YES' : 'not yet'}`;
      hooks().aij = {
        ...(hooks().aij ?? {}),
        mode: m,
        synthetic: run.synthetic,
        underResolved: run.underResolved,
        totalSteps: r.totalSteps,
        windows: r.windows,
        drift: r.drift,
        steady: r.steady,
        q: r.score?.q,
        r: r.score?.r,
        fetchMaxRel: r.fetch?.maxRel,
        fetchPass: r.fetch?.pass,
        trace: r.trace,
      };
      if (m === 'score' && r.score) {
        const { q, r: rr, rows } = r.score;
        table.textContent =
          `point (x, y, z m)          measured   sim     hit\n` +
          rows
            .map(
              (row) =>
                `(${row.point.x.toFixed(2)}, ${row.point.y.toFixed(2)}, ${row.point.z.toFixed(3)})`.padEnd(
                  27,
                ) + `${row.point.u.toFixed(3)}      ${row.sim.toFixed(3)}   ${row.hit ? '✓' : '✗'}`,
            )
            .join('\n');
        const pass = q >= CASE_A_GATES.q && rr >= CASE_A_GATES.r;
        if (run.synthetic) {
          verdict.style.color = '#d29922';
          verdict.textContent = `SYNTHETIC pipeline check — q ${q.toFixed(3)}, r ${rr.toFixed(3)} (no verdict on fake data)`;
        } else if (run.underResolved) {
          // Real data, but below the spec's ≥16 cells/b: a number, never a verdict.
          verdict.style.color = '#d29922';
          verdict.textContent = `UNDER-RESOLVED pipeline check (${MIN_CELLS_PER_B} cells/b required) — q ${q.toFixed(3)}, r ${rr.toFixed(3)} (no verdict)`;
        } else if (r.steady) {
          verdict.style.color = pass ? COLORS.ok : COLORS.bad;
          verdict.textContent = `${pass ? 'PASS' : 'FAIL'}  q ${q.toFixed(3)} (gate ≥ ${CASE_A_GATES.q})   r ${rr.toFixed(3)} (gate ≥ ${CASE_A_GATES.r})`;
        } else {
          verdict.style.color = COLORS.dim;
          verdict.textContent = `q ${q.toFixed(3)}   r ${rr.toFixed(3)} (not steady yet — no verdict)`;
        }
      } else if (m === 'fetch' && r.fetch) {
        table.textContent =
          'node y   sim u      inlet u    rel\n' +
          r.fetch.rows
            .map((row) => {
              const rel = Math.abs(row.sim - row.ref) / row.ref;
              return `${String(row.y).padEnd(8)} ${row.sim.toFixed(6)}   ${row.ref.toFixed(6)}   ${(rel * 100).toFixed(2)}%`;
            })
            .join('\n');
        if (r.steady) {
          verdict.style.color = r.fetch.pass ? COLORS.ok : COLORS.bad;
          verdict.textContent = `${r.fetch.pass ? 'PASS' : 'FAIL'}  max deviation ${(r.fetch.maxRel * 100).toFixed(2)}% (gate ≤ 5%, node 2 → H)`;
        } else {
          verdict.style.color = COLORS.dim;
          verdict.textContent = `max deviation ${(r.fetch.maxRel * 100).toFixed(2)}% (not steady yet)`;
        }
      }
      info.textContent = info.textContent.split('\n').slice(0, 4).join('\n') + '\n' + head;
      if (run) timer = window.setTimeout(() => void tick(), 0);
    };
    timer = window.setTimeout(() => void tick(), 0);
  };

  scoreBtn.onclick = () => restart('score');
  fetchBtn.onclick = () => restart('fetch');
  demoBtn.onclick = () => restart('demo');
  stopBtn.onclick = stop;
}
