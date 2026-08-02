import { CellType, D2Q9, equilibrium } from '@aeroflow/core';
import lbmWgsl from './shaders/lbm2d.wgsl?raw';
import reduceForcesWgsl from './shaders/reduce_forces.wgsl?raw';
import renderWgsl from './shaders/render2d.wgsl?raw';

export interface Lbm2DParams {
  /** Relaxation rate ω = 1/τ₀ (base). */
  omega: number;
  /** Inlet velocity (lattice units). */
  uin: number;
  /** Collision operator. Default 'bgk'. */
  collision?: 'bgk' | 'trt';
  /** TRT magic parameter Λ. Default 3/16. */
  lambda?: number;
  /** Smagorinsky Cs (0 = LES off). Default 0. */
  lesCs?: number;
  /** Projected (Latt-Chopard) regularization of pre-collision f^neq. See H10. */
  regularize?: boolean;
  /** Restore the incoming zeroth moment after finite-precision collision. See H13. */
  conserveMass?: boolean;
  /**
   * Outlet treatment. Default 'zero-gradient' (interactive tunnel). External-flow cases
   * (M4 cylinder) use 'pressure' — the fixed-ρ non-equilibrium-extrapolation outlet that
   * mirrors solver2d.ts, required for CPU/GPU parity and reflection suppression.
   */
  outlet?: 'zero-gradient' | 'pressure';
  /** Wrap the x edges (periodic). Default false. */
  periodicX?: boolean;
  /** Wrap the y edges (periodic). Default false. M4 cylinder uses periodicY. */
  periodicY?: boolean;
}

/** 18·√2·Cs² — the LES constant, matching makeCollideContext in @aeroflow/core. */
function lesKof(cs: number | undefined): number {
  return cs ? 18 * Math.SQRT2 * cs * cs : 0;
}

export type RenderMode = 'speed' | 'vorticity' | 'tau';

const RENDER_MODE_CODE: Record<RenderMode, number> = { speed: 0, vorticity: 1, tau: 2 };

/**
 * GPU D2Q9 wind tunnel. Same algorithm and direction ordering as the CPU reference
 * solver in @aeroflow/core (see packages/core/src/cpu/solver2d.ts) — pull streaming,
 * halfway bounce-back, equilibrium inlet, zero-gradient outlet. Distributions live in
 * two ping-pong storage buffers holding post-collision values (SoA, direction-major).
 */
export class Lbm2D {
  readonly nx: number;
  readonly ny: number;
  readonly n: number;
  /** CPU mirror of the cell flags; call uploadFlags() after editing. */
  readonly flags: Uint32Array<ArrayBuffer>;
  totalSteps = 0;

  private readonly device: GPUDevice;
  private readonly fBufs: [GPUBuffer, GPUBuffer];
  private readonly flagsBuf: GPUBuffer;
  private readonly velBuf: GPUBuffer;
  /** Per-cell τ_t/τ₀ (LES eddy-viscosity ratio), written by the step kernel. */
  private readonly tauFieldBuf: GPUBuffer;
  private readonly wallVelBuf: GPUBuffer;
  /** Params with collectForces = 0 (fast path) and = 1 (sampled step). */
  private readonly paramsBuf: GPUBuffer;
  private readonly paramsCollectBuf: GPUBuffer;
  private readonly renderParamsBuf: GPUBuffer;
  private readonly stepPipeline: GPUComputePipeline;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly stepBindGroups: [GPUBindGroup, GPUBindGroup];
  private readonly stepCollectBindGroups: [GPUBindGroup, GPUBindGroup];
  private readonly renderBindGroup: GPUBindGroup;
  private readonly workgroups: number;
  // Momentum-exchange force reduction (docs/handoff/H2 §5).
  private readonly cellForceBuf: GPUBuffer;
  private readonly forceResultBuf: GPUBuffer;
  private readonly reduceParamsBuf: GPUBuffer;
  private readonly reducePipeline: GPUComputePipeline;
  private readonly reduceBindGroup: GPUBindGroup;
  private forceStaging: GPUBuffer | undefined;
  /** Which f buffer currently holds the newest (source) state. */
  private parity: 0 | 1 = 0;
  private params: Lbm2DParams;
  private renderMode: RenderMode = 'speed';

