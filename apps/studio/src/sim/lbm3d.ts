import {
  CellType,
  D3Q19,
  lesKFromCs,
  validateEsotericPull3DFlags,
  validateFreeSlip,
  type Outlet3D,
} from '@aeroflow/core';
import shader3d from './shaders/stream_collide_3d.wgsl?raw';
import reduceForces3dWgsl from './shaders/reduce_forces_3d.wgsl?raw';
import { preprocessShader } from './shaderPreprocess';
import {
  planDdfLayout,
  type Precision,
  CELL_FORCE_BYTES_PER_CELL,
  MACRO_BYTES_PER_CELL,
  MACRO_COMPONENT_BYTES_PER_CELL,
  DEFAULT_BINDING_BYTES,
  MAX_DDF_BUFFERS,
  maxAddressableCells,
  storageBindingsNeeded,
} from '../gpu/ddfLayout';
import {
  interpolateMacroPointReadback,
  planMacroPointReadback,
  type MacroSamplePoint,
} from './macroPoints';

export type Collision3D = 'bgk' | 'trt';

export interface Lbm3DOptions {
  nx: number;
  ny: number;
  nz: number;
  /** Base relaxation rate ω = 1/τ₀. */
  omega: number;
  /** Inlet velocity (lattice units, +x). */
  inletVel?: number;
  collision?: Collision3D;
  /** TRT magic parameter Λ (default 3/16). */
  lambda?: number;
  /** Projected (Latt–Chopard) regularization — velocity-stable collision (H10). */
  regularize?: boolean;
  /** Restore the incoming zeroth moment after finite-precision collision (H13). */
  conserveMass?: boolean;
  /** Outlet treatment; H4 zero-gradient copy remains the historical default. */
  outlet?: Outlet3D;
  /** Opt-in H14 diagnostic: accumulate the exact signed fluid-mass effect of shell links. */
  boundaryMassLedger?: boolean;
  /** Smagorinsky LES; off when undefined. Cs≈0.1 (M7). */
  les?: { cs: number; norm?: 'spec' | 'legacy' };
  /**
   * Enable the momentum-exchange force pass (M7, H2). Compiles the FORCES shader variant,
   * allocates the per-cell force + reduction buffers, and enables `sampleForce`. When
   * false (default) the kernel is byte-identical to the M6 stream-collide. Costs one extra
   * storage buffer (16 B/cell) — leave off for benchmark/demo runs that don't need Cd.
   */
  forces?: boolean;
  /**
   * Permit `forces: true` on a scene with no `CellType.BodySolid` cell. Off by default:
   * the kernel weighs BODY links only, so an untagged obstacle reduces to exactly zero
   * force silently, and `uploadFlags` refuses it. Set this only for genuinely body-free
   * control runs (the empty-tunnel reference), where measuring nothing is the point.
   */
  allowNoMeasuredBody?: boolean;
  /**
   * H11 free-slip domain faces (y/z only; x carries inlet/outlet). Uniform-only config —
   * no extra buffers. Cells flagged CellType.FreeSlip must lie on configured faces —
   * `uploadFlags` validates this itself (`validateFreeSlip`), no separate CPU-side call needed.
   */
  freeSlip?: { yMin?: boolean; yMax?: boolean; zMin?: boolean; zMax?: boolean };
  /**
   * H12/M10 per-height inlet profile u_in indexed by y or z. Applies to Inlet and
   * VelocityInlet cells. Compiles the ABL variant (profile + ρ-snapshot bindings).
   */
  inletProfile?: { axis: 'y' | 'z'; ux: Float32Array };
  /**
   * Enable CellType.VelocityInlet support (H12 flux-imposing inlet: equilibrium at the +x
   * neighbor's previous ρ). Compiles the ABL variant. Cells must sit on the x=0 face with
   * a Fluid +x neighbor (validated CPU-side by EsotericPull3D/Solver3D construction).
   */
  velocityInlet?: boolean;
  /**
   * The device's per-binding cap in bytes — pass `deviceBindingCap(caps)`. The DDF planes
   * are split across enough buffers that every binding stays ≤ this (#5). Defaults to the
   * conservative `DEFAULT_BINDING_BYTES` when omitted.
   */
  maxBindingBytes?: number;
  /**
   * Negotiated `maxStorageBufferBindingSize`'s sibling: how many storage buffers one shader
   * stage may bind. The worst-case kernel (4 DDF buffers + forces + ABL) needs **13**, above
   * the WebGPU spec default of 8. Pass it and construction fails with a named limit instead
   * of an opaque pipeline-creation error. Unchecked when omitted.
   */
  maxStorageBuffersPerStage?: number;
  precision?: Precision;
  /** Whether the device granted `shader-f16` (required for the FP16 native path). */
  hasF16?: boolean;
  /** Whether the device granted `timestamp-query`. */
  hasTimestamp?: boolean;
}

export interface LbmReadback<T> {
  queueCompletion: Promise<void>;
  map(): Promise<T>;
  destroy(): void;
}

// 4×u32 + omegaPlus/Minus/inletVel/lambda/lesK (f32) + collectForces/freeSlipMask/
// profileAxis/lesNormSpec (u32) — the last is fix-confirmed-physics-defects's addition.
const PARAMS_SIZE = 52;

/**
 * GPU D3Q19 wind tunnel — the fused Esoteric-Pull stream-collide kernel (M6).
 *
 * DDF storage is split across up to four bindings to honor the negotiated per-binding cap.
 * Algorithm and direction ordering are a 1:1 match of packages/core/src/cpu/esoteric.ts —
 * the CPU parity oracle. Two per-step
 * passes run in ONE compute pass (WebGPU orders intra-pass dispatches): the outlet
 * zero-gradient snapshot, then the fused stream-collide. Step parity alternates via two
 * pre-built bind groups (even/odd) — never a writeBuffer between dispatches (M6 pitfall).
 */
export class Lbm3D {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly n: number;
  readonly precision: Precision;
  readonly flags: Uint8Array;
  /**
   * Whether the H13 mass-conservation correction can actually take effect (false when
   * `conserveMass` was requested but `precision === 'fp16'` quantizes it away — see the
   * constructor comment and docs/WGSL-NOTES.md #23). Report this, not the raw
   * `conserveMass` option, alongside `massDriftRel` so a healthy-looking drift number is
   * never misread as evidence the correction held.
   */
  readonly conserveMassEffective: boolean;
  totalSteps = 0;
  /** Last submitted step known to have crossed an observed GPU completion boundary. */
  gpuCompletedSteps = 0;

