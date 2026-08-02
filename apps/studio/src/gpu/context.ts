export class WebGPUUnsupportedError extends Error {}

/** Capabilities the M6 3D solver negotiates and depends on. */
export interface GpuCapabilities {
  /** Negotiated device limits (post requiredLimits). */
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  /**
   * Storage buffers one shader stage may bind. Governs whether the 3D kernel's worst-case
   * configuration (4 DDF + flags + macro×4 + outlet + forces + ABL = 13 bindings) is legal,
   * `MAX_DDF_BUFFERS` could ever rise. Spec default is 8 — below that worst case — so this
   * is a portability limit, not a curiosity (docs/decisions/D1-resolution-wall.md).
   */
  maxStorageBuffersPerShaderStage: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupsPerDimension: number;
  /** `shader-f16` requested and granted → the native FP16-storage path is available. */
  hasF16: boolean;
  /** `timestamp-query` requested and granted → MLUPs from GPU timestamps, not wall-clock. */
  hasTimestamp: boolean;
}

export interface GpuDeviceInit {
  device: GPUDevice;
  description: string;
  limitsSummary: string;
  caps: GpuCapabilities;
}

export interface GpuInit extends GpuDeviceInit {
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

/**
 * Acquire adapter + device, canvas-free — shared by the main thread and the M9 worker
 * (dedicated workers get their own device; GPUDevice does not cross threads).
 *
 * From M6 (3D) we renegotiate `requiredLimits`: a 256³ D3Q19 lattice needs buffers far
 * above the WebGPU spec defaults (256 MiB buffer / 128 MiB binding). We request the
 * adapter's advertised maxima for buffer/binding size (WebGPU requires you to ask for
 * anything above the default), plus the optional `shader-f16` and `timestamp-query`
 * features when the adapter offers them. All are best-effort: missing features degrade
 * to the FP32-storage / wall-clock fallbacks rather than failing device creation.
 *
 * `onLost` receives every device-loss event (M9 recovery hooks in here); without it the
 * loss is only logged.
 */
export async function initDevice(
  onLost?: (info: GPUDeviceLostInfo) => void,
): Promise<GpuDeviceInit> {
  if (!navigator.gpu) {
    throw new WebGPUUnsupportedError(
      'WebGPU is not available in this browser. Use Chrome/Edge 113+, Safari 26+, or Firefox 141+.',
    );
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new WebGPUUnsupportedError(
      'No WebGPU adapter found. Your GPU or driver may be blocklisted.',
    );
  }

  // Request every optional feature we can use; the adapter tells us what it has.
  const wantFeatures: GPUFeatureName[] = ['shader-f16', 'timestamp-query'];
  const requiredFeatures = wantFeatures.filter((f) => adapter.features.has(f));

  // Ask for the adapter's advertised buffer/binding maxima (M6 needs the headroom).
  const al = adapter.limits;
  const requiredLimits: Record<string, number> = {
    maxBufferSize: al.maxBufferSize,
    maxStorageBufferBindingSize: al.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: al.maxStorageBuffersPerShaderStage,
  };

  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });

  const info = adapter.info;
  const description = info
    ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' · ')
    : 'unknown adapter';

  const l = device.limits;
  const caps: GpuCapabilities = {
    maxBufferSize: l.maxBufferSize,
    maxStorageBufferBindingSize: l.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: l.maxStorageBuffersPerShaderStage,
    maxComputeInvocationsPerWorkgroup: l.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupsPerDimension: l.maxComputeWorkgroupsPerDimension,
    hasF16: device.features.has('shader-f16'),
    hasTimestamp: device.features.has('timestamp-query'),
  };

  const limitsSummary = [
    `maxBufferSize: ${(caps.maxBufferSize / 1024 / 1024).toFixed(0)} MiB`,
    `maxStorageBufferBindingSize: ${(caps.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0)} MiB`,
    `maxStorageBuffersPerShaderStage: ${caps.maxStorageBuffersPerShaderStage}`,
    `maxComputeInvocationsPerWorkgroup: ${caps.maxComputeInvocationsPerWorkgroup}`,
    `maxComputeWorkgroupsPerDimension: ${caps.maxComputeWorkgroupsPerDimension}`,
    `shader-f16: ${caps.hasF16 ? 'yes' : 'no'}`,
    `timestamp-query: ${caps.hasTimestamp ? 'yes' : 'no'}`,
    `features: ${[...device.features].sort().join(', ') || 'none'}`,
  ].join('\n');

  device.lost.then((lostInfo) => {
    console.error('WebGPU device lost:', lostInfo.reason, lostInfo.message);
    onLost?.(lostInfo);
  });

  return { device, description, limitsSummary, caps };
}

/** Acquire adapter + device and configure the canvas (the main-thread entry point). */
export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GpuInit> {
  const base = await initDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new WebGPUUnsupportedError('Could not create a WebGPU canvas context.');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: base.device, format, alphaMode: 'opaque' });
  return { ...base, context, format };
}
