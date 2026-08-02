/**
 * Sphere-drag post-processing (M7 step 8). Turns a raw lattice-unit drag-force series into
 * the dimensionless drag coefficient and the running-mean / convergence statistics the
 * acceptance gate needs, entirely in lattice units (ρ0 = 1, u_lattice, R in cells, time in
 * steps — Cd is dimensionless so NO dx/dt conversion, M7 pitfall).
 *
 * Cd = Fx / (½·ρ0·u² · πR²): the reference is the sphere's *projected frontal* area πR²,
 * not the surface area 4πR² (M7 pitfall). Compare with the 2D `coefficient()` (spectrum.ts)
 * which divides by a length D instead of an area.
 */

/**
 * Drag coefficient from an instantaneous drag force (lattice units).
 * @param fx      drag force on the sphere (+x), lattice units.
 * @param u       inflow lattice velocity.
 * @param radius  sphere radius in cells (R = D/2).
 */
export function sphereDragCoefficient(fx: number, u: number, radius: number, rho0 = 1): number {
  const area = Math.PI * radius * radius; // projected frontal area πR²
  return fx / (0.5 * rho0 * u * u * area);
}

export interface SphereDragStatsOptions {
  /** Timesteps between consecutive samples (the `k` passed to sampleForce). */
  sampleInterval: number;
  /** One convective time in steps (= D / u_lattice). */
  convectiveTimeSteps: number;
  /** Sphere radius in cells (R = D/2) — normalizes Cd. */
  radius: number;
  /** Inflow lattice velocity. */
  u: number;
  /** Convective times to discard as startup transient. Default 20 (M7 step 8). */
  transientTc?: number;
  /** Final-window length (convective times) for the drift metric. Default 20 (M7 crit. 3). */
  driftWindowTc?: number;
  rho0?: number;
}

export interface SphereDragStats {
  /** Time-averaged Cd over the post-transient window (the reported drag). */
  meanCd: number;
  /** Number of post-transient samples averaged. */
  samples: number;
  /** Cd at the first and last post-transient sample (diagnostic). */
  minCd: number;
  maxCd: number;
  /**
   * Fractional drift of the *cumulative running mean* over the final `driftWindowTc`
   * convective times: (max − min of the running-mean trace in that window) / final mean.
   * The Re=10⁴ gate requires this < 0.03 (M7 acceptance 3). NaN if the window is empty.
   */
  runningMeanDrift: number;
  /** Whether enough post-transient samples exist to trust the statistics. */
  converged: boolean;
}

/**
 * Compute the drag statistics from a raw force series.
 *
 * @param fxSeries  drag force per sample (lattice units); sample j is timestep
 *                  (j+1)·sampleInterval (sampleForce advances first, then reads).
 */
export function sphereDragStats(
  fxSeries: ArrayLike<number>,
  opts: SphereDragStatsOptions,
): SphereDragStats {
  const { sampleInterval, convectiveTimeSteps, radius, u } = opts;
  const rho0 = opts.rho0 ?? 1;
  const transientTc = opts.transientTc ?? 20;
  const driftWindowTc = opts.driftWindowTc ?? 20;

  const transientSteps = transientTc * convectiveTimeSteps;
  // Sample j corresponds to timestep (j+1)·sampleInterval, so discard through transient.
  const firstIdx = Math.max(0, Math.ceil(transientSteps / sampleInterval) - 1);

  const cd: number[] = [];
  for (let j = firstIdx; j < fxSeries.length; j++) {
    cd.push(sphereDragCoefficient(fxSeries[j], u, radius, rho0));
  }
  const samples = cd.length;

  let sum = 0;
  let minCd = Infinity;
  let maxCd = -Infinity;
  // Cumulative running-mean trace (post-transient), used for the drift metric.
  const runningMean: number[] = [];
  for (let i = 0; i < samples; i++) {
    sum += cd[i];
    runningMean.push(sum / (i + 1));
    if (cd[i] < minCd) minCd = cd[i];
    if (cd[i] > maxCd) maxCd = cd[i];
  }
  const meanCd = samples > 0 ? sum / samples : NaN;

  // Drift: spread of the running-mean trace over the final driftWindowTc convective times.
  const driftWindowSamples = Math.max(
    1,
    Math.round((driftWindowTc * convectiveTimeSteps) / sampleInterval),
  );
  const windowStart = Math.max(0, samples - driftWindowSamples);
  let rmMin = Infinity;
  let rmMax = -Infinity;
  for (let i = windowStart; i < samples; i++) {
    if (runningMean[i] < rmMin) rmMin = runningMean[i];
    if (runningMean[i] > rmMax) rmMax = runningMean[i];
  }
  const runningMeanDrift =
    samples > windowStart && Number.isFinite(meanCd) && meanCd !== 0
      ? (rmMax - rmMin) / Math.abs(meanCd)
      : NaN;

  return {
    meanCd,
    samples,
    minCd: samples > 0 ? minCd : NaN,
    maxCd: samples > 0 ? maxCd : NaN,
    runningMeanDrift,
    // Need at least a couple of convective times of post-transient data to mean anything.
    converged: samples * sampleInterval >= 2 * convectiveTimeSteps,
  };
}
