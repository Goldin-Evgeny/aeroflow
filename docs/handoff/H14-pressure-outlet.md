# H14 — Opt-in D3Q19 fixed-density outlet

> **Handoff doc.** Milestone: M9 Phase 3c. This is new opt-in 3D solver physics based on
> M4's validated D2Q9 fixed-density non-equilibrium-extrapolation outlet. H3/H4
> zero-gradient copy remains the historical default. CPU oracle and tests land before WGSL.

## 1. Why

H12 `VelocityInlet` prescribes velocity at the upstream fluid density. H4 `Outlet` copies
the upstream state. With H11 free-slip top/sides and a no-slip ground, neither boundary
sets the bulk density. The M9 empty tunnel measured a nearly uniform but monotonically
growing density level under that pairing. A fixed-density outlet is the smallest repo-backed
way to anchor the isothermal pressure, but it must earn its 3D use independently of M4.

This document does not reinterpret M9's phrase "outflow outlet": in the historical 3D
solver that phrase means H4 zero-gradient copy. Selecting this outlet is an explicit new
configuration choice. Existing scenes and measurements remain unchanged unless they opt in.

## 2. Rule

For an `Outlet` cell on the +x face, reconstruct the previous post-collision populations of
its upstream Fluid neighbour `n = x - xhat` using the existing H4 snapshot. Compute its
moments in D3Q19 direction order:

```text
rho_n = sum_i f_i(n)
m_n   = sum_i e_i f_i(n)
u_n   = m_n / rho_n
```

Then emit the M4/Guo non-equilibrium extrapolation at `rho_out = 1`:

```text
f_i(out) = f_i_eq(1, u_n) + f_i(n) - f_i_eq(rho_n, u_n)
```

For Guo-forced CPU configurations, apply the same half-force physical-velocity correction
as the 2D outlet before evaluating both equilibria. The M9/GPU path has no body force.

In exact arithmetic the rule imposes `sum_i f_i(out) = 1` and preserves the neighbour
velocity and non-equilibrium population residual. It does not prescribe outlet velocity.

## 3. Surfaces and defaults

- `outlet: 'zero-gradient' | 'pressure'` on `Solver3D`, `EsotericPull3D`, and `Lbm3D`.
- Default: `'zero-gradient'` everywhere. No scene silently changes mode.
- All `Outlet` cells in one solver instance use the selected mode, matching M4's option.
- The H4 parity-aware 19-population snapshot is reused; no new outlet side buffer exists.
- WGSL uses a compile-time `PRESSURE_OUTLET` variant so the historical kernel path is
  unchanged when the option is absent.

## 4. CPU gates

1. **Moment identity:** a non-equilibrium D3Q19 neighbour produces outlet density 1,
   neighbour velocity, and the same `f - f_eq` residual to Float64 roundoff.
2. **Naive/Esoteric identity:** exact equality for at least 100 steps on a scene combining
   H12 VelocityInlet, H11 free-slip, no-slip ground, an interior solid, and pressure Outlet.
3. **Default regression:** omitting `outlet` is bit-identical to explicit
   `'zero-gradient'` for both CPU solvers.
4. **Long-run anchor:** on a small empty tunnel, pressure mode has bounded/stationary density
   and no secular fluid-mass growth. Mean rho and core velocity are reported diagnostics;
   no new 1% or 5% gate is invented here.
5. **Signed mass ledger:** for every boundary link into a Fluid cell, each step sums
   `replacement incoming - canonical outgoing`. The complete boundary transformation must
   include inlet, outlet, solid bounce, and H11 free-slip redirection; open x-face transport
   alone is not a fluid-mass ledger at free-slip intersections. Cumulative net boundary
   input must close against the change in mass over `CellType.Fluid` cells to the measured
   arithmetic residual.

   **What closure does and does not prove.** The ledger recomputes the same boundary
   transformation the solver applies, so closure is guaranteed by construction whenever the
   two are consistent. It establishes that the mass change is entirely boundary-transported —
   which does usefully rule out interior collision roundoff and H13 as the driver — but it is
   an accounting result, not a statement that any boundary is behaving correctly. Attributing
   a residual requires decomposing the ledger by boundary class, which this gate does not do.

## 5. GPU port and gates

The snapshot pass is unchanged. In `stream_collide`, pressure mode reduces the 19 snapshot
values to `rho_n` and momentum in direction order, then applies the Section 2 formula before
the existing scatter. CPU and WGSL loop structure and order stay paired.

The GPU ledger enumerates **shell cells only** (`snapshot_boundary_mass` walks the x, y and z
faces), so an interior solid — the Ahmed body — lies outside its cell set. That is sound for
the mass total, because an interior bounce-back link sets `incoming = outgoing` and
contributes exactly zero, but the Section 4 gate-5 phrase "every boundary link into a Fluid
cell" describes the CPU oracle, which is the complete one. Read the GPU number as the
shell-link total.

