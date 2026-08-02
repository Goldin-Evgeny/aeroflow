import {
  WebGPURenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Mesh,
  InstancedMesh,
  BoxGeometry,
  SphereGeometry,
  BufferGeometry,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
  Float32BufferAttribute,
  MeshBasicNodeMaterial,
  DoubleSide,
  AdditiveBlending,
  Color,
} from 'three/webgpu';
import {
  Fn,
  texture3D,
  instancedArray,
  instanceIndex,
  positionGeometry,
  positionLocal,
  vec3,
  float,
  uniform,
  hash,
  If,
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CellType, latticeUnits } from '@aeroflow/core';
import { Lbm3D } from '../sim/lbm3d';
import { FieldTexture } from './render3d/fieldTexture';
import type { GpuCapabilities } from '../gpu/context';

// TSL's node proxies are dynamically typed; @types/three models them with strict generics
// that collapse to `never` on some chained ops (storage `.element()`, uint↔float mixing).
// These aliases keep the runtime-correct expressions compiling without `any`.
type FNode = ReturnType<typeof float>;
type V3Node = ReturnType<typeof vec3>;

// Demo grid (M6 step 9). ~0.5 M cells — comfortably interactive; the go/no-go benchmark
// (?bench3d) carries the throughput claims, this scene only has to look right.
const NX = 128;
const NY = 64;
const NZ = 64;
const CUBE = 16; // obstacle side, cells
const PARTICLES = 8192;

/**
 * Colormap t∈[0,1] → blue→cyan→green→yellow→red. A cheap piecewise ramp; the demo is
 * qualitative (no accuracy claims — CLAUDE.md hard rule 5), so a perceptual map isn't worth
 * the node count.
 */
const colormap = Fn(([t]: [ReturnType<typeof float>]) => {
  const x = t.clamp(0, 1);
  const r = x.sub(0.5).mul(2).clamp(0, 1);
  const g = x.mul(2).min(x.oneMinus().mul(2)).clamp(0, 1);
  const b = x.mul(-2).add(1).clamp(0, 1);
  return vec3(r, g, b);
});
const cmap = colormap as unknown as (t: FNode) => V3Node;

/** Two-triangle slice quad; `positionGeometry` in the shader carries the [0,1]³ sample uvw. */
function sliceGeometry(corners: [number, number, number][]): BufferGeometry {
  const [a, b, c, d] = corners;
  const pos = [...a, ...b, ...c, ...a, ...c, ...d];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return geo;
}

function buildFlags(sim: Lbm3D): void {
  const f = sim.flags;
  const at = (x: number, y: number, z: number) => x + NX * (y + NY * z);
  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        let t = CellType.Fluid;
        if (x === 0) t = CellType.Inlet;
        else if (x === NX - 1) t = CellType.Outlet;
        else if (y === 0 || y === NY - 1 || z === 0 || z === NZ - 1) t = CellType.Solid;
        f[at(x, y, z)] = t;
      }
    }
  }
  // Solid cube centered a quarter-length downstream of the inlet.
  const cx = Math.floor(NX / 4);
  const half = CUBE / 2;
  const lo = (c: number) => Math.floor(c - half);
  const hi = (c: number) => Math.floor(c + half);
  for (let z = lo(NZ / 2); z < hi(NZ / 2); z++) {
    for (let y = lo(NY / 2); y < hi(NY / 2); y++) {
      for (let x = lo(cx); x < hi(cx); x++) {
        f[at(x, y, z)] = CellType.Solid;
      }
    }
  }
}

/**
 * Mount the M6 Three.js wind-tunnel demo (step 9). Three's `WebGPURenderer` shares the
 * solver's `GPUDevice`, so the velocity field crosses into the render graph as a 3D texture
 * with no readback (see FieldTexture). Visualizes: domain box, solid cube, three velocity
 * slice planes, and GPU-advected streamline particles.
 *
 * Runtime-pending: authored and build-verified without a GPU in the dev environment, like
 * the rest of M6's GPU work — validate in-browser before recording a Status pass.
 */
