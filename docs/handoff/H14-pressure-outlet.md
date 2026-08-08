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
