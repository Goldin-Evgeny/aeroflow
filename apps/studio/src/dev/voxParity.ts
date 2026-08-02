import { CellType, icosphere, voxelizeSolid, type VoxelGrid } from '@aeroflow/core';
import { voxelizeMeshGPU } from '../sim/voxelizer';

/**
 * CPU↔GPU voxelization parity harness (M8, step 8; route ?voxparity).
 *
 * Runs the Float64 CPU reference (`voxelizeSolid`) and the WGSL pipeline
 * (`voxelizeMeshGPU`) on the same meshes and compares the CellType masks cell by cell.
 * Gate: ZERO mismatches — voxelization is integer work, so unlike the float LBM kernels
 * the masks must agree exactly (H8 §4). The one theoretical exception: the GPU runs the
 * SAT in f32 vs f64 on the CPU, so a knife-edge triangle-box case could flip a single
 * surface cell; any mismatch is reported with exact coordinates so it can be judged.
 */
export const VOXPARITY_VERSION = 'v1';

interface VoxParityCase {
  label: string;
  positions: Float32Array;
  indices: Uint32Array | null;
  grid: VoxelGrid;
  /** Optional extra invariant checked on the CPU mask (e.g. dirty-CAD interior seal). */
  invariant?: (mask: Uint8Array, grid: VoxelGrid) => string | null;
}

interface VoxParityResult {
  mismatches: number;
  firstMismatch: string;
  cpuSolid: number;
  gpuSolid: number;
  ms: number;
  fillPasses: number;
  invariantFailure: string | null;
  gpuErrors: string[];
  pass: boolean;
}

/** Expand an indexed mesh into a non-indexed soup (exercises the synthesized-index path). */
function deindex(positions: Float32Array, indices: Uint32Array): Float32Array {
  const soup = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    soup[3 * i] = positions[3 * indices[i]];
    soup[3 * i + 1] = positions[3 * indices[i] + 1];
    soup[3 * i + 2] = positions[3 * indices[i] + 2];
  }
  return soup;
}

function buildCases(): VoxParityCase[] {
  const N = 32;
  const grid = { nx: N, ny: N, nz: N };
  const C = 15.5;
  const R = 10.3;
  const sphere = icosphere(3, R, C, C, C); // 1280 triangles — the T-VOX-SPHERE mesh

  // Dirty-CAD case: drop one triangle. At subdivision 3 the hole is ~1.4 cells wide —
  // inside the ≤2-cell seal guarantee, so the interior must still classify solid.
  const dirtyIndices = sphere.indices.slice(3);
  const interiorStillSolid = (mask: Uint8Array, g: VoxelGrid): string | null => {
    for (let z = 0; z < g.nz; z++)
      for (let y = 0; y < g.ny; y++)
        for (let x = 0; x < g.nx; x++) {
          const inside = Math.hypot(x - C, y - C, z - C) <= R - 1.5;
          if (inside && mask[x + g.nx * (y + g.ny * z)] !== CellType.Solid) {
            return `interior cell (${x},${y},${z}) leaked to fluid — hole did not seal`;
          }
        }
    return null;
  };

  return [
    { label: `icosphere r=${R} @ ${N}³ (indexed, 1280 tris)`, ...sphere, grid },
    {
      label: 'same icosphere as non-indexed soup (synthesized index path)',
      positions: deindex(sphere.positions, sphere.indices),
      indices: null,
      grid,
    },
    {
      label: 'dirty CAD: icosphere minus one triangle (~1.4-cell hole must seal)',
      positions: sphere.positions,
      indices: dirtyIndices,
      grid,
      invariant: interiorStillSolid,
    },
  ];
}

