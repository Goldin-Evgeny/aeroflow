import {
  CellType,
  ConvergingVelocityAverager,
  aijUrbanDirection,
  aijUrbanMeasuredInflow,
  aijUrbanProbesInWindFrame,
  bounds3,
  buildAijUrbanReport,
  fieldStats,
  interpolateInflowToLattice,
  latticeRowHeight,
  materialConfigurationFingerprint,
  planUrbanDomain,
  powerLawProfile,
  prepareUrbanScene,
  resolveAcceptanceOutlet,
  resolveCollisionPolicy,
  urbanBoundaryFlags,
  validateAijUrbanData,
  windAlignEnuPositions,
  type AijUrbanCaseId,
  type AijUrbanData,
  type AijUrbanDirection,
  type AijUrbanReport,
  type ConvergingVelocityAveragerState,
  type ConvergingVelocityStats,
  type FieldStats,
  type GpuBatchPolicyRecord,
  type GpuOperationRecord,
  type Outlet3D,
  type PhaseWindow,
  type ResolvedAcceptanceOutlet,
  type UrbanDomainPlan,
  type UrbanSceneSetup,
  type WebGpuErrorRecord,
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
import {
  AdaptiveStepBatchController,
  OperationFailure,
  OperationSupervisor,
  WebGpuValidationError,
  captureWebGpuErrors,
  withWebGpuErrorScope,
  type AdaptiveBatchOptions,
} from '../operationLiveness';

const PRESET_PATHS: Record<AijUrbanCaseId, string> = {
  C: 'benchmarks/aij/case-c',
  E: 'benchmarks/aij/case-e',
};
const RUNNER_VERSION = 4;
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
  logicalRunId?: string;
  attemptId?: string;
  liveness?: Partial<AijUrbanLivenessPolicy>;
  batch?: AdaptiveBatchOptions;
  /** Programmatic test seam; never exposed as a production UI control. */
  faultInjection?: AijUrbanFaultInjection;
  /** Explicit reproduction override; a non-policy value is diagnostic. */
  outlet?: Outlet3D;
}

export interface AijUrbanLivenessPolicy {
  queueMs: number;
  readbackMs: number;
  checkpointChunkMs: number;
  scoringMs: number;
  maximumMs: number;
}

export interface AijUrbanFaultInjection {
  queueCompletion?: (real: Promise<void>, range: { start: number; end: number }) => Promise<void>;
  probeMap?: (real: Promise<Float32Array>) => Promise<Float32Array>;
  healthMap?: (real: Promise<Float32Array>) => Promise<Float32Array>;
  checkpointTransfer?: <T>(real: Promise<T>) => Promise<T>;
  checkpointPersistence?: <T>(real: Promise<T>) => Promise<T>;
  scoring?: <T>(real: Promise<T>) => Promise<T>;
  deviceLost?: Promise<{ reason?: string; message?: string }>;
}

export interface AijUrbanRunSnapshot {
  totalSteps: number;
  submittedSteps: number;
  completedSteps: number;
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
  phase: 'initialization' | 'transient' | 'averaging' | 'evaluation' | 'terminal';
  windows: PhaseWindow[];
  health: AijUrbanHealthSnapshot[];
  logicalRunId: string;
  attemptId: string;
  operations: GpuOperationRecord[];
  batchPolicy: GpuBatchPolicyRecord;
  webgpuErrors: WebGpuErrorRecord[];
  quarantined: boolean;
}

export interface AijUrbanHealthSnapshot {
  boundary: 'checkpoint' | 'pre-score' | 'terminal';
  sampledAt: string;
  step: number;
  phase: AijUrbanRunSnapshot['phase'];
  readbackMs: number;
  field: FieldStats;
  boundaryMassNet: number;
  boundaryMassCumulative: number;
  boundaryFluxClosureRel: number;
}

