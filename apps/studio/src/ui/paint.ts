import { CellType } from '@aeroflow/core';
import type { Lbm2D } from '../sim/lbm2d';

/**
 * Mouse/touch obstacle painting. Left-drag paints solid cells; right-drag or
 * Shift+drag erases. The inlet/outlet columns and wall rows are protected.
 * CPU-side flags are updated immediately; the GPU upload is deferred to the
 * next frame via markDirty (one writeBuffer per frame at most while painting).
 */
export function attachPainting(
  canvas: HTMLCanvasElement,
  sim: Lbm2D,
  getBrush: () => number,
  markDirty: () => void,
): void {
  let painting = false;
  let erasing = false;

  const stamp = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor(((clientX - rect.left) / rect.width) * sim.nx);
    // Screen y grows downward; lattice y grows upward (matches the render shader flip).
    const cy = Math.floor((1 - (clientY - rect.top) / rect.height) * sim.ny);
    const r = getBrush();
    const x0 = Math.max(1, cx - r);
    const x1 = Math.min(sim.nx - 2, cx + r);
    const y0 = Math.max(1, cy - r);
    const y1 = Math.min(sim.ny - 2, cy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const idx = y * sim.nx + x;
        const current = sim.flags[idx];
        if (current === CellType.Inlet || current === CellType.Outlet) continue;
        sim.flags[idx] = erasing ? CellType.Fluid : CellType.Solid;
      }
    }
    if (erasing) {
      // Newly-fluid cells need valid populations (ρ=0 would NaN the solver).
      sim.fillEquilibriumRegion(x0, y0, x1, y1);
    }
    markDirty();
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    painting = true;
    erasing = e.button === 2 || e.shiftKey;
    canvas.setPointerCapture(e.pointerId);
    stamp(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (painting) stamp(e.clientX, e.clientY);
  });
  const stop = () => {
    painting = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
}