  constructor(device: GPUDevice, nx: number, ny: number, params: Lbm2DParams) {
    this.device = device;
    this.nx = nx;
    this.ny = ny;
    this.n = nx * ny;
    this.params = { ...params };
    this.flags = new Uint32Array(this.n);
    this.workgroups = Math.ceil(this.n / 64);

    const fSize = 9 * this.n * 4;
    const mk = (label: string, size: number, usage: GPUBufferUsageFlags) =>
      device.createBuffer({ label, size, usage });
    // COPY_SRC so the parity panel (docs/handoff/H6) can read distributions back.
    this.fBufs = [
      mk('f0', fSize, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC),
      mk('f1', fSize, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC),
    ];
    this.flagsBuf = mk('flags', this.n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.velBuf = mk('vel', this.n * 8, GPUBufferUsage.STORAGE);
    this.tauFieldBuf = mk('tauField', this.n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    // Per-cell moving-wall velocity (vec2f), all-zero unless a lid case sets it (M3).
    this.wallVelBuf = mk('wallVel', this.n * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.paramsBuf = mk('params', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.paramsCollectBuf = mk('paramsC', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.renderParamsBuf = mk('rparams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    // Force reduction buffers (H2 §5): per-cell force + the single reduced result.
    this.cellForceBuf = mk('cellForce', this.n * 8, GPUBufferUsage.STORAGE);
    this.forceResultBuf = mk('forceResult', 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.reduceParamsBuf = mk('rforce', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

    const stepModule = device.createShaderModule({ label: 'lbm2d', code: lbmWgsl });
    this.stepPipeline = device.createComputePipeline({
      label: 'lbm2d-step',
      layout: 'auto',
      compute: { module: stepModule, entryPoint: 'step' },
    });
    const stepLayout = this.stepPipeline.getBindGroupLayout(0);
    const mkStepGroup = (params: GPUBuffer, src: GPUBuffer, dst: GPUBuffer) =>
      device.createBindGroup({
        layout: stepLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: src } },
          { binding: 2, resource: { buffer: dst } },
          { binding: 3, resource: { buffer: this.flagsBuf } },
          { binding: 4, resource: { buffer: this.velBuf } },
          { binding: 5, resource: { buffer: this.wallVelBuf } },
          { binding: 6, resource: { buffer: this.cellForceBuf } },
          { binding: 7, resource: { buffer: this.tauFieldBuf } },
        ],
      });
    this.stepBindGroups = [
      mkStepGroup(this.paramsBuf, this.fBufs[0], this.fBufs[1]),
      mkStepGroup(this.paramsBuf, this.fBufs[1], this.fBufs[0]),
    ];
    this.stepCollectBindGroups = [
      mkStepGroup(this.paramsCollectBuf, this.fBufs[0], this.fBufs[1]),
      mkStepGroup(this.paramsCollectBuf, this.fBufs[1], this.fBufs[0]),
    ];

    const reduceModule = device.createShaderModule({
      label: 'reduce_forces',
      code: reduceForcesWgsl,
    });
    this.reducePipeline = device.createComputePipeline({
      label: 'reduce-forces',
      layout: 'auto',
      compute: { module: reduceModule, entryPoint: 'reduce' },
    });
    this.reduceBindGroup = device.createBindGroup({
      layout: this.reducePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.reduceParamsBuf } },
        { binding: 1, resource: { buffer: this.cellForceBuf } },
        { binding: 2, resource: { buffer: this.forceResultBuf } },
      ],
    });

    const renderModule = device.createShaderModule({ label: 'render2d', code: renderWgsl });
    this.renderPipeline = device.createRenderPipeline({
      label: 'lbm2d-render',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.renderBindGroup = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderParamsBuf } },
        { binding: 1, resource: { buffer: this.velBuf } },
        { binding: 2, resource: { buffer: this.flagsBuf } },
        { binding: 3, resource: { buffer: this.tauFieldBuf } },
      ],
    });

