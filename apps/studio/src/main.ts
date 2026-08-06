import './style.css';
import { CellType } from '@aeroflow/core';
import { initWebGPU, WebGPUUnsupportedError, type GpuInit } from './gpu/context';
import {
  deviceBindingCap,
  maxAddressableCells,
  storageBindingsNeeded,
  MAX_DDF_BUFFERS,
} from './gpu/ddfLayout';
import { Lbm2D } from './sim/lbm2d';
import { buildHud } from './ui/hud';
import { attachPainting } from './ui/paint';
import { mountNav } from './ui/nav';
import { hooks } from './dev/testHooks';

// M1 grid. ~19 MB per distribution buffer — comfortably inside WebGPU default limits.
const NX = 1024;
const NY = 512;
const CYLINDER = { x: Math.floor(NX / 4), y: Math.floor(NY / 2), r: 20 };
const DEFAULTS = { uin: 0.07, tau: 0.56, brush: 8, paused: false };

/**
 * Mirror the negotiated device limits into the e2e hooks on every route.
 *
 * The resolution-wall record (docs/decisions/D1-resolution-wall.md) makes one browser
 * reading of `maxStorageBufferBindingSize` + `maxStorageBuffersPerShaderStage` the
 * precondition for changing the binding cap. Recording it at boot means any Tier-B page
 * load satisfies that precondition, instead of it needing a bespoke run.
 */
function recordCaps(gpu: GpuInit): void {
  const c = gpu.caps;
  const bindingCap = deviceBindingCap(c);
  hooks().caps = {
    adapter: gpu.description,
    maxBufferSize: c.maxBufferSize,
    maxStorageBufferBindingSize: c.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: c.maxStorageBuffersPerShaderStage,
    hasF16: c.hasF16,
    hasTimestamp: c.hasTimestamp,
    bindingCap,
    addressableCells: {
      fp32: maxAddressableCells('fp32', bindingCap),
      fp16: maxAddressableCells('fp16', bindingCap),
    },
    worstCaseStorageBindings: storageBindingsNeeded(MAX_DDF_BUFFERS, { forces: true, abl: true }),
  };
}

function setBaseFlags(sim: Lbm2D): void {
  // Inlet/outlet columns first; wall rows override the corners.
  for (let y = 0; y < NY; y++) {
    sim.flags[y * NX] = CellType.Inlet;
    sim.flags[y * NX + NX - 1] = CellType.Outlet;
  }
  for (let x = 0; x < NX; x++) {
    sim.flags[x] = CellType.Solid;
    sim.flags[(NY - 1) * NX + x] = CellType.Solid;
  }
}

function addCylinder(sim: Lbm2D): void {
  const { x: cx, y: cy, r } = CYLINDER;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) sim.flags[y * NX + x] = CellType.Solid;
    }
  }
}

function showFallback(app: HTMLElement, err: unknown): void {
  app.classList.add('fallback-host');
  const message =
    err instanceof WebGPUUnsupportedError
      ? err.message
      : `Failed to initialize WebGPU: ${err instanceof Error ? err.message : String(err)}`;
  app.innerHTML = `<div class="fallback" data-testid="fallback">
    <h1>AeroFlow</h1>
    <p>${message}</p>
    <p>AeroFlow runs a lattice-Boltzmann wind tunnel on your GPU and needs WebGPU:
    Chrome/Edge 113+, Safari 26+ (macOS/iOS), or Firefox 141+.</p>
  </div>`;
}

/**
 * Routes that take over the whole page. Each clears `#app` first and lazy-imports its
 * module so the default route does not pay for the others' bundles.
 *
 * `DEFAULT_ROUTE` is the 3D tunnel: until 2026-07-25 the default was the 2D playground, so
 * every visitor to the deployed site saw the M1 demo while nine later milestones sat behind
 * query flags nobody could discover. The 2D playground now lives at `?playground2d`.
 */
type Route = (app: HTMLElement, gpu: GpuInit) => Promise<void> | void;

const DEFAULT_ROUTE = 'demo3d';

