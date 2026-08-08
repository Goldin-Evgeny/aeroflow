/**
 * Ordinary least-squares slope with its standard error.
 *
 * Exists because a two-endpoint difference cannot tell a settling trajectory from a
 * diverging one: on a saturating curve `(last - first)/Δt` reports the chord, which is
 * dominated by wherever the first endpoint happened to land and stays positive long after
 * the trend has died. Fitting successive windows and reading the slopes WITH their
 * uncertainty distinguishes the three cases that matter — approaching zero, plateauing at a
 * nonzero value, or oscillating — and a slope is only meaningful against its own error bar,
 * which is why `slopeStdErr` is returned rather than left to the caller.
 */
export interface LinearTrend {
  slope: number;
  intercept: number;
  /** OLS standard error of the slope. `NaN` when n < 3 (no residual degrees of freedom). */
  slopeStdErr: number;
  /** |slope| / slopeStdErr — below ~2 the slope is not distinguishable from zero. */
  tStatistic: number;
  n: number;
}

export function linearTrend(x: readonly number[], y: readonly number[]): LinearTrend {
  if (x.length !== y.length) throw new Error('linearTrend: x and y must be the same length');
  const n = x.length;
  if (n < 2) {
    return {
      slope: Number.NaN,
      intercept: Number.NaN,
      slopeStdErr: Number.NaN,
      tStatistic: Number.NaN,
      n,
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (y[i] - meanY);
  }
  if (sxx === 0) {
    return {
      slope: Number.NaN,
      intercept: Number.NaN,
      slopeStdErr: Number.NaN,
      tStatistic: Number.NaN,
      n,
    };
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let residualSumSquares = 0;
  for (let i = 0; i < n; i++) {
    const residual = y[i] - (intercept + slope * x[i]);
    residualSumSquares += residual * residual;
  }
  const slopeStdErr = n > 2 ? Math.sqrt(residualSumSquares / (n - 2) / sxx) : Number.NaN;
  // A perfect fit has zero error and any nonzero slope is then infinitely significant; a
  // zero slope on a perfect fit is exactly zero and reports 0 rather than NaN.
  const tStatistic =
    slopeStdErr === 0 ? (slope === 0 ? 0 : Infinity) : Math.abs(slope) / slopeStdErr;

  return { slope, intercept, slopeStdErr, tStatistic, n };
}
