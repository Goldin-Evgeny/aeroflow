import { ExternalTexture, LinearFilter, ClampToEdgeWrapping, type Texture } from 'three/webgpu';
import packShader from '../../sim/shaders/pack_field_3d.wgsl?raw';

/**
 * FieldTexture — the one shared-device bridge from the raw-WebGPU solver into Three.js
 * (M6 step 9). The demo runs `Lbm3D` on a `GPUDevice`; `WebGPURenderer` is constructed on
 * that same device, so a `GPUTexture` written by our own compute pass can be sampled inside
 * Three's node materials with no readback and no copy.
 *
 * We own a 3D `rgba16float` texture (vx, vy, vz, |u|). A raw compute pass reads the solver's
 * planar velocity buffers and fills it. The texture is handed to Three via `ExternalTexture`
 * (three/webgpu wraps `.sourceTexture` directly); setting `is3DTexture = true` makes the
 * node builder emit `texture_3d<f32>` bindings and a ThreeD sampler view. Both slice-plane
 * materials and the particle-advection TSL compute sample it through `texture3D(...)`.
 */
export class FieldTexture {
  /** Pass this to `texture3D(...)` in TSL. */
  readonly texture: Texture;

  private readonly device: GPUDevice;
  private readonly gpuTex: GPUTexture;
  private readonly dimsBuf: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly dispatch: [number, number, number];

  constructor(
    device: GPUDevice,
    macroBufs: readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer],
    nx: number,
    ny: number,
    nz: number,
  ) {
    this.device = device;
    this.dispatch = [Math.ceil(nx / 64), ny, nz];

    this.gpuTex = device.createTexture({
      label: 'field-vel-3d',
      size: { width: nx, height: ny, depthOrArrayLayers: nz },
      dimension: '3d',
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Wrap for Three. `is3DTexture` drives both the WGSL emit (texture_3d) and the sampler
    // view dimension (ThreeD) in three/webgpu's WGSLNodeBuilder / WebGPUBindingUtils.
    const ext = new ExternalTexture(this.gpuTex);
    (ext as unknown as { is3DTexture: boolean }).is3DTexture = true;
    ext.minFilter = LinearFilter;
    ext.magFilter = LinearFilter;
    ext.wrapS = ClampToEdgeWrapping;
    ext.wrapT = ClampToEdgeWrapping;
    (ext as unknown as { wrapR: number }).wrapR = ClampToEdgeWrapping;
    ext.needsUpdate = true;
    this.texture = ext as unknown as Texture;

    this.dimsBuf = device.createBuffer({
      label: 'field-dims',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.dimsBuf, 0, new Uint32Array([nx, ny, nz, 0]));

    const module = device.createShaderModule({ label: 'pack_field_3d', code: packShader });
    const bgLayout = device.createBindGroupLayout({
      label: 'field-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' },
        },
      ],
    });
    this.pipeline = device.createComputePipeline({
      label: 'field-pack',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgLayout] }),
      compute: { module, entryPoint: 'pack' },
    });
    this.bindGroup = device.createBindGroup({
      layout: bgLayout,
      entries: [
        { binding: 0, resource: { buffer: this.dimsBuf } },
        { binding: 1, resource: { buffer: macroBufs[1] } },
        { binding: 2, resource: { buffer: macroBufs[2] } },
        { binding: 3, resource: { buffer: macroBufs[3] } },
        { binding: 4, resource: this.gpuTex.createView({ dimension: '3d' }) },
      ],
    });
  }

  /** Encode the macro→texture pack (call after the solver's `encodeMacro`). */
  encode(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginComputePass({ label: 'field-pack' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(this.dispatch[0], this.dispatch[1], this.dispatch[2]);
    pass.end();
  }

  destroy(): void {
    this.gpuTex.destroy();
    this.dimsBuf.destroy();
    this.texture.dispose();
  }
}
