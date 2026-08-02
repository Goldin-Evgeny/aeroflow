export interface MacroSamplePoint {
  x: number;
  y: number;
  z: number;
}

export interface MacroPointStencil {
  slots: [number, number, number, number, number, number, number, number];
  fx: number;
  fy: number;
  fz: number;
}

export interface MacroPointReadbackPlan {
  cellIndices: Uint32Array;
  stencils: MacroPointStencil[];
}

/** Plan the unique lattice cells needed to trilinear-sample a set of points. */
export function planMacroPointReadback(
  points: readonly MacroSamplePoint[],
  nx: number,
  ny: number,
  nz: number,
): MacroPointReadbackPlan {
  if (![nx, ny, nz].every((size) => Number.isInteger(size) && size >= 2)) {
    throw new Error('planMacroPointReadback: grid dimensions must be integers >= 2');
  }
  const unique = new Map<number, number>();
  const cellIndices: number[] = [];
  const slotFor = (index: number): number => {
    const found = unique.get(index);
    if (found !== undefined) return found;
    const slot = cellIndices.length;
    unique.set(index, slot);
    cellIndices.push(index);
    return slot;
  };
  const stencils = points.map((point, pointIndex): MacroPointStencil => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new Error(`planMacroPointReadback: non-finite point ${pointIndex}`);
    }
    const cx = Math.min(Math.max(point.x, 0), nx - 1);
    const cy = Math.min(Math.max(point.y, 0), ny - 1);
    const cz = Math.min(Math.max(point.z, 0), nz - 1);
    const x0 = Math.min(Math.floor(cx), nx - 2);
    const y0 = Math.min(Math.floor(cy), ny - 2);
    const z0 = Math.min(Math.floor(cz), nz - 2);
    const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
    return {
      slots: [
        slotFor(at(x0, y0, z0)),
        slotFor(at(x0 + 1, y0, z0)),
        slotFor(at(x0, y0 + 1, z0)),
        slotFor(at(x0 + 1, y0 + 1, z0)),
        slotFor(at(x0, y0, z0 + 1)),
        slotFor(at(x0 + 1, y0, z0 + 1)),
        slotFor(at(x0, y0 + 1, z0 + 1)),
        slotFor(at(x0 + 1, y0 + 1, z0 + 1)),
      ],
      fx: cx - x0,
      fy: cy - y0,
      fz: cz - z0,
    };
  });
  return { cellIndices: Uint32Array.from(cellIndices), stencils };
}

/** Interpolate interleaved rho/ux/uy/uz records copied by a readback plan. */
export function interpolateMacroPointReadback(
  cellMacros: Float32Array,
  plan: MacroPointReadbackPlan,
): Float32Array {
  if (cellMacros.length !== plan.cellIndices.length * 4) {
    throw new Error(
      `interpolateMacroPointReadback: ${cellMacros.length} values for ` +
        `${plan.cellIndices.length} cells`,
    );
  }
  const output = new Float32Array(plan.stencils.length * 4);
  const lerp = (a: number, b: number, fraction: number): number => a + (b - a) * fraction;
  for (let pointIndex = 0; pointIndex < plan.stencils.length; pointIndex++) {
    const { slots, fx, fy, fz } = plan.stencils[pointIndex];
    for (let component = 0; component < 4; component++) {
      const value = (corner: number): number => cellMacros[slots[corner] * 4 + component];
      const c00 = lerp(value(0), value(1), fx);
      const c10 = lerp(value(2), value(3), fx);
      const c01 = lerp(value(4), value(5), fx);
      const c11 = lerp(value(6), value(7), fx);
      output[pointIndex * 4 + component] = lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
    }
  }
  return output;
}
