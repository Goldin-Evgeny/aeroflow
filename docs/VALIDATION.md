# AeroFlow validation ladder

The benchmark suite that doubles as (a) the acceptance-test spec for milestones M2–M11
and (b) the content of the future public trust page (M15). Numbers come from
`docs/research/physics-validation.md`, which carries the source URLs; key references are
repeated here. Method details are in `docs/PHYSICS.md`.

**Hard rules** (see also CLAUDE.md):

1. Tolerances are never weakened to make a change pass. A regressed benchmark means the
   change is wrong.
2. Every recorded result states: date, git commit, hardware (GPU + browser), grid,
   precision (FP32/FP16 storage), collision operator, and run length.
3. GPU results only count after CPU/GPU parity is confirmed on a small grid
   (≤1e-6 relative after 1000 steps, bit-identical for pure-FP32).

**Reference hardware.** Every result recorded as "Ampere" in this repo's Status sections
(M1–M10, 2026) is the same machine: **NVIDIA RTX 3090 (desktop GA102, 24 GB VRAM,
~936 GB/s)**, i9-12900K, 32 GB DDR5 (at 4000 MT/s), Windows Chrome (WebGPU); the dev
environment is WSL2, which has no WebGPU, so all GPU runs happen in the Windows browser.
Feasibility notes: ~20+ GB VRAM usable (Case A at 32 cells/b fp32 ≈ 7.4 GB fits); the
practical ceiling is CPU-side — a single JS ArrayBuffer maxes out around 2 GB, which is
what full-field readbacks and whole-domain init images run into first. **Caveat for gate
claims:** the M1/M6 MLUPs go/no-go gates are defined for RTX-4060-laptop-class hardware;
the 3090 passed them with 5–7× margin, but a true 4060-class measurement is still
outstanding (the M6 benchmark page targets ≥3 GPUs).

## Summary table

| #   | Case                                                               | Target (literature)                                                                       | Gate                                                                                                    | Milestone |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| V1  | 2D Poiseuille (body-force channel)                                 | exact parabola                                                                            | BGK: order-2 convergence (16/32/64); TRT(Λ=3/16): ≤1e-4 rel. error, τ-independent over [0.51, 1.5]      | M2        |
| V2  | Lid-driven cavity Re=100                                           | Ghia 1982: u_min=−0.21090 @ y=0.4531; v_min=−0.24533 @ x=0.8047; v_max=0.17527 @ x=0.2344 | ±1.5% on extrema (256²)                                                                                 | M3        |
| V3  | Lid-driven cavity Re=1000                                          | Ghia 1982: u_min=−0.38289 @ y=0.1719; v_min=−0.51500 @ x=0.9063; v_max=0.37095 @ x=0.1563 | ±2% on extrema (512²)                                                                                   | M3        |
| V4  | Cylinder Re=100                                                    | St=0.164–0.166 (Tritton 1959); Cd=1.33–1.39; Cl amplitude 0.30–0.34                       | St∈[0.160,0.170]; Cd∈[1.30,1.42]; Cl∈[0.28,0.36]                                                        | M4        |
| V5  | Cylinder Re=200 (2D refs)                                          | St≈0.195–0.197; Cd=1.29–1.41 (Braza, Liu, Russell & Wang)                                 | St∈[0.190,0.200]; Cd∈[1.25,1.45]                                                                        | M4        |
| V6  | LES non-interference                                               | V4/V5 with LES enabled                                                                    | St/Cd shift ≤3% vs LES-off                                                                              | M5        |
| V7  | Sphere drag Re=100                                                 | Cd≈1.09 (Schiller–Naumann 1.092)                                                          | ±7%; force is the mean of two consecutive steps                                                         | M7        |
| V8  | Sphere drag Re=1000                                                | Cd≈0.46–0.47                                                                              | ±10%; force is the mean of two consecutive steps                                                        | M7        |
| V9  | Sphere drag Re=10⁴ (LES)                                           | Cd≈0.40–0.42; Newton-regime envelope [0.38, 0.50]                                         | mean consecutive-step-pair Cd inside envelope, running mean stable to <3% over last 20 convective times | M7        |
| V10 | FP16 storage A/B                                                   | V7–V9 in FP16 vs FP32 storage                                                             | ≤2% difference on identically pair-averaged Cd values                                                   | M7        |
| V11 | Ahmed body 25° slant                                               | Cd=0.285 (Ahmed 1984, SAE 840300; SimScale ref 0.2875)                                    | [0.242, 0.328], constrained ≤5%-blockage/fetch scene; independent-block convergence + topology          | M9        |
| V12 | ABL fetch (empty domain)                                           | inlet profile preserved                                                                   | ≤5% profile deviation at the building station                                                           | M10       |
| V13 | AIJ Case A (isolated 1:1:2 building, Meng & Hibi wind-tunnel data) | published point data at z=0.125H (2.5 m full scale)                                       | VDI hit rate q≥0.66; Pearson r≥0.70                                                                     | M10       |
| V14 | AIJ Case C (9-building block + 2H tower)                           | published point data at 1.5 m full scale                                                  | q≥0.66                                                                                                  | M11       |
| V15 | AIJ Case E (Niigata, 80 points at 2 m, power-law α=0.25)           | wind-tunnel data; published "good" RANS: r=0.71–0.84, bias to −35%                        | q≥0.66 and r≥0.70 at ≥2 wind directions                                                                 | M11       |

