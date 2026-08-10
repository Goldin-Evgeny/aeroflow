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
  **V11 Ahmed** (pair-averaged Cd 0.889 vs [0.242, 0.328] at 15.7M cells). The corrected
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

## V11 disposition — 2026-08-10

**V11 FAILS at ≈3.1× the band.** The 15.7M-cell run
(484×136×239 = 15,731,936 cells, dx 8.63334 mm, 120.9265 cells on the body, 4.9247%
blockage, nvidia ampere, 4 h, 3,338,390 steps, 1380 T_conv) gives a stationary
pair-averaged **Cd ≈ 0.889** against the band **[0.242, 0.328]**. Four independent
300-T_conv windows agree to 0.3%:

| T_conv window | mean Cd                    |
| ------------- | -------------------------- |
| 0–100         | 1.4231 — startup transient |
| 100–200       | 0.9141                     |
| 200–400       | 0.8864                     |
| 400–700       | 0.8894                     |
| 700–1000      | 0.8879                     |
| 1000–1380     | 0.8911                     |

The whole-run cumulative mean of 0.8678 is the transient-contaminated figure and is not the
result; the stationary value is 0.889. This is a **FAIL**, recorded as one (rule 5). The
band does not move (rule 3).

**Resolution is moving it.** The same scene and force definition give pair-averaged Cd
≈1.19 at 2M cells and 0.889 at 15.7M — the first honest point of a resolution ladder, since
every Cd recorded before the consecutive-step force correction measured a drag plus an
eigenmode and is withdrawn. Extrapolation is not claimed: 0.889 is still ~3× the band and
the ladder has two points.

**The Cd may not be quoted against Re 4.29×10⁶.** The τ_eff measurement on the 8M ladder
showed the subgrid model backfills whatever τ₀ gives up, so ν_eff falls only 1.46× while
nominal Re rises 10× and the solver does not run at the Reynolds number it is asked for. No
Cd at or above nominal Re 1×10⁵ may be quoted against its nominal Re. **This run captured no
τ_eff snapshot**, so that statement cannot yet be made specific to the 15.7M scene; the
closure harness now takes the readback and it is outstanding evidence, not a settled number.

**Convergence: the criterion failed, not the flow.** The run was recorded
`AHMED_CONVERGENCE_FAIL` at the 30-minute terminal. That verdict is withdrawn as a statement
about the flow. σ(Cd) = 1.212 at ~10 samples/T_conv, so a 20-T_conv block holds ~200 samples
and its mean carries a standard error of ≈0.086 — about 10% of the mean, judged against a 3%
spread gate. The gate was unreachable by construction. The 3% gate is unchanged; the block
length is now derived from the run's own σ/mean so its standard error sits under the gate
(≈210 T_conv for this signal), and the windows above are what that test sees.

**Topology: RECORDED, not passed.** Slant reverse-flow fraction 0.426276 and opposite-signed
C-pillar circulation +53.8151/−57.0557 are present, but the same field reports a
recirculation length of exactly **0 cells** and a base reverse fraction of 0.047. The
original gate (`slantReverse > 0` and `Γ_left·Γ_right < 0`) is satisfied by any turbulent
field and its PASS is withdrawn. V11's qualitative criterion is not met on this run.

**Resilience: PASS, narrowly.** 4 h continuous, one device loss and recovery, monotonic
advance to step 3,338,390, zero non-finite cells, mass drift 1.905×10⁻⁴. The
checkpoint/recovery cycle ran at step **726** of 3,338,390 — a field a few seconds old — so
it evidences the plumbing, not multi-hour state survival; the harness now repeats the cycle
on the aged field. The >1 h background check used a foreground cover target plus standard
hidden/`visibilitychange` emulation because automated Chromium reports all targets visible;
this is a disclosed automation limitation, not native visibility telemetry.

**Acceptance configuration.** H12's velocity inlet and H14's pressure outlet are promoted to
the acceptance configuration on the strength of their own validation. The lateral far field
remains **freestream**: the closure run used free-slip, but free-slip removes the cells that
hold the core at u_in and so can lower Cd through a velocity deficit rather than through
physics (the sphere Re=10⁴ case moved 0.55→0.263 on that single change), and no A/B
isolating it was run. Free-slip becomes the acceptance far field only by an explicit
decision recorded here, informed by that A/B.

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