1. Add a real-GPU FP32 parity-panel configuration with H12 + H11 + pressure Outlet. Existing
   parity tolerances are unchanged; record the required parity result line.
2. Run the 250k empty tunnel in FP32 with `VelocityInlet + free-slip`, zero-gradient versus
   pressure. Report density history, signed mass balance, fluid-mass closure, Mach, symmetry,
   core velocity, and an acoustic-pulse reflection/decay A/B. Reflection is a tradeoff, not a
   hard failure unless an existing requirement supplies a bound.
3. If healthy, run only the 2M pressure arm in FP32 with the same reports and closure check.
4. Stop after the 2M report. No FP16 and no Ahmed body in Phase 3c.

## 6. Stop conditions

Stop before increasing the grid on any CPU/GPU parity failure, non-finite population,
unbounded density, positive secular fluid-mass trend after the startup transient, failed
signed-flux closure beyond its measured numerical error, or Mach outside the existing M9
health envelope. Preserve the existing empty-tunnel health bounds; do not promote the
diagnostic `coreU/Ucmd` or mean-density levels into new acceptance tolerances.

## 7. Pitfalls

1. Replacing H4 copy instead of adding an opt-in changes every historical 3D run.
2. Reconstructing only incoming populations is a different boundary formulation; H14 applies
   M4's all-population non-equilibrium extrapolation exactly.
3. Summing moments in a different order on naive, Esoteric, and WGSL paths weakens parity.
4. Reading the upstream Esoteric state during the sweep violates slot ownership; use the H4
   snapshot unchanged.
5. H13 conserves collision density only. It must not be credited for open-boundary global
   mass closure.
6. A fixed-density outlet can change acoustic reflection. Measure it; do not call the outlet
   non-reflecting without evidence.

## 8. Results

Real-GPU parity panel `[v12-pressure-outlet]` on NVIDIA Ampere, FP32, 100 steps:

```text
PASS TRT + ABL BCs + CONSERVE_MASS + pressure outlet (H14):
rho=6.86e-7 u=5.66e-6 (bar 5e-5)
massClosure=4.07e-7 (dM=5.920e+2 boundaryInput=5.920e+2)
```

The complete-shell ledger supersedes the earlier open-x-face diagnostic. Its closure above
includes inlet, outlet, solid, and H11 free-slip transformations, over the shell cell set
described in Section 5.

The FP32 250k-cell empty-tunnel A/B ran with the same 113x35x63 grid, VelocityInlet,
free-slip top/sides, no-slip ground, H10 + H13, and all settings held equal except the
outlet. Run length was the `runEmptyTunnel` default of **40 convective times**;
`convectiveTimeSteps = round(lengthCells / u)` is **563 steps** for this scene, so the run is
22,520 steps. (An earlier draft of this section reported "563 convective times", conflating
the two.)

| diagnostic                     | H4 zero-gradient | H14 pressure |
| ------------------------------ | ---------------: | -----------: |
| final mean rho                 |         1.109897 |     1.003177 |
| fluid-mass slope / `T_conv`    |          8.14e-4 |      1.49e-4 |
| exact ledger closure / initial |          7.74e-8 |      7.41e-8 |
| max Mach                       |           0.1382 |       0.1931 |
| reflected center-rho amplitude |          3.02e-2 |      8.29e-2 |
| late center-rho amplitude      |          2.78e-2 |      3.87e-2 |

**Stage A verdict: FAIL; no 2M escalation.** H14 materially reduces the density drift and
anchors the final bulk-density level, and its ledger closes in the accounting sense of
Section 4 gate 5. It nevertheless retains a positive post-startup fluid-mass slope and fails
the existing stationarity health criteria. Per Section 6, Phase 3c stops here: no FP16 and no
Ahmed run.

Three qualifications on the table above, all established while reviewing this result:

1. **The acoustic rows do not establish a reflection increase.** The center-rho probe samples
   every `round(T_conv/4) = 141` steps, while one acoustic domain transit is `nx/c_s ≈ 196`
   steps and a round trip ≈ 391 — under three samples per round trip, so the pulse is
   aliased. The amplitudes are also measured against a baseline taken as the mean of the last
   three samples, so any secular offset between the early window and the run's end is counted
   as wave amplitude, and `incidentAmplitude` is a maximum over roughly five points. Pitfall 6
   still stands as a theoretical expectation — a fixed-density outlet is a pressure-release
   condition and should reflect the density mode — but these numbers are **not evidence for
   it**. A cadence resolving the acoustic transit and a baseline local in time are required
   before any reflection claim is made.