## Protocols

**V1 Poiseuille (M2).** Periodic-x channel, solid walls top/bottom, body force g≈1e-6.
Channel width H = ny−2 (halfway bounce-back: walls sit half a cell beyond the outermost
fluid nodes; fluid node j is at wall distance j−0.5). Analytic:
u(y) = g·y·(H−y)/(2ν), u_max = gH²/(8ν). Converge to |Δu_center|/u_center < 1e-10 per
500 steps. BGK: L2-error slope 2.0±0.2 across ny∈{18, 34, 66}. TRT(Λ=3/16): max relative
error ≤1e-4 for every τ ∈ {0.51, 0.6, 0.8, 1.0, 1.5} — this checks the viscosity-
independent wall location, the entire point of TRT.

**V2/V3 Ghia cavity (M3).** Square cavity, moving top lid (velocity-BC), u_lid ≤ 0.1,
Re = u_lid·N/ν. Steady-state detection: max |Δu| < 1e-8 per 1000 steps. Extract u_x
along the vertical centerline and u_y along the horizontal centerline; compare against
the full 17-point Ghia, Ghia & Shin 1982 tables (fetch from the gists cited in
`docs/research/physics-validation.md` and embed in the test fixtures at M3). Gate on the
extrema listed above; plot overlays for the trust page.

**V4/V5 cylinder (M4).** Cylinder diameter D ≥ 25 cells, blockage D/ny ≤ 5%, inlet ≥ 8D
upstream, outlet ≥ 20D downstream. Forces via momentum exchange (PHYSICS.md §8), Strouhal
from FFT of the Cl time series over ≥ 30 shedding periods after transient discard
(≥ 100 convective times D/U). Note: physical cylinder flow goes 3D at Re≈190 — V5
compares against 2D-simulation consensus only. **V5 requires LES on** (Cs=0.1): at Re=200
the bare relaxation time is τ≈0.519, and plain TRT there is Mach-unstable and diverges
(confirmed on the CPU reference — `packages/core/test/cylinder-re200-repro.test.ts`;
`apps/studio/src/dev/cylinderValidation.ts` runs the Re=200 case with LES). V4 (Re=100,
τ≈0.5375) is stable with plain TRT and runs LES-off, so V6's ≤3% LES-shift check uses V4.

**V7–V9 sphere (M7).** Analytic SDF sphere mask (mesh import not required), D ≥ 24 cells,
domain ≥ 6D×6D×16D. Cd uses body-only momentum exchange averaged over every two
consecutive steps; sampling only one Esoteric-Pull parity is invalid. Re=10⁴ needs LES and
time-averaging. **V10:** identical runs with storage precision flipped and the same
consecutive-step force average.

**V11 Ahmed (M9).** 25° slant geometry per Ahmed 1984. The invalid
512×192×160/250-cell prescription is superseded because it violates the same criterion's
≤5% blockage and fetch rules. The final constrained production configuration is
the repository's 1,044×389×288 mm lofted body (50 mm clearance, support stilts omitted) on
484×136×239 = 15,731,936 cells, dx 8.63334 mm, body length 120.9265 cells, 4.9247%
blockage, Re_L 4.29×10⁶, u=0.05, FP16, Cs=0.1, **freestream** far field + H12 velocity inlet

- H14 pressure outlet, no-slip ground, and body-only consecutive-step-pair force. Acceptance
  requires the live trigger followed by at least four independent blocks meeting the 3% spread
  tests, where the block length is derived from the run's own σ/mean so that a block mean's
  standard error sits under that gate — a block too short to resolve 3% measures its own
  sampling noise, not the flow. Checkpointing and long-run recovery are also required, the
  recovery cycle exercised on an aged field rather than only at start. A τ_eff readback on the
  settled field is mandatory: without it there is no basis for quoting the Cd against its
  nominal Re.

