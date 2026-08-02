import { describe, expect, it } from 'vitest';
import {
  enuPointToWindFrame,
  enuVectorToWindFrame,
  normalizeDegrees,
  windFrameBasis,
  windFramePointToEnu,
  windFrameVectorToEnu,
} from '../src/geometry/windFrame.js';

describe('meteorological wind frame', () => {
  it.each([
    [0, 0, -1, -1, 0],
    [90, -1, 0, 0, 1],
    [180, 0, 1, 1, 0],
    [270, 1, 0, 0, -1],
  ])(
    'maps wind from %i degrees to the expected downstream and right basis',
    (degrees, downstreamEast, downstreamNorth, rightEast, rightNorth) => {
      const basis = windFrameBasis(degrees);
      expect(basis.downstream.east).toBeCloseTo(downstreamEast, 12);
      expect(basis.downstream.north).toBeCloseTo(downstreamNorth, 12);
      expect(basis.right.east).toBeCloseTo(rightEast, 12);
      expect(basis.right.north).toBeCloseTo(rightNorth, 12);
    },
  );

  it('puts the wind source upstream and preserves a right-handed solver frame', () => {
    for (const degrees of [0, 37, 90, 215, 359]) {
      const radians = (degrees * Math.PI) / 180;
      const source = { east: Math.sin(radians), north: Math.cos(radians), up: 0 };
      const mapped = enuVectorToWindFrame(source, degrees);
      expect(mapped.x).toBeCloseTo(-1, 12);
      expect(mapped.y).toBeCloseTo(0, 12);
      expect(mapped.z).toBeCloseTo(0, 12);

      const { downstream, right } = windFrameBasis(degrees);
      // downstream cross up = right in ENU coordinates.
      expect(right.east).toBeCloseTo(downstream.north, 12);
      expect(right.north).toBeCloseTo(-downstream.east, 12);
    }
  });

  it('round-trips vectors and translated points', () => {
    const vector = { east: 3.25, north: -7.5, up: 1.75 };
    const origin = { east: 411_000, north: 4_171_000, up: 12 };
    const point = { east: origin.east + 14, north: origin.north - 9, up: 16.5 };
    for (const degrees of [-45, 0, 28.5, 360, 721]) {
      const vectorRoundTrip = windFrameVectorToEnu(enuVectorToWindFrame(vector, degrees), degrees);
      expect(vectorRoundTrip.east).toBeCloseTo(vector.east, 12);
      expect(vectorRoundTrip.north).toBeCloseTo(vector.north, 12);
      expect(vectorRoundTrip.up).toBeCloseTo(vector.up, 12);

      const pointRoundTrip = windFramePointToEnu(
        enuPointToWindFrame(point, origin, degrees),
        origin,
        degrees,
      );
      expect(pointRoundTrip.east).toBeCloseTo(point.east, 9);
      expect(pointRoundTrip.north).toBeCloseTo(point.north, 9);
      expect(pointRoundTrip.up).toBeCloseTo(point.up, 12);
    }
  });

  it('normalizes periodic angles and rejects non-finite directions', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(450)).toBe(90);
    expect(normalizeDegrees(720)).toBe(0);
    expect(() => normalizeDegrees(Number.NaN)).toThrow(/finite/);
    expect(() => normalizeDegrees(Infinity)).toThrow(/finite/);
  });
});