const ROUTES: Record<string, Route> = {
  // M6: the 3D demo (Three.js cube-in-tunnel, slice planes, GPU streamline particles).
  demo3d: async (app, gpu) => {
    app.classList.add('demo3d-host');
    const { mountDemo3D } = await import('./ui/demo3d');
    await mountDemo3D(gpu.device, gpu.caps, app);
  },
  // M6: the browser 3D LBM benchmark page (the B3 launch asset).
  bench3d: async (app, gpu) => {
    const { mountBenchmark } = await import('./ui/benchmark');
    mountBenchmark(gpu.device, gpu.caps, gpu.description, app);
  },
  // M8: mesh import → wizard → voxelize → live drag in newtons (acceptance 1/5).
  import3d: async (app, gpu) => {
    const { mountImport3D } = await import('./ui/import3d');
    mountImport3D(gpu.device, gpu.caps, app);
  },
  // M7: sphere drag ladder vs the standard drag curve.
  spheredrag: async (app, gpu) => {
    const { mountSphereDrag } = await import('./ui/sphereDrag');
    mountSphereDrag(gpu.device, gpu.caps, app);
  },
  // M3: lid-driven cavity vs the Ghia 1982 tables (headline runs + overlay plots).
  cavity: async (app, gpu) => {
    const { mountCavity } = await import('./ui/cavity');
    mountCavity(gpu.device, app);
  },
  // M10: AIJ Case A validation + ABL demo.
  aij: async (app, gpu) => {
    const { mountAij } = await import('./ui/aij');
    mountAij(gpu.device, gpu.caps, app);
  },
  // M11: official AIJ Case C/E urban validation workbench.
  urban: async (app, gpu) => {
    const { mountAijUrban } = await import('./ui/aijUrban');
    mountAijUrban(gpu.device, gpu.caps, gpu.description, app);
  },
  // M9: Ahmed 25° long run in a worker (checkpoint/recovery/background-safe).
  ahmed: async (app) => {
    const { mountAhmed } = await import('./ui/ahmed');
    mountAhmed(app);
  },
  // M6 dev route: 3D GPU↔CPU parity harness.
  parity3d: async (app, gpu) => {
    const { mountParity3D } = await import('./sim/parity3d');
    await mountParity3D(gpu.device, app, gpu.caps.hasTimestamp);
  },
  // M9 dev route: raw-FP16 checkpoint restore + density-field bit identity.
  checkpointparity: async (app, gpu) => {
    const { mountCheckpointParity } = await import('./sim/checkpointParity');
    await mountCheckpointParity(gpu.device, app);
  },
  // M9 dev route: validate the τ_eff oracle before any τ_eff number is believed.
  tauoracle: async (app, gpu) => {
    const { mountTauOracleCheck } = await import('./sim/tauOracleCheck');
    await mountTauOracleCheck(gpu.device, app);
  },
  // M8 dev route: CPU↔GPU voxelization parity (bit-identical mask gate, H8 §4).
  voxparity: async (app, gpu) => {
    const { mountVoxParity } = await import('./dev/voxParity');
    await mountVoxParity(gpu.device, app);
  },
};

/**
 * Resolve the route from the query string. `?dev` selects the 2D playground with the H6
 * parity panel — the workflow CLAUDE.md rule 0 requires for every `.wgsl` commit — so it
 * must keep behaving exactly as it did when 2D was the default.
 */
