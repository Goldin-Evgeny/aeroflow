import { SPHERE_CASES, sphereScene, type SphereCaseName, type LateralBC } from '@aeroflow/core';
import type { GpuCapabilities } from '../gpu/context';
import { ForcePlot } from './forcePlot';
import { hooks } from '../dev/testHooks';
import { deviceBindingCap } from '../gpu/ddfLayout';
import {
  runSphereCase,
  runSphereFp16Ab,
  runStlVsAnalytic,
  SPHERE_TARGETS,
} from '../sim/cases/sphereDrag';

/**
 * M7 sphere-drag validation page (step 10; dev route `?spheredrag`). Runs a selected case
 * on the GPU, streams the drag coefficient into a strip chart (instantaneous Cd + running
 * mean), and shows the literature target band with a pass/fail verdict. The FP16 A/B button
 * runs both storage modes and reports |ΔCd|/Cd (acceptance 4). This is the interactive
 * driver for the numbers that go on the M15 validation page; runs are long (tens of
 * thousands of steps), so a Stop button cancels cooperatively.
 */

const CASE_ORDER: SphereCaseName[] = ['Re100', 'Re1000', 'Re10000'];

export function mountSphereDrag(device: GPUDevice, caps: GpuCapabilities, root: HTMLElement): void {
  root.innerHTML = '';
  root.classList.add('page');

  // e2e overrides (spheredrag.gpu.spec.ts): `?tc=N` lengthens the run for drift/A/B
  // confirmation; `?lateral=freeslip` swaps the far field to H11 free-slip (the Re=10⁴
  // confinement lever). Both flow through to runSphereCase's opts.
  const params = new URLSearchParams(location.search);
  const tcRaw = Number(params.get('tc'));
  const totalConvectiveTimes = Number.isFinite(tcRaw) && tcRaw > 0 ? tcRaw : undefined;
  const lp = params.get('lateral');
  const lateralBC: LateralBC | undefined =
    lp === 'freeslip' || lp === 'wall' || lp === 'freestream' ? lp : undefined;
  const runOpts = { lateralBC, totalConvectiveTimes };
  let runId = 0;

  const h = document.createElement('h2');
  h.className = 'page-title';
  h.textContent = 'M7 — Sphere drag ladder';
  const sub = document.createElement('p');
  sub.className = 'subtitle';
  const lateralLabel =
    lateralBC === 'freeslip'
      ? 'H11 free-slip (specular reflection, no confinement)'
      : lateralBC === 'wall'
        ? 'no-slip solid shell'
        : 'free-stream velocity inlets (slip-like far field)';
  sub.innerHTML =
    'Screening-grade, uniform grid. Cd = Fx / (½·ρ₀·u²·πR²), lattice units. ' +
    `Lateral BC: ${lateralLabel}. ` +
    (totalConvectiveTimes ? `T_c override: ${totalConvectiveTimes}. ` : '') +
    (caps.hasF16 ? 'shader-f16 available.' : 'shader-f16 NOT granted — A/B disabled.');

  const controls = document.createElement('div');
  controls.className = 'button-row';

  const info = document.createElement('pre');
  info.className = 'readout';

  const plot = new ForcePlot(560, 200);
  const verdict = document.createElement('div');
  verdict.className = 'verdict';
  const setVerdict = (text: string, status: 'ok' | 'bad' | 'warn' | 'muted'): void => {
    verdict.className = status === 'muted' ? 'verdict muted' : `verdict status-${status}`;
    verdict.textContent = text;
  };

  root.append(h, sub, controls, info, plot.element, verdict);

  const sceneSummary = (name: SphereCaseName): string => {
    const s = sphereScene(SPHERE_CASES[name]);
    const t = SPHERE_TARGETS[name];
    return [
      `${SPHERE_CASES[name].name}   Re=${s.Re}`,
      `grid ${s.nx}×${s.ny}×${s.nz} = ${((s.nx * s.ny * s.nz) / 1e6).toFixed(1)}M cells   D=${s.D} (R=${s.radius})`,
      `ν=${s.nu.toExponential(3)}  τ₀=${s.tau.toFixed(5)}  ω=${s.omega.toFixed(4)}  LES ${s.les ? 'on' : 'off'}`,
      `blockage ${(s.blockage * 100).toFixed(2)}%   cells/D ${s.cellsPerDiameter}   T_c=${s.convectiveTimeSteps} steps`,
      `target Cd ${t.target}  band [${t.band[0]}, ${t.band[1]}]  (${t.note})`,
    ].join('\n');
  };

  let running = false;
  let stop = false;
  const buttons: HTMLButtonElement[] = [];
  const setBusy = (b: boolean) => {
    running = b;
    for (const btn of buttons) btn.disabled = b && btn.textContent !== 'Stop';
  };

  const mkBtn = (label: string, fn: () => void, testId?: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (testId) btn.setAttribute('data-testid', testId);
    btn.onclick = fn;
    controls.append(btn);
    buttons.push(btn);
    return btn;
  };

  async function runCase(name: SphereCaseName): Promise<void> {
    if (running) return;
    setBusy(true);
    stop = false;
    const id = ++runId;
    info.textContent = sceneSummary(name) + '\n\nrunning…';
    verdict.textContent = '';
    hooks().sphereDrag = {
      runId: id,
      case: name,
      kind: 'run',
      done: false,
      lateralBC,
      totalConvectiveTimes,
    };
    try {
      const res = await runSphereCase(device, name, {
        ...runOpts,
        hasTimestamp: caps.hasTimestamp,
        maxBindingBytes: deviceBindingCap(caps),
        maxStorageBuffersPerStage: caps.maxStorageBuffersPerShaderStage,
        onSample: ({ cd, meanCd, fy, fz }) => {
          plot.push(cd, meanCd);
          plot.setReadouts({ meanCd, clAmplitude: NaN, st: null, periods: 0 });
          setVerdict(
            `Cd(t)=${cd.toFixed(4)}  running mean=${meanCd.toFixed(4)}  Fy=${fy.toExponential(2)} Fz=${fz.toExponential(2)}`,
            'muted',
          );
        },
        shouldStop: () => stop,
      });
      if (res.diverged) {
        setVerdict(
          `DIVERGED at step ${res.lastStep} — solver went non-finite (near-floor τ Mach ` +
            `instability). Raise D or u, or enable regularization/LES for this case.`,
          'bad',
        );
        hooks().sphereDrag = {
          runId: id,
          case: name,
          kind: 'run',
          done: true,
          diverged: true,
          lateralBC,
          totalConvectiveTimes,
          totalSteps: res.totalSteps,
        };
        return;
      }
      const t = SPHERE_TARGETS[name];
      const cd = res.stats.meanCd;
      const inBand = cd >= t.band[0] && cd <= t.band[1];
      const driftOk = name !== 'Re10000' || res.stats.runningMeanDrift < 0.03;
      const pass = inBand && driftOk;
      hooks().sphereDrag = {
        runId: id,
        case: name,
        kind: 'run',
        done: true,
        diverged: false,
        lateralBC,
        totalConvectiveTimes,
        totalSteps: res.totalSteps,
        meanCd: cd,
        driftPct: res.stats.runningMeanDrift * 100,
        meanAbsFy: res.meanAbsFy,
        meanAbsFz: res.meanAbsFz,
        band: t.band,
        inBand,
      };
      setVerdict(
        `${pass ? 'PASS' : 'FAIL'}  mean Cd=${cd.toFixed(4)}  target ${t.target} [${t.band[0]}, ${t.band[1]}]  ` +
          `drift=${(res.stats.runningMeanDrift * 100).toFixed(2)}%  ` +
          `|Fy|=${res.meanAbsFy.toExponential(2)} |Fz|=${res.meanAbsFz.toExponential(2)}  ` +
          `(${res.stats.samples} samples, ${res.totalSteps} steps)`,
        pass ? 'ok' : 'bad',
      );
    } catch (e) {
      setVerdict(`error: ${String(e)}`, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function runAb(name: SphereCaseName): Promise<void> {
    if (running || !caps.hasF16) return;
    setBusy(true);
    stop = false;
    const id = ++runId;
    info.textContent = sceneSummary(name) + '\n\nFP16 vs FP32 A/B running (two runs)…';
    verdict.textContent = '';
    hooks().sphereDrag = {
      runId: id,
      case: name,
      kind: 'ab',
      done: false,
      lateralBC,
      totalConvectiveTimes,
    };
    try {
      const ab = await runSphereFp16Ab(device, name, {
        ...runOpts,
        hasF16: caps.hasF16,
        hasTimestamp: caps.hasTimestamp,
        maxBindingBytes: deviceBindingCap(caps),
        maxStorageBuffersPerStage: caps.maxStorageBuffersPerShaderStage,
        onSample: ({ cd, meanCd }) => {
          plot.push(cd, meanCd);
        },
        shouldStop: () => stop,
      });
      const diverged = ab.fp32.diverged || ab.fp16.diverged;
      hooks().sphereDrag = {
        runId: id,
        case: name,
        kind: 'ab',
        done: true,
        diverged,
        lateralBC,
        totalConvectiveTimes,
        totalSteps: ab.fp32.totalSteps,
        meanCd: ab.fp32.stats.meanCd,
        cdA: ab.fp32.stats.meanCd,
        cdB: ab.fp16.stats.meanCd,
        relDiff: ab.relDiff,
        abPass: ab.pass,
      };
      if (diverged) {
        setVerdict(
          `A/B DIVERGED (fp32 ${ab.fp32.diverged ? 'diverged' : 'ok'}, fp16 ${ab.fp16.diverged ? 'diverged' : 'ok'})`,
          'bad',
        );
        return;
      }
      setVerdict(
        `A/B ${ab.pass ? 'PASS' : 'FAIL'}  Cd fp32=${ab.fp32.stats.meanCd.toFixed(4)}  ` +
          `fp16=${ab.fp16.stats.meanCd.toFixed(4)}  relΔ=${(ab.relDiff * 100).toFixed(2)}% (bar ≤ 2%)`,
        ab.pass ? 'ok' : 'bad',
      );
    } catch (e) {
      setVerdict(`error: ${String(e)}`, 'bad');
    } finally {
      setBusy(false);
    }
  }

  // M8 acceptance 2: STL sphere (voxelizer path) vs the analytic mask, Re=1000, ≤2% ΔCd.
  async function runStlAb(): Promise<void> {
    if (running) return;
    setBusy(true);
    stop = false;
    info.textContent =
      sceneSummary('Re1000') +
      '\n\nM8 acceptance 2 — analytic mask vs voxelized 20,480-tri icosphere (two runs)…';
    verdict.textContent = '';
    try {
      const ab = await runStlVsAnalytic(device, {
        hasTimestamp: caps.hasTimestamp,
        maxBindingBytes: deviceBindingCap(caps),
        maxStorageBuffersPerStage: caps.maxStorageBuffersPerShaderStage,
        onSample: ({ cd, meanCd }) => {
          plot.push(cd, meanCd);
        },
        shouldStop: () => stop,
      });
      const cal = ab.stlScene.calibration;
      info.textContent =
        sceneSummary('Re1000') +
        `\n\nSTL sphere: ${ab.stlScene.triangleCount} tris, mesh R=${cal.radius.toFixed(3)} ` +
        `(calibrated −${cal.radiusOffset.toFixed(3)} cells for the conservative-hull offset)\n` +
        `voxels ${ab.stlScene.sphereVoxels} vs analytic ${ab.stlScene.analyticVoxels} ` +
        `(Δ ${(ab.stlScene.voxelCountMismatch * 100).toFixed(2)}%)`;
      if (ab.analytic.diverged || ab.stl.diverged) {
        setVerdict(
          `DIVERGED (analytic ${ab.analytic.diverged ? 'diverged' : 'ok'}, stl ${ab.stl.diverged ? 'diverged' : 'ok'})`,
          'bad',
        );
        return;
      }
      hooks().sphereDrag = {
        runId: ++runId,
        case: 'Re1000',
        kind: 'stlab',
        done: true,
        diverged: ab.analytic.diverged || ab.stl.diverged,
        meanCd: ab.analytic.stats.meanCd,
        cdA: ab.analytic.stats.meanCd,
        cdB: ab.stl.stats.meanCd,
        relDiff: ab.relDiff,
        abPass: ab.pass,
      };
      setVerdict(
        `M8 acc-2 ${ab.pass ? 'PASS' : 'FAIL'}  Cd analytic=${ab.analytic.stats.meanCd.toFixed(4)}  ` +
          `stl=${ab.stl.stats.meanCd.toFixed(4)}  relΔ=${(ab.relDiff * 100).toFixed(2)}% (bar ≤ 2%)`,
        ab.pass ? 'ok' : 'bad',
      );
    } catch (e) {
      setVerdict(`error: ${String(e)}`, 'bad');
    } finally {
      setBusy(false);
    }
  }

  for (const name of CASE_ORDER)
    mkBtn(`Run ${SPHERE_CASES[name].name}`, () => void runCase(name), `sphere-run-${name}`);
  if (caps.hasF16) {
    for (const name of CASE_ORDER)
      mkBtn(`A/B ${SPHERE_CASES[name].name}`, () => void runAb(name), `sphere-ab-${name}`);
  }
  mkBtn('M8: STL vs analytic Re=1000', () => void runStlAb(), 'sphere-stlab');
  mkBtn(
    'Stop',
    () => {
      stop = true;
    },
    'sphere-stop',
  );

  info.textContent = sceneSummary('Re100');
}