**V12–V15 AIJ urban (M10/M11).** Geometry and wind-tunnel data distributed by AIJ
(https://www.aij.or.jp/jpn/publish/cfdguide/index_e.htm). Power-law inflow α=0.25.
**VDI 3783/9 hit rate**: q = (1/N)·Σ hits, where a point is a hit if
|sim−obs|/obs_ref ≤ 0.25 (allowed relative deviation) — gate q ≥ 0.66. Also report
Pearson r between simulated and measured normalized speeds. Automated point-probe
extraction at the published coordinates; scoring built into the validation runner.

_Citing these results._ AIJ requires that users of the benchmark data cite the data paper
**and** each case's original publications ([NOTICE](../NOTICE) §1b, terms recorded in
[D2](decisions/D2-aij-data-redistribution.md)). Any published V12–V15 number therefore
cites Kikumoto et al. (2026), _Japan Architectural Review_ 9(1), e70083
(https://doi.org/10.1002/2475-8876.70083) plus the per-case references in NOTICE — "scored
against AIJ Case C" on its own does not satisfy this. The LES-specific reading of these
benchmarks — how AIJ expects an LES code to be set up and scored on them, which is what
AeroFlow is — is Okaze et al. (2026), _J. Wind Eng. Ind. Aerodyn._ 269, 106321
(https://doi.org/10.1016/j.jweia.2025.106321); AIJ asked specifically that it be used
alongside Tominaga et al. (2008), and it is the standard the V12–V15 setups should be read
against. AIJ does not warrant the converted files and has not reviewed these results.

## What uniform grids honestly reach

Every case above runs on a **uniform** lattice. As of 2026-07-25 that bounds which cases
can pass at all — decided once in [docs/decisions/D1-resolution-wall.md](decisions/D1-resolution-wall.md),
which this section summarizes. **No tolerance here is relaxed by that finding** (CLAUDE.md
rule 3); the point is to state in advance which bars uniform grids are not expected to clear,
so a FAIL is read as a known limit rather than a regression.

- **Reachable today:** V1–V6 (2D Poiseuille/cavity/cylinder/LES), V7 sphere **Re=100**,
  V12/V13 AIJ Case A at ≥24 cells/building — all measured in band.
- **Not reached on the tested uniform grids:** sphere **Re=1000** (pair-averaged Cd 0.5692
  vs 0.47) and **Re=10⁴** (0.6047 freestream / 0.2727 free-slip vs [0.38, 0.50]), and
  **V11 Ahmed** (pair-averaged Cd 0.9011 vs [0.242, 0.328] at 15.7M cells). The corrected
  results do not establish a unique cause. V10's FP16-vs-FP32 gate passes at
  Re=10⁴ (**0.6047/0.6066, 0.320%**) and fails at Re=1000
  (**0.5692/0.5845, 2.702%**) and at the preserved Re=100 result (**2.253%**).
  These three sit at ω⁻ = 0.019, 1.9×10⁻³ and ~10⁻⁵ respectively, i.e. deep in the regime
  where the projected regularization is measured to be anti-dissipative (V11 disposition
  below), so under-resolution is no longer the only candidate explanation for any of them.
- **Blocked by a hard cell-count ceiling, not by physics:** the kernel can address at most
  **~107.4 M cells FP16 / ~53.7 M FP32** (storage-binding count, `MAX_DDF_BUFFERS` — see
  D1). V15 Case E needs 2.735 B cells to place its 2 m probe at the third node and is
  formally **DEFERRED** to a benchmark-faithful domain crop.
- **Probe-height rule is never fudged:** runs whose evaluation plane sits below the third
  fluid node are marked `underResolved` and **suppress their verdict** instead of
  interpolating a score. A suppressed run is not a pass and not a fail — it is not a
  measurement.

Published claims stay screening-grade (CLAUDE.md rule 5). Cases requiring
more than a consumer GPU are published as reference results with hardware stated, in a tier
visually distinct from the visitor-re-runnable set — never mixed into it.

## V11 disposition — 2026-08-11

**V11 FAILS at ≈3.2× the band: `AHMED_CD_FAIL`, Cd = 0.9011 against [0.242, 0.328].**
Acceptance run on the acceptance configuration (484×136×239 = 15,731,936 cells, dx 8.63334
mm, 120.9265 cells on the body, 4.9247% blockage, **freestream** far field + H12 velocity
inlet + H14 pressure outlet, FP16, Cs=0.1, nvidia ampere, 4.04 h, 2,038,850 steps, 842.8
T_conv). The live trigger opened at 64.9 T_conv and five independent 20-T_conv blocks agreed
to **0.525%** against the 3% gate:

| block (T_conv) | mean Cd |
| -------------- | ------- |
| 65.0–84.9      | 0.8963  |
| 85.0–104.9     | 0.8984  |
| 105.0–125.0    | 0.9008  |
| 125.1–145.0    | 0.8965  |
| 145.1–165.0    | 0.9011  |

A converged, out-of-band result — a statement about the drag, recorded as a **FAIL** (rule
5). The band does not move (rule 3). Acceptance was decided at 165 T_conv, inside the
30-minute product budget (which reached 210.7 T_conv at mean Cd 0.8984).

**Resolution is moving it, slowly.** Pair-averaged Cd ≈1.19 at 2M and 0.901 at 15.7M — the
first honest ladder points, since every Cd from before the consecutive-step force correction
measured a drag plus an eigenmode and is withdrawn. No extrapolation is claimed.

**The far field was the noise source, not the drag error.** The 2026-08-10 run of the same
scene with H11 free-slip lateral walls gave σ(Cd) = **1.212** with 25.4% of instantaneous
samples negative, ρ ∈ [0.889, 1.148] and Ma_max 0.209. On freestream walls the same scene
gives σ(Cd) = **0.0163**, ρ ∈ [0.9943, 1.0073], Ma_max 0.1445 and mass drift −5.08×10⁻⁶.
That is a 74× reduction in force variance and a 20× reduction in density excursion. **Cd
itself barely moves (0.889 → 0.901)**, so the ≈3× over-prediction is robust and is not a
lateral-BC artifact — but free-slip was producing a badly polluted field, and this run is
the A/B that the acceptance constant's guard comment had always demanded.

**The Cd may not be quoted against Re 4.29×10⁶ — now measured on this scene.** τ_eff
readback on the settled field, τ₀ = 0.5000042, ν_mol = 1.4094×10⁻⁶:

| region                  | τ_eff p50 | ν_LES/ν_mol p50 | p90   | max  | LES-dominant |
| ----------------------- | --------- | --------------- | ----- | ---- | ------------ |
| whole domain            | 0.501193  | **281.2**       | 495.5 | 1583 | 100.0%       |
| **approach freestream** | 0.501169  | **275.5**       | 462.8 | 1035 | 100.0%       |
| around body             | 0.501298  | 305.9           | 544.2 | 1476 | 100.0%       |
| slant                   | 0.501243  | 292.9           | 533.4 | 1340 | 100.0%       |
| near wake (≤1 L aft)    | 0.501061  | 249.9           | 490.8 | 993  | 100.0%       |
| station x=2 (inlet)     | 0.500312  | 72.8            | 128.3 | 1110 | 100.0%       |

The subgrid model supplies **~276× the molecular viscosity in undisturbed approach flow**,
where Π^neq should be ≈0, with **100% of cells LES-dominant and none at the τ floor**. The
8M/Re 1e5 measurement of 6.47× is not merely reproduced at the acceptance scene, it is ~40×
larger. Read as a median-based diagnostic proxy only — ν_eff varies strongly in space and
time under Smagorinsky, so this is not a global Reynolds number — it puts the effective Re in
the region of **10⁴**, against a nominal 4.29×10⁶. The standing rule-5 constraint is now
specific to this scene: **this Cd is not a Cd at Re 4.29×10⁶.**

**And the sensor is reading the grid, not the flow.** Same field, approach region, 2,656,675
cells: median(Π-implied |S| / centered-difference |S|) = **3.2194** (Pearson 0.9155). Per
component, against the wavelength band holding its contribution energy:

| component | α₀ (Π vs hydrodynamic) | Pearson | energy at 2–4 cells |
| --------- | ---------------------- | ------- | ------------------- |
| xy        | **3.3853**             | 0.9782  | **99.36%**          |
| xz        | **3.4340**             | 0.9780  | **99.42%**          |
| yz        | **1.1560**             | 0.9832  | **0.49%**           |

The two shear components whose strain content lives almost entirely at 2–4 cells are
over-reported by ~3.4×; the one component whose content sits at 8–16+ cells is nearly
unbiased at 1.16×. Deviatoric α = 2.9703. This is the mechanism measured end to end at the
acceptance point: the projected regularization leaves grid-scale transverse shear
under-damped, Π^neq over-states it ~3.4×, Smagorinsky reads Π^neq and manufactures ~276×
molecular eddy viscosity out of undisturbed freestream, and the run stops being a run at its
nominal Reynolds number. It matches the eigenanalysis prediction (Π/Π_hydro 2.06 at 2.67
cells) in sign, band and order of magnitude.

**Topology: RECORDED, not passed.** Slant reverse-flow fraction 0.4127 and opposite-signed
C-pillar circulation +48.592/−49.213 are present, but the field reports a recirculation
length of exactly **0 cells** and a base reverse fraction of 0.0368. The original gate
(`slantReverse > 0` and `Γ_left·Γ_right < 0`) is satisfied by any turbulent field and its
earlier PASS is withdrawn. V11's qualitative criterion is not met.

**Resilience: PASS.** 4.04 h continuous, monotonic to step 2,038,850, zero non-finite cells,
mass drift −5.08×10⁻⁶. Two device-loss/recovery cycles: one at step 726 (fresh field) and one
at step **2,037,882** — four hours in — which recovered and continued advancing, so the
criterion now covers aged state rather than only the plumbing. Background advance 968 →
1,009,382 over 1 h. The background check uses a foreground cover target plus standard
hidden/`visibilitychange` emulation because automated Chromium reports all targets visible;
a disclosed automation limitation, not native visibility telemetry.

**Acceptance configuration.** H12's velocity inlet and H14's pressure outlet are promoted to
the acceptance configuration on the strength of their own validation. The lateral far field
is **freestream**: the 2026-08-10 run used free-slip, promoted without the A/B its own guard
comment required. That A/B has now been run (above) and free-slip is rejected on the
evidence, not merely on procedure.

### The mechanism, as measured

Not a resolution deficit alone, and not a property of D3Q19 as a lattice. An exact
von-Neumann analysis of the production transverse block — guarded against the shipping
`collideCell` Jacobian to 3.07×10⁻¹¹ — shows the **projected second-order regularization is
anti-dissipative at high wavenumber once τ₀ → ½ and a mean flow is present**:

- gain **1.004405 per step** at λ ≈ 2.65 cells at τ₀ = 0.5000021, u = 0.05;
- still **1.001925** at the measured approach τ_eff p50 of 0.500989, so the eddy viscosity
  the model actually supplies does not stabilize the band;
- **stable everywhere at u = 0** and the same τ₀, so the instability is advection-coupled,
  not a bare τ-floor effect;
- strongly damped at τ = 0.8 (0.333 at λ = 2), which is why it never appeared before.

Π^neq over-reports the hydrodynamic strain in the same band (1.0012 at λ = 19.7 cells, 1.27
at 4, 2.06 at 2.67) — classified as a finite-resolution plus finite-Knudsen constitutive
departure after cubic-G_i, fixed-index, global-normalization and time-level explanations
were each excluded. That is the path from the mode to the LES: Smagorinsky reads Π^neq, so
it sees grid-scale content as resolved strain and fires on undisturbed freestream.

A nonlinear periodic A/B confirms it and isolates the cause: at λ = 3.2 the regularized
operator grows (1.00249 with LES, 1.00314 without) while plain TRT without regularization
decays (0.98398). Dropping regularization is not the fix — it buys stability with a far
worse constitutive ratio (Π/Π_hydro 6.09 against 1.53) and a higher τ_eff, i.e. it damps by
making the LES fire harder on a noisier Π. **RR3**, the third-order recursive regularization
the mechanism points at, was implemented and **failed** both predeclared gates.

FP16 is not implicated (0.12% effect). What is **not** established: that D3Q19 as a lattice
is at fault (every case above is the regularized-TRT collision measured on D3Q19, with no
D3Q27 comparison at the same τ₀ in this evidence set), that all near-τ₀=½ configurations
fail, or that M10/M11 urban mean velocities are contaminated — those cases must establish
the production operating envelope with their own mean-velocity gates.

A D3Q27 central-moment operator damps the same mode (gain 0.99731 at λ = 3.2) at a
comparable constitutive ratio (1.504 vs 1.527), which is why it is preserved as research.
Its GPU port matches the CPU authority to 3.8×10⁻⁶ relative on populations, but its periodic
momentum gate fails at λ = 16 (7.678×10⁻⁵ vs 5×10⁻⁵) — an **unnormalized** gate on a 64-cell
1-D harness with |p| = 3.2, i.e. a 1.6×10⁻⁵ relative bar for an f32 kernel over 120 steps,
with streaming contributing exactly zero and the drift concentrated in a component that is
identically zero by symmetry. **Q27 PRODUCTION MIGRATION: DEFERRED** — recorded as not yet
demonstrated correct, not as demonstrated broken. Production remains D3Q19.

## Recording results

Each executed case is recorded as a row of the shape below, and (from M15) published
to the public validation page:

`| date | commit | GPU / browser | grid | precision | collision | result | pass/fail |`
