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

| #   | Case                                                               | Target (literature)                                                                       | Gate                                                                                               | Milestone |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| V1  | 2D Poiseuille (body-force channel)                                 | exact parabola                                                                            | BGK: order-2 convergence (16/32/64); TRT(Λ=3/16): ≤1e-4 rel. error, τ-independent over [0.51, 1.5] | M2        |
| V2  | Lid-driven cavity Re=100                                           | Ghia 1982: u_min=−0.21090 @ y=0.4531; v_min=−0.24533 @ x=0.8047; v_max=0.17527 @ x=0.2344 | ±1.5% on extrema (256²)                                                                            | M3        |
| V3  | Lid-driven cavity Re=1000                                          | Ghia 1982: u_min=−0.38289 @ y=0.1719; v_min=−0.51500 @ x=0.9063; v_max=0.37095 @ x=0.1563 | ±2% on extrema (512²)                                                                              | M3        |
| V4  | Cylinder Re=100                                                    | St=0.164–0.166 (Tritton 1959); Cd=1.33–1.39; Cl amplitude 0.30–0.34                       | St∈[0.160,0.170]; Cd∈[1.30,1.42]; Cl∈[0.28,0.36]                                                   | M4        |
| V5  | Cylinder Re=200 (2D refs)                                          | St≈0.195–0.197; Cd=1.29–1.41 (Braza, Liu, Russell & Wang)                                 | St∈[0.190,0.200]; Cd∈[1.25,1.45]                                                                   | M4        |
| V6  | LES non-interference                                               | V4/V5 with LES enabled                                                                    | St/Cd shift ≤3% vs LES-off                                                                         | M5        |
| V7  | Sphere drag Re=100                                                 | Cd≈1.09 (Schiller–Naumann 1.092)                                                          | ±7%                                                                                                | M7        |
| V8  | Sphere drag Re=1000                                                | Cd≈0.46–0.47                                                                              | ±10%                                                                                               | M7        |
| V9  | Sphere drag Re=10⁴ (LES)                                           | Cd≈0.40–0.42; Newton-regime envelope [0.38, 0.50]                                         | mean Cd inside envelope, running mean stable to <3% over last 20 convective times                  | M7        |
| V10 | FP16 storage A/B                                                   | V7–V9 in FP16 vs FP32 storage                                                             | ≤2% difference on all Cd values                                                                    | M7        |
| V11 | Ahmed body 25° slant                                               | Cd=0.285 (Ahmed 1984, SAE 840300; SimScale ref 0.2875)                                    | ±15% (stretch ±10%) + qualitative slant separation bubble & C-pillar vortices                      | M9        |
| V12 | ABL fetch (empty domain)                                           | inlet profile preserved                                                                   | ≤5% profile deviation at the building station                                                      | M10       |
| V13 | AIJ Case A (isolated 1:1:2 building, Meng & Hibi wind-tunnel data) | published point data at z=0.125H (2.5 m full scale)                                       | VDI hit rate q≥0.66; Pearson r≥0.70                                                                | M10       |
| V14 | AIJ Case C (9-building block + 2H tower)                           | published point data at 1.5 m full scale                                                  | q≥0.66                                                                                             | M11       |
| V15 | AIJ Case E (Niigata, 80 points at 2 m, power-law α=0.25)           | wind-tunnel data; published "good" RANS: r=0.71–0.84, bias to −35%                        | q≥0.66 and r≥0.70 at ≥2 wind directions                                                            | M11       |

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
domain ≥ 6D×6D×16D. Cd from momentum exchange; Re=10⁴ needs LES + time-averaging.
**V10:** identical runs, storage precision flipped.

**V11 Ahmed (M9).** 25° slant geometry per Ahmed 1984; ~512×192×160 uniform grid, LES,
long-run infra (checkpointing) required. Publish with honest error bars — uniform grids
without wall functions are expected to sit in the ±10–15% band, not the industry ±5%.

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
- **Not reachable on a uniform grid at the ladder's grid sizes:** sphere **Re=1000**
  (Cd 0.569 vs 0.47) and **Re=10⁴** (0.55 freestream / 0.263 free-slip vs [0.38, 0.50]),
  because the boundary layer is ~D/√Re and goes unresolved. V10's FP16-vs-FP32 ≤2% bar
  fails at Re=100/1000 for the same reason — it is 0.40% at Re=10⁴, so the discrepancy
  tracks under-resolution, not fp16 storage.
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

## Recording results

Each executed case is recorded as a row of the shape below, and (from M15) published
to the public validation page:

`| date | commit | GPU / browser | grid | precision | collision | result | pass/fail |`