  private readonly device: GPUDevice;
  /** DDF planes split across 1–4 storage buffers (iOS binding cap, #5). */
  private readonly ddfBufs: GPUBuffer[];
  /** Planes stored per DDF buffer (all but the last are full); routing constant. */
  private readonly perBuffer: number;
  private readonly flagsBuf: GPUBuffer;
  /** Planar rho, ux, uy, uz outputs; each binding costs one f32 per cell. */
  private readonly macroBufs: [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer];
  private readonly outletSnapBuf: GPUBuffer;
  private readonly paramsBufs: [GPUBuffer, GPUBuffer]; // [even, odd]
  private readonly snapshotPipeline: GPUComputePipeline;
  private readonly snapshotBoundaryMassPipeline: GPUComputePipeline | undefined;
  private readonly streamPipeline: GPUComputePipeline;
  private readonly macroPipeline: GPUComputePipeline;
  private readonly boundaryMassPipeline: GPUComputePipeline | undefined;
  private readonly bindGroups: [GPUBindGroup, GPUBindGroup]; // by parity (collectForces=0)
  // Momentum-exchange force pass (M7, H2 §5); all undefined unless opts.forces is set.
  private readonly forcesEnabled: boolean;
  /** Params with collectForces=1, by parity; used only on the sampled step. */
  private readonly paramsCollectBufs: [GPUBuffer, GPUBuffer] | undefined;
  /** Bind groups referencing the collect params, by parity. */
  private readonly collectBindGroups: [GPUBindGroup, GPUBindGroup] | undefined;
  private readonly cellForceBuf: GPUBuffer | undefined;
  private readonly forceResultBuf: GPUBuffer | undefined;
  private readonly reduceParamsBuf: GPUBuffer | undefined;
  private readonly reduceParamsBuf1: GPUBuffer | undefined;
  private readonly allowNoMeasuredBody: boolean;
  private _measuredCells = 0;
  private readonly reducePipeline: GPUComputePipeline | undefined;
  private readonly reduceBindGroup: GPUBindGroup | undefined;
  private reduceBindGroup1: GPUBindGroup | undefined;
  private forceStaging: GPUBuffer | undefined;
  // M10 ABL boundary conditions (H11 freeSlipMask is uniform-only; H12 needs two buffers).
  private readonly ablEnabled: boolean;
  private readonly inletProfileBuf: GPUBuffer | undefined;
  private readonly velInletRhoBuf: GPUBuffer | undefined;
  private readonly freeSlipMask: number;
  private readonly freeSlipFaces: {
    yMin?: boolean;
    yMax?: boolean;
    zMin?: boolean;
    zMax?: boolean;
  };
  private readonly profileAxis: number;
  private readonly boundaryMassLedgerEnabled: boolean;
  private readonly boundaryMassSurfaceCells: number;
  private readonly boundaryMassLedgerBuf: GPUBuffer | undefined;
  private readonly opts: Required<
    Omit<
      Lbm3DOptions,
      | 'precision'
      | 'hasF16'
      | 'hasTimestamp'
      | 'maxBindingBytes'
      | 'maxStorageBuffersPerStage'
      | 'les'
      | 'forces'
      | 'allowNoMeasuredBody'
      | 'freeSlip'
      | 'inletProfile'
      | 'velocityInlet'
      | 'boundaryMassLedger'
    >
  >;
  /** Smagorinsky LES config; undefined = off. Kept off the Required opts (LES-off is valid). */
  private readonly les: { cs: number; norm?: 'spec' | 'legacy' } | undefined;
  private readonly querySet: GPUQuerySet | undefined;
  private readonly queryResolve: GPUBuffer | undefined;
  private readonly queryStaging: GPUBuffer | undefined;
  private parity: 0 | 1 = 0;

