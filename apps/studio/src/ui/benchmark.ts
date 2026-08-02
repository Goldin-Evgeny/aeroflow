import { CellType } from '@aeroflow/core';
import type { GpuCapabilities } from '../gpu/context';
import { Lbm3D } from '../sim/lbm3d';
import { gridFits, planDdfLayout, type Precision, deviceBindingCap } from '../gpu/ddfLayout';
import { hooks } from '../dev/testHooks';

/**
 * Browser 3D LBM benchmark page (M6, step 10 + acceptance #4). Runs a size ladder
 * (128³ → 192³ → 256³) × {FP32, FP16}, ≥1000 timed steps after warm-up, and reports
 * MLUPs per configuration alongside adapter info, f16 availability, and negotiated
 * limits. Throughput only — NO accuracy claims here. These are, as far as we know, the
 * first published browser 3D LBM numbers; prior figures were derived, not measured.
 */

const LADDER = [128, 192, 256];
const WARMUP = 100;
const TIMED = 1000;
const INLET_VEL = 0.05;
const TAU = 0.8;

export interface BenchRow {
  grid: number;
  precision: Precision;
  cells: number;
  bytesPerCell: number;
  totalMB: number;
  steps: number;
  ms: number;
  mlups: number;
  stepsPerSec: number;
  timestamped: boolean;
  skipped?: string;
}

/** Minimal duct: solid y/z shell, +x inlet, −x outlet. No obstacle (pure throughput). */
function ductFlags(n: number): Uint8Array {
  const flags = new Uint8Array(n * n * n);
  const idx = (x: number, y: number, z: number) => x + n * (y + n * z);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (y === 0 || y === n - 1 || z === 0 || z === n - 1) flags[idx(x, y, z)] = CellType.Solid;
        else if (x === 0) flags[idx(x, y, z)] = CellType.Inlet;
        else if (x === n - 1) flags[idx(x, y, z)] = CellType.Outlet;
      }
  return flags;
}

export async function runBenchmark(
  device: GPUDevice,
  caps: GpuCapabilities,
  onRow?: (row: BenchRow) => void,
): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  for (const grid of LADDER) {
    for (const precision of ['fp32', 'fp16'] as Precision[]) {
      const cells = grid * grid * grid;
      const layout = planDdfLayout(grid, grid, grid, precision);
      const base: BenchRow = {
        grid,
        precision,
        cells,
        bytesPerCell: layout.totalBytes / cells,
        totalMB: layout.totalBytes / 1024 / 1024,
        steps: 0,
        ms: 0,
        mlups: 0,
        stepsPerSec: 0,
        timestamped: false,
      };
      if (precision === 'fp16' && !caps.hasF16) {
        rows.push({ ...base, skipped: 'shader-f16 unavailable' });
        onRow?.(rows[rows.length - 1]);
        continue;
      }
      if (
        !gridFits(grid, grid, grid, precision, caps.maxStorageBufferBindingSize, caps.maxBufferSize)
      ) {
        rows.push({ ...base, skipped: 'exceeds negotiated buffer/binding limits' });
        onRow?.(rows[rows.length - 1]);
        continue;
      }

      let sim: Lbm3D | undefined;
      try {
        sim = new Lbm3D(device, {
          nx: grid,
          ny: grid,
          nz: grid,
          omega: 1 / TAU,
          inletVel: INLET_VEL,
          collision: 'trt',
          precision,
          // Split DDF planes to the device's real binding cap (iOS portability, #5).
          maxBindingBytes: deviceBindingCap(caps),
          maxStorageBuffersPerStage: caps.maxStorageBuffersPerShaderStage,
          hasF16: caps.hasF16,
          hasTimestamp: caps.hasTimestamp,
        });
        const flags = ductFlags(grid);
        sim.flags.set(flags);
        sim.uploadFlags();
        sim.reset();
        sim.submitSteps(WARMUP);
        await device.queue.onSubmittedWorkDone();
        const { ms, timestamped } = await sim.runTimed(TIMED);
        const mlups = (cells * TIMED) / (ms * 1000);
        const row: BenchRow = {
          ...base,
          steps: TIMED,
          ms,
          mlups,
          stepsPerSec: (TIMED * 1000) / ms,
          timestamped,
        };
        rows.push(row);
        onRow?.(row);
      } catch (e) {
        rows.push({ ...base, skipped: `error: ${String(e)}` });
        onRow?.(rows[rows.length - 1]);
      } finally {
        sim?.destroy();
      }
    }
  }
  return rows;
}

