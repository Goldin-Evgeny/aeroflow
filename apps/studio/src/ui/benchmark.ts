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

const TABLE_COLUMNS = [
  'grid',
  'precision',
  'B/cell',
  'mem (MB)',
  'MLUPs',
  'steps/s',
  'timed',
  'source',
] as const;

function td(text: string, cls?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (cls) cell.className = cls;
  return cell;
}

function rowToTr(row: BenchRow): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (row.skipped) {
    tr.append(
      td(`${row.grid}³`),
      td(row.precision),
      td(row.bytesPerCell.toFixed(0)),
      td(row.totalMB.toFixed(0)),
      td('—'),
      td('—'),
      td('—'),
      td(`skipped: ${row.skipped}`, 'muted'),
    );
  } else {
    tr.append(
      td(`${row.grid}³`),
      td(row.precision),
      td(row.bytesPerCell.toFixed(0)),
      td(row.totalMB.toFixed(0)),
      td(row.mlups.toFixed(0)),
      td(row.stepsPerSec.toFixed(1)),
      td(String(row.steps)),
      td(row.timestamped ? 'timestamp' : 'wall-clock', 'muted'),
    );
  }
  return tr;
}

/** Mount the benchmark UI (browser dev route ?bench3d). */
export function mountBenchmark(
  device: GPUDevice,
  caps: GpuCapabilities,
  adapter: string,
  root: HTMLElement,
): void {
  root.innerHTML = '';
  root.classList.add('page');

  const h = document.createElement('h2');
  h.className = 'page-title';
  h.textContent = 'AeroFlow — first browser 3D LBM benchmark';

  const sub = document.createElement('p');
  sub.className = 'subtitle';
  sub.textContent =
    'D3Q19 Esoteric-Pull stream-collide. Throughput only — no accuracy claims. Prior 3D ' +
    'browser-LBM figures were derived; these are measured. Note your power state (plugged ' +
    'in vs battery) and that browser tab throttling / thermals skew results.';

  const info = document.createElement('p');
  info.className = 'readout';
  const adapterLine = document.createElement('div');
  adapterLine.textContent = `Adapter: ${adapter}`;
  const capsLine = document.createElement('div');
  capsLine.className = 'muted';
  capsLine.textContent = `shader-f16: ${caps.hasF16} · timestamp-query: ${caps.hasTimestamp}`;
  info.append(adapterLine, capsLine);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'button-row';
  const btn = document.createElement('button');
  btn.id = 'run-bench';
  btn.textContent = 'Run ladder (128³ → 192³ → 256³, FP32 + FP16)';
  buttonRow.append(btn);

  const out = document.createElement('div');
  root.append(h, sub, info, buttonRow, out);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const rows: BenchRow[] = [];
    hooks().benchRows = rows;
    hooks().benchDone = false;

    out.innerHTML = '';
    const status = document.createElement('p');
    status.className = 'muted';
    status.textContent = 'Running… (warm-up + 1000 timed steps per config)';

    const table = document.createElement('table');
    table.className = 'data-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of TABLE_COLUMNS) {
      const th = document.createElement('th');
      th.textContent = col;
      headRow.append(th);
    }
    thead.append(headRow);
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);

    out.append(status, table);

    await runBenchmark(device, caps, (row) => {
      rows.push(row);
      tbody.append(rowToTr(row));
    });

    const md = rowsToMarkdown(rows, adapter, caps);
    hooks().benchMarkdown = md;
    hooks().benchDone = true;
    status.textContent = 'Done.';

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Copy for milestone Status';
    const copyBox = document.createElement('textarea');
    copyBox.readOnly = true;
    copyBox.style.cssText = 'width:100%;height:16em';
    copyBox.value = `${md}\n\n${JSON.stringify(rows, null, 2)}`;
    details.append(summary, copyBox);
    out.append(details);

    btn.disabled = false;
  });
}