    this.writeParams();
  }

  setParams(p: Partial<Lbm2DParams>): void {
    this.params = { ...this.params, ...p };
    this.writeParams();
  }

  get currentParams(): Lbm2DParams {
    return { ...this.params };
  }

  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
    this.writeParams();
  }

  private writeParams(): void {
    const write = (collectForces: 0 | 1): ArrayBuffer => {
      const buf = new ArrayBuffer(64);
      const dv = new DataView(buf);
      dv.setUint32(0, this.nx, true);
      dv.setUint32(4, this.ny, true);
      dv.setFloat32(8, this.params.omega, true);
      dv.setFloat32(12, this.params.uin, true);
      dv.setUint32(16, this.params.collision === 'trt' ? 1 : 0, true);
      dv.setFloat32(20, this.params.lambda ?? 3 / 16, true);
      dv.setFloat32(24, lesKof(this.params.lesCs), true);
      dv.setUint32(28, this.params.outlet === 'pressure' ? 1 : 0, true);
      dv.setUint32(32, collectForces, true);
      dv.setUint32(36, this.params.periodicX ? 1 : 0, true);
      dv.setUint32(40, this.params.periodicY ? 1 : 0, true);
      dv.setUint32(44, this.params.regularize ? 1 : 0, true);
      dv.setUint32(48, this.params.conserveMass ? 1 : 0, true);
      return buf;
    };
    this.device.queue.writeBuffer(this.paramsBuf, 0, write(0));
    this.device.queue.writeBuffer(this.paramsCollectBuf, 0, write(1));

    // Reduce params: n cells, slot 0 (single-result MVP; see sampleForce).
    const rf = new ArrayBuffer(16);
    const rfdv = new DataView(rf);
    rfdv.setUint32(0, this.n, true);
    rfdv.setUint32(4, 0, true);
    this.device.queue.writeBuffer(this.reduceParamsBuf, 0, rf);

    const rbuf = new ArrayBuffer(16);
    const rdv = new DataView(rbuf);
    rdv.setUint32(0, this.nx, true);
    rdv.setUint32(4, this.ny, true);
    rdv.setFloat32(8, this.params.uin, true);
    rdv.setUint32(12, RENDER_MODE_CODE[this.renderMode], true);
    this.device.queue.writeBuffer(this.renderParamsBuf, 0, rbuf);
  }

  uploadFlags(): void {
    this.device.queue.writeBuffer(this.flagsBuf, 0, this.flags);
  }

  /**
   * Set per-cell moving-wall velocities (Float32, length 2·n: [ux,uy] per cell, lattice
   * units). Only entries on solid cells matter — a fluid cell that bounces a population
   * off such a solid neighbour picks up the Ladd correction. Used by the lid-driven
   * cavity (M3); the interactive tunnel leaves it all-zero.
   */
  setWallVelocity(wallVel: Float32Array<ArrayBuffer>): void {
    if (wallVel.length !== 2 * this.n) throw new Error('wallVel length must be 2·nx·ny');
    this.device.queue.writeBuffer(this.wallVelBuf, 0, wallVel);
  }

  /** Re-initialize the whole flow field to equilibrium at (ρ=1, u=(uin,0)). */
  resetFlow(): void {
    const { n, flags } = this;
    const init = new Float32Array(9 * n);
    const feqDir: number[] = [];
    for (let i = 0; i < 9; i++) feqDir.push(equilibrium(i, 1, this.params.uin, 0));
    for (let idx = 0; idx < n; idx++) {
      const solid = flags[idx] === CellType.Solid;
      for (let i = 0; i < 9; i++) {
        init[i * n + idx] = solid ? 0 : feqDir[i];
      }
    }
    this.device.queue.writeBuffer(this.fBufs[0], 0, init);
    this.device.queue.writeBuffer(this.fBufs[1], 0, init);
    this.parity = 0;
    this.totalSteps = 0;
  }

  /**
   * Fill a rectangle of cells with resting equilibrium (ρ=1, u=0) in BOTH f buffers.
   * Used when erasing obstacles: newly-fluid cells would otherwise have zero
   * populations (ρ=0 → NaN on the next step).
   */
  fillEquilibriumRegion(x0: number, y0: number, x1: number, y1: number): void {
    const { nx, ny, n } = this;
    const cx0 = Math.max(0, Math.min(nx - 1, x0));
    const cx1 = Math.max(0, Math.min(nx - 1, x1));
    const cy0 = Math.max(0, Math.min(ny - 1, y0));
    const cy1 = Math.max(0, Math.min(ny - 1, y1));
    const len = cx1 - cx0 + 1;
    if (len <= 0) return;
    for (let i = 0; i < 9; i++) {
      // At rest, f_i^eq(ρ=1, u=0) = w_i: a constant row segment per direction.
      const row = new Float32Array(len).fill(D2Q9.w[i]);
      for (let y = cy0; y <= cy1; y++) {
        const offset = (i * n + y * nx + cx0) * 4;
        this.device.queue.writeBuffer(this.fBufs[0], offset, row);
        this.device.queue.writeBuffer(this.fBufs[1], offset, row);
      }
    }
  }

  /** Encode + submit k timesteps as a standalone command buffer (headless/parity use). */
  submitSteps(k: number): void {
    const encoder = this.device.createCommandEncoder();
    this.encodeSteps(encoder, k);
    this.device.queue.submit([encoder.finish()]);
  }

  /** Encode k timesteps (ping-pong within a single compute pass). */
  encodeSteps(encoder: GPUCommandEncoder, k: number): void {
    const pass = encoder.beginComputePass({ label: `lbm2d ${k} steps` });
    pass.setPipeline(this.stepPipeline);
    for (let s = 0; s < k; s++) {
      pass.setBindGroup(0, this.stepBindGroups[this.parity]);
      pass.dispatchWorkgroups(this.workgroups);
      this.parity = this.parity === 0 ? 1 : 0;
    }
    pass.end();
    this.totalSteps += k;
  }

  /**
   * Advance `k` steps and return the momentum-exchange force (lattice units) on all solid
   * cells at the final step (docs/handoff/H2 §5). Only the last step writes cellForce
   * (collectForces = 1), so the preceding k−1 steps run at baseline cost; a single reduce
   * dispatch in the same pass sums it. For the cylinder scene the only solids are the
   * obstacle, so this equals the obstacle force (H2 §2). Use an EVEN `k` as the sample
   * interval: it aliases the period-2 staggered momentum eigenmode to a constant offset
   * (removed downstream by mean subtraction), so no explicit pair-averaging is needed
   * (H2 §4a). Reads back once per call — never per raw step (H2 §5 protocol).
   */
  async sampleForce(k: number): Promise<{ fx: number; fy: number }> {
    if (k < 1) throw new Error('sampleForce: k must be ≥ 1');
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass({ label: `lbm2d ${k} steps +force` });
    pass.setPipeline(this.stepPipeline);
    for (let s = 0; s < k; s++) {
      const groups = s === k - 1 ? this.stepCollectBindGroups : this.stepBindGroups;
      pass.setBindGroup(0, groups[this.parity]);
      pass.dispatchWorkgroups(this.workgroups);
      this.parity = this.parity === 0 ? 1 : 0;
    }
    // Dispatch ordering within the pass guarantees the reduce sees the final step's
    // cellForce writes (the ping-pong stepping relies on the same guarantee).
    pass.setPipeline(this.reducePipeline);
    pass.setBindGroup(0, this.reduceBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();

    if (!this.forceStaging) {
      this.forceStaging = this.device.createBuffer({
        label: 'force-staging',
        size: 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    encoder.copyBufferToBuffer(this.forceResultBuf, 0, this.forceStaging, 0, 8);
    this.device.queue.submit([encoder.finish()]);
    this.totalSteps += k;

    await this.forceStaging.mapAsync(GPUMapMode.READ);
    const r = new Float32Array(this.forceStaging.getMappedRange());
    const fx = r[0];
    const fy = r[1];
    this.forceStaging.unmap();
    return { fx, fy };
  }

  /**
   * Read back the current post-collision distributions (SoA i·n+idx, Float32).
   * After N steps the newest state lives in fBufs[this.parity] (docs/handoff/H6 §3).
   * For the parity panel only — allocates and frees a staging buffer each call.
   */
  async readDistributions(): Promise<Float32Array> {
    const size = 9 * this.n * 4;
    const staging = this.device.createBuffer({
      label: 'parity-staging',
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.fBufs[this.parity], 0, staging, 0, size);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }

  /** Read per-cell τ_t/τ₀ for validation; colliding cells have τ_eff=τ₀·(1+value). */
  async readTauField(): Promise<Float32Array> {
    const size = this.n * 4;
    const staging = this.device.createBuffer({
      label: 'tau-field-staging',
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.tauFieldBuf, 0, staging, 0, size);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }

  /** Release GPU buffers (offscreen parity instances). */
  destroy(): void {
    this.fBufs[0].destroy();
    this.fBufs[1].destroy();
    this.flagsBuf.destroy();
    this.velBuf.destroy();
    this.tauFieldBuf.destroy();
    this.wallVelBuf.destroy();
    this.paramsBuf.destroy();
    this.paramsCollectBuf.destroy();
    this.renderParamsBuf.destroy();
    this.cellForceBuf.destroy();
    this.forceResultBuf.destroy();
    this.reduceParamsBuf.destroy();
    this.forceStaging?.destroy();
  }

  encodeRender(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    const pass = encoder.beginRenderPass({
      label: 'lbm2d render',
      colorAttachments: [
        { view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(3);
    pass.end();
  }
}
