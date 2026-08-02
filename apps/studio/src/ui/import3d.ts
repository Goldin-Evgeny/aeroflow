import { AIR_DENSITY, CellType, ahmedBody, forceToNewtons, icosphere } from '@aeroflow/core';
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Uint32BufferAttribute,
  Float32BufferAttribute,
  WebGLRenderer,
  BoxGeometry,
  AmbientLight,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GpuCapabilities } from '../gpu/context';
import { Lbm3D } from '../sim/lbm3d';
import { voxelizeMeshGPU } from '../sim/voxelizer';
import { importMeshFile, meshBounds, scalePositions, type ImportedMesh } from '../sim/meshImport';
import { fitMeshToDomain, toLatticeSpace, DEFAULT_MAX_CELLS, type DomainFit } from '../sim/fitMesh';
import { ForcePlot } from './forcePlot';
import { applyCellsOverride, hooks } from '../dev/testHooks';
import { deviceBindingCap } from '../gpu/ddfLayout';

/**
 * M8 end-to-end import page (route ?import3d, steps 5–7 + acceptance 1/5): drag-and-drop
 * an STL/glTF model → auto-scaling wizard (unit choice, characteristic length, wind speed;
 * all conversions through latticeUnits) → GPU voxelization (time displayed — the
 * acceptance-1 metric) → live run with drag in NEWTONS and Cd in the HUD, plus the
 * F = ½·ρ·Cd·A·U² hand cross-check line (acceptance 5) and a voxel-slice viewer
 * (acceptance-3 visual). "Generate benchmark sphere" builds the 1,310,720-triangle
 * icosphere (subdiv 8) for the 1M-triangle ≤ 3 s voxelization gate without needing a file.
 */

interface LoadedModel {
  name: string;
  mesh: ImportedMesh;
  /** Unit → meters factor currently selected. */
  unitScale: number;
}

const UNITS: Record<string, number> = { mm: 1e-3, cm: 1e-2, m: 1, inch: 0.0254 };
const BUDGETS: Record<string, number> = {
  '8.4M cells (192³-class)': 8_400_000,
  '16.7M cells (256³-class)': DEFAULT_MAX_CELLS,
  '33.5M cells (322³-class)': 33_500_000,
};

