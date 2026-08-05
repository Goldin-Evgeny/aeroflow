import {
  CellType,
  ConvergingVelocityAverager,
  aijUrbanDirection,
  aijUrbanMeasuredInflow,
  aijUrbanProbesInWindFrame,
  bounds3,
  buildAijUrbanReport,
  interpolateInflowToLattice,
  planUrbanDomain,
  powerLawProfile,
  prepareUrbanScene,
  urbanBoundaryFlags,
  validateAijUrbanData,
  windAlignEnuPositions,
  type AijUrbanCaseId,
  type AijUrbanData,
  type AijUrbanDirection,
  type AijUrbanReport,
  type ConvergingVelocityAveragerState,
  type ConvergingVelocityStats,
  type UrbanDomainPlan,
  type UrbanSceneSetup,
} from '@aeroflow/core';
import type { GpuCapabilities } from '../../gpu/context';
import {
  openCheckpointDb,
  requestPersistence,
  restoreCheckpoint,
  saveCheckpoint,
  type SaveCheckpointResult,
} from '../checkpoint';
import { Lbm3D } from '../lbm3d';
import { parseGltf } from '../meshImport';
import { voxelizeMeshGPU } from '../voxelizer';
import { deviceBindingCap } from '../../gpu/ddfLayout';

const PRESET_PATHS: Record<AijUrbanCaseId, string> = {
  C: 'benchmarks/aij/case-c',
  E: 'benchmarks/aij/case-e',
};
const RUNNER_VERSION = 2;
const TRANSIENT_FLOW_THROUGHS = 3;
const REQUIRED_AVERAGING_FLOW_THROUGHS = 10;
const SAMPLES_PER_FLOW_THROUGH = 20;

export interface AijUrbanAveragingSchedule {
  flowThroughSteps: number;
  transientSteps: number;
  sampleIntervalSteps: number;
  targetSteps: number;
}

export type AijUrbanProbeSamplingMode = 'published-coordinates' | 'nearest-fluid-cell-smoke';

export interface AijUrbanProbeSamplingPlan {
  points: { x: number; y: number; z: number }[];
  mode: AijUrbanProbeSamplingMode;
}

export interface AijUrbanPreset {
  data: AijUrbanData;
  /** Geometry in source-local ENU meters, before direction alignment. */
  enuPositions: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
}

export interface AijUrbanRunOptions {
  caseId: AijUrbanCaseId;
  windFromDegrees: number;
  maxCells: number;
  precision: 'fp16' | 'fp32';
  caps: GpuCapabilities;
  adapterDescription: string;
  resume?: boolean;
  onStatus?: (message: string) => void;
}

export interface AijUrbanRunSnapshot {
  totalSteps: number;
  transientSteps: number;
  flowThroughSteps: number;
  sampleIntervalSteps: number;
  averagingFlowThroughs: number;
  requiredAveragingFlowThroughs: number;
  samples: number;
  stats: ConvergingVelocityStats | null;
  normalizedMeans: Float64Array | null;
  report: AijUrbanReport | null;
  elapsedMs: number;
  complete: boolean;
}

interface AijUrbanCheckpointState {
  version: 1;
  sceneKey: string;
  totalSteps: number;
  elapsedMs: number;
  averager: ConvergingVelocityAveragerState;
}