2. **The fluid-mass slope is a two-endpoint estimate**, `(drift_last - drift_first)` over the
   post-transient window, with the first endpoint at `T_conv = 5` where the startup ring-down
   is still large. On a saturating trajectory this overstates the asymptote. Whether the
   residual slope is asymptotic, decaying, or oscillatory is **not decided** by this number;
   fitted slopes over successive late windows, with uncertainty, are needed.
3. **The per-sample time series behind this table was not persisted** — only the summary lines
   were attached — so none of the above can be re-derived from the recorded artifacts. Future
   runs of this harness must attach the raw samples.

The anchor's own timescale bounds what the slope can be. The fixed-density outlet restores
mass at `kappa*(rho-1)` per outlet cell per step with `kappa = 1/6 - u/2 ~ 0.1417`, so the
global mass mode relaxes with `tau = V/(kappa*A_out) = 223443/285 ~ 783` steps, about 1.4
`T_conv`. The slope is measured over ~36 `T_conv`, roughly 26 e-folding times later, so the
residual cannot be the anchored mass mode still relaxing. Likewise, a _constant_ boundary
source under a working anchor produces a steady density **level**, not a slope. Both point at
a time-varying driver or at the metric, and neither is resolved here.

### 8.1 E0 — the class-decomposed Float64 budget

`boundaryMassByClass3D` splits the gate-5 sum by boundary class, so the Stage A residual can
be attributed instead of inferred. Run on a 10x8x7 scene carrying the same topology as the
tunnel — no-slip ground, free-slip top and sides, VelocityInlet with the H12 plain-`Inlet`
edge ring, `Outlet` interior with the H11 §3.2 FreeSlip outlet ring — at the acceptance-tier
`tau0 = 0.5000005` with TRT, LES `Cs = 0.1`, regularization and `conserveMass`, 6000 steps:

| class                | pressure rho0=1 | pressure rho0=1.05 | zero-gradient |
| -------------------- | --------------: | -----------------: | ------------: |
| `velocityInlet`      |        7.889e+3 |           7.890e+3 |      9.496e+3 |
| `inlet`              |        8.364e+2 |           8.362e+2 |     -1.668e+2 |
| `outlet`             |       -7.830e+3 |          -7.842e+3 |     -8.595e+3 |
| `freeSlipFace`       |       -4.23e-16 |          -8.60e-16 |      2.12e-16 |
| `freeSlipEdge`       |               0 |                  0 |             0 |
| `freeSlipInletRing`  |               0 |                  0 |             0 |
| `freeSlipOutletRing` |       -8.951e+2 |          -8.962e+2 |     -6.351e+2 |
| final `rhoMean`      |     1.001218109 |        1.001218109 |   1.409881586 |
| late `drho/dstep`    |        -4.7e-18 |           -5.2e-18 |       6.3e-05 |

**Free-slip is exact wherever the bijection argument applies.** The flat face stays at Float64
roundoff over the whole run. Slip-slip edges are _identically_ zero, not merely small: the
double mirror is an involution that resolves back onto the pulling cell's own opposite
population, so each link cancels exactly. Slip-solid intersections take the H11 §3.1
bounce-back fallback, `incoming = outgoing`, likewise exactly zero. Those three classes are
gated at roundoff as a regression guard. `freeSlipOutletRing` is large but is **not a leak**:
it appears in both outlet modes, it is the ring redirecting into the outlet plane, and in the
pressure arm it participates in a budget that balances exactly. It is reported and ungated —
bounding legitimate flux would be inventing a tolerance.

**The pressure outlet reaches a genuinely stationary state**, approached from both above and
below to the same `rhoMean = 1.001218109`, with a late rate of 5e-18 per step. Its stable
state carries a **finite density offset**, and that is why `massDriftDecay = peak/steady` is
the wrong stationarity statement for it: a decay-to-zero ratio scores a converged run as a
failure. Late-time stationarity must be stated as a rate, and the density-level error judged
separately against its own bound. Zero-gradient on the identical scene climbs monotonically
to 1.41 and is still climbing at 6.3e-5 per step, reproducing the Stage A pathology in
Float64 on 240 fluid cells.

**Conclusion.** The Stage A residual is neither a free-slip defect nor the outlet
reconstruction. What this scene cannot settle is magnitude: its mass mode relaxes in
`V/(kappa*A_out) = 240/4.25 ~ 56` steps and it ran 107 of those, while the 250k tunnel ran 29.
The open question is therefore whether the 250k run had simply not finished settling.

### 8.2 E1 — the residual slope is a chord artifact

Stage A re-run at 250k with the per-sample series persisted and the drift fitted over four
successive late windows. The physics is unchanged and the run reproduces Stage A exactly
(`rhoMean` 1.109897 / 1.003177, chord 8.140e-4 / 1.485e-4).

