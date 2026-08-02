# H7 — Measurement utilities (Strouhal, convergence, coefficients): executable specification

> **Handoff doc.** Milestone: M4 (first quantitative unsteady benchmark — cylinder
> St/Cd). Deliverable when executed: `packages/core/src/measurement.ts` + tests. All
> pure TypeScript, no dependencies, fully deterministic.

## 1. `dominantFrequency(series, sampleInterval=1)` — the Strouhal extractor

Input: the Cl (lift) time series sampled every timestep (or every k-th step —
`sampleInterval` in timesteps). Output: `{ frequency, amplitude }` with frequency in
cycles per timestep.

Algorithm (deterministic, O(N²) DFT is FINE for N ≤ 8192 — do not add an FFT library):

```
1. Drop the transient: caller passes only the post-transient window (see §3).
2. x[n] ← series[n] − mean(series)                       // remove DC
3. w[n] = 0.5·(1 − cos(2πn/(N−1)))                        // Hann window
4. For k = 1 … N/2−1:  P[k] = |Σ_n x[n]·w[n]·e^{−2πikn/N}|²
5. k* = argmax P[k]  (exclude k=0)
6. Parabolic interpolation on log-power (better for Hann):
   δ = 0.5·(ln P[k*−1] − ln P[k*+1]) / (ln P[k*−1] − 2·ln P[k*] + ln P[k*+1])
   (guard k* at the ends; δ ∈ [−0.5, 0.5] — assert, else the peak is at the boundary)
7. frequency = (k* + δ) / (N · sampleInterval)
```

Strouhal: `St = frequency · D / U` with D = cylinder diameter (cells), U = inflow
lattice velocity — both taken from the run's frozen config (H2 §6 pitfall 8).

**Tests (exact expectations):**

- T-FREQ-1: `x[n] = sin(2π·0.01234567·n)`, N = 4096 → `|f − 0.01234567| ≤ 5e-6`.
- T-FREQ-2: two tones 0.012 (amp 1.0) + 0.031 (amp 0.3) → returns the 0.012 peak,
  same gate.
- T-FREQ-3: tone 0.0123 + seeded uniform noise (LCG, amplitude 0.5, seed literal) →
  `|f − 0.0123| ≤ 5e-5`.
- T-FREQ-4: N=4096, f exactly ON a bin (k=50 → f=50/4096): δ ≈ 0 (|δ| ≤ 1e-3).

## 2. `runningMean` / `isConverged` — statistical convergence

For mean-Cd measurement at higher Re (M7/M9) and steady-state detection:

```
converged(series, window, tol):
  a = mean(series[−2·window : −window]);  b = mean(series[−window :])
  return |b − a| ≤ tol · max(|b|, floor)        // floor = 1e-12 guards zero-mean
```

Convention for validation runs (write into results): "mean Cd over the last W samples,
with |Δ windowed mean| ≤ 1% over the last 2W" — W expressed in convective times
(T_conv = D/U timesteps), never raw steps, so results are resolution-comparable.

Tests: monotone-decaying synthetic series converges exactly when predicted by hand
(precomputed literals); a linearly drifting series never converges.

## 3. Transient discard rule (encode as a helper, not folklore)

For the cylinder: discard `max(100·D/U timesteps, 10 shedding periods)` before
measuring; measure over ≥ 30 shedding periods. First estimate the period from a coarse
first-pass `dominantFrequency` on the raw tail, then re-window properly and re-measure
(two-pass — deterministic and self-consistent). Assert the two passes agree within 2%
or flag "not yet periodic".

## 4. `coefficient(F, U, refLength)` — Cd/Cl

`C = F / (0.5 · ρ0 · U² · L_ref)`, ρ0 = 1, L_ref = D (2D per-unit-depth) or frontal
area A (3D). One function, used everywhere; unit-test against a hand computation.

## 5. Pitfalls

1. Measuring frequency of Cd instead of Cl: drag oscillates at **2×** the shedding
   frequency (symmetric wake halves) — the classic "St off by a factor of 2".
   Always feed **Cl** to `dominantFrequency`. (Cross-check: Cd's peak should sit at
   ~2× Cl's.)
2. Including the transient in the DFT window (smears the peak; T-FREQ tests can't
   catch this — the two-pass rule in §3 is the guard).
3. Windowing before mean removal (Hann leaks DC into low bins).
4. Parabolic interpolation on raw power vs log-power — for Hann, log-power is the
   accurate variant (that choice is baked into step 6).
5. Reporting frequency in "per sample" while the series was subsampled
   (`sampleInterval` exists precisely for this).
6. N so small the peak has < 4 bins of separation from DC — require
   `frequency·N·sampleInterval ≥ 8` and assert it.