async function runCase(device: GPUDevice, c: VoxParityCase): Promise<VoxParityResult> {
  const cpuMask = voxelizeSolid(c.positions, c.indices, c.grid);

  const gpuErrors: string[] = [];
  const onErr = (e: Event) => gpuErrors.push(String((e as GPUUncapturedErrorEvent).error.message));
  device.addEventListener('uncapturederror', onErr);
  device.pushErrorScope('validation');
  device.pushErrorScope('internal');
  device.pushErrorScope('out-of-memory');

  const gpu = await voxelizeMeshGPU(device, c.positions, c.indices, c.grid);

  for (const scope of ['out-of-memory', 'internal', 'validation'] as const) {
    const err = await device.popErrorScope();
    if (err) gpuErrors.push(`[${scope}] ${err.message}`);
  }
  device.removeEventListener('uncapturederror', onErr);

  let mismatches = 0;
  let firstMismatch = '—';
  let cpuSolid = 0;
  let gpuSolid = 0;
  const { nx, ny } = c.grid;
  for (let i = 0; i < cpuMask.length; i++) {
    if (cpuMask[i] === CellType.Solid) cpuSolid++;
    if (gpu.mask[i] === CellType.Solid) gpuSolid++;
    if (cpuMask[i] !== gpu.mask[i]) {
      if (mismatches === 0) {
        const x = i % nx;
        const y = Math.floor(i / nx) % ny;
        const z = Math.floor(i / (nx * ny));
        firstMismatch = `(${x},${y},${z}) cpu=${cpuMask[i]} gpu=${gpu.mask[i]}`;
      }
      mismatches++;
    }
  }
  const invariantFailure = c.invariant ? c.invariant(cpuMask, c.grid) : null;
  return {
    mismatches,
    firstMismatch,
    cpuSolid,
    gpuSolid,
    ms: gpu.ms,
    fillPasses: gpu.fillPasses,
    invariantFailure,
    gpuErrors,
    pass: mismatches === 0 && invariantFailure === null && gpuErrors.length === 0,
  };
}

/** Mount the voxelization parity report (browser dev route ?voxparity). */
export async function mountVoxParity(device: GPUDevice, root: HTMLElement): Promise<void> {
  root.innerHTML = '<p>Running CPU↔GPU voxelization parity (3 meshes)…</p>';
  try {
    const parts: string[] = [];
    let allPass = true;
    for (const c of buildCases()) {
      const r = await runCase(device, c);
      allPass = allPass && r.pass;
      const errs = r.gpuErrors.length
        ? `<pre style="color:#c22;white-space:pre-wrap">GPU errors:\n- ${r.gpuErrors.join('\n- ')}</pre>`
        : '<p style="color:#2a2">no GPU validation/OOM errors</p>';
      const invariant = r.invariantFailure
        ? `<p style="color:#c22">invariant: ${r.invariantFailure}</p>`
        : '';
      parts.push(`
        <h3>${c.label}
          <span style="color:${r.pass ? '#2a2' : '#c22'}">${r.pass ? 'PASS' : 'FAIL'}</span>
        </h3>
        <table style="border-collapse:collapse">
          <tr><td>mismatched cells</td>
              <td style="color:${r.mismatches === 0 ? '#2a2' : '#c22'}">${r.mismatches}
                  (gate: 0, bit-identical)</td></tr>
          <tr><td>first mismatch</td><td>${r.firstMismatch}</td></tr>
          <tr><td>solid cells (CPU / GPU)</td><td>${r.cpuSolid} / ${r.gpuSolid}</td></tr>
          <tr><td>GPU time</td><td>${r.ms.toFixed(1)} ms (${r.fillPasses} fill passes)</td></tr>
        </table>
        ${invariant}
        ${errs}`);
    }
    root.innerHTML = `
      <h2>M8 CPU↔GPU voxelization parity <small>[${VOXPARITY_VERSION}]</small></h2>
      <p style="font-size:1.4em;font-weight:bold;color:${allPass ? '#2a2' : '#c22'}">
        ${allPass ? 'PASS (all meshes bit-identical)' : 'FAIL'}
      </p>
      ${parts.join('<hr/>')}`;
  } catch (e) {
    root.innerHTML = `<pre style="color:#c22">voxparity error:\n${String(e)}</pre>`;
  }
}
