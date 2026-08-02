import { runParity, type ParityMatrix, type ParityReport } from './parity';
import { runForceParity } from './forceParity';
import {
  runCylinderCase,
  runH10HighReRetry,
  runV6NonInterference,
  runStabilityEnvelope,
} from './cylinderValidation';
import { ForcePlot } from '../ui/forcePlot';
import { hooks } from './testHooks';

const BTN_CSS =
  'background:#21262d;color:#e6edf3;border:1px solid #2d333b;border-radius:6px;padding:6px 12px;cursor:pointer;margin-right:6px';

/** Lets the panel suspend the interactive loop so dev runs get the GPU to themselves. */
export interface SimSuspender {
  suspend: () => void;
  resume: () => void;
}

/**
 * Dev-only parity panel overlay (docs/handoff/H6-parity-panel.md §5). Mounted only when
 * the page URL contains `?dev`. One button runs the CPU↔GPU parity matrix and renders
 * the results plus a copy-to-clipboard summary line for commit messages.
 */
export function mountParityPanel(device: GPUDevice, sim?: SimSuspender): void {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:12px',
    'z-index:1000',
    'background:#0e1116',
    'border:1px solid #2d333b',
    'border-radius:6px',
    'padding:12px',
    'font:12px/1.5 ui-monospace,monospace',
    'color:#e6edf3',
    'max-width:520px',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'CPU↔GPU parity (H6)';
  title.style.cssText = 'font-weight:600;margin-bottom:8px';

  const btn = document.createElement('button');
  btn.textContent = 'Run parity';
  btn.style.cssText =
    'background:#21262d;color:#e6edf3;border:1px solid #2d333b;border-radius:6px;padding:6px 12px;cursor:pointer';

  const out = document.createElement('div');
  out.style.cssText = 'margin-top:10px;white-space:pre-wrap';

  const render = (r: ParityReport) => {
    hooks().parityReport = r;
    const rows = r.results
      .map((c) => {
        const cells = c.runs
          .map((run) => {
            const ok = run.pass ? '✓' : '✗';
            return `N=${run.n} ${run.maxFErr.toExponential(1)} (≤${run.gate.toExponential(0)}) ${ok}`;
          })
          .join('   ');
        return `${c.key.padEnd(10)} ${cells}`;
      })
      .join('\n');
    out.innerHTML = '';
    const pre = document.createElement('div');
    pre.textContent = `${r.pass ? 'PASS ✅' : 'FAIL ❌'}\n${rows}`;
    pre.style.color = r.pass ? '#3fb950' : '#f85149';
    const copy = document.createElement('button');
    copy.textContent = 'copy summary';
    copy.style.cssText =
      'margin-top:8px;background:#21262d;color:#9aa4af;border:1px solid #2d333b;border-radius:6px;padding:3px 8px;cursor:pointer';
    copy.onclick = () => void navigator.clipboard?.writeText(r.summary);
    out.append(pre, copy);
  };

  btn.style.cssText = BTN_CSS;
  btn.dataset.testid = 'parity-run';
  // `?dev&parityQuick` runs the reduced N=10 slice — the Tier A e2e path, where the full
  // matrix does not finish in a sane budget on SwiftShader. Interactive use gets the full
  // matrix by default; see ParityMatrix in dev/parity.ts.
  const matrix: ParityMatrix = new URLSearchParams(location.search).has('parityQuick')
    ? 'quick'
    : 'full';
  btn.textContent = matrix === 'quick' ? 'Run parity matrix (quick)' : btn.textContent;
  btn.onclick = async () => {
    btn.disabled = true;
    out.textContent = 'running…';
    sim?.suspend();
    delete hooks().parityReport;
    delete hooks().parityError;
    delete hooks().parityProgress;
    try {
      render(
        await runParity(device, matrix, (step) => {
          hooks().parityProgress = step;
          out.textContent = `running… ${step}`;
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.textContent = `error: ${msg}`;
      // Mirror it into the hooks: an e2e run that only polls `parityReport` would otherwise
      // sit until its timeout and report "undefined", hiding the actual cause.
      hooks().parityError = msg;
    } finally {
      sim?.resume();
      btn.disabled = false;
    }
  };

  el.append(title, btn, out);
  mountM4Section(el, device, sim);
  document.body.append(el);
}

/**
 * M4 force section: the CPU↔GPU force-parity check (run this FIRST) and the two cylinder
 * validation cases with a live Cd/Cl strip-chart. All GPU-measured — hardware only.
 */
function mountM4Section(parent: HTMLElement, device: GPUDevice, sim?: SimSuspender): void {
  const hr = document.createElement('div');
  hr.style.cssText = 'border-top:1px solid #2d333b;margin:12px 0 8px';
  const title = document.createElement('div');
  title.textContent = 'M4 forces — momentum exchange (H2)';
  title.style.cssText = 'font-weight:600;margin-bottom:8px';

  const row = document.createElement('div');
  row.style.cssText = 'margin-bottom:8px';
  const fpBtn = document.createElement('button');
  fpBtn.textContent = 'Force parity';
  fpBtn.style.cssText = BTN_CSS;
  const re100Btn = document.createElement('button');
  re100Btn.textContent = 'Cylinder Re=100';
  re100Btn.style.cssText = BTN_CSS;
  const re200Btn = document.createElement('button');
  re200Btn.textContent = 'Cylinder Re=200';
  re200Btn.style.cssText = BTN_CSS;
  // M5 LES gates (M5 acceptance).
  const v6Btn = document.createElement('button');
  v6Btn.textContent = 'V6: Re=100 ±LES';
  v6Btn.style.cssText = BTN_CSS;
  const highReBtn = document.createElement('button');
  highReBtn.textContent = 'Stability envelope';
  highReBtn.style.cssText = BTN_CSS;
  const h10RetryBtn = document.createElement('button');
  h10RetryBtn.textContent = 'H10 retry: Re=10⁴/10⁵';
  h10RetryBtn.style.cssText = BTN_CSS;
  fpBtn.dataset.testid = 'force-parity';
  re100Btn.dataset.testid = 'cyl-re100';
  re200Btn.dataset.testid = 'cyl-re200';
  v6Btn.dataset.testid = 'v6-les';
  highReBtn.dataset.testid = 'stability-envelope';
  h10RetryBtn.dataset.testid = 'h10-high-re';
  row.append(fpBtn, re100Btn, re200Btn, v6Btn, highReBtn, h10RetryBtn);

  const out = document.createElement('div');
  out.style.cssText = 'white-space:pre-wrap;margin-bottom:8px';

  const plot = new ForcePlot();

  const setBusy = (busy: boolean) => {
    fpBtn.disabled = busy;
    re100Btn.disabled = busy;
    re200Btn.disabled = busy;
    v6Btn.disabled = busy;
    highReBtn.disabled = busy;
    h10RetryBtn.disabled = busy;
  };
  const showLine = (text: string, pass: boolean) => {
    hooks().m4 = { summary: text, pass };
    out.innerHTML = '';
    const pre = document.createElement('div');
    pre.textContent = text;
    pre.style.color = pass ? '#3fb950' : '#f85149';
    const copy = document.createElement('button');
    copy.textContent = 'copy';
    copy.style.cssText = `${BTN_CSS};margin-top:6px;padding:3px 8px;color:#9aa4af`;
    copy.onclick = () => void navigator.clipboard?.writeText(text);
    out.append(pre, copy);
  };

  fpBtn.onclick = async () => {
    setBusy(true);
    out.textContent = 'running force parity…';
    sim?.suspend();
    try {
      const r = await runForceParity(device);
      showLine(r.summary, r.pass);
    } catch (e) {
      out.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      sim?.resume();
      setBusy(false);
    }
  };

  const runCase = async (Re: number, lesCs?: number) => {
    setBusy(true);
    out.textContent = `running cylinder Re=${Re}… 0%`;
    sim?.suspend();
    try {
      const r = await runCylinderCase(device, Re, {
        plot,
        lesCs,
        onProgress: (frac) => {
          out.textContent = `running cylinder Re=${Re}… ${(frac * 100).toFixed(0)}%`;
        },
      });
      showLine(r.summary, r.pass);
    } catch (e) {
      out.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      sim?.resume();
      setBusy(false);
    }
  };
  re100Btn.onclick = () => void runCase(100);
  // Re=200 runs with LES on (Cs=0.1): plain TRT at Re=200 (bare τ≈0.519) is Mach-unstable
  // and diverged on the 2026-07-20 GPU run — the CPU reference reproduces it and shows LES
  // (or H10 regularization) tames it. The recorded M4 result used LES, so preserve that
  // configuration here; the separate H10 retry below measures the new operator.
  re200Btn.onclick = () => void runCase(200, 0.1);

  v6Btn.onclick = async () => {
    setBusy(true);
    out.textContent = 'running V6 (Re=100, LES off then on)… 0%';
    sim?.suspend();
    try {
      const r = await runV6NonInterference(device, {
        onProgress: (frac) => {
          out.textContent = `running V6 (Re=100 ±LES)… ${(frac * 100).toFixed(0)}%`;
        },
      });
      showLine(r.summary, r.pass);
    } catch (e) {
      out.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      sim?.resume();
      setBusy(false);
    }
  };

  highReBtn.onclick = async () => {
    setBusy(true);
    out.textContent = 'running stability envelope… 0%';
    sim?.suspend();
    try {
      const r = await runStabilityEnvelope(device, {
        onProgress: (frac, label) => {
          out.textContent = `running stability envelope ${label}… ${(frac * 100).toFixed(0)}%`;
        },
      });
      showLine(r.summary, r.pass);
    } catch (e) {
      out.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      sim?.resume();
      setBusy(false);
    }
  };

  h10RetryBtn.onclick = async () => {
    setBusy(true);
    out.textContent = 'running H10 high-Re retry… 0%';
    sim?.suspend();
    try {
      const r = await runH10HighReRetry(device, {
        onProgress: (frac, label) => {
          out.textContent = `running H10 high-Re retry ${label}… ${(frac * 100).toFixed(0)}%`;
        },
      });
      showLine(r.summary, r.pass);
    } catch (e) {
      out.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      sim?.resume();
      setBusy(false);
    }
  };

  parent.append(hr, title, row, out, plot.element);
}