function rowsToMarkdown(rows: BenchRow[], adapter: string, caps: GpuCapabilities): string {
  const lines = [
    `# AeroFlow browser 3D LBM benchmark (D3Q19, Esoteric Pull)`,
    ``,
    `Adapter: ${adapter}`,
    `shader-f16: ${caps.hasF16} · timestamp-query: ${caps.hasTimestamp}`,
    `maxBufferSize: ${(caps.maxBufferSize / 1024 / 1024).toFixed(0)} MiB · ` +
      `maxStorageBufferBindingSize: ${(caps.maxStorageBufferBindingSize / 1024 / 1024).toFixed(0)} MiB`,
    ``,
    `| grid | precision | B/cell | mem (MB) | MLUPs | steps/s | timed | source |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const r of rows) {
    if (r.skipped) {
      lines.push(
        `| ${r.grid}³ | ${r.precision} | ${r.bytesPerCell.toFixed(0)} | ${r.totalMB.toFixed(0)} | — | — | — | skipped: ${r.skipped} |`,
      );
    } else {
      lines.push(
        `| ${r.grid}³ | ${r.precision} | ${r.bytesPerCell.toFixed(0)} | ${r.totalMB.toFixed(0)} | ` +
          `${r.mlups.toFixed(0)} | ${r.stepsPerSec.toFixed(1)} | ${r.steps} | ${r.timestamped ? 'timestamp' : 'wall-clock'} |`,
      );
    }
  }
  return lines.join('\n');
}

/** Mount the benchmark UI (browser dev route ?bench3d). */
export function mountBenchmark(
  device: GPUDevice,
  caps: GpuCapabilities,
  adapter: string,
  root: HTMLElement,
): void {
  root.innerHTML = `
    <h2>AeroFlow — first browser 3D LBM benchmark</h2>
    <p style="max-width:60ch">D3Q19 Esoteric-Pull stream-collide. Throughput only — no accuracy
    claims. Prior 3D browser-LBM figures were <em>derived</em>; these are measured. Note your
    power state (plugged in vs battery) and that browser tab throttling / thermals skew results.</p>
    <p><b>Adapter:</b> ${adapter}<br>
       <b>shader-f16:</b> ${caps.hasF16} · <b>timestamp-query:</b> ${caps.hasTimestamp}</p>
    <button id="run-bench">Run ladder (128³ → 192³ → 256³, FP32 + FP16)</button>
    <div id="bench-out"></div>`;
  const out = root.querySelector('#bench-out') as HTMLElement;
  const btn = root.querySelector('#run-bench') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const rows: BenchRow[] = [];
    hooks().benchRows = rows;
    hooks().benchDone = false;
    out.innerHTML = '<p>Running… (warm-up + 1000 timed steps per config)</p><pre id="live"></pre>';
    const live = out.querySelector('#live') as HTMLElement;
    await runBenchmark(device, caps, (row) => {
      rows.push(row);
      const label = row.skipped
        ? `${row.grid}³ ${row.precision}: skipped (${row.skipped})`
        : `${row.grid}³ ${row.precision}: ${row.mlups.toFixed(0)} MLUPs, ${row.stepsPerSec.toFixed(1)} steps/s ` +
          `(${row.bytesPerCell.toFixed(0)} B/cell, ${row.timestamped ? 'timestamp' : 'wall-clock'})`;
      live.textContent += label + '\n';
    });
    const md = rowsToMarkdown(rows, adapter, caps);
    hooks().benchMarkdown = md;
    hooks().benchDone = true;
    out.innerHTML += `<h3>Copyable results</h3><textarea style="width:100%;height:16em">${md}\n\n${JSON.stringify(rows, null, 2)}</textarea>`;
    btn.disabled = false;
  });
}
