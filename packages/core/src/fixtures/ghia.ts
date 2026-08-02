/**
 * Ghia, Ghia & Shin (1982), J. Comput. Phys. 48:387–411 — lid-driven cavity benchmark
 * (257×257 multigrid). Re=100 and Re=1000 columns only (the M3-normative, verified
 * ones). Full tables + provenance + validation notes: docs/handoff/H9-fixtures-ghia.md.
 *
 * Conventions: unit square, lid on top (y=1) moving +x at speed 1, other walls no-slip.
 * GHIA_U = u along the vertical centerline x=0.5; GHIA_V = v along the horizontal
 * centerline y=0.5. Velocities normalized by lid speed; coordinates by cavity side.
 */
export const GHIA_U = {
  y: [
    1.0, 0.9766, 0.9688, 0.9609, 0.9531, 0.8516, 0.7344, 0.6172, 0.5, 0.4531, 0.2813, 0.1719,
    0.1016, 0.0703, 0.0625, 0.0547, 0.0,
  ],
  re100: [
    1.0, 0.84123, 0.78871, 0.73722, 0.68717, 0.23151, 0.00332, -0.13641, -0.20581, -0.2109,
    -0.15662, -0.1015, -0.06434, -0.04775, -0.04192, -0.03717, 0.0,
  ],
  re1000: [
    1.0, 0.65928, 0.57492, 0.51117, 0.46604, 0.33304, 0.18719, 0.05702, -0.0608, -0.10648, -0.27805,
    -0.38289, -0.2973, -0.2222, -0.20196, -0.18109, 0.0,
  ],
} as const;

export const GHIA_V = {
  x: [
    1.0, 0.9688, 0.9609, 0.9531, 0.9453, 0.9063, 0.8594, 0.8047, 0.5, 0.2344, 0.2266, 0.1563,
    0.0938, 0.0781, 0.0703, 0.0625, 0.0,
  ],
  re100: [
    0.0, -0.05906, -0.07391, -0.08864, -0.10313, -0.16914, -0.22445, -0.24533, 0.05454, 0.17527,
    0.17507, 0.16077, 0.12317, 0.1089, 0.10091, 0.09233, 0.0,
  ],
  re1000: [
    0.0, -0.21388, -0.27669, -0.33714, -0.39188, -0.515, -0.42665, -0.31966, 0.02526, 0.32235,
    0.33075, 0.37095, 0.32627, 0.30353, 0.29012, 0.27485, 0.0,
  ],
} as const;

/** Linear interpolation of a sampled profile (xs ascending or descending) at query q. */
export function interpProfile(xs: readonly number[], ys: readonly number[], q: number): number {
  const n = xs.length;
  const asc = xs[n - 1] > xs[0];
  for (let i = 0; i < n - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const lo = asc ? a : b;
    const hi = asc ? b : a;
    if (q >= lo - 1e-12 && q <= hi + 1e-12) {
      const ya = asc ? ys[i] : ys[i + 1];
      const yb = asc ? ys[i + 1] : ys[i];
      const t = (q - lo) / (hi - lo);
      return ya + t * (yb - ya);
    }
  }
  return q <= Math.min(xs[0], xs[n - 1])
    ? ys[xs[0] < xs[n - 1] ? 0 : n - 1]
    : ys[xs[0] < xs[n - 1] ? n - 1 : 0];
}