export async function mountDemo3D(
  device: GPUDevice,
  caps: GpuCapabilities,
  host: HTMLElement,
): Promise<void> {
  // Re≈200 through latticeUnits — an unsteady bluff-body wake. At D=16 / τ≈0.519 this
  // is past plain TRT's stability edge (it NaNs), so the demo runs the H10 velocity-stable
  // regularized collision. Cube side is the characteristic length; lattice u≈0.08 ≤ Mach.
  const map = latticeUnits({
    physLength: 0.2,
    physVelocity: 0.015,
    physViscosity: 1.5e-5,
    cells: CUBE,
    uLattice: 0.08,
  });

  const sim = new Lbm3D(device, {
    nx: NX,
    ny: NY,
    nz: NZ,
    omega: map.omega,
    inletVel: map.uLattice,
    collision: 'trt',
    regularize: true,
    hasTimestamp: caps.hasTimestamp,
  });
  buildFlags(sim);
  sim.uploadFlags();
  sim.reset(1, map.uLattice, 0, 0);

  const field = new FieldTexture(device, sim.macroBuffers, NX, NY, NZ);

  // --- Three.js scene on the shared device ---
  const canvas = document.createElement('canvas');
  canvas.className = 'demo3d-canvas';
  host.append(canvas);
  const renderer = new WebGPURenderer({ canvas, device, antialias: true });
  renderer.setClearColor(0x0a0d12, 1);
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(1.4, 1.0, 1.9);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  // Domain group holds children in [0,1]³; scale to the nx:ny:nz aspect, center on origin.
  const maxDim = Math.max(NX, NY, NZ);
  const domain = new Group();
  domain.scale.set(NX / maxDim, NY / maxDim, NZ / maxDim);
  domain.position.set((-0.5 * NX) / maxDim, (-0.5 * NY) / maxDim, (-0.5 * NZ) / maxDim);
  scene.add(domain);
  controls.target.set(0, 0, 0);

  // Domain wireframe.
  const box = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const wire = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: 0x3a4658 }));
  domain.add(wire);

  // Solid cube obstacle (mesh mirrors the flag mask; real mesh import is M8).
  const cubeMat = new MeshBasicNodeMaterial();
  cubeMat.color = new Color(0x8892a0);
  const cubeMesh = new Mesh(
    new BoxGeometry(CUBE / NX, CUBE / NY, CUBE / NZ).translate(0.25, 0.5, 0.5),
    cubeMat,
  );
  domain.add(cubeMesh);

  // Velocity-magnitude scale for the colormap (≈2× inlet catches the acceleration zones).
  const maxSpeed = uniform(map.uLattice * 2);

  // Three slice planes: XY through z-center, XZ through y-center, YZ downstream of the cube.
  const sliceSpecs: [number, number, number][][] = [
    [
      [0, 0, 0.5],
      [1, 0, 0.5],
      [1, 1, 0.5],
      [0, 1, 0.5],
    ],
    [
      [0, 0.5, 0],
      [1, 0.5, 0],
      [1, 0.5, 1],
      [0, 0.5, 1],
    ],
    [
      [0.55, 0, 0],
      [0.55, 1, 0],
      [0.55, 1, 1],
      [0.55, 0, 1],
    ],
  ];
  for (const corners of sliceSpecs) {
    const mat = new MeshBasicNodeMaterial();
    mat.side = DoubleSide;
    mat.transparent = true;
    mat.opacity = 0.82;
    const speed = texture3D(field.texture, positionGeometry).level(float(0)).a;
    mat.colorNode = cmap(speed.div(maxSpeed) as unknown as FNode);
    domain.add(new Mesh(sliceGeometry(corners as [number, number, number][]), mat));
  }

  // --- GPU streamline particles ---
  // Seed positions across the inlet region; store [0,1]³ domain coords in a storage buffer.
  const seed = new Float32Array(PARTICLES * 3);
  for (let i = 0; i < PARTICLES; i++) {
    seed[i * 3] = Math.random() * 0.15; // near inlet
    seed[i * 3 + 1] = 0.05 + Math.random() * 0.9;
    seed[i * 3 + 2] = 0.05 + Math.random() * 0.9;
  }
  const positions = instancedArray(seed, 'vec3');

  const uSeed = uniform(0);
  const speedScale = uniform(1.6); // advection step per frame, in cell-fractions of the field
  const iidF = instanceIndex as unknown as FNode;
  const advect = Fn(() => {
    const slot = positions.element(instanceIndex) as unknown as V3Node;
    const p = slot.toVar();
    const vel = (texture3D(field.texture, p).level(float(0)) as unknown as V3Node).xyz;
    p.addAssign(vel.mul(speedScale.mul(1 / maxDim)));
    // Reseed when a particle leaves the domain or stalls (inside the cube / stagnation).
    const stalled = vel.length().lessThan(1e-6);
    const gone = p.x.greaterThan(1).or(p.x.lessThan(0)).or(stalled);
    If(gone, () => {
      const h = hash(iidF.add(uSeed));
      const h2 = hash(iidF.add(uSeed).add(17.0));
      p.assign(vec3(float(0.02), h.mul(0.9).add(0.05), h2.mul(0.9).add(0.05)));
    });
    slot.assign(p);
  })().compute(PARTICLES);

  const partMat = new MeshBasicNodeMaterial();
  partMat.transparent = true;
  partMat.blending = AdditiveBlending;
  partMat.depthWrite = false;
  const pPos = positions.element(instanceIndex) as unknown as V3Node;
  partMat.positionNode = positionLocal.add(pPos);
  const pSpeed = (
    texture3D(field.texture, pPos).level(float(0)) as unknown as V3Node & { a: FNode }
  ).a;
  partMat.colorNode = cmap(pSpeed.div(maxSpeed) as unknown as FNode);
  const particles = new InstancedMesh(new SphereGeometry(0.006, 6, 6), partMat, PARTICLES);
  particles.frustumCulled = false;
  domain.add(particles);

  // --- HUD overlay ---
  const hud = document.createElement('div');
  hud.className = 'demo3d-hud';
  host.append(hud);
  let paused = false;
  const stepsPerFrame = 4;
  const btn = document.createElement('button');
  btn.textContent = 'Pause';
  btn.onclick = () => {
    paused = !paused;
    btn.textContent = paused ? 'Resume' : 'Pause';
  };
  const stat = document.createElement('div');
  hud.append(
    Object.assign(document.createElement('div'), {
      textContent: `AeroFlow 3D — ${NX}×${NY}×${NZ}, cube D=${CUBE}, Re≈${Math.round(map.Re)}`,
      className: 'demo3d-title',
    }),
    stat,
    btn,
  );

  const resize = () => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let simSteps = 0;
  let last = performance.now();
  const loop = async () => {
    if (!paused) {
      sim.submitSteps(stepsPerFrame);
      simSteps += stepsPerFrame;
      const enc = device.createCommandEncoder();
      sim.encodeMacro(enc);
      field.encode(enc);
      device.queue.submit([enc.finish()]);
      uSeed.value = (uSeed.value + 0.618) % 1000;
      await renderer.computeAsync(advect);
    }
    controls.update();
    renderer.render(scene, camera);

    const now = performance.now();
    if (now - last >= 500) {
      const sps = (simSteps / (now - last)) * 1000;
      stat.textContent = `${sps.toFixed(0)} steps/s · ${((sps * sim.n) / 1e6).toFixed(0)} MLUPs · ${sim.totalSteps} steps`;
      last = now;
      simSteps = 0;
    }
    requestAnimationFrame(() => void loop());
  };
  void loop();
}
