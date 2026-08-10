import { describe, expect, it } from 'vitest';
import {
  Q27_GPU_DIRECTION_MAPPING,
  Q27_GPU_TOLERANCES,
  q27PopulationMemory,
  reconstructQ27ConservedFloat64,
} from '../src/sim/q27GpuAuthority';
import { D3Q27 } from '@aeroflow/core';

describe('bounded Q27 GPU authority contracts', () => {
  it('maps every CPU direction to the identical GPU direction and velocity', () => {
    expect(Q27_GPU_DIRECTION_MAPPING).toHaveLength(27);
    for (const entry of Q27_GPU_DIRECTION_MAPPING) {
      expect(entry.gpu).toBe(entry.cpu);
      expect(entry.velocity).toEqual(D3Q27.velocities[entry.cpu]);
    }
  });

  it('accounts for actual one-copy Q19 and two-copy Q27 f32 population layouts', () => {
    const row = q27PopulationMemory(15_700_000);
    expect(row.d3q19Bytes).toBe(15_700_000 * 19 * 4);
    expect(row.d3q27Bytes).toBe(15_700_000 * 2 * 27 * 4);
    expect(row.d3q27Bytes / row.d3q19Bytes).toBeCloseTo(54 / 19, 14);
    expect(row.d3q27Bytes).toBeLessThan(24 * 1024 ** 3);
  });

  it('keeps the predeclared periodic gate at the existing accumulated-f32 scale', () => {
    expect(Q27_GPU_TOLERANCES.periodicGain).toBe(5e-5);
    expect(Q27_GPU_TOLERANCES.periodicMassDriftRelative).toBe(5e-5);
    expect(Q27_GPU_TOLERANCES.periodicMomentumDrift).toBe(5e-5);
  });

  it('reconstructs global Q27 conservation from raw direction-major populations in Float64', () => {
    const cells = 3;
    const field = new Float32Array(27 * cells);
    for (let direction = 0; direction < 27; direction++) {
      for (let cell = 0; cell < cells; cell++) {
        field[direction * cells + cell] = Math.fround(
          D3Q27.w[direction] * (1 + 1e-3 * (cell + 1) * D3Q27.ex[direction]),
        );
      }
    }
    const reconstructed = reconstructQ27ConservedFloat64(field, cells);
    const independent = [0, 0, 0, 0];
    for (let direction = 0; direction < 27; direction++) {
      for (let cell = 0; cell < cells; cell++) {
        const value = field[direction * cells + cell];
        independent[0] += value;
        independent[1] += D3Q27.ex[direction] * value;
        independent[2] += D3Q27.ey[direction] * value;
        independent[3] += D3Q27.ez[direction] * value;
      }
    }
    expect(reconstructed).toEqual(independent);
  });
});