interface AijUrbanCheckpointState {
  version: 3;
  sceneKey: string;
  outlet: Outlet3D;
  outletPolicyId: string;
  totalSteps: number;
  elapsedMs: number;
  averager: ConvergingVelocityAveragerState;
  cumulativeBoundaryMass: number;
  health: AijUrbanHealthSnapshot[];
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
    profile[y] = powerLawProfile(latticeRowHeight(y, dx), zRef, 1, data.inflow.alpha);
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
  resolvedOutlet: Pick<ResolvedAcceptanceOutlet, 'outlet' | 'policyId'>,
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
    resolvedOutlet.outlet,
    resolvedOutlet.policyId,
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
    outlet: Outlet3D;
    outletPolicyId: string;
  },
): AijUrbanCheckpointState {
  const state = value as AijUrbanCheckpointState;
  if (
    typeof state !== 'object' ||
    state === null ||
    state.version !== 3 ||
    state.sceneKey !== expected.sceneKey ||
    state.outlet !== expected.outlet ||
    state.outletPolicyId !== expected.outletPolicyId ||
    state.totalSteps !== expected.totalSteps ||
    !Number.isFinite(state.elapsedMs) ||
    state.elapsedMs < 0 ||
    typeof state.averager !== 'object' ||
    state.averager === null ||
    state.averager.nPoints !== expected.nPoints ||
    state.averager.statistic !== expected.statistic ||
    state.averager.transientSteps !== expected.transientSteps ||
    state.averager.checkpointSteps !== expected.flowThroughSteps ||
    !Number.isFinite(state.cumulativeBoundaryMass) ||
    !Array.isArray(state.health)
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
  readonly restoredStep: number | null;
  readonly restoredSamples: number | null;
  readonly precision: 'fp16' | 'fp32';
  readonly logicalRunId: string;
  readonly attemptId: string;
  readonly resolvedOutlet: ResolvedAcceptanceOutlet;

  private readonly device: GPUDevice;
  private readonly sim: Lbm3D;
  private readonly db: IDBDatabase;
  private readonly key: string;
  private readonly points: { x: number; y: number; z: number }[];
  private readonly probeSampling: AijUrbanProbeSamplingMode;
  private readonly adapterDescription: string;
  private averager: ConvergingVelocityAverager;
  private elapsedMs: number;
  private cumulativeBoundaryMass = 0;
  private readonly healthSnapshots: AijUrbanHealthSnapshot[] = [];
  private readonly supervisor: OperationSupervisor;
  private readonly batchController: AdaptiveStepBatchController;
  private readonly liveness: AijUrbanLivenessPolicy;
  private readonly faultInjection: AijUrbanFaultInjection;
  private readonly webgpuErrors: WebGpuErrorRecord[] = [];
  private readonly stopErrorCapture: () => void;
  private quarantined = false;

  private constructor(args: {
    preset: AijUrbanPreset;
    direction: AijUrbanDirection;
    plan: UrbanDomainPlan;
    setup: UrbanSceneSetup;
    geometryVoxels: number;
    voxelizationMs: number;
    sim: Lbm3D;
    device: GPUDevice;
    db: IDBDatabase;
    key: string;
    points: { x: number; y: number; z: number }[];
    probeSampling: AijUrbanProbeSamplingMode;
    averager: ConvergingVelocityAverager;
    elapsedMs: number;
    resumed: boolean;
    restoredStep: number | null;
    restoredSamples: number | null;
    precision: 'fp16' | 'fp32';
    adapterDescription: string;
    flowThroughSteps: number;
    transientSteps: number;
    sampleIntervalSteps: number;
    cumulativeBoundaryMass: number;
    health: AijUrbanHealthSnapshot[];
    logicalRunId: string;
    attemptId: string;
    resolvedOutlet: ResolvedAcceptanceOutlet;
    liveness: AijUrbanLivenessPolicy;
    batch?: AdaptiveBatchOptions;
    faultInjection?: AijUrbanFaultInjection;
  }) {
    this.data = args.preset.data;
    this.direction = args.direction;
    this.plan = args.plan;
    this.setup = args.setup;
    this.geometryVoxels = args.geometryVoxels;
    this.voxelizationMs = args.voxelizationMs;
    this.sim = args.sim;
    this.device = args.device;
    this.db = args.db;
    this.key = args.key;
    this.points = args.points;
    this.probeSampling = args.probeSampling;
    this.averager = args.averager;
    this.elapsedMs = args.elapsedMs;
    this.resumed = args.resumed;
    this.restoredStep = args.restoredStep;
    this.restoredSamples = args.restoredSamples;
    this.precision = args.precision;
    this.adapterDescription = args.adapterDescription;
    this.flowThroughSteps = args.flowThroughSteps;
    this.transientSteps = args.transientSteps;
    this.sampleIntervalSteps = args.sampleIntervalSteps;
    this.cumulativeBoundaryMass = args.cumulativeBoundaryMass;
    this.healthSnapshots.push(...structuredClone(args.health));
    this.logicalRunId = args.logicalRunId;
    this.attemptId = args.attemptId;
    this.resolvedOutlet = args.resolvedOutlet;
    this.liveness = args.liveness;
    this.faultInjection = args.faultInjection ?? {};
    this.batchController = new AdaptiveStepBatchController(args.batch);
    this.supervisor = new OperationSupervisor({
      logicalRunId: this.logicalRunId,
      attemptId: this.attemptId,
      onTransition: (record) => {
        if (
          record.terminalState &&
          record.terminalState !== 'completed' &&
          ['device-lost', 'queue-timeout', 'readback-timeout'].includes(record.classification ?? '')
        ) {
          this.quarantined = true;
        }
      },
    });
    this.stopErrorCapture = captureWebGpuErrors(
      this.device,
      (record) => {
        this.webgpuErrors.push(record);
        if (record.source === 'uncaptured-error') {
          this.supervisor.reportWebGpuError(new WebGpuValidationError(record.message));
        }
      },
      () => this.supervisor.activeContext(),
    );
    this.targetSteps =
      args.transientSteps + REQUIRED_AVERAGING_FLOW_THROUGHS * args.flowThroughSteps;
  }

  static async create(device: GPUDevice, options: AijUrbanRunOptions): Promise<AijUrbanRun> {
    const status = options.onStatus ?? (() => {});
    status(`loading official AIJ Case ${options.caseId} assets`);
    const preset = await loadAijUrbanPreset(options.caseId);
    const resolvedOutlet = resolveAcceptanceOutlet(
      options.caseId === 'C' ? 'V14' : 'V15',
      options.outlet,
    );
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
      boundaryMassLedger: true,
      outlet: resolvedOutlet.outlet,
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
    const key = sceneKey(preset, direction, plan, options.precision, resolvedOutlet);
    const collision = resolveCollisionPolicy();
    let db: IDBDatabase | null = null;
    try {
      db = await openCheckpointDb();
      void requestPersistence();
      let resumed = false;
      let restoredStep: number | null = null;
      let restoredSamples: number | null = null;
      let elapsedMs = 0;
      let cumulativeBoundaryMass = 0;
      let health: AijUrbanHealthSnapshot[] = [];
      if (options.resume) {
        status('restoring latest matching DDF and averaging checkpoint');
        const meta = await restoreCheckpoint(db, sim, key, {
          outlet: resolvedOutlet.outlet,
          outletPolicyId: resolvedOutlet.policyId,
          collisionPolicyId: collision.policyId,
          collisionOperatorId: collision.operatorId,
        });
        if (!meta) {
          throw new Error(
            `AIJ urban resume requested for ${key}, but no complete compatible checkpoint exists`,
          );
        }
        const state = checkpointState(meta.runState, {
          sceneKey: key,
          totalSteps: meta.totalSteps,
          nPoints: points.length,
          statistic: preset.data.measurement.statistic,
          transientSteps,
          flowThroughSteps,
          outlet: resolvedOutlet.outlet,
          outletPolicyId: resolvedOutlet.policyId,
        });
        averager = ConvergingVelocityAverager.fromState(state.averager);
        elapsedMs = state.elapsedMs;
        resumed = true;
        restoredStep = meta.totalSteps;
        restoredSamples = state.averager.samples;
        cumulativeBoundaryMass = state.cumulativeBoundaryMass;
        health = state.health;
      }
      return new AijUrbanRun({
        preset,
        direction,
        plan,
        setup,
        geometryVoxels: boundaries.geometryVoxels,
        voxelizationMs: voxelized.ms,
        sim,
        device,
        db,
        key,
        points,
        probeSampling: probeSampling.mode,
        averager,
        elapsedMs,
        resumed,
        restoredStep,
        restoredSamples,
        precision: options.precision,
        adapterDescription: options.adapterDescription,
        flowThroughSteps,
        transientSteps,
        sampleIntervalSteps,
        cumulativeBoundaryMass,
        health,
        logicalRunId: options.logicalRunId ?? crypto.randomUUID(),
        attemptId: options.attemptId ?? crypto.randomUUID(),
        resolvedOutlet,
        liveness: {
          queueMs: options.liveness?.queueMs ?? 30_000,
          readbackMs: options.liveness?.readbackMs ?? 30_000,
          checkpointChunkMs: options.liveness?.checkpointChunkMs ?? 30_000,
          scoringMs: options.liveness?.scoringMs ?? 30_000,
          maximumMs: options.liveness?.maximumMs ?? 300_000,
        },
        batch: options.batch,
        faultInjection: options.faultInjection,
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
    if (!normalizedMeans || this.sim.gpuCompletedSteps < this.transientSteps) return null;
    const collision = resolveCollisionPolicy();
    return buildAijUrbanReport(this.data, this.direction, this.plan, normalizedMeans, {
      generatedAt: new Date().toISOString(),
      precision: this.precision,
      totalSteps: this.sim.gpuCompletedSteps,
      transientSteps: this.transientSteps,
      flowThroughSteps: this.flowThroughSteps,
      elapsedMs: this.elapsedMs,
      voxelizationMs: this.voxelizationMs,
      gpu: this.adapterDescription,
      browser: navigator.userAgent,
      probeSampling: this.probeSampling,
      outlet: this.resolvedOutlet.outlet,
      outletPolicyId: this.resolvedOutlet.policyId,
      outletConfigurationKind: this.resolvedOutlet.configurationKind,
      collisionPolicyId: collision.policyId,
      collisionOperatorId: collision.operatorId,
      collisionConfigurationKind: collision.configurationKind,
    });
  }

  snapshot(): AijUrbanRunSnapshot {
    const { stats, means } = this.normalizedStats();
    const averagingFlowThroughs =
      Math.max(0, this.sim.gpuCompletedSteps - this.transientSteps) / this.flowThroughSteps;
    return {
      totalSteps: this.sim.gpuCompletedSteps,
      submittedSteps: this.sim.totalSteps,
      completedSteps: this.sim.gpuCompletedSteps,
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
      complete: this.sim.gpuCompletedSteps >= this.targetSteps && !this.quarantined,
      phase: this.phase(),
      windows: this.phaseWindows(),
      health: structuredClone(this.healthSnapshots),
      logicalRunId: this.logicalRunId,
      attemptId: this.attemptId,
      operations: this.supervisor.snapshot(),
      batchPolicy: this.batchController.snapshot(),
      webgpuErrors: structuredClone(this.webgpuErrors),
      quarantined: this.quarantined,
    };
  }

  private phase(): AijUrbanRunSnapshot['phase'] {
    if (this.sim.gpuCompletedSteps === 0) return 'initialization';
    if (this.sim.gpuCompletedSteps <= this.transientSteps) return 'transient';
    if (this.sim.gpuCompletedSteps < this.targetSteps) return 'averaging';
    return this.healthSnapshots.some((sample) => sample.boundary === 'terminal')
      ? 'terminal'
      : 'evaluation';
  }

  phaseWindows(): PhaseWindow[] {
    return [
      {
        phase: 'initialization',
        startStep: 0,
        endStep: 0,
        selectionRule: 'uniform density reset and scene construction',
      },
      ...(this.transientSteps > 0
        ? [
            {
              phase: 'transient' as const,
              startStep: 1,
              endStep: this.transientSteps,
              selectionRule: 'discard the declared three-flow-through startup transient',
              startFlowThrough: 0,
              endFlowThrough: TRANSIENT_FLOW_THROUGHS,
            },
          ]
        : []),
      {
        phase: 'averaging',
        startStep: this.transientSteps + 1,
        endStep: this.targetSteps - 1,
        selectionRule: 'accumulate the fixture-declared velocity statistic',
        startFlowThrough: TRANSIENT_FLOW_THROUGHS,
        endFlowThrough: TRANSIENT_FLOW_THROUGHS + REQUIRED_AVERAGING_FLOW_THROUGHS,
      },
      {
        phase: 'evaluation',
        startStep: this.targetSteps,
        endStep: this.targetSteps,
        selectionRule: 'score the completed accumulated mean against every published point',
      },
    ];
  }

  materialConfiguration(): Record<string, unknown> {
    const collision = resolveCollisionPolicy();
    const material = {
      sceneKey: this.key,
      caseId: this.data.caseId,
      windFromDegrees: this.direction.windFromDegrees,
      grid: this.plan.grid,
      dx: this.plan.dx,
      precision: this.precision,
      collision: 'trt',
      collisionPolicyId: collision.policyId,
      collisionOperatorId: collision.operatorId,
      collisionConfigurationKind: collision.configurationKind,
      regularize: true,
      les: { cs: 0.1 },
      velocityInlet: true,
      outlet: this.resolvedOutlet.outlet,
      outletPolicyId: this.resolvedOutlet.policyId,
      policyOutlet: this.resolvedOutlet.policyOutlet,
      outletQualificationStatus: this.resolvedOutlet.qualificationStatus,
      outletConfigurationKind: this.resolvedOutlet.configurationKind,
      physicsVerdictAllowed:
        this.resolvedOutlet.physicsVerdictAllowed && collision.physicsVerdictAllowed,
      freeSlip: { yMax: true, zMin: true, zMax: true },
      measurementStatistic: this.data.measurement.statistic,
      transientSteps: this.transientSteps,
      averagingSteps: REQUIRED_AVERAGING_FLOW_THROUGHS * this.flowThroughSteps,
      sampleIntervalSteps: this.sampleIntervalSteps,
      boundedSubmission: this.batchController.snapshot(),
      operationDeadlines: this.liveness,
    };
    return { ...material, configurationFingerprint: materialConfigurationFingerprint(material) };
  }

  private async sampleHealth(
    boundary: AijUrbanHealthSnapshot['boundary'],
  ): Promise<AijUrbanHealthSnapshot> {
    const previous = this.healthSnapshots.at(-1);
    this.assertCommitted(`health sampling (${boundary})`);
    if (previous?.step === this.sim.gpuCompletedSteps && previous.boundary !== boundary) {
      const reused = {
        ...structuredClone(previous),
        boundary,
        sampledAt: new Date().toISOString(),
        readbackMs: 0,
      };
      this.healthSnapshots.push(reused);
      return reused;
    }
    const started = performance.now();
    const ledger = await this.supervisor.supervise({
      phase: 'health-readback',
      deadline: { initialMs: this.liveness.readbackMs, maximumMs: this.liveness.maximumMs },
      deviceLost: this.deviceLostSignal(),
      execute: () => this.sim.drainBoundaryMassLedger(),
    });
    this.cumulativeBoundaryMass += ledger.net;
    const readback = this.sim.beginMacroReadback();
    let macros: Float32Array;
    try {
      await this.supervisor.supervise({
        phase: 'queue-completion',
        deadline: { initialMs: this.liveness.queueMs, maximumMs: this.liveness.maximumMs },
        deviceLost: this.deviceLostSignal(),
        execute: () => readback.queueCompletion,
      });
      macros = await this.supervisor.supervise({
        phase: 'health-readback',
        deadline: { initialMs: this.liveness.readbackMs, maximumMs: this.liveness.maximumMs },
        deviceLost: this.deviceLostSignal(),
        execute: () => {
          const real = readback.map();
          return this.faultInjection.healthMap?.(real) ?? real;
        },
      });
    } finally {
      readback.destroy();
    }
    const field = fieldStats(
      macros,
      this.sim.flags,
      this.plan.grid.nx,
      this.plan.grid.ny,
      this.plan.grid.nz,
    );
    const sample: AijUrbanHealthSnapshot = {
      boundary,
      sampledAt: new Date().toISOString(),
      step: this.sim.gpuCompletedSteps,
      phase: this.phase(),
      readbackMs: performance.now() - started,
      field,
      boundaryMassNet: ledger.net,
      boundaryMassCumulative: this.cumulativeBoundaryMass,
      boundaryFluxClosureRel:
        (field.totalMass - field.fluidCells - this.cumulativeBoundaryMass) /
        Math.max(field.fluidCells, 1),
    };
    this.healthSnapshots.push(sample);
    return sample;
  }

  private deviceLostSignal(): Promise<{ reason?: string; message?: string }> {
    return this.faultInjection.deviceLost ?? this.device.lost;
  }

  private assertCommitted(boundary: string): void {
    if (this.quarantined) throw new Error(`AIJ urban ${boundary} rejected: attempt is quarantined`);
    if (this.sim.totalSteps !== this.sim.gpuCompletedSteps) {
      throw new Error(
        `AIJ urban ${boundary} rejected: submitted ${this.sim.totalSteps} != completed ` +
          `${this.sim.gpuCompletedSteps}`,
      );
    }
  }

  private async submitBoundedBatch(steps: number): Promise<void> {
    const range = { start: this.sim.totalSteps + 1, end: this.sim.totalSteps + steps };
    const started = performance.now();
    try {
      await this.supervisor.supervise({
        phase: 'queue-completion',
        submittedRange: range,
        completedRange: () => range,
        deadline: { initialMs: this.liveness.queueMs, maximumMs: this.liveness.maximumMs },
        deviceLost: this.deviceLostSignal(),
        execute: async () => {
          let queueCompletion!: Promise<void>;
          await withWebGpuErrorScope(
            this.device,
            'validation',
            () => {
              const actual = this.sim.submitSteps(steps);
              if (actual.startStep !== range.start || actual.endStep !== range.end) {
                throw new Error('bounded submission step range changed while encoding');
              }
              queueCompletion = this.device.queue.onSubmittedWorkDone();
            },
            (record) => this.webgpuErrors.push(record),
            this.supervisor.activeContext(),
          );
          return this.faultInjection.queueCompletion?.(queueCompletion, range) ?? queueCompletion;
        },
      });
      this.sim.markGpuCompleted(range.end);
      this.batchController.observeCompleted(steps, Math.max(performance.now() - started, 0.001));
    } catch (error) {
      if (
        error instanceof OperationFailure &&
        ['device-lost', 'queue-timeout', 'readback-timeout'].includes(error.classification)
      ) {
        this.quarantined = true;
      } else if (this.sim.totalSteps !== this.sim.gpuCompletedSteps) {
        this.quarantined = true;
      }
      throw error;
    }
  }

  private async readProbeMacros(): Promise<Float32Array> {
    this.assertCommitted('probe sampling');
    const readback = this.sim.beginMacroPointReadback(this.points);
    try {
      await this.supervisor.supervise({
        phase: 'queue-completion',
        deadline: { initialMs: this.liveness.queueMs, maximumMs: this.liveness.maximumMs },
        deviceLost: this.deviceLostSignal(),
        execute: () => readback.queueCompletion,
      });
      return await this.supervisor.supervise({
        phase: 'probe-readback',
        deadline: { initialMs: this.liveness.readbackMs, maximumMs: this.liveness.maximumMs },
        deviceLost: this.deviceLostSignal(),
        execute: () => {
          const real = readback.map();
          return this.faultInjection.probeMap?.(real) ?? real;
        },
      });
    } catch (error) {
      if (
        error instanceof OperationFailure &&
        ['device-lost', 'queue-timeout', 'readback-timeout'].includes(error.classification)
      ) {
        this.quarantined = true;
      }
      throw error;
    } finally {
      readback.destroy();
    }
  }

  /** Advance one exact sampling interval through supervised, bounded GPU submissions. */
  async advance(): Promise<AijUrbanRunSnapshot> {
    this.assertCommitted('advance');
    const started = performance.now();
    let remaining = Math.min(
      this.sampleIntervalSteps,
      Math.max(0, this.targetSteps - this.sim.gpuCompletedSteps),
    );
    while (remaining > 0) {
      const steps = this.batchController.next(remaining);
      await this.submitBoundedBatch(steps);
      remaining -= steps;
    }
    const macros = await this.readProbeMacros();
    this.elapsedMs += performance.now() - started;
    await this.supervisor.supervise({
      phase: 'scoring',
      deadline: { initialMs: this.liveness.scoringMs, maximumMs: this.liveness.maximumMs },
      execute: () => {
        const real = Promise.resolve().then(() => {
          const ux = new Float64Array(this.points.length);
          const uy = new Float64Array(this.points.length);
          const uz = new Float64Array(this.points.length);
          for (let index = 0; index < this.points.length; index++) {
            const rho = macros[index * 4];
            ux[index] = macros[index * 4 + 1];
            uy[index] = macros[index * 4 + 2];
            uz[index] = macros[index * 4 + 3];
            if (![rho, ux[index], uy[index], uz[index]].every(Number.isFinite) || rho <= 0) {
              throw new Error(
                `AIJ urban solver diverged at probe ${index}, step ${this.sim.gpuCompletedSteps}`,
              );
            }
          }
          this.assertCommitted('scoring');
          this.averager.add(ux, uy, uz, this.sim.gpuCompletedSteps);
        });
        return this.faultInjection.scoring?.(real) ?? real;
      },
    });
    if (this.sim.gpuCompletedSteps >= this.targetSteps) {
      await this.sampleHealth('pre-score');
      await this.sampleHealth('terminal');
    }
    return this.snapshot();
  }

  async checkpoint(): Promise<SaveCheckpointResult> {
    this.assertCommitted('checkpoint');
    await this.sampleHealth('checkpoint');
    const runState: AijUrbanCheckpointState = {
      version: 3,
      sceneKey: this.key,
      outlet: this.resolvedOutlet.outlet,
      outletPolicyId: this.resolvedOutlet.policyId,
      totalSteps: this.sim.gpuCompletedSteps,
      elapsedMs: this.elapsedMs,
      averager: this.averager.serialize(),
      cumulativeBoundaryMass: this.cumulativeBoundaryMass,
      health: structuredClone(this.healthSnapshots),
    };
    const collision = resolveCollisionPolicy();
    return saveCheckpoint(this.db, this.sim, {
      sceneId: this.key,
      materialIdentity: {
        outlet: this.resolvedOutlet.outlet,
        outletPolicyId: this.resolvedOutlet.policyId,
        collisionPolicyId: collision.policyId,
        collisionOperatorId: collision.operatorId,
      },
      sceneOptions: {
        caseId: this.data.caseId,
        windFromDegrees: this.direction.windFromDegrees,
        grid: this.plan.grid,
        dx: this.plan.dx,
        precision: this.precision,
        outlet: this.resolvedOutlet.outlet,
        outletPolicyId: this.resolvedOutlet.policyId,
        collisionPolicyId: collision.policyId,
        collisionOperatorId: collision.operatorId,
      },
      runState,
      superviseTransfer: (execute) =>
        this.supervisor.supervise({
          phase: 'checkpoint-transfer',
          deadline: {
            initialMs: this.liveness.checkpointChunkMs,
            maximumMs: this.liveness.maximumMs,
          },
          deviceLost: this.deviceLostSignal(),
          execute: () => {
            const real = execute();
            return this.faultInjection.checkpointTransfer?.(real) ?? real;
          },
        }),
      supervisePersistence: (execute) =>
        this.supervisor.supervise({
          phase: 'checkpoint-persistence',
          deadline: {
            initialMs: this.liveness.checkpointChunkMs,
            maximumMs: this.liveness.maximumMs,
          },
          execute: () => {
            const real = execute();
            return this.faultInjection.checkpointPersistence?.(real) ?? real;
          },
        }),
    });
  }

  destroy(): void {
    this.stopErrorCapture();
    this.sim.destroy();
    this.db.close();
  }
}
