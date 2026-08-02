import { CellType, type VoxelGrid } from '@aeroflow/core';
import surfaceWgsl from './shaders/voxelize_surface.wgsl?raw';
import fillWgsl from './shaders/voxelize_fill.wgsl?raw';

/**
 * GPU voxelization pipeline (M8, step 4): conservative surface pass (per-triangle SAT
 * scatter into a bitmask) → iterative exterior flood fill → classify to a CellType mask.
 *
 * GPU counterpart of `voxelizeSolid()` in packages/core/src/voxel/voxelize.ts; the
 * ?voxparity harness compares the two bit-for-bit (integer work — exact, H8 §4).
 * `positions` must already be in lattice space (1 unit = 1 cell), like the CPU path.
 * Non-indexed soups get a synthesized 0..3N−1 index buffer so one shader serves both.
 */
export interface VoxelizeGpuResult {
  /** CellType per cell (Solid = surface + enclosed interior, Fluid = exterior). */
  mask: Uint8Array;
  /** Wall-clock ms from first submit to mask readback complete (acceptance 1 metric). */
  ms: number;
  /** Flood-fill propagate passes executed until convergence. */
  fillPasses: number;
}

/** Propagate passes encoded per host round-trip (readback of `changed` between batches). */
const FILL_BATCH = 32;

