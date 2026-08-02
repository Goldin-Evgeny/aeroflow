/** A point or vector in an east-north-up world frame. */
export interface EnuVector {
  east: number;
  north: number;
  up: number;
}

/** A point or vector in the solver frame: +x downstream, +y up, +z flow-right. */
export interface WindFrameVector {
  x: number;
  y: number;
  z: number;
}

export interface WindFrameBasis {
  /** Unit vector pointing downstream in the ENU horizontal plane. */
  downstream: Readonly<Pick<EnuVector, 'east' | 'north'>>;
  /** Unit vector pointing to the right when facing downstream. */
  right: Readonly<Pick<EnuVector, 'east' | 'north'>>;
}

/** Normalize an angle to [0, 360). */
export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new Error('wind direction must be finite');
  return ((degrees % 360) + 360) % 360;
}

/**
 * Build the solver basis for a meteorological wind direction.
 *
 * `windFromDegrees` is clockwise from north: 0 degrees comes from north and flows
 * south; 90 degrees comes from east and flows west. The solver always flows along +x.
 * With y fixed upward, +z is chosen as downstream cross up, so the frame remains
 * right-handed and +z points to the flow's right.
 */
export function windFrameBasis(windFromDegrees: number): WindFrameBasis {
  const radians = (normalizeDegrees(windFromDegrees) * Math.PI) / 180;
  const downstream = {
    east: -Math.sin(radians),
    north: -Math.cos(radians),
  };
  return {
    downstream,
    right: {
      east: downstream.north,
      north: -downstream.east,
    },
  };
}

/** Rotate an ENU vector into the solver's wind-aligned frame. */
export function enuVectorToWindFrame(vector: EnuVector, windFromDegrees: number): WindFrameVector {
  const { downstream, right } = windFrameBasis(windFromDegrees);
  return {
    x: vector.east * downstream.east + vector.north * downstream.north,
    y: vector.up,
    z: vector.east * right.east + vector.north * right.north,
  };
}

/** Rotate a solver-frame vector back into east-north-up coordinates. */
export function windFrameVectorToEnu(vector: WindFrameVector, windFromDegrees: number): EnuVector {
  const { downstream, right } = windFrameBasis(windFromDegrees);
  return {
    east: vector.x * downstream.east + vector.z * right.east,
    north: vector.x * downstream.north + vector.z * right.north,
    up: vector.y,
  };
}

/** Translate about `origin`, then rotate an ENU point into the solver frame. */
export function enuPointToWindFrame(
  point: EnuVector,
  origin: EnuVector,
  windFromDegrees: number,
): WindFrameVector {
  return enuVectorToWindFrame(
    {
      east: point.east - origin.east,
      north: point.north - origin.north,
      up: point.up - origin.up,
    },
    windFromDegrees,
  );
}

/** Rotate a solver-frame point back to ENU, then translate by `origin`. */
export function windFramePointToEnu(
  point: WindFrameVector,
  origin: EnuVector,
  windFromDegrees: number,
): EnuVector {
  const delta = windFrameVectorToEnu(point, windFromDegrees);
  return {
    east: origin.east + delta.east,
    north: origin.north + delta.north,
    up: origin.up + delta.up,
  };
}