function resolveRoute(q: URLSearchParams): string {
  if (q.has('playground2d') || q.has('dev')) return 'playground2d';
  for (const key of Object.keys(ROUTES)) if (q.has(key)) return key;
  return DEFAULT_ROUTE;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app');

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.width = NX;
  canvas.height = NY;
  canvasWrap.append(canvas);
  const sidebar = document.createElement('div');
  sidebar.className = 'sidebar';
  app.append(canvasWrap, sidebar);

  let gpu;
  try {
    gpu = await initWebGPU(canvas);
  } catch (err) {
    hooks().bootError = err instanceof Error ? err.message : String(err);
    app.innerHTML = '';
    showFallback(app, err);
    return;
  }
  recordCaps(gpu);
  gpu.device.lost.then((info) => {
    hooks().deviceLost = `${info.reason}: ${info.message}`;
  });

  const q = new URLSearchParams(location.search);
  const route = resolveRoute(q);
  // Highlight the default entry whether it was reached as './' or './?demo3d'.
  mountNav(route === DEFAULT_ROUTE ? '' : route);

  const mount = ROUTES[route];
  if (mount) {
    app.innerHTML = '';
    await mount(app, gpu);
    return;
  }

  app.classList.add('playground-host');

  const sim = new Lbm2D(gpu.device, NX, NY, {
    omega: 1 / DEFAULTS.tau,
    uin: DEFAULTS.uin,
  });
  setBaseFlags(sim);
  addCylinder(sim);
  sim.uploadFlags();
  sim.resetFlow();

  let paused = DEFAULTS.paused;
  let flagsDirty = false;
  let tau = DEFAULTS.tau;
  // Dev runs (parity, force parity, cylinder validation) spin up their own offscreen GPU
  // work; suspending the interactive loop while they run frees the GPU so the two don't
  // starve each other (the HUD would otherwise drop toward 0 MLUPs).
  let simSuspended = false;

  // Dev-only CPU↔GPU parity panel (docs/handoff/H6). Enabled with ?dev.
  if (new URLSearchParams(location.search).has('dev')) {
    const { mountParityPanel } = await import('./dev/panel');
    mountParityPanel(gpu.device, {
      suspend: () => {
        simSuspended = true;
      },
      resume: () => {
        simSuspended = false;
      },
    });
  }

  const reynolds = () => {
    const nu = (tau - 0.5) / 3;
    return (sim.currentParams.uin * 2 * CYLINDER.r) / nu;
  };

  const hud = buildHud(
    sidebar,
    {
      gridLabel: `${NX}×${NY}`,
      adapterDescription: gpu.description,
      limitsSummary: gpu.limitsSummary,
    },
    DEFAULTS,
    {
      onUin: (v) => sim.setParams({ uin: v }),
      onTau: (v) => {
        tau = v;
        sim.setParams({ omega: 1 / v });
      },
      onMode: (m) => sim.setRenderMode(m),
      onLes: (cs) => sim.setParams({ lesCs: cs }),
      onBrush: () => {},
      onPauseToggle: () => {
        paused = !paused;
        return paused;
      },
      onResetFlow: () => sim.resetFlow(),
      onClearObstacles: () => {
        sim.flags.fill(CellType.Fluid);
        setBaseFlags(sim);
        sim.uploadFlags();
        sim.resetFlow();
      },
      onAddCylinder: () => {
        addCylinder(sim);
        sim.uploadFlags();
      },
    },
  );

  attachPainting(canvas, sim, hud.brush, () => {
    flagsDirty = true;
  });

  // Main loop: adaptive steps-per-frame targeting ~60 fps. The MLUPs figure counts
  // submitted lattice updates against wall time — approximate (GPU work is async;
  // canvas presentation provides backpressure). M2 adds precise timestamp queries.
  let stepsPerFrame = 8;
  let lastFrame = performance.now();
  let statWindowStart = lastFrame;
  let statWindowSteps = 0;

  const frame = (now: number) => {
    const dt = now - lastFrame;
    lastFrame = now;

    if (flagsDirty) {
      sim.uploadFlags();
      flagsDirty = false;
    }

    const encoder = gpu.device.createCommandEncoder();
    if (!paused && !simSuspended) {
      if (dt < 14 && stepsPerFrame < 200) stepsPerFrame += 2;
      else if (dt > 24 && stepsPerFrame > 1) {
        stepsPerFrame = Math.max(1, Math.floor(stepsPerFrame * 0.8));
      }
      sim.encodeSteps(encoder, stepsPerFrame);
      statWindowSteps += stepsPerFrame;
    }
    sim.encodeRender(encoder, gpu.context.getCurrentTexture().createView());
    gpu.device.queue.submit([encoder.finish()]);

    const windowMs = now - statWindowStart;
    if (windowMs >= 500) {
      const stepsPerSec = (statWindowSteps / windowMs) * 1000;
      hud.setStats({
        stepsPerSec,
        mlups: (stepsPerSec * sim.n) / 1e6,
        totalSteps: sim.totalSteps,
        re: reynolds(),
      });
      hooks().sim2d = { totalSteps: sim.totalSteps, mlups: (stepsPerSec * sim.n) / 1e6 };
      statWindowStart = now;
      statWindowSteps = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  hooks().ready = true;
}

void boot();