export function mountImport3D(device: GPUDevice, caps: GpuCapabilities, root: HTMLElement): void {
  root.innerHTML = '';
  root.style.cssText =
    'display:flex;gap:16px;font:13px/1.5 ui-monospace,monospace;color:#e6edf3;padding:16px;' +
    'align-items:flex-start;flex-wrap:wrap';

  // --- Left column: preview + slice viewer ---
  const left = document.createElement('div');
  left.style.cssText = 'display:flex;flex-direction:column;gap:10px;min-width:480px;flex:1';
  const previewCanvas = document.createElement('canvas');
  previewCanvas.style.cssText =
    'width:100%;height:360px;background:#0b0e13;border:1px solid #2d333b;border-radius:4px';
  const sliceWrap = document.createElement('div');
  sliceWrap.style.cssText = 'display:none;flex-direction:column;gap:4px';
  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.style.cssText =
    'width:100%;image-rendering:pixelated;border:1px solid #2d333b;border-radius:4px;background:#0b0e13';
  const sliceSlider = document.createElement('input');
  sliceSlider.type = 'range';
  const sliceLabel = document.createElement('span');
  sliceLabel.style.color = '#8b949e';
  sliceWrap.append(sliceCanvas, sliceSlider, sliceLabel);
  left.append(previewCanvas, sliceWrap);

  // --- Right column: wizard + run controls ---
  const side = document.createElement('div');
  side.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:420px';
  root.append(left, side);

  const h = document.createElement('h2');
  h.textContent = 'M8 — Import a model, read drag in newtons';
  h.style.margin = '0';

  const drop = document.createElement('div');
  drop.textContent = 'Drop an .stl / .glb / .gltf here — or click to pick a file';
  drop.style.cssText =
    'border:2px dashed #444c56;border-radius:6px;padding:22px;text-align:center;cursor:pointer;color:#8b949e';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.stl,.glb,.gltf';
  fileInput.style.display = 'none';
  fileInput.dataset.testid = 'import-file';

  const genRow = document.createElement('div');
  genRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const mkBtn = (label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:6px 10px;background:#21262d;color:#e6edf3;border:1px solid #444c56;border-radius:4px;cursor:pointer';
    return b;
  };
  const genBench = mkBtn('Generate benchmark sphere (1,310,720 tris, D=0.5 m)');
  const genAhmed = mkBtn('Ahmed body 25° (M9 preset)');
  genRow.append(genBench, genAhmed);

  const meshInfo = document.createElement('pre');
  meshInfo.style.cssText =
    'background:#0b0e13;border:1px solid #2d333b;border-radius:4px;padding:10px;white-space:pre-wrap;margin:0';
  meshInfo.textContent = 'no model loaded';
  meshInfo.dataset.testid = 'import-mesh-info';

  // Wizard form.
  const form = document.createElement('div');
  form.style.cssText =
    'display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center';
  const field = <T extends HTMLElement>(label: string, el: T): T => {
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.style.color = '#8b949e';
    form.append(lab, el);
    return el;
  };
  const mkSelect = (options: string[]): HTMLSelectElement => {
    const s = document.createElement('select');
    for (const o of options) s.append(new Option(o, o));
    s.style.cssText =
      'background:#21262d;color:#e6edf3;border:1px solid #444c56;border-radius:4px;padding:4px';
    return s;
  };
  const mkNumber = (value: number, step: number): HTMLInputElement => {
    const n = document.createElement('input');
    n.type = 'number';
    n.value = String(value);
    n.step = String(step);
    n.style.cssText =
      'background:#21262d;color:#e6edf3;border:1px solid #444c56;border-radius:4px;padding:4px';
    return n;
  };
  const unitSel = field('STL unit', mkSelect(Object.keys(UNITS)));
  const charSel = field(
    'characteristic length',
    mkSelect(['bbox height (y)', 'bbox length (x)', 'bbox width (z)', 'custom']),
  );
  const charCustom = field('custom length (m)', mkNumber(1, 0.1));
  charCustom.disabled = true;
  const windInput = field('wind speed (m/s)', mkNumber(10, 0.5));
  const uInput = field('lattice u (Mach control)', mkNumber(0.05, 0.005));
  const lesBox = field('LES (Smagorinsky)', document.createElement('input'));
  lesBox.type = 'checkbox';
  const budgetSel = field('cell budget', mkSelect(Object.keys(BUDGETS)));
  budgetSel.selectedIndex = 1;
  applyCellsOverride(BUDGETS, budgetSel);

  const plan = document.createElement('pre');
  plan.style.cssText = meshInfo.style.cssText;
  plan.textContent = '—';
  const warnBox = document.createElement('div');
  warnBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const runRow = document.createElement('div');
  runRow.style.cssText = 'display:flex;gap:8px';
  const runBtn = mkBtn('Voxelize + Run');
  runBtn.disabled = true;
  runBtn.dataset.testid = 'import-run';
  const stopBtn = mkBtn('Stop');
  stopBtn.disabled = true;
  stopBtn.dataset.testid = 'import-stop';
  runRow.append(runBtn, stopBtn);

  const voxInfo = document.createElement('div');
  voxInfo.style.cssText = 'color:#8b949e';
  const hud = document.createElement('pre');
  hud.style.cssText = meshInfo.style.cssText + ';font-size:14px';
  hud.textContent = '';
  const plot = new ForcePlot(400, 160);

  side.append(
    h,
    drop,
    fileInput,
    genRow,
    meshInfo,
    form,
    plan,
    warnBox,
    runRow,
    voxInfo,
    hud,
    plot.element,
  );

  // --- Three.js preview (WebGL — independent of the sim device; qualitative only) ---
  const renderer = new WebGLRenderer({ canvas: previewCanvas, antialias: true });
  renderer.setClearColor(0x0b0e13, 1);
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(1.6, 1.1, 1.9);
  const controls = new OrbitControls(camera, previewCanvas);
  controls.enableDamping = true;
  scene.add(new AmbientLight(0xffffff, 0.5));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(2, 3, 1);
  scene.add(sun);
  let previewGroup = new Group();
  scene.add(previewGroup);
  const resizePreview = (): void => {
    const w = previewCanvas.clientWidth || 480;
    const hgt = previewCanvas.clientHeight || 360;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resizePreview);
  resizePreview();
  const renderLoop = (): void => {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  };
  renderLoop();

  // --- State ---
  let model: LoadedModel | null = null;
  let fit: DomainFit | null = null;
  let running = false;
  let stop = false;

  const charLenMeters = (sizeM: [number, number, number]): number => {
    switch (charSel.selectedIndex) {
      case 0:
        return sizeM[1];
      case 1:
        return sizeM[0];
      case 2:
        return sizeM[2];
      default:
        return Number(charCustom.value) || 1;
    }
  };

  const rebuildPreview = (): void => {
    scene.remove(previewGroup);
    previewGroup = new Group();
    scene.add(previewGroup);
    if (!model || !fit) return;
    const { nx, ny, nz } = fit.grid;
    const maxDim = Math.max(nx, ny, nz);
    previewGroup.scale.setScalar(1 / maxDim);
    previewGroup.position.set(-0.5 * (nx / maxDim), -0.5 * (ny / maxDim), -0.5 * (nz / maxDim));
    // Domain wireframe in lattice space.
    const box = new BoxGeometry(nx, ny, nz).translate(nx / 2, ny / 2, nz / 2);
    previewGroup.add(
      new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: 0x3a4658 })),
    );
    // Mesh in lattice space (same transform the voxelizer gets).
    const meters = scalePositions(model.mesh.positions, model.unitScale);
    const lattice = toLatticeSpace(meters, meshBounds(meters), fit);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(lattice, 3));
    if (model.mesh.indices) geo.setIndex(new Uint32BufferAttribute(model.mesh.indices, 1));
    geo.computeVertexNormals();
    const mat = new MeshStandardMaterial({ color: new Color(0x8fa3bf), flatShading: true });
    previewGroup.add(new Mesh(geo, mat));
  };

  const replan = (): void => {
    if (!model) return;
    const meters = scalePositions(model.mesh.positions, model.unitScale);
    const b = meshBounds(meters);
    const L = charLenMeters(b.size);
    try {
      fit = fitMeshToDomain({
        bboxSize: b.size,
        charLen: L,
        windSpeed: Number(windInput.value) || 10,
        uLattice: Number(uInput.value) || 0.05,
        les: lesBox.checked,
        maxCells: BUDGETS[budgetSel.value],
      });
    } catch (e) {
      plan.textContent = `plan error: ${String(e)}`;
      fit = null;
      runBtn.disabled = true;
      return;
    }
    const m = fit.mapping;
    plan.textContent = [
      `physical bbox  ${b.size.map((s) => s.toFixed(3)).join(' × ')} m   (check this! wrong unit ⇒ Re off by 10³)`,
      `char length L  ${L.toFixed(3)} m   wind ${Number(windInput.value)} m/s   Re ${m.Re.toExponential(2)}`,
      `grid ${fit.grid.nx}×${fit.grid.ny}×${fit.grid.nz} = ${(fit.totalCells / 1e6).toFixed(1)}M cells   dx ${(fit.dx * 1e3).toFixed(2)} mm   ${fit.cellsPerCharLen.toFixed(1)} cells/L`,
      `τ ${m.tau.toFixed(5)}   dt ${m.dt.toExponential(3)} s   lattice u ${m.uLattice}   LES ${lesBox.checked ? 'on' : 'off'}`,
      `bbox blockage ${(fit.blockage * 100).toFixed(2)}%   padding 2L/6L/2L (up/down/lateral)`,
    ].join('\n');
    warnBox.innerHTML = '';
    for (const w of fit.warnings) {
      const row = document.createElement('div');
      row.style.cssText = 'color:#d29922;display:flex;gap:8px;align-items:baseline';
      const msg = document.createElement('span');
      msg.textContent = `⚠ ${w.message}`;
      row.append(msg);
      if (w.fix === 'enable-les') {
        const b2 = mkBtn('enable LES');
        b2.onclick = () => {
          lesBox.checked = true;
          replan();
        };
        row.append(b2);
      } else if (w.fix === 'reduce-u') {
        const b2 = mkBtn('u → 0.05');
        b2.onclick = () => {
          uInput.value = '0.05';
          replan();
        };
        row.append(b2);
      }
      warnBox.append(row);
    }
    runBtn.disabled = running;
    rebuildPreview();
  };

  const setModel = (name: string, mesh: ImportedMesh): void => {
    model = { name, mesh, unitScale: UNITS[unitSel.value] };
    // glTF is meters by spec; STL defaults to CAD-typical mm (user can override).
    unitSel.value = mesh.source === 'gltf' ? 'm' : unitSel.value;
    model.unitScale = UNITS[unitSel.value];
    meshInfo.textContent =
      `${name}\n${mesh.triangleCount.toLocaleString()} triangles (${mesh.source}` +
      `${mesh.indices ? ', indexed' : ', soup'})`;
    replan();
  };

  // --- File handling ---
  drop.onclick = () => fileInput.click();
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.style.borderColor = '#58a6ff';
  };
  drop.ondragleave = () => {
    drop.style.borderColor = '#444c56';
  };
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.style.borderColor = '#444c56';
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  };
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) void loadFile(f);
  };
  async function loadFile(f: File): Promise<void> {
    try {
      meshInfo.textContent = `reading ${f.name}…`;
      setModel(f.name, await importMeshFile(f.name, await f.arrayBuffer()));
    } catch (e) {
      meshInfo.textContent = `import failed: ${String(e)}`;
    }
  }

  genBench.onclick = () => {
    meshInfo.textContent = 'generating icosphere subdiv 8…';
    // Deterministic 1M-triangle model for acceptance 1: icosphere subdiv 8, D = 0.5 m.
    setTimeout(() => {
      const s = icosphere(8, 0.25, 0, 0, 0);
      unitSel.value = 'm';
      setModel('benchmark-icosphere-subdiv8', {
        positions: s.positions,
        indices: s.indices,
        triangleCount: s.indices.length / 3,
        source: 'stl',
      });
    }, 30);
  };

  genAhmed.onclick = () => {
    // M9 step 1 preset: the SAE 840300 body in mm, flow along +x. Sets the experiment's
    // conditions: U ≈ 60 m/s, characteristic length = body LENGTH (Re_L = 4.29e6). The
    // generic import page has no no-slip ground plane (that is the dedicated M9 scene) —
    // this preset exists for geometry/voxelization/preview checks of the real mesh.
    const mesh = ahmedBody();
    unitSel.value = 'mm';
    charSel.selectedIndex = 1; // bbox length (x)
    windInput.value = '60';
    lesBox.checked = true;
    setModel('ahmed-body-25deg', {
      positions: mesh.positions,
      indices: mesh.indices,
      triangleCount: mesh.indices.length / 3,
      source: 'stl',
    });
  };

  for (const el of [unitSel, charSel, windInput, uInput, lesBox, budgetSel]) {
    el.onchange = () => {
      if (model) model.unitScale = UNITS[unitSel.value];
      charCustom.disabled = charSel.selectedIndex !== 3;
      replan();
    };
  }
  charCustom.onchange = () => replan();

  // --- Voxel slice viewer (acceptance-3 visual): z-slice of the final flag field ---
  let sliceFlags: Uint8Array | null = null;
  let sliceDims: { nx: number; ny: number; nz: number } | null = null;
  const drawSlice = (): void => {
    if (!sliceFlags || !sliceDims) return;
    const { nx, ny } = sliceDims;
    const z = Number(sliceSlider.value);
    sliceCanvas.width = nx;
    sliceCanvas.height = ny;
    const ctx = sliceCanvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(nx, ny);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const t = sliceFlags[x + nx * (y + ny * z)];
        // y flipped so +y is up on screen.
        const p = 4 * (x + nx * (ny - 1 - y));
        const [r, g, b] =
          t === CellType.Solid
            ? [210, 153, 34]
            : t === CellType.Inlet
              ? [31, 111, 235]
              : t === CellType.Outlet
                ? [137, 87, 213]
                : [13, 17, 23];
        img.data[p] = r;
        img.data[p + 1] = g;
        img.data[p + 2] = b;
        img.data[p + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    sliceLabel.textContent = `flag slice z=${z}  (amber=solid, blue=inlet, purple=outlet)`;
  };
  sliceSlider.oninput = drawSlice;

  // --- Voxelize + run ---
  runBtn.onclick = () => void voxelizeAndRun();
  stopBtn.onclick = () => {
    stop = true;
  };

  async function voxelizeAndRun(): Promise<void> {
    if (!model || !fit || running) return;
    running = true;
    stop = false;
    runBtn.disabled = true;
    stopBtn.disabled = false;
    let sim: Lbm3D | null = null;
    try {
      const { nx, ny, nz } = fit.grid;
      const meters = scalePositions(model.mesh.positions, model.unitScale);
      const lattice = toLatticeSpace(meters, meshBounds(meters), fit);

      voxInfo.textContent = `voxelizing ${model.mesh.triangleCount.toLocaleString()} triangles into ${nx}×${ny}×${nz}…`;
      const vox = await voxelizeMeshGPU(device, lattice, model.mesh.indices, { nx, ny, nz });
      let solidCells = 0;
      for (let i = 0; i < vox.mask.length; i++) if (vox.mask[i] === CellType.Solid) solidCells++;
      // The acceptance-1 line: model, grid, wall-clock ms (record with GPU in M8 Status).
      voxInfo.textContent =
        `voxelized in ${vox.ms.toFixed(0)} ms (${vox.fillPasses} fill passes) — ` +
        `${solidCells.toLocaleString()} solid cells` +
        (model.mesh.triangleCount >= 1_000_000 ? `  [acceptance 1 gate: ≤ 3000 ms]` : '');
      hooks().import3d = { voxMs: vox.ms, solidCells };
      if (solidCells === 0) {
        throw new Error(
          'voxelization produced 0 solid cells — check units/transform (leaky-surface symptom)',
        );
      }

      // Frontal reference area for Cd: solid-occupied (y,z) columns (projection along x).
      const columns = new Uint8Array(ny * nz);
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++) {
            if (vox.mask[x + nx * (y + ny * z)] === CellType.Solid) {
              columns[y + ny * z] = 1;
              break;
            }
          }
      let frontalCells = 0;
      for (let i = 0; i < columns.length; i++) frontalCells += columns[i];
      const areaM2 = frontalCells * fit.dx * fit.dx;

      const m = fit.mapping;
      sim = new Lbm3D(device, {
        nx,
        ny,
        nz,
        omega: m.omega,
        inletVel: m.uLattice,
        collision: 'trt',
        regularize: m.tau < 0.51, // near-floor τ needs the velocity-stable collision (M7)
        les: lesBox.checked ? { cs: 0.1 } : undefined,
        forces: true,
        hasTimestamp: caps.hasTimestamp,
        maxBindingBytes: deviceBindingCap(caps),
        maxStorageBuffersPerStage: caps.maxStorageBuffersPerShaderStage,
      });
      sim.flags.set(vox.mask);
      // Boundary overlay AFTER the mask so faces stay boundaries even if the model touches
      // them: inlet x=0, outlet x=nx−1, freestream (inlet-type) lateral far field (M7).
      const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++) {
          sim.flags[at(0, y, z)] = CellType.Inlet;
          sim.flags[at(nx - 1, y, z)] = CellType.Outlet;
        }
      for (let z = 0; z < nz; z++)
        for (let x = 1; x < nx - 1; x++) {
          sim.flags[at(x, 0, z)] = CellType.Inlet;
          sim.flags[at(x, ny - 1, z)] = CellType.Inlet;
        }
      for (let y = 0; y < ny; y++)
        for (let x = 1; x < nx - 1; x++) {
          sim.flags[at(x, y, 0)] = CellType.Inlet;
          sim.flags[at(x, y, nz - 1)] = CellType.Inlet;
        }
      sim.uploadFlags();
      sim.reset(1, 0, 0, 0);

      sliceFlags = sim.flags.slice();
      sliceDims = { nx, ny, nz };
      sliceWrap.style.display = 'flex';
      sliceSlider.min = '0';
      sliceSlider.max = String(nz - 1);
      sliceSlider.value = String(Math.floor(nz / 2));
      drawSlice();

      // Sampling cadence: ~10/convective time, even (staggered-momentum aliasing, H2 §4a).
      const tcSteps = Math.max(2, Math.round(fit.cellsPerCharLen / m.uLattice));
      const interval = Math.max(2, 2 * Math.round(tcSteps / 20));
      const areaLattice = frontalCells; // cells² — matches lattice-unit force normalization
      const transientSteps = 5 * tcSteps;
      const U = Number(windInput.value) || 10;

      let steps = 0;
      let sum = 0;
      let count = 0;
      while (!stop) {
        const f = await sim.sampleForce(interval);
        steps += interval;
        const cd = f.fx / (0.5 * m.uLattice * m.uLattice * areaLattice);
        if (!Number.isFinite(cd)) {
          hud.textContent =
            `DIVERGED at step ${steps} — near-floor τ Mach instability.\n` +
            `Enable LES and/or reduce lattice u, then re-run.`;
          return;
        }
        const newtons = forceToNewtons(f.fx, m);
        if (steps >= transientSteps) {
          sum += cd;
          count++;
        }
        const meanCd = count > 0 ? sum / count : cd;
        plot.push(cd, meanCd);
        plot.setReadouts({ meanCd, clAmplitude: NaN, st: null, periods: 0 });
        const meanN = forceToNewtons(meanCd * 0.5 * m.uLattice * m.uLattice * areaLattice, m);
        const handCheck = 0.5 * AIR_DENSITY * meanCd * areaM2 * U * U;
        hud.textContent = [
          `step ${steps.toLocaleString()}  (${(steps / tcSteps).toFixed(1)} convective times)`,
          `drag F  = ${newtons.toExponential(3)} N   (running mean ${meanN.toExponential(3)} N)`,
          `Cd      = ${cd.toFixed(4)}   (running mean ${meanCd.toFixed(4)}, A = ${areaM2.toFixed(4)} m²)`,
          `cross-check ½·ρ·Cd·A·U² = ${handCheck.toExponential(3)} N  (must match mean F)`,
        ].join('\n');
        (hooks().import3d ??= {}).sample = { steps, cd, meanCd, newtons };
      }
    } catch (e) {
      hud.textContent = `run error: ${String(e)}`;
    } finally {
      sim?.destroy();
      running = false;
      runBtn.disabled = !model || !fit;
      stopBtn.disabled = true;
    }
  }
}