  constructor(device: GPUDevice, o: Lbm3DOptions) {
    this.device = device;
    this.nx = o.nx;
    this.ny = o.ny;
    this.nz = o.nz;
    this.n = o.nx * o.ny * o.nz;
    this.precision = o.precision ?? 'fp32';
    this.les = o.les;
    this.forcesEnabled = o.forces ?? false;
    this.boundaryMassLedgerEnabled = o.boundaryMassLedger ?? false;
    this.boundaryMassSurfaceCells =
      2 * o.ny * o.nz + 2 * (o.nx - 2) * o.nz + 2 * (o.nx - 2) * (o.ny - 2);
    const fs = o.freeSlip ?? {};
    this.freeSlipFaces = fs;
    this.freeSlipMask =
      (fs.yMin ? 1 : 0) | (fs.yMax ? 2 : 0) | (fs.zMin ? 4 : 0) | (fs.zMax ? 8 : 0);
    this.profileAxis = o.inletProfile ? (o.inletProfile.axis === 'y' ? 1 : 2) : 0;
    this.ablEnabled = o.inletProfile !== undefined || (o.velocityInlet ?? false);
    if (o.inletProfile) {
      const expected = o.inletProfile.axis === 'y' ? o.ny : o.nz;
      if (o.inletProfile.ux.length !== expected) {
        throw new Error(
          `Lbm3D: inletProfile.ux length ${o.inletProfile.ux.length} ≠ ` +
            `${o.inletProfile.axis}-extent ${expected}`,
        );
      }
    }
    if (this.precision === 'fp16' && !o.hasF16) {
      throw new Error('Lbm3D: fp16 precision requested but shader-f16 not available');
    }
    // H13's CONSERVE_MASS correction (rho − rhoOut, typically ~1e-7) is quantized away by
    // the very next f16 store — its magnitude sits far below f16's ULP at a typical stored
    // value (docs/WGSL-NOTES.md #23). Rather than reject the combination outright (the M9
    // Ahmed acceptance config runs conserveMass+fp16 together deliberately, per the H13
    // handoff's "default-on in the Ahmed runner"), report it honestly: `conserveMassEffective`
    // tells a caller whether the correction is actually doing anything, so `massDriftRel`
    // is never read as evidence the correction held when it could not have.
    this.conserveMassEffective = (o.conserveMass ?? false) && this.precision !== 'fp16';
    this.flags = new Uint8Array(this.n);
    this.allowNoMeasuredBody = o.allowNoMeasuredBody ?? false;
    this.opts = {
      nx: o.nx,
      ny: o.ny,
      nz: o.nz,
      omega: o.omega,
      inletVel: o.inletVel ?? 0,
      collision: o.collision ?? 'trt',
      lambda: o.lambda ?? 3 / 16,
      regularize: o.regularize ?? false,
      conserveMass: o.conserveMass ?? false,
      outlet: o.outlet ?? 'zero-gradient',
    };

    const layout = planDdfLayout(o.nx, o.ny, o.nz, this.precision, o.maxBindingBytes);
    const plans = layout.ddfBuffers;
    const numBufs = plans.length;
    // Every failure below is a storage-BINDING limit, not device VRAM: a larger GPU does not
    // move any of them. `gridFits`/`maxAddressableCells` predict them all up front.
    const bindingCap = o.maxBindingBytes ?? DEFAULT_BINDING_BYTES;
    const ceiling = maxAddressableCells(this.precision, o.maxBindingBytes);
    const overCeiling =
      `${o.nx}×${o.ny}×${o.nz} = ${this.n} cells exceeds the ${this.precision} ceiling of ` +
      `${ceiling} cells at a ${(bindingCap / 1024 ** 3).toFixed(2)} GiB binding cap; ` +
      `this is a storage-binding limit, not device VRAM.`;
    if (numBufs > MAX_DDF_BUFFERS) {
      throw new Error(
        `Lbm3D: DDF split needs ${numBufs} buffers (>${MAX_DDF_BUFFERS} unsupported at this ` +
          `binding cap). ${overCeiling}`,
      );
    }
    const macroComponentBytes = this.n * MACRO_COMPONENT_BYTES_PER_CELL;
    if (macroComponentBytes > bindingCap) {
      throw new Error(
        `Lbm3D: each macro component needs ${(macroComponentBytes / 1024 ** 3).toFixed(2)} ` +
          `GiB in a single binding (4 B/cell), over the cap. ${overCeiling}`,
      );
    }
    if (this.forcesEnabled) {
      const cellForceBytes = this.n * CELL_FORCE_BYTES_PER_CELL;
      if (cellForceBytes > bindingCap) {
        throw new Error(
          `Lbm3D: the optional cellForce buffer needs ${(cellForceBytes / 1024 ** 3).toFixed(2)} ` +
            `GiB in a single binding (16 B/cell), over the ${(bindingCap / 1024 ** 3).toFixed(2)} ` +
            `GiB cap; disable force collection or reduce the grid.`,
        );
      }
    }
    const bindingsNeeded = storageBindingsNeeded(numBufs, {
      forces: this.forcesEnabled,
      abl: this.ablEnabled,
      massLedger: this.boundaryMassLedgerEnabled,
    });
    if (o.maxStorageBuffersPerStage !== undefined && bindingsNeeded > o.maxStorageBuffersPerStage) {
      throw new Error(
        `Lbm3D: this configuration needs ${bindingsNeeded} storage bindings ` +
          `(${numBufs} DDF + flags/macro×4/outlet` +
          `${this.forcesEnabled ? ' + cellForce' : ''}${this.ablEnabled ? ' + ABL ×2' : ''}` +
          `${this.boundaryMassLedgerEnabled ? ' + massLedger' : ''}), ` +
          `but the device grants maxStorageBuffersPerShaderStage = ` +
          `${o.maxStorageBuffersPerStage}.`,
      );
    }
    this.perBuffer = plans[0].directions.length;
    const mk = (label: string, size: number, usage: GPUBufferUsageFlags) =>
      device.createBuffer({ label, size, usage });

    this.ddfBufs = plans.map((p, k) =>
      mk(
        `ddf3d-${k}`,
        p.bytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      ),
    );
    this.flagsBuf = mk(
      'flags3d',
      Math.ceil(this.n / 4) * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const macroBuffer = (component: string) =>
      mk(
        `macro3d-${component}`,
        macroComponentBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      );
    this.macroBufs = [macroBuffer('rho'), macroBuffer('ux'), macroBuffer('uy'), macroBuffer('uz')];
    this.outletSnapBuf = mk('outletSnap', D3Q19.q * o.ny * o.nz * 4, GPUBufferUsage.STORAGE);
    if (this.boundaryMassLedgerEnabled) {
      this.boundaryMassLedgerBuf = mk(
        'boundaryMassLedger3d',
        (this.boundaryMassSurfaceCells + 4) * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      );
    }
    this.paramsBufs = [
      mk('params-even', PARAMS_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      mk('params-odd', PARAMS_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    ];
    if (this.forcesEnabled) {
      // Per-cell force (vec3f → 16 B stride) + collect-variant params + reduction result.
      this.cellForceBuf = mk('cellForce3d', this.n * 16, GPUBufferUsage.STORAGE);
      this.paramsCollectBufs = [
        mk('paramsC-even', PARAMS_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
        mk('paramsC-odd', PARAMS_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      ];
      // Two vec3f slots: `forceAveraged` reduces consecutive steps into 0 and 1 within one
      // submit so the pair-average of H2 §4a costs a single readback (`sampleForce` uses
      // slot 0 only).
      this.forceResultBuf = mk(
        'forceResult3d',
        32,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      );
      this.reduceParamsBuf = mk('rforce3d', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      this.reduceParamsBuf1 = mk(
        'rforce3d-1',
        16,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      );
    }
    if (this.ablEnabled) {
      // Profile buffer sized max(ny,nz) so a velocityInlet-only config (scalar u_in,
      // profileAxis=0) still satisfies the ABL binding; ρ snapshot is one f32 per
      // (y,z) column of the x=0 face (zero-initialized per WebGPU; snapshot writes it
      // before any VelocityInlet cell reads it, same pass).
      const prof = new Float32Array(Math.max(o.ny, o.nz));
      if (o.inletProfile) prof.set(o.inletProfile.ux);
      this.inletProfileBuf = mk(
        'inletProfile3d',
        prof.byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      );
      device.queue.writeBuffer(this.inletProfileBuf, 0, prof);
      this.velInletRhoBuf = mk('velInletRho3d', o.ny * o.nz * 4, GPUBufferUsage.STORAGE);
    }

    // DDF at bindings 1..numBufs; flags, four macro planes, and outlet follow.
    const flagsBinding = 1 + numBufs;
    const macroBase = flagsBinding + 1;
    const outletBinding = macroBase + this.macroBufs.length;
    const forceBinding = outletBinding + 1;
    const ablBase = forceBinding + (this.forcesEnabled ? 1 : 0);
    const boundaryMassBinding = ablBase + (this.ablEnabled ? 2 : 0);
    const code = preprocessShader(shader3d, {
      STORAGE_FP16: this.precision === 'fp16',
      TRT: this.opts.collision === 'trt',
      REGULARIZE: this.opts.regularize ?? false,
      CONSERVE_MASS: this.opts.conserveMass ?? false,
      PRESSURE_OUTLET: this.opts.outlet === 'pressure',
      LES: this.les !== undefined,
      // Both LES (τ_t) and REGULARIZE (projection) read the one Π^neq reduction.
      NEED_TENSOR: this.les !== undefined || (this.opts.regularize ?? false),
      MULTI_DDF: numBufs > 1,
      DDF_BUF_1: numBufs > 1,
      DDF_BUF_2: numBufs > 2,
      DDF_BUF_3: numBufs > 3,
      PER_BUFFER: this.perBuffer,
      NUM_DDF_BUFFERS: numBufs,
      B_FLAGS: flagsBinding,
      B_MACRO_RHO: macroBase,
      B_MACRO_UX: macroBase + 1,
      B_MACRO_UY: macroBase + 2,
      B_MACRO_UZ: macroBase + 3,
      B_OUTLET: outletBinding,
      FORCES: this.forcesEnabled,
      // H11 free-slip costs throughput even when unused: its branch sits in the innermost
      // gather loop and its `freeSlipRead` call raises register pressure, cutting occupancy
      // on a bandwidth-bound kernel. Compiling it out when no face is configured restores
      // the M6 benchmark path. `uploadFlags` refuses FreeSlip cells in that variant, so the
      // BC can never be silently dropped.
      FREESLIP: this.freeSlipMask !== 0,
      B_FORCE: forceBinding,
      ABL: this.ablEnabled,
      B_PROFILE: ablBase,
      B_VELRHO: ablBase + 1,
      MASS_LEDGER: this.boundaryMassLedgerEnabled,
      B_MASS_LEDGER: boundaryMassBinding,
    });
    const module = device.createShaderModule({ label: 'stream_collide_3d', code });
    // Explicit shared layout: the three entry points touch different resource subsets, so
    // `layout: 'auto'` would mint three incompatible bind-group layouts and
    // a bind group built from one would be rejected by the others (silently discarding
    // the command buffer). One explicit layout keeps a single bind group valid for all.
    const st = (t: GPUBufferBindingType): GPUBindGroupLayoutEntry['buffer'] => ({ type: t });
    const bglEntry = (binding: number, t: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: st(t),
    });
    const bgLayout = device.createBindGroupLayout({
      label: 'lbm3d-bgl',
      entries: [
        bglEntry(0, 'uniform'),
        // DDF storage buffers occupy bindings 1..numBufs.
        ...this.ddfBufs.map((_, k) => bglEntry(1 + k, 'storage')),
        bglEntry(flagsBinding, 'read-only-storage'),
        ...this.macroBufs.map((_, component) => bglEntry(macroBase + component, 'storage')),
        bglEntry(outletBinding, 'storage'),
        ...(this.forcesEnabled ? [bglEntry(forceBinding, 'storage')] : []),
        ...(this.ablEnabled
          ? [bglEntry(ablBase, 'read-only-storage'), bglEntry(ablBase + 1, 'storage')] // ABL
          : []),
        ...(this.boundaryMassLedgerEnabled ? [bglEntry(boundaryMassBinding, 'storage')] : []),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bgLayout] });
    const mkPipeline = (entryPoint: string) =>
      device.createComputePipeline({
        label: `lbm3d-${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      });
    this.snapshotPipeline = mkPipeline('snapshot_outlets');
    this.snapshotBoundaryMassPipeline = this.boundaryMassLedgerEnabled
      ? mkPipeline('snapshot_boundary_mass')
      : undefined;
    this.streamPipeline = mkPipeline('stream_collide');
    this.macroPipeline = mkPipeline('write_macro');
    this.boundaryMassPipeline = this.boundaryMassLedgerEnabled
      ? mkPipeline('reduce_boundary_mass')
      : undefined;

    const mkGroup = (params: GPUBuffer) =>
      device.createBindGroup({
        layout: bgLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          ...this.ddfBufs.map((buffer, k) => ({ binding: 1 + k, resource: { buffer } })),
          { binding: flagsBinding, resource: { buffer: this.flagsBuf } },
          ...this.macroBufs.map((buffer, component) => ({
            binding: macroBase + component,
            resource: { buffer },
          })),
          { binding: outletBinding, resource: { buffer: this.outletSnapBuf } },
          ...(this.forcesEnabled
            ? [{ binding: forceBinding, resource: { buffer: this.cellForceBuf! } }]
            : []),
          ...(this.ablEnabled
            ? [
                { binding: ablBase, resource: { buffer: this.inletProfileBuf! } },
                { binding: ablBase + 1, resource: { buffer: this.velInletRhoBuf! } },
              ]
            : []),
          ...(this.boundaryMassLedgerEnabled
            ? [
                {
                  binding: boundaryMassBinding,
                  resource: { buffer: this.boundaryMassLedgerBuf! },
                },
              ]
            : []),
        ],
      });
    this.bindGroups = [mkGroup(this.paramsBufs[0]), mkGroup(this.paramsBufs[1])];

    if (this.forcesEnabled) {
      const cbufs = this.paramsCollectBufs!;
      this.collectBindGroups = [mkGroup(cbufs[0]), mkGroup(cbufs[1])];
      const reduceModule = device.createShaderModule({
        label: 'reduce_forces_3d',
        code: reduceForces3dWgsl,
      });
      this.reducePipeline = device.createComputePipeline({
        label: 'reduce-forces-3d',
        layout: 'auto',
        compute: { module: reduceModule, entryPoint: 'reduce' },
      });
      this.reduceBindGroup = device.createBindGroup({
        layout: this.reducePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.reduceParamsBuf! } },
          { binding: 1, resource: { buffer: this.cellForceBuf! } },
          { binding: 2, resource: { buffer: this.forceResultBuf! } },
        ],
      });
      this.reduceBindGroup1 = device.createBindGroup({
        layout: this.reducePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.reduceParamsBuf1! } },
          { binding: 1, resource: { buffer: this.cellForceBuf! } },
          { binding: 2, resource: { buffer: this.forceResultBuf! } },
        ],
      });
      // Reduce params: n cells; slot 0 for sampleForce and the first half of a pair,
      // slot 1 for the second half (forceAveraged).
      const rf = new ArrayBuffer(16);
      const dv = new DataView(rf);
      dv.setUint32(0, this.n, true);
      dv.setUint32(4, 0, true); // slot
      this.device.queue.writeBuffer(this.reduceParamsBuf!, 0, rf);
      dv.setUint32(4, 1, true);
      this.device.queue.writeBuffer(this.reduceParamsBuf1!, 0, rf);
    }

    if (o.hasTimestamp) {
      this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
      this.queryResolve = mk(
        'ts-resolve',
        16,
        GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      );
      this.queryStaging = mk('ts-staging', 16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    }

    this.writeParams();
  }

  private writeParams(): void {
    const { omega, lambda, collision, inletVel } = this.opts;
    const tau = 1 / omega;
    const omegaPlus = omega;
    // TRT: Λ = (τ⁺−½)(τ⁻−½) ⇒ ω⁻ = 1/(½ + Λ/(τ−½)). BGK: ω⁻ = ω⁺.
    const omegaMinus = collision === 'trt' ? 1 / (0.5 + lambda / (tau - 0.5)) : omegaPlus;
    // Smagorinsky lesK = 18√2·Cs² (matches makeCollideContext); 0 when LES is off.
    const lesK = this.les ? lesKFromCs(this.les.cs) : 0;
    const build = (parity: 0 | 1, collectForces: 0 | 1): ArrayBuffer => {
      const buf = new ArrayBuffer(PARAMS_SIZE);
      const dv = new DataView(buf);
      dv.setUint32(0, this.nx, true);
      dv.setUint32(4, this.ny, true);
      dv.setUint32(8, this.nz, true);
      dv.setUint32(12, parity, true);
      dv.setFloat32(16, omegaPlus, true);
      dv.setFloat32(20, omegaMinus, true);
      dv.setFloat32(24, inletVel, true);
      dv.setFloat32(28, lambda, true);
      dv.setFloat32(32, lesK, true);
      dv.setUint32(36, collectForces, true);
      dv.setUint32(40, this.freeSlipMask, true);
      dv.setUint32(44, this.profileAxis, true);
      dv.setUint32(48, this.les?.norm === 'spec' ? 1 : 0, true);
      return buf;
    };
    for (let parity = 0 as 0 | 1; parity <= 1; parity++) {
      this.device.queue.writeBuffer(this.paramsBufs[parity], 0, build(parity, 0));
      if (this.paramsCollectBufs) {
        this.device.queue.writeBuffer(this.paramsCollectBufs[parity], 0, build(parity, 1));
      }
      if (parity === 1) break;
    }
  }

  /** Upload the CPU flags mirror (packed 4 cells per u32 word). */
  uploadFlags(): void {
    // Scene legality: the same checks the CPU reference (EsotericPull3D) runs at
    // construction, since this kernel mirrors its Esoteric-Pull layout 1:1. Run here, not
    // left to the caller, so a scene the CPU refuses cannot silently run on the GPU with a
    // different wrong answer (fix-confirmed-physics-defects, scene-boundary-legality).
    validateEsotericPull3DFlags(this.flags, this.nx, this.ny, this.nz);
    validateFreeSlip(this.flags, this.nx, this.ny, this.nz, this.freeSlipFaces);
    const words = new Uint32Array(Math.ceil(this.n / 4));
    let firstFreeSlip = -1;
    let measured = 0;
    for (let idx = 0; idx < this.n; idx++) {
      const flag = this.flags[idx] & 0xff;
      if (flag === CellType.FreeSlip && firstFreeSlip < 0) firstFreeSlip = idx;
      if (flag === CellType.BodySolid) measured++;
      words[idx >> 2] |= flag << ((idx & 3) * 8);
    }
    this._measuredCells = measured;
    // The FREESLIP shader variant is compiled out when no face is configured, so a scene
    // that flags FreeSlip cells anyway would have them silently treated as plain fluid —
    // a wrong answer with no error. Refuse it instead. (Which FACES are legal is the
    // separate, CPU-side `validateFreeSlip` check.)
    if (this.freeSlipMask === 0 && firstFreeSlip >= 0) {
      throw new Error(
        `Lbm3D.uploadFlags: cell ${firstFreeSlip} is CellType.FreeSlip but no free-slip face ` +
          `was configured, so the kernel was compiled without the free-slip gather. Pass ` +
          `\`freeSlip: { … }\` to the constructor.`,
      );
    }
    // Mirror of the free-slip guard above, for the force path. The kernel weighs BODY links
    // ONLY (there is no GPU equivalent of the CPU solvers' per-cell `forceMask`), so a scene
    // that tags its obstacle plain `Solid` — or builds a `forceMask` and forgets the flag —
    // reduces to exactly zero force with no error at all. Since the CPU oracle honours
    // `forceMask`, that also reads as a CPU/GPU physics disagreement rather than a tagging
    // slip. Refuse it, with an opt-out for the body-less control runs (empty tunnel), which
    // legitimately measure nothing.
    if (this.forcesEnabled && measured === 0 && !this.allowNoMeasuredBody) {
      throw new Error(
        `Lbm3D.uploadFlags: constructed with \`forces: true\` but no cell is ` +
          `CellType.BodySolid, so every force sample would be exactly zero. Tag the measured ` +
          `body BodySolid (the flag IS the mask on GPU), or pass ` +
          `\`allowNoMeasuredBody: true\` if this is a deliberately body-free control run.`,
      );
    }
    this.device.queue.writeBuffer(this.flagsBuf, 0, words);
  }

  /** Number of `BodySolid` cells seen by the last `uploadFlags()` — what the force weighs. */
  get measuredCells(): number {
    return this._measuredCells;
  }

  /**
   * Initialize the whole DDF array to equilibrium at (ρ, u). Matches EsotericPull3D.reset:
   * ALL cells (solids included — their slots are functional scratch, H4 §5). FP16 storage
   * is shifted by −w_i, so rest-equilibrium stores exactly zero.
   */
  reset(rho = 1, ux = 0, uy = 0, uz = 0): void {
    const { n } = this;
    if (this.precision === 'fp16') {
      // Shifted store: f_i − w_i. At rest (ρ=1,u=0) this is exactly 0 → zero the buffer.
      // For non-rest init we'd need f16 encoding; parity/benchmark use rest init.
      if (rho !== 1 || ux !== 0 || uy !== 0 || uz !== 0) {
        throw new Error('Lbm3D fp16 reset supports rest-equilibrium init only (see H5)');
      }
      // Shifted store: f_i − w_i = 0 at rest, so rest init is an all-zero-bytes buffer.
      // Zero it ON THE GPU (clearBuffer) rather than uploading a CPU zero image: at
      // 32 cells/b the image is q·n·2 ≈ 2.6 GB, past the ArrayBuffer limit — the reported
      // "Array buffer allocation failed" at scene build. clearBuffer needs no host memory.
      // (DDF buffers are COPY_DST and 4-aligned — the same assumption writeDdf relies on.)
      const enc = this.device.createCommandEncoder();
      for (const buf of this.ddfBufs) enc.clearBuffer(buf);
      this.device.queue.submit([enc.finish()]);
    } else {
      const feq: number[] = [];
      for (let i = 0; i < D3Q19.q; i++) {
        const eu = D3Q19.ex[i] * ux + D3Q19.ey[i] * uy + D3Q19.ez[i] * uz;
        const usq = ux * ux + uy * uy + uz * uz;
        feq.push(D3Q19.w[i] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * usq));
      }
      // Each direction plane is ONE constant (uniform init), so stream a small chunk per
      // plane instead of allocating the whole q·n image — that image is ~2.2 GB at
      // 24 cells/b / ~5.2 GB at 32, i.e. the "Array buffer allocation failed" at scene
      // build (the ?aij page runs fp32). Plane i lives in split buffer ⌊i/perBuffer⌋ at
      // local-plane offset — same layout writeDdf uses.
      const chunkFloats = Math.min(n, 1 << 22); // ≤ 16 MiB of host memory, reused
      const chunk = new Float32Array(chunkFloats);
      const planeBytes = n * 4;
      for (let i = 0; i < D3Q19.q; i++) {
        chunk.fill(feq[i]);
        const k = Math.floor(i / this.perBuffer);
        const base = (i - k * this.perBuffer) * planeBytes;
        for (let off = 0; off < n; off += chunkFloats) {
          const count = Math.min(chunkFloats, n - off);
          this.device.queue.writeBuffer(this.ddfBufs[k], base + off * 4, chunk, 0, count);
        }
      }
    }
    if (this.boundaryMassLedgerBuf) {
      this.device.queue.writeBuffer(
        this.boundaryMassLedgerBuf,
        this.boundaryMassSurfaceCells * 4,
        new Float32Array(4),
      );
    }
    this.parity = 0;
    this.totalSteps = 0;
    this.gpuCompletedSteps = 0;
  }

  private encodeStep(pass: GPUComputePassEncoder): void {
    const group = this.bindGroups[this.parity];
    // Pass 1: outlet snapshot over the +x face (y,z columns).
    pass.setPipeline(this.snapshotPipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(this.ny / 64), this.nz, 1);
    if (this.snapshotBoundaryMassPipeline && this.boundaryMassPipeline) {
      pass.setPipeline(this.snapshotBoundaryMassPipeline);
      pass.dispatchWorkgroups(Math.ceil(this.boundaryMassSurfaceCells / 256));
      pass.setPipeline(this.boundaryMassPipeline);
      pass.dispatchWorkgroups(1);
    }
    // Pass 2: fused stream-collide, one thread per cell. 3D dispatch (Nx/64, Ny, Nz).
    pass.setPipeline(this.streamPipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(this.nx / 64), this.ny, this.nz);
    this.parity = this.parity === 0 ? 1 : 0;
    this.totalSteps++;
  }

  /** Submit `k` timesteps as a single command buffer (no timing). */
  submitSteps(k: number): { startStep: number; endStep: number } {
    if (!Number.isInteger(k) || k <= 0) throw new Error('Lbm3D.submitSteps: k must be positive');
    const startStep = this.totalSteps + 1;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass({ label: `lbm3d ${k} steps` });
    for (let s = 0; s < k; s++) this.encodeStep(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return { startStep, endStep: this.totalSteps };
  }

  /** Commit a submitted range only after its queue-completion promise resolves. */
  markGpuCompleted(endStep = this.totalSteps): void {
    if (
      !Number.isInteger(endStep) ||
      endStep < this.gpuCompletedSteps ||
      endStep > this.totalSteps
    ) {
      throw new Error(
        `Lbm3D.markGpuCompleted: ${endStep} outside [${this.gpuCompletedSteps}, ${this.totalSteps}]`,
      );
    }
    this.gpuCompletedSteps = endStep;
  }

  /**
   * Advance `k` steps and return the INSTANTANEOUS momentum-exchange force (lattice units)
   * at the final step (docs/handoff/H2 §5). Requires `forces: true` at construction. Only
   * the last step collects (collectForces = 1) so the preceding k−1 steps run at baseline
   * cost; a single reduce dispatch in the same pass sums the per-cell buffer. Reads back
   * once per call (H2 §5 protocol).
   *
   * **Weighs `BodySolid` (BODY) links only, not every solid** — see `CellType.BodySolid`.
   * The flag *is* the per-cell mask; a scene whose obstacle is tagged plain `Solid` reads
   * zero here. (This corrects a JSDoc that claimed "all solid cells … no per-cell mask",
   * written before M9 added the flag and left in place through the ground-contamination
   * fix.)
   *
   * **This is a single-parity reading and is NOT the physical force.** Prefer
   * `forceAveraged` for anything reported. The period-2 staggered momentum eigenmode
   * (H2 §4a) is damped by ω⁻ = 1/(½ + Λ/(τ_eff−½)), which collapses as τ₀ → ½: the mode is
   * 0.1% of the force at τ=0.8 but 60% at τ₀=0.500003, where consecutive steps differ by
   * 4×. A previous version of this comment argued an even `k` aliases the mode "to a
   * constant offset removed by downstream mean subtraction" — that holds for an amplitude
   * (Cl, St) but NOT for a mean Cd, which is itself a DC quantity, and it is how the Ahmed
   * ladder came to report Cd 3.99 for a body whose pair-averaged Cd is ~1.42
   * (packages/core/test/ahmedForceSampling.test.ts).
   *
   * Note that the force parity gate (parity3d.ts) cannot catch this: it compares CPU and
   * GPU at the SAME step and parity, and the eigenmode moves both identically. It is a
   * transliteration check, not a physics check.
   */
  async sampleForce(k: number): Promise<{ fx: number; fy: number; fz: number }> {
    if (!this.forcesEnabled) throw new Error('Lbm3D.sampleForce: constructed without forces:true');
    if (k < 1) throw new Error('Lbm3D.sampleForce: k must be ≥ 1');
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass({ label: `lbm3d ${k} steps +force` });
    for (let s = 0; s < k; s++) {
      // The collect bind group differs only in collectForces=1 (writes cellForce); use it on
      // the final step for both passes (same layout — snapshot ignores cellForce).
      const group = (s === k - 1 ? this.collectBindGroups! : this.bindGroups)[this.parity];
      pass.setPipeline(this.snapshotPipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(this.ny / 64), this.nz, 1);
      if (this.snapshotBoundaryMassPipeline && this.boundaryMassPipeline) {
        pass.setPipeline(this.snapshotBoundaryMassPipeline);
        pass.dispatchWorkgroups(Math.ceil(this.boundaryMassSurfaceCells / 256));
        pass.setPipeline(this.boundaryMassPipeline);
        pass.dispatchWorkgroups(1);
      }
      pass.setPipeline(this.streamPipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(this.nx / 64), this.ny, this.nz);
      this.parity = this.parity === 0 ? 1 : 0;
      this.totalSteps++;
    }
    // Same-pass dispatch ordering guarantees the reduce sees the final step's cellForce writes.
    pass.setPipeline(this.reducePipeline!);
    pass.setBindGroup(0, this.reduceBindGroup!);
    pass.dispatchWorkgroups(1);
    pass.end();

    this.ensureForceStaging();
    encoder.copyBufferToBuffer(this.forceResultBuf!, 0, this.forceStaging!, 0, 16);
    this.device.queue.submit([encoder.finish()]);

    await this.forceStaging!.mapAsync(GPUMapMode.READ);
    const r = new Float32Array(this.forceStaging!.getMappedRange());
    const fx = r[0];
    const fy = r[1];
    const fz = r[2];
    this.forceStaging!.unmap();
    return { fx, fy, fz };
  }

  private ensureForceStaging(): void {
    this.forceStaging ??= this.device.createBuffer({
      label: 'force3d-staging',
      // 32 B = two vec3f slots, so `forceAveraged` needs one readback, not two.
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /**
   * Advance `k` steps (`k ≥ 2`) and return the momentum-exchange force on the measured
   * body (`BodySolid` links) averaged over the final TWO consecutive steps. Advances
   * exactly `k` steps, like `sampleForce`, so it is a drop-in replacement and no caller's
   * step bookkeeping shifts.
   *
   * **This, not `sampleForce`, is the physical force.** H2 §4a: "All reported forces are
   * two-consecutive-step averages." Forced/bounce-back flows settle into an exact period-2
   * limit cycle (a non-hydrodynamic staggered momentum eigenmode), and the instantaneous
   * force alternates around the true value every step, forever. The mode is damped by
   * ω⁻ = 1/(½ + Λ/(τ_eff−½)); at τ=0.8 it is 0.1% of the force, at τ₀=0.500003 it is 60%
   * and consecutive steps differ by 4×. Averaging the pair cancels it to ~1e-12 — the
   * two-step average recovers the exact injected momentum where either single reading
   * misses it by orders of magnitude (packages/core/test/forceLedger.test.ts).
   *
   * Cost over `sampleForce`: one extra collecting step (the second-to-last step writes
   * `cellForce` instead of skipping it) and one extra reduce dispatch, both inside the same
   * compute pass, plus a 32 B readback instead of 16 B — the two steps reduce into
   * different slots of `forceResultBuf`, so there is still exactly one map per call.
   */
  async forceAveraged(k: number): Promise<{ fx: number; fy: number; fz: number }> {
    if (!this.forcesEnabled)
      throw new Error('Lbm3D.forceAveraged: constructed without forces:true');
    if (k < 2) throw new Error('Lbm3D.forceAveraged: k must be ≥ 2 (it averages a step pair)');
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass({ label: `lbm3d ${k} steps +paired force` });
    // Collect on the last two steps; reduce each into its own slot immediately after, so
    // the second step's cellForce writes cannot overwrite the first before it is summed.
    for (let s = 0; s < k; s++) {
      const collecting = s >= k - 2;
      const group = (collecting ? this.collectBindGroups! : this.bindGroups)[this.parity];
      pass.setPipeline(this.snapshotPipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(this.ny / 64), this.nz, 1);
      if (this.snapshotBoundaryMassPipeline && this.boundaryMassPipeline) {
        pass.setPipeline(this.snapshotBoundaryMassPipeline);
        pass.dispatchWorkgroups(Math.ceil(this.boundaryMassSurfaceCells / 256));
        pass.setPipeline(this.boundaryMassPipeline);
        pass.dispatchWorkgroups(1);
      }
      pass.setPipeline(this.streamPipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(this.nx / 64), this.ny, this.nz);
      this.parity = this.parity === 0 ? 1 : 0;
      this.totalSteps++;
      if (collecting) {
        pass.setPipeline(this.reducePipeline!);
        pass.setBindGroup(0, s === k - 2 ? this.reduceBindGroup! : this.reduceBindGroup1!);
        pass.dispatchWorkgroups(1);
      }
    }
    pass.end();

    this.ensureForceStaging();
    encoder.copyBufferToBuffer(this.forceResultBuf!, 0, this.forceStaging!, 0, 32);
    this.device.queue.submit([encoder.finish()]);

    await this.forceStaging!.mapAsync(GPUMapMode.READ);
    const r = new Float32Array(this.forceStaging!.getMappedRange());
    const out = {
      fx: 0.5 * (r[0] + r[4]),
      fy: 0.5 * (r[1] + r[5]),
      fz: 0.5 * (r[2] + r[6]),
    };
    this.forceStaging!.unmap();
    return out;
  }

  /**
   * Run `k` timesteps timed. Returns elapsed ms — from timestamp queries when available
   * (GPU-side, accurate), else fenced wall-clock via onSubmittedWorkDone. `timestamped`
   * says which. Warm up before the measured run; keep k ≥ 100 (M6 pitfall).
   */
  async runTimed(k: number): Promise<{ ms: number; timestamped: boolean }> {
    const encoder = this.device.createCommandEncoder();
    const useTs = this.querySet !== undefined;
    const pass = encoder.beginComputePass({
      label: `lbm3d ${k} steps timed`,
      timestampWrites: useTs
        ? { querySet: this.querySet!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
        : undefined,
    });
    for (let s = 0; s < k; s++) this.encodeStep(pass);
    pass.end();
    if (useTs) {
      encoder.resolveQuerySet(this.querySet!, 0, 2, this.queryResolve!, 0);
      encoder.copyBufferToBuffer(this.queryResolve!, 0, this.queryStaging!, 0, 16);
    }
    const t0 = performance.now();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    this.markGpuCompleted();
    const wall = performance.now() - t0;

    if (useTs) {
      await this.queryStaging!.mapAsync(GPUMapMode.READ);
      const ts = new BigUint64Array(this.queryStaging!.getMappedRange());
      const ns = Number(ts[1] - ts[0]);
      this.queryStaging!.unmap();
      if (ns > 0) return { ms: ns / 1e6, timestamped: true };
    }
    return { ms: wall, timestamped: false };
  }

  /** Step parity of the CURRENT layout (0 = canonical). Part of the checkpoint state. */
  get currentParity(): 0 | 1 {
    return this.parity;
  }

  /** Read and reset the exact H14 complete-shell mass ledger since the previous drain. */
  async drainBoundaryMassLedger(): Promise<{ net: number; even: number; odd: number }> {
    if (!this.boundaryMassLedgerBuf) {
      throw new Error('Lbm3D.drainBoundaryMassLedger: boundaryMassLedger was not enabled');
    }
    const staging = this.device.createBuffer({
      label: 'boundary-mass-ledger-staging',
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const offset = this.boundaryMassSurfaceCells * 4;
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(this.boundaryMassLedgerBuf, offset, staging, 0, 16);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const values = new Float32Array(staging.getMappedRange());
      const even = values[0];
      const odd = values[2];
      staging.unmap();
      this.device.queue.writeBuffer(this.boundaryMassLedgerBuf, offset, new Float32Array(4));
      return { net: even + odd, even, odd };
    } finally {
      if (staging.mapState === 'mapped') staging.unmap();
      staging.destroy();
    }
  }

  /** Byte size of each DDF split buffer — the checkpoint chunking plan runs over these. */
  ddfBufferSizes(): number[] {
    return this.ddfBufs.map((b) => b.size);
  }

  /**
   * Direction planes per DDF split buffer — plane i lives in buffer ⌊i/perBuffer⌋ at local
   * plane i mod perBuffer. Exposed for the τ_eff oracle (M9 step 6), which reconstructs
   * `ld(plane, cell)` on the CPU from the raw buffers and must route planes identically to
   * the shader or it silently reads the wrong direction.
   */
  get planesPerDdfBuffer(): number {
    return this.perBuffer;
  }

  /**
   * Smagorinsky 18√2·Cs², or 0 when LES is off — the same `lesK` written into the params
   * buffer. The τ_eff oracle needs it to reproduce the kernel's per-cell relaxation time.
   */
  get lesK(): number {
    return this.les ? lesKFromCs(this.les.cs) : 0;
  }

  /** Base relaxation time τ₀ = 1/ω. ν_mol = (τ₀ − ½)/3. */
  get tau0(): number {
    return 1 / this.opts.omega;
  }

  /**
   * Read one raw chunk of a DDF split buffer (M9 step 4). Bytes come back EXACTLY as
   * stored — for fp16 that is the −w_i-shifted half-precision image; any f16→f32 round
   * trip through JS numbers risks flushing subnormals and breaks the bit-exact restore
   * (M9 pitfall), so nothing here interprets them. Chunk lengths must respect the copy
   * alignment (multiples of 4) and the caller's staging budget (≤ 256 MiB per spec
   * defaults; checkpointFormat.planChunks handles both).
   */
  async readDdfChunk(bufIndex: number, offset: number, length: number): Promise<ArrayBuffer> {
    const buf = this.ddfBufs[bufIndex];
    if (!buf) throw new Error(`readDdfChunk: no DDF buffer ${bufIndex}`);
    if (offset < 0 || offset + length > buf.size) {
      throw new Error(`readDdfChunk: [${offset}, ${offset + length}) outside buffer ${buf.size}`);
    }
    const staging = this.device.createBuffer({
      label: 'ddf-chunk-staging',
      size: length,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(buf, offset, staging, 0, length);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const bytes = staging.getMappedRange().slice(0);
      staging.unmap();
      return bytes;
    } finally {
      staging.destroy();
    }
  }

  /** Write one raw chunk back into a DDF split buffer (checkpoint restore). */
  writeDdfChunk(bufIndex: number, offset: number, bytes: ArrayBuffer): void {
    const buf = this.ddfBufs[bufIndex];
    if (!buf) throw new Error(`writeDdfChunk: no DDF buffer ${bufIndex}`);
    if (offset < 0 || offset + bytes.byteLength > buf.size) {
      throw new Error(
        `writeDdfChunk: [${offset}, ${offset + bytes.byteLength}) outside buffer ${buf.size}`,
      );
    }
    this.device.queue.writeBuffer(buf, offset, bytes);
  }

  /**
   * Restore the step bookkeeping after the DDF bytes are back. The parity selects which
   * pre-built bind group every subsequent step uses — restoring bytes without it reads
   * DDFs from the wrong slots and drifts silently (M9 pitfall; the CPU checkpoint test
   * proves the failure mode).
   */
  restoreStepState(parity: 0 | 1, totalSteps: number): void {
    if (parity !== 0 && parity !== 1) throw new Error('restoreStepState: parity must be 0|1');
    if (!Number.isInteger(totalSteps) || totalSteps < 0) {
      throw new Error('restoreStepState: totalSteps must be a non-negative integer');
    }
    if (totalSteps % 2 !== parity) {
      throw new Error(
        `restoreStepState: parity ${parity} inconsistent with totalSteps ${totalSteps}`,
      );
    }
    this.parity = parity;
    this.totalSteps = totalSteps;
    this.gpuCompletedSteps = totalSteps;
  }

  /** Run the canonical macro readout pass (parity-aware) into the four component buffers. */
  encodeMacro(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginComputePass({ label: 'lbm3d macro' });
    pass.setPipeline(this.macroPipeline);
    pass.setBindGroup(0, this.bindGroups[this.parity]);
    pass.dispatchWorkgroups(Math.ceil(this.nx / 64), this.ny, this.nz);
    pass.end();
  }

  /**
   * Read back macroscopics (rho, ux, uy, uz interleaved, Float32, length 4·n) after the
   * canonical macro pass. Allocates/frees a staging buffer each call — parity/probe use.
   */
  async readMacro(): Promise<Float32Array> {
    const readback = this.beginMacroReadback();
    try {
      await readback.queueCompletion;
      return await readback.map();
    } finally {
      readback.destroy();
    }
  }

  /** Submit the full macro copy while exposing queue completion separately from mapping. */
  beginMacroReadback(): LbmReadback<Float32Array> {
    const componentBytes = this.n * MACRO_COMPONENT_BYTES_PER_CELL;
    const staging = this.macroBufs.map((_, component) =>
      this.device.createBuffer({
        label: `macro-staging-${component}`,
        size: componentBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
    );
    const encoder = this.device.createCommandEncoder();
    this.encodeMacro(encoder);
    for (let component = 0; component < this.macroBufs.length; component++) {
      encoder.copyBufferToBuffer(
        this.macroBufs[component],
        0,
        staging[component],
        0,
        componentBytes,
      );
    }
    this.device.queue.submit([encoder.finish()]);
    let destroyed = false;
    return {
      queueCompletion: this.device.queue.onSubmittedWorkDone(),
      map: async () => {
        await Promise.all(staging.map((buffer) => buffer.mapAsync(GPUMapMode.READ)));
        const output = new Float32Array(this.n * 4);
        for (let component = 0; component < staging.length; component++) {
          const values = new Float32Array(staging[component].getMappedRange());
          for (let cell = 0; cell < this.n; cell++) output[cell * 4 + component] = values[cell];
        }
        return output;
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        for (const buffer of staging) {
          if (buffer.mapState === 'mapped') buffer.unmap();
          buffer.destroy();
        }
      },
    };
  }

  /**
   * Read trilinear macros at selected lattice points without copying the full field.
   * The existing parity-aware macro pass still computes the field on GPU; only the
   * unique eight-corner records needed by the probes cross the GPU/CPU boundary.
   */
  async readMacroPoints(points: readonly MacroSamplePoint[]): Promise<Float32Array> {
    if (points.length === 0) return new Float32Array(0);
    const readback = this.beginMacroPointReadback(points);
    try {
      await readback.queueCompletion;
      return await readback.map();
    } finally {
      readback.destroy();
    }
  }

  /** Submit probe macro/copy work and leave its staging-map boundary independently awaitable. */
  beginMacroPointReadback(points: readonly MacroSamplePoint[]): LbmReadback<Float32Array> {
    if (points.length === 0) {
      return {
        queueCompletion: Promise.resolve(),
        map: () => Promise.resolve(new Float32Array(0)),
        destroy: () => {},
      };
    }
    const plan = planMacroPointReadback(points, this.nx, this.ny, this.nz);
    const size = plan.cellIndices.length * MACRO_BYTES_PER_CELL;
    const staging = this.device.createBuffer({
      label: 'macro-points-staging',
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder();
      this.encodeMacro(encoder);
      for (let slot = 0; slot < plan.cellIndices.length; slot++) {
        for (let component = 0; component < this.macroBufs.length; component++) {
          encoder.copyBufferToBuffer(
            this.macroBufs[component],
            plan.cellIndices[slot] * MACRO_COMPONENT_BYTES_PER_CELL,
            staging,
            (slot * 4 + component) * MACRO_COMPONENT_BYTES_PER_CELL,
            MACRO_COMPONENT_BYTES_PER_CELL,
          );
        }
      }
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      staging.destroy();
      throw error;
    }
    let destroyed = false;
    return {
      queueCompletion: this.device.queue.onSubmittedWorkDone(),
      map: async () => {
        await staging.mapAsync(GPUMapMode.READ);
        const cells = new Float32Array(staging.getMappedRange().slice(0));
        staging.unmap();
        return interpolateMacroPointReadback(cells, plan);
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        if (staging.mapState === 'mapped') staging.unmap();
        staging.destroy();
      },
    };
  }

  /**
   * Planar rho, ux, uy, uz f32 storage buffers written by `encodeMacro`. Exposed so the
   * demo's field-packing compute can read velocity on the shared device without a readback.
   */
  get macroBuffers(): readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer] {
    return this.macroBufs;
  }

  get bytesPerCell(): number {
    return planDdfLayout(this.nx, this.ny, this.nz, this.precision).totalBytes / this.n;
  }

  /** Convenience: helper matching CellType for callers building flag masks. */
  static readonly Cell = CellType;

  destroy(): void {
    for (const b of this.ddfBufs) b.destroy();
    this.flagsBuf.destroy();
    for (const b of this.macroBufs) b.destroy();
    this.outletSnapBuf.destroy();
    this.boundaryMassLedgerBuf?.destroy();
    this.paramsBufs[0].destroy();
    this.paramsBufs[1].destroy();
    this.paramsCollectBufs?.[0].destroy();
    this.paramsCollectBufs?.[1].destroy();
    this.cellForceBuf?.destroy();
    this.forceResultBuf?.destroy();
    this.reduceParamsBuf?.destroy();
    this.reduceParamsBuf1?.destroy();
    this.forceStaging?.destroy();
    this.inletProfileBuf?.destroy();
    this.velInletRhoBuf?.destroy();
    this.querySet?.destroy();
    this.queryResolve?.destroy();
    this.queryStaging?.destroy();
  }
}
