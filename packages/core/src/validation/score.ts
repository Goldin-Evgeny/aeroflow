/**
 * Validation scoring metrics (M10 step 2) — the numbers the AIJ Case A gate reports.
 *
 * hit rate q: VDI 3783 Part 9 — a point is a hit when |sim − exp| / ref ≤ allowed;
 * q = hits/N. The AIJ wind-tunnel data are velocities already normalized by a reference
 * velocity, so with normalized inputs use ref = 1 and allowed = 0.25 (the digest's
 * "normalized allowed range"); the M10 gate is q ≥ 0.66 with Pearson r ≥ 0.70.
 */

export function hitRate(
  sim: ArrayLike<number>,
  exp: ArrayLike<number>,
  allowed = 0.25,
  ref = 1,
): number {
  if (sim.length !== exp.length) throw new Error('hitRate: length mismatch');
  if (sim.length === 0) return NaN;
  if (!(allowed > 0) || !(ref > 0)) throw new Error('hitRate: allowed and ref must be positive');
  let hits = 0;
  for (let i = 0; i < sim.length; i++) {
    if (Math.abs(sim[i] - exp[i]) / ref <= allowed) hits++;
  }
  return hits / sim.length;
}

/** Standard Pearson correlation coefficient; NaN when either series is constant. */
export function pearson(sim: ArrayLike<number>, exp: ArrayLike<number>): number {
  if (sim.length !== exp.length) throw new Error('pearson: length mismatch');
  const n = sim.length;
  if (n < 2) return NaN;
  let ms = 0;
  let me = 0;
  for (let i = 0; i < n; i++) {
    ms += sim[i];
    me += exp[i];
  }
  ms /= n;
  me /= n;
  let cov = 0;
  let vs = 0;
  let ve = 0;
  for (let i = 0; i < n; i++) {
    const a = sim[i] - ms;
    const b = exp[i] - me;
    cov += a * b;
    vs += a * a;
    ve += b * b;
  }
  if (vs === 0 || ve === 0) return NaN;
  return cov / Math.sqrt(vs * ve);
}