| late-window slope / `T_conv` | H4 zero-gradient    | H14 pressure         |
| ---------------------------- | ------------------- | -------------------- |
| `[5–11]`                     | 1.28e-3 (\|t\|=6)   | -1.86e-3 (\|t\|=0.3) |
| `[13–19]`                    | 7.34e-4 (\|t\|=124) | -2.43e-3 (\|t\|=0.6) |
| `[21–27]`                    | 6.76e-4 (\|t\|=121) | 1.29e-3 (\|t\|=0.4)  |
| `[29–41]`                    | 7.50e-4 (\|t\|=83)  | 1.86e-4 (\|t\|=0.4)  |
| late level                   | 1.075e-1            | -1.171e-4            |

**H14 has no secular mass drift.** All four of its fitted slopes are indistinguishable from
zero at \|t\| <= 0.6 and they alternate in sign; the drift oscillates about -1.2e-4. The
reported 1.49e-4 per `T_conv` was the two-endpoint chord between `drift(5) = -2.17e-3`, taken
inside the startup ring-down, and `drift(41) = +3.18e-3`. Zero-gradient on the same grid is
the opposite in every respect: four same-signed slopes resolved at \|t\| = 83 to 124, settling
toward a level of 0.108. The statistic separates them cleanly.

### 8.3 E2 — the window was too short, by about 20x

Pressure arm only, same 250k grid, 120 convective times (68,144 steps, 9.5 s). Maxima taken
over successive windows rather than over everything after `T_conv = 5`:

| window `T_conv` | max \|drift\| | max fluxMismatch | center-rho amplitude |
| --------------- | ------------: | ---------------: | -------------------: |
| 5–10            |       2.62e-2 |          7.63e-1 |              1.50e-2 |
| 10–20           |       2.81e-2 |          4.38e-1 |              3.34e-2 |
| 20–40           |       1.19e-2 |          1.87e-1 |              1.47e-2 |
| 40–60           |       3.65e-3 |          8.75e-2 |              4.30e-3 |
| 60–90           |       1.74e-3 |          3.08e-2 |              2.10e-3 |
| 90–125          |       5.73e-4 |          9.46e-3 |              6.33e-4 |

Everything decays monotonically, by roughly a decade per 40 `T_conv`: drift 49x, flux
mismatch 81x, center-rho amplitude 53x. **In its final window the run satisfies both
`BOUNDS.massDrift` (5.73e-4 < 1e-3) and `BOUNDS.fluxMismatch` (9.46e-3 < 0.05)**, with no
threshold touched. The fitted slopes fall the same way — 4.95e-5, -2.71e-5, -1.26e-5,
-2.01e-6 per `T_conv`, a 25x reduction, none resolved from zero — and the chord itself drops
from 1.485e-4 to 2.15e-5 purely from running longer.

The standing density field converges with it. Streamwise `max|rho-1|` falls from 8.18e-3 at
41 `T_conv` to **8.64e-4** at 120, `rhoSpan(x)` to 9.82e-4, and `rho_in - rho_out` from
8.21e-3 to 9.82e-4. The outlet holds `rho_out = 0.9999`: the anchor does exactly what it was
built to do. Against zero-gradient's 1.11e-1 standing deviation, that is a 128x improvement.
The ledger closes at 1.2e-7 throughout.

**Why the ring-down is so long.** Resolved viscosity is `nu = u*L/Re = 3.28e-7`, so there is
almost nothing to damp acoustic energy, and a fixed-density outlet is a pressure-release
condition that reflects it rather than passing it. The measured reflection ratio is 0.91 at
both run lengths. Section 7 pitfall 6 anticipated exactly this. It is a slow ring-down, not a
sustained standing mode — it decays 50-80x over the run — but it sets the settling time, and
~90 `T_conv` is what this configuration needs.

**Verdict on Stage A: the FAIL was correct as a statement about that run, and wrong as a
statement about H14.** The outlet is sound. What failed was a 40-`T_conv` window applied to a
configuration that rings down over ~90, judged by a chord that cannot tell settling from
divergence. Both diagnostics are now stated as rates.

**Open, and deliberately not decided here:** `TRANSIENT_TCONV = 5` in `ahmedEmptyTunnel.ts`
splits transient from steady, and every `worst.*` is a maximum after it. That split was
calibrated against a non-reflecting far field. With this outlet the maxima above are dominated
by the 5-20 `T_conv` band and describe the transient, not the steady state — which is why the
120-`T_conv` run still reports `massDrift = 2.81e-2` even though its final window is 5.73e-4.
Changing that constant changes what every arm of phases 2, 3 and 3b measured, so it is not
changed as part of this investigation.