function assetUrl(caseId: AijUrbanCaseId, file: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${PRESET_PATHS[caseId]}/${file}`;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  return response;
}

/** Undo the converters' right-handed source `(X,Y,Z) -> glTF (X,Z,-Y)` mapping. */
export function gltfYUpToEnu(positions: ArrayLike<number>): Float32Array {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error('gltfYUpToEnu: positions must contain xyz triplets');
  }
  const output = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    if (![x, y, z].every(Number.isFinite)) {
      throw new Error(`gltfYUpToEnu: non-finite vertex at ${index / 3}`);
    }
    output[index] = x;
    output[index + 1] = -z;
    output[index + 2] = y;
  }
  return output;
}

/** Build U/Uref at halfway-bounce-back node heights for the fixture's stated inflow. */
export function buildAijUrbanInflow(
  data: AijUrbanData,
  direction: AijUrbanDirection,
  nCells: number,
  dx: number,
): Float64Array {
  if (data.inflow.kind === 'measured') {
    return interpolateInflowToLattice(aijUrbanMeasuredInflow(data, direction), nCells, dx);
  }
  const zRef = data.measurement.uRefHeightMeters;
  if (!(zRef && zRef > 0)) {
    throw new Error(`AIJ Case ${data.caseId}: power-law inflow requires a positive Uref height`);
  }
  const profile = new Float64Array(nCells);
  for (let y = 0; y < nCells; y++) {
    profile[y] = powerLawProfile((y + 0.5) * dx, zRef, 1, data.inflow.alpha);
  }
  return profile;
}

export async function loadAijUrbanPreset(caseId: AijUrbanCaseId): Promise<AijUrbanPreset> {
  const [fixtureResponse, geometryResponse] = await Promise.all([
    fetchOk(assetUrl(caseId, 'fixture.json')),
    fetchOk(assetUrl(caseId, 'geometry.glb')),
  ]);
  const [rawFixture, geometryBytes] = await Promise.all([
    fixtureResponse.json() as Promise<unknown>,
    geometryResponse.arrayBuffer(),
  ]);
  const data = validateAijUrbanData(rawFixture);
  if (data.caseId !== caseId) {
    throw new Error(`AIJ preset path ${caseId} contains Case ${data.caseId}`);
  }
  const mesh = await parseGltf(geometryBytes);
  if (!mesh.indices || mesh.indices.length === 0) {
    throw new Error(`AIJ Case ${caseId}: converted geometry must be indexed`);
  }
  return {
    data,
    enuPositions: gltfYUpToEnu(mesh.positions),
    indices: mesh.indices,
    triangleCount: mesh.triangleCount,
  };
}

function evenAtLeastTwo(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/** Acceptance runs discard 3T and average 10T; suppressed smoke runs start immediately. */
export function planAijUrbanAveraging(
  nx: number,
  latticePerNormalized: number,
  acceptanceReady: boolean,
): AijUrbanAveragingSchedule {
  if (!(nx >= 2) || !(latticePerNormalized > 0)) {
    throw new Error('planAijUrbanAveraging: invalid domain length or lattice velocity');
  }
  const flowThroughSteps = evenAtLeastTwo(nx / latticePerNormalized);
  const transientSteps = acceptanceReady ? TRANSIENT_FLOW_THROUGHS * flowThroughSteps : 0;
  const sampleIntervalSteps = evenAtLeastTwo(flowThroughSteps / SAMPLES_PER_FLOW_THROUGH);
  return {
    flowThroughSteps,
    transientSteps,
    sampleIntervalSteps,
    targetSteps: transientSteps + REQUIRED_AVERAGING_FLOW_THROUGHS * flowThroughSteps,
  };
}

/**
 * Keep acceptance probes exact. An already-suppressed coarse smoke grid may place the
 * published plane inside the no-slip ground; move those diagnostics to the nearest
 * interior Fluid cell and label the approximation in every report.
 */
export function planAijUrbanProbeSampling(
  points: readonly { x: number; y: number; z: number }[],
  flags: Uint8Array,
  grid: { nx: number; ny: number; nz: number },
  acceptanceReady: boolean,
): AijUrbanProbeSamplingPlan {
  const { nx, ny, nz } = grid;
  if (flags.length !== nx * ny * nz || [nx, ny, nz].some((size) => size < 3)) {
    throw new Error('planAijUrbanProbeSampling: invalid flags or grid');
  }
  if (acceptanceReady) {
    return { points: points.map((point) => ({ ...point })), mode: 'published-coordinates' };
  }
  const clampInterior = (value: number, size: number): number =>
    Math.min(size - 2, Math.max(1, Math.round(value)));
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const sampled = points.map((point, pointIndex) => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new Error(`planAijUrbanProbeSampling: non-finite point ${pointIndex}`);
    }
    const origin = {
      x: clampInterior(point.x, nx),
      y: clampInterior(point.y, ny),
      z: clampInterior(point.z, nz),
    };
    const maxRadius = Math.max(nx, ny, nz);
    for (let radius = 0; radius <= maxRadius; radius++) {
      let best: { x: number; y: number; z: number; distance: number } | null = null;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
            const x = origin.x + dx;
            const y = origin.y + dy;
            const z = origin.z + dz;
            if (x < 1 || x >= nx - 1 || y < 1 || y >= ny - 1 || z < 1 || z >= nz - 1) {
              continue;
            }
            if (flags[at(x, y, z)] !== CellType.Fluid) continue;
            const distance = (x - point.x) ** 2 + (y - point.y) ** 2 + (z - point.z) ** 2;
            if (!best || distance < best.distance) best = { x, y, z, distance };
          }
        }
      }
      if (best) return { x: best.x, y: best.y, z: best.z };
    }
    throw new Error(`planAijUrbanProbeSampling: no interior Fluid cell for point ${pointIndex}`);
  });
  return { points: sampled, mode: 'nearest-fluid-cell-smoke' };
}

function sceneKey(
  preset: AijUrbanPreset,
  direction: AijUrbanDirection,
  plan: UrbanDomainPlan,
  precision: 'fp16' | 'fp32',
): string {
  const { nx, ny, nz } = plan.grid;
  return [
    `aij-urban-v${RUNNER_VERSION}`,
    preset.data.caseId,
    direction.windFromDegrees,
    preset.data.source.sha256,
    preset.data.geometry.sha256,
    `${nx}x${ny}x${nz}`,
    precision,
  ].join(':');
}

function checkpointState(
  value: unknown,
  expected: {
    sceneKey: string;
    totalSteps: number;
    nPoints: number;
    statistic: AijUrbanData['measurement']['statistic'];
    transientSteps: number;
    flowThroughSteps: number;
  },
): AijUrbanCheckpointState {
  const state = value as AijUrbanCheckpointState;
  if (
    typeof state !== 'object' ||
    state === null ||
    state.version !== 1 ||
    state.sceneKey !== expected.sceneKey ||
    state.totalSteps !== expected.totalSteps ||
    !Number.isFinite(state.elapsedMs) ||
    state.elapsedMs < 0 ||
    typeof state.averager !== 'object' ||
    state.averager === null ||
    state.averager.nPoints !== expected.nPoints ||
    state.averager.statistic !== expected.statistic ||
    state.averager.transientSteps !== expected.transientSteps ||
    state.averager.checkpointSteps !== expected.flowThroughSteps
  ) {
    throw new Error('AIJ urban checkpoint state does not match the requested run');
  }
  return state;
}

export class AijUrbanRun {
  readonly data: AijUrbanData;
  readonly direction: AijUrbanDirection;
  readonly plan: UrbanDomainPlan;
  readonly setup: UrbanSceneSetup;
  readonly geometryVoxels: number;
  readonly voxelizationMs: number;
  readonly flowThroughSteps: number;
  readonly transientSteps: number;
  readonly sampleIntervalSteps: number;
  readonly targetSteps: number;
  readonly resumed: boolean;
  readonly precision: 'fp16' | 'fp32';

  private readonly sim: Lbm3D;
  private readonly db: IDBDatabase;
  private readonly key: string;
  private readonly points: { x: number; y: number; z: number }[];
  private readonly probeSampling: AijUrbanProbeSamplingMode;
  private readonly adapterDescription: string;
  private averager: ConvergingVelocityAverager;
  private elapsedMs: number;

  private constructor(args: {
    preset: AijUrbanPreset;
    direction: AijUrbanDirection;
    plan: UrbanDomainPlan;
    setup: UrbanSceneSetup;
    geometryVoxels: number;
    voxelizationMs: number;
    sim: Lbm3D;
    db: IDBDatabase;
    key: string;
    points: { x: number; y: number; z: number }[];
    probeSampling: AijUrbanProbeSamplingMode;
    averager: ConvergingVelocityAverager;
    elapsedMs: number;
    resumed: boolean;
    precision: 'fp16' | 'fp32';
    adapterDescription: string;
    flowThroughSteps: number;
    transientSteps: number;
    sampleIntervalSteps: number;
  }) {
    this.data = args.preset.data;
    this.direction = args.direction;
    this.plan = args.plan;
    this.setup = args.setup;
    this.geometryVoxels = args.geometryVoxels;
    this.voxelizationMs = args.voxelizationMs;
    this.sim = args.sim;
    this.db = args.db;
    this.key = args.key;
    this.points = args.points;
    this.probeSampling = args.probeSampling;
    this.averager = args.averager;
    this.elapsedMs = args.elapsedMs;
    this.resumed = args.resumed;
    this.precision = args.precision;
    this.adapterDescription = args.adapterDescription;
    this.flowThroughSteps = args.flowThroughSteps;
    this.transientSteps = args.transientSteps;
    this.sampleIntervalSteps = args.sampleIntervalSteps;
    this.targetSteps =
      args.transientSteps + REQUIRED_AVERAGING_FLOW_THROUGHS * args.flowThroughSteps;
  }

  static async create(device: GPUDevice, options: AijUrbanRunOptions): Promise<AijUrbanRun> {
    const status = options.onStatus ?? (() => {});
    status(`loading official AIJ Case ${options.caseId} assets`);
    const preset = await loadAijUrbanPreset(options.caseId);
    const direction = aijUrbanDirection(preset.data, options.windFromDegrees);
    const alignedPositions = windAlignEnuPositions(
      preset.enuPositions,
      { east: 0, north: 0, up: 0 },
      direction.windFromDegrees,
    );
    const geometryBounds = bounds3(alignedPositions);
    const plan = planUrbanDomain({
      geometryBounds,
      maxBuildingHeight: geometryBounds.max[1],
      probeHeight: preset.data.measurement.probeHeightMeters,
      maxCells: options.maxCells,
    });
    const setup = prepareUrbanScene({
      mesh: { positions: alignedPositions, indices: preset.indices },
      plan,
      uRefMps: direction.uRefMps,
      inflowNormalized: (ny, dx) => buildAijUrbanInflow(preset.data, direction, ny, dx),
    });

    status(
      `GPU voxelizing ${preset.triangleCount.toLocaleString()} triangles on ` +
        `${plan.grid.nx} x ${plan.grid.ny} x ${plan.grid.nz}`,
    );
    const voxelized = await voxelizeMeshGPU(
      device,
      setup.mesh.positions,
      setup.mesh.indices,
      plan.grid,
    );
    const boundaries = urbanBoundaryFlags(voxelized.mask, plan.grid);
    status(`building ${options.precision.toUpperCase()} TRT + LES solver`);
    const sim = new Lbm3D(device, {
      nx: setup.nx,
      ny: setup.ny,
      nz: setup.nz,
      omega: setup.mapping.omega,
      collision: 'trt',
      regularize: true,
      les: { cs: 0.1 },
      inletProfile: { axis: 'y', ux: Float32Array.from(setup.profile) },
      velocityInlet: true,
      freeSlip: { yMax: true, zMin: true, zMax: true },
      precision: options.precision,
      hasF16: options.caps.hasF16,
      hasTimestamp: options.caps.hasTimestamp,
      maxBindingBytes: deviceBindingCap(options.caps),
      maxStorageBuffersPerStage: options.caps.maxStorageBuffersPerShaderStage,
    });
    sim.flags.set(boundaries.flags);
    sim.uploadFlags();
    sim.reset(1, 0, 0, 0);

    const probes = aijUrbanProbesInWindFrame(direction);
    const probeSampling = planAijUrbanProbeSampling(
      probes.map((probe) => setup.pointToLattice(probe)),
      boundaries.flags,
      plan.grid,
      plan.acceptanceReady,
    );
    const points = probeSampling.points;
    const { flowThroughSteps, transientSteps, sampleIntervalSteps } = planAijUrbanAveraging(
      setup.nx,
      setup.latticePerNormalized,
      plan.acceptanceReady,
    );
    let averager = new ConvergingVelocityAverager(
      points.length,
      preset.data.measurement.statistic,
      transientSteps,
      flowThroughSteps,
    );
    const key = sceneKey(preset, direction, plan, options.precision);
    let db: IDBDatabase | null = null;
    try {
      db = await openCheckpointDb();
      void requestPersistence();
      let resumed = false;
      let elapsedMs = 0;
      if (options.resume) {
        status('restoring latest matching DDF and averaging checkpoint');
        const meta = await restoreCheckpoint(db, sim, key);
        if (meta) {
          const state = checkpointState(meta.runState, {
            sceneKey: key,
            totalSteps: meta.totalSteps,
            nPoints: points.length,
            statistic: preset.data.measurement.statistic,
            transientSteps,
            flowThroughSteps,
          });
          averager = ConvergingVelocityAverager.fromState(state.averager);
          elapsedMs = state.elapsedMs;
          resumed = true;
        }
      }
      return new AijUrbanRun({
        preset,
        direction,
        plan,
        setup,
        geometryVoxels: boundaries.geometryVoxels,
        voxelizationMs: voxelized.ms,
        sim,
        db,
        key,
        points,
        probeSampling: probeSampling.mode,
        averager,
        elapsedMs,
        resumed,
        precision: options.precision,
        adapterDescription: options.adapterDescription,
        flowThroughSteps,
        transientSteps,
        sampleIntervalSteps,
      });
    } catch (error) {
      db?.close();
      sim.destroy();
      throw error;
    }
  }

  private normalizedStats(): {
    stats: ConvergingVelocityStats | null;
    means: Float64Array | null;
  } {
    const stats = this.averager.stats();
    if (!stats) return { stats: null, means: null };
    return {
      stats,
      means: Float64Array.from(stats.means, (mean) => mean / this.setup.latticePerNormalized),
    };
  }

  private buildReport(normalizedMeans: Float64Array | null): AijUrbanReport | null {
    if (!normalizedMeans || this.sim.totalSteps < this.transientSteps) return null;
    return buildAijUrbanReport(this.data, this.direction, this.plan, normalizedMeans, {
      generatedAt: new Date().toISOString(),
      precision: this.precision,
      totalSteps: this.sim.totalSteps,
      transientSteps: this.transientSteps,
      flowThroughSteps: this.flowThroughSteps,
      elapsedMs: this.elapsedMs,
      voxelizationMs: this.voxelizationMs,
      gpu: this.adapterDescription,
      browser: navigator.userAgent,
      probeSampling: this.probeSampling,
    });
  }

  snapshot(): AijUrbanRunSnapshot {
    const { stats, means } = this.normalizedStats();
    const averagingFlowThroughs =
      Math.max(0, this.sim.totalSteps - this.transientSteps) / this.flowThroughSteps;
    return {
      totalSteps: this.sim.totalSteps,
      transientSteps: this.transientSteps,
      flowThroughSteps: this.flowThroughSteps,
      sampleIntervalSteps: this.sampleIntervalSteps,
      averagingFlowThroughs,
      requiredAveragingFlowThroughs: REQUIRED_AVERAGING_FLOW_THROUGHS,
      samples: this.averager.samples,
      stats,
      normalizedMeans: means,
      report: this.buildReport(means),
      elapsedMs: this.elapsedMs,
      complete: this.sim.totalSteps >= this.targetSteps,
    };
  }

  /** Advance one fixed, even sampling interval and accumulate the fixture's stated mean. */
  async advance(): Promise<AijUrbanRunSnapshot> {
    const started = performance.now();
    this.sim.submitSteps(this.sampleIntervalSteps);
    const macros = await this.sim.readMacroPoints(this.points);
    this.elapsedMs += performance.now() - started;
    const ux = new Float64Array(this.points.length);
    const uy = new Float64Array(this.points.length);
    const uz = new Float64Array(this.points.length);
    for (let index = 0; index < this.points.length; index++) {
      const rho = macros[index * 4];
      ux[index] = macros[index * 4 + 1];
      uy[index] = macros[index * 4 + 2];
      uz[index] = macros[index * 4 + 3];
      if (![rho, ux[index], uy[index], uz[index]].every(Number.isFinite) || rho <= 0) {
        throw new Error(`AIJ urban solver diverged at probe ${index}, step ${this.sim.totalSteps}`);
      }
    }
    this.averager.add(ux, uy, uz, this.sim.totalSteps);
    return this.snapshot();
  }

  async checkpoint(): Promise<SaveCheckpointResult> {
    const runState: AijUrbanCheckpointState = {
      version: 1,
      sceneKey: this.key,
      totalSteps: this.sim.totalSteps,
      elapsedMs: this.elapsedMs,
      averager: this.averager.serialize(),
    };
    return saveCheckpoint(this.db, this.sim, {
      sceneId: this.key,
      sceneOptions: {
        caseId: this.data.caseId,
        windFromDegrees: this.direction.windFromDegrees,
        grid: this.plan.grid,
        dx: this.plan.dx,
        precision: this.precision,
      },
      runState,
    });
  }

  destroy(): void {
    this.sim.destroy();
    this.db.close();
  }
}