export async function voxelizeMeshGPU(
  device: GPUDevice,
  positions: Float32Array,
  indices: Uint32Array | null,
  grid: VoxelGrid,
): Promise<VoxelizeGpuResult> {
  const { nx, ny, nz } = grid;
  const nCells = nx * ny * nz;
  const nWords = Math.ceil(nCells / 32);
  const triCount = indices ? indices.length / 3 : positions.length / 9;

  // Same meters-as-cells guard as the CPU reference (H8 pitfall 6).
  let lo = Infinity;
  let hi = -Infinity;
  for (let a = 0; a < 3; a++) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = a; i < positions.length; i += 3) {
      mn = Math.min(mn, positions[i]);
      mx = Math.max(mx, positions[i]);
    }
    lo = Math.min(lo, mx - mn);
    hi = Math.max(hi, mx - mn);
  }
  if (triCount === 0 || hi < 4) {
    throw new Error(
      `voxelizeMeshGPU: mesh AABB spans only ${hi.toFixed(3)} cells — positions must be ` +
        `pre-transformed to lattice space (1 unit = 1 cell)`,
    );
  }

  const idxArray = indices ?? Uint32Array.from({ length: triCount * 3 }, (_, i) => i);

  const t0 = performance.now();

  // --- Buffers ---
  const mkStorage = (label: string, size: number, extraUsage = 0): GPUBuffer =>
    device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | extraUsage });
  const positionsBuf = mkStorage('vox-positions', positions.byteLength, GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(
    positionsBuf,
    0,
    positions.buffer as ArrayBuffer,
    positions.byteOffset,
    positions.byteLength,
  );
  const indicesBuf = mkStorage('vox-indices', idxArray.byteLength, GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(
    indicesBuf,
    0,
    idxArray.buffer as ArrayBuffer,
    idxArray.byteOffset,
    idxArray.byteLength,
  );
  const surfaceBits = mkStorage('vox-surface-bits', nWords * 4); // zero-initialized
  const exteriorBits = mkStorage('vox-exterior-bits', nWords * 4);
  const changedBuf = mkStorage('vox-changed', 4, GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  const outMask = mkStorage('vox-out-mask', nCells * 4, GPUBufferUsage.COPY_SRC);
  const surfaceParams = device.createBuffer({
    label: 'vox-surface-params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(surfaceParams, 0, new Uint32Array([nx, ny, nz, triCount]));
  const fillParams = device.createBuffer({
    label: 'vox-fill-params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(fillParams, 0, new Uint32Array([nx, ny, nz, 0]));
  const changedStaging = device.createBuffer({
    label: 'vox-changed-staging',
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const maskStaging = device.createBuffer({
    label: 'vox-mask-staging',
    size: nCells * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // --- Pipelines (explicit shared layouts — per-entry `layout:'auto'` would mint
  // incompatible bind-group layouts across the three fill entry points, the M6 lesson) ---
  const surfaceModule = device.createShaderModule({ label: 'vox-surface', code: surfaceWgsl });
  const fillModule = device.createShaderModule({ label: 'vox-fill', code: fillWgsl });

  const surfaceLayout = device.createBindGroupLayout({
    label: 'vox-surface-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const fillLayout = device.createBindGroupLayout({
    label: 'vox-fill-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const surfacePipeline = device.createComputePipeline({
    label: 'vox-surface-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [surfaceLayout] }),
    compute: { module: surfaceModule, entryPoint: 'voxelize_surface' },
  });
  const fillPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [fillLayout] });
  const mkFillPipeline = (entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label: `vox-fill-${entryPoint}`,
      layout: fillPipelineLayout,
      compute: { module: fillModule, entryPoint },
    });
  const seedPipeline = mkFillPipeline('seed');
  const propagatePipeline = mkFillPipeline('propagate');
  const classifyPipeline = mkFillPipeline('classify');

  const surfaceBindGroup = device.createBindGroup({
    label: 'vox-surface-bg',
    layout: surfaceLayout,
    entries: [
      { binding: 0, resource: { buffer: surfaceParams } },
      { binding: 1, resource: { buffer: positionsBuf } },
      { binding: 2, resource: { buffer: indicesBuf } },
      { binding: 3, resource: { buffer: surfaceBits } },
    ],
  });
  const fillBindGroup = device.createBindGroup({
    label: 'vox-fill-bg',
    layout: fillLayout,
    entries: [
      { binding: 0, resource: { buffer: fillParams } },
      { binding: 1, resource: { buffer: surfaceBits } },
      { binding: 2, resource: { buffer: exteriorBits } },
      { binding: 3, resource: { buffer: changedBuf } },
      { binding: 4, resource: { buffer: outMask } },
    ],
  });

  // Per-cell passes use the same 3D dispatch shape as the LBM kernels — a flat 1D
  // dispatch of 256³/64 workgroups would exceed the 65,535 per-dimension limit.
  const cellDispatch = [Math.ceil(nx / 64), ny, nz] as const;

  // --- Surface pass + seed ---
  {
    const encoder = device.createCommandEncoder({ label: 'vox-surface-seed' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(surfacePipeline);
    pass.setBindGroup(0, surfaceBindGroup);
    pass.dispatchWorkgroups(Math.ceil(triCount / 64));
    pass.setPipeline(seedPipeline);
    pass.setBindGroup(0, fillBindGroup);
    pass.dispatchWorkgroups(...cellDispatch);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // --- Flood fill: batches of propagate passes until a whole batch changes nothing.
  // Each pass advances the frontier ≥1 cell, so passes needed ≈ the longest exterior
  // path (~nx+ny+nz for typical scenes); the cap only guards against a driver bug.
  let fillPasses = 0;
  const maxPasses = 64 * (nx + ny + nz);
  for (;;) {
    device.queue.writeBuffer(changedBuf, 0, new Uint32Array([0]));
    const encoder = device.createCommandEncoder({ label: 'vox-fill-batch' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(propagatePipeline);
    pass.setBindGroup(0, fillBindGroup);
    for (let i = 0; i < FILL_BATCH; i++) pass.dispatchWorkgroups(...cellDispatch);
    pass.end();
    encoder.copyBufferToBuffer(changedBuf, 0, changedStaging, 0, 4);
    device.queue.submit([encoder.finish()]);
    fillPasses += FILL_BATCH;

    await changedStaging.mapAsync(GPUMapMode.READ);
    const changed = new Uint32Array(changedStaging.getMappedRange())[0];
    changedStaging.unmap();
    if (changed === 0) break;
    if (fillPasses >= maxPasses) {
      throw new Error(`voxelizeMeshGPU: flood fill did not converge in ${fillPasses} passes`);
    }
  }

  // --- Classify + read back ---
  {
    const encoder = device.createCommandEncoder({ label: 'vox-classify' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(classifyPipeline);
    pass.setBindGroup(0, fillBindGroup);
    pass.dispatchWorkgroups(...cellDispatch);
    pass.end();
    encoder.copyBufferToBuffer(outMask, 0, maskStaging, 0, nCells * 4);
    device.queue.submit([encoder.finish()]);
  }
  await maskStaging.mapAsync(GPUMapMode.READ);
  const words = new Uint32Array(maskStaging.getMappedRange());
  const mask = new Uint8Array(nCells);
  for (let i = 0; i < nCells; i++) {
    mask[i] = words[i] === 0 ? CellType.Fluid : CellType.Solid;
  }
  maskStaging.unmap();
  const ms = performance.now() - t0;

  for (const b of [
    positionsBuf,
    indicesBuf,
    surfaceBits,
    exteriorBits,
    changedBuf,
    outMask,
    surfaceParams,
    fillParams,
    changedStaging,
    maskStaging,
  ]) {
    b.destroy();
  }

  return { mask, ms, fillPasses };
}
