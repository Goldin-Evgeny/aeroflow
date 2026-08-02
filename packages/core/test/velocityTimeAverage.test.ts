import { describe, expect, it } from 'vitest';
import { ConvergingVelocityAverager } from '../src/stats/velocityTimeAverage.js';

describe('ConvergingVelocityAverager', () => {
  it('distinguishes mean scalar speed from magnitude of the mean vector', () => {
    const scalar = new ConvergingVelocityAverager(
      1,
      'time-mean-of-instantaneous-scalar-speed',
      0,
      1,
    );
    const vector = new ConvergingVelocityAverager(1, 'magnitude-of-time-mean-vector', 0, 1);
    for (const averager of [scalar, vector]) {
      averager.add([1], [0], [0], 1);
      averager.add([-1], [0], [0], 2);
    }
    // Hand oracle: <|+1|,|-1|> = 1, while |<+1,-1>| = |0| = 0.
    expect(scalar.stats()!.means[0]).toBeCloseTo(1, 12);
    expect(vector.stats()!.means[0]).toBeCloseTo(0, 12);
  });

  it('forms a 3D magnitude after component-wise averaging', () => {
    const averager = new ConvergingVelocityAverager(1, 'magnitude-of-time-mean-vector', 0, 1);
    averager.add([3], [0], [0], 1);
    averager.add([3], [8], [0], 2);
    // Mean vector = (3,4,0), so magnitude = 5.
    expect(averager.stats()!.means[0]).toBeCloseTo(5, 12);
  });

  it('discards transient samples and reports convergence on scalar means', () => {
    const averager = new ConvergingVelocityAverager(
      2,
      'time-mean-of-instantaneous-scalar-speed',
      100,
      50,
    );
    averager.add([999, 999], [0, 0], [0, 0], 100);
    averager.add([1, 2], [0, 0], [0, 0], 150);
    averager.add([1, 2], [0, 0], [0, 0], 200);
    const stats = averager.stats()!;
    expect(averager.samples).toBe(2);
    expect(Array.from(stats.means)).toEqual([1, 2]);
    expect(stats.windows).toBe(2);
    expect(stats.driftScaled).toBeCloseTo(0, 12);
  });

  it('rejects mismatched and non-finite component samples', () => {
    const averager = new ConvergingVelocityAverager(2, 'magnitude-of-time-mean-vector', 0, 1);
    expect(() => averager.add([1], [0, 0], [0, 0], 1)).toThrow(/length mismatch/);
    expect(() => averager.add([1, NaN], [0, 0], [0, 0], 1)).toThrow(/non-finite/);
  });

  it('resumes both statistic orders exactly from a JSON checkpoint', () => {
    for (const statistic of [
      'time-mean-of-instantaneous-scalar-speed',
      'magnitude-of-time-mean-vector',
    ] as const) {
      const uninterrupted = new ConvergingVelocityAverager(2, statistic, 10, 10);
      const checkpointed = new ConvergingVelocityAverager(2, statistic, 10, 10);
      const samples = [
        { x: [9, 9], y: [0, 0], z: [0, 0], step: 10 },
        { x: [1, 2], y: [2, 0], z: [0, 2], step: 20 },
        { x: [-1, 4], y: [2, 0], z: [0, 2], step: 30 },
        { x: [3, 6], y: [2, 0], z: [0, 2], step: 40 },
      ];
      for (const sample of samples) {
        uninterrupted.add(sample.x, sample.y, sample.z, sample.step);
      }
      for (const sample of samples.slice(0, 2)) {
        checkpointed.add(sample.x, sample.y, sample.z, sample.step);
      }
      const resumed = ConvergingVelocityAverager.fromState(
        JSON.parse(JSON.stringify(checkpointed.serialize())),
      );
      for (const sample of samples.slice(2)) {
        resumed.add(sample.x, sample.y, sample.z, sample.step);
      }
      expect(resumed.serialize()).toEqual(uninterrupted.serialize());
      expect(resumed.stats()).toEqual(uninterrupted.stats());
    }
  });

  it('rejects inconsistent serialized checkpoint snapshots', () => {
    const averager = new ConvergingVelocityAverager(1, 'magnitude-of-time-mean-vector', 0, 1);
    const state = averager.serialize();
    state.checkpoints = 1;
    expect(() => ConvergingVelocityAverager.fromState(state)).toThrow(/disagree/);
  });
});
