# H9 — Ghia, Ghia & Shin (1982) cavity benchmark tables (embedded fixtures)

> **Handoff doc.** Milestone: M3. These are the normative comparison data for the
> lid-driven cavity validation (V2/V3 in `docs/VALIDATION.md`). Embedded here so M3
> never transcribes numbers from the web.
>
> **Provenance:** Ghia, Ghia & Shin, _J. Comput. Phys._ 48:387–411 (1982), Tables I
> and II (257×257 multigrid). Fetched 2026-07-08 from the sources cited in
> `docs/research/physics-validation.md`
> (gists ivan-pi/3e9326d18a366ffe6a8e5bfda6353219 and ivan-pi/caa6c6737d36a9140fbcf2ea59c78b3c).
>
> **Validation status:** the **Re=100 and Re=1000 columns are verified** — every
> extremum matches the independently-sourced digest values (u_min=−0.21090 @ y=0.4531
> and v_min=−0.24533 @ x=0.8047, v_max=0.17527 @ x=0.2344 for Re=100; u_min=−0.38289 @
> y=0.1719, v_min=−0.51500 @ x=0.9063, v_max=0.37095 @ x=0.1563 for Re=1000) and the
> profiles are smooth/consistent. **Only these two columns are normative for M3.**
> Other Re columns are carried as-is for future use and are NOT verified; note one
> known transcription error in the source gist: Table I, y=0.4531, Re=3200 reads
> "−0.86636" — by profile continuity the correct value is **−0.086636**. Re-verify any
> non-{100,1000} column against the original paper before gating on it.

## Geometry & conventions

Unit square cavity; lid is the **top** wall (y=1) moving in **+x** with speed 1;
all other walls no-slip. Table I: u along the **vertical line through the geometric
center (x=0.5)**. Table II: v along the **horizontal line through the center (y=0.5)**.
Velocities normalized by lid speed; coordinates by cavity side.

## Table I — u(y) at x = 0.5

| y      | Re=100   | Re=400   | Re=1000  | Re=3200    | Re=5000  | Re=7500  | Re=10000 |
| ------ | -------- | -------- | -------- | ---------- | -------- | -------- | -------- |
| 1.0000 | 1.00000  | 1.00000  | 1.00000  | 1.00000    | 1.00000  | 1.00000  | 1.00000  |
| 0.9766 | 0.84123  | 0.75837  | 0.65928  | 0.53236    | 0.48223  | 0.47244  | 0.47221  |
| 0.9688 | 0.78871  | 0.68439  | 0.57492  | 0.48296    | 0.46120  | 0.47048  | 0.47783  |
| 0.9609 | 0.73722  | 0.61756  | 0.51117  | 0.46547    | 0.45992  | 0.47323  | 0.48070  |
| 0.9531 | 0.68717  | 0.55892  | 0.46604  | 0.46101    | 0.46036  | 0.47167  | 0.47804  |
| 0.8516 | 0.23151  | 0.29093  | 0.33304  | 0.34682    | 0.33556  | 0.34228  | 0.34635  |
| 0.7344 | 0.00332  | 0.16256  | 0.18719  | 0.19791    | 0.20087  | 0.20591  | 0.20673  |
| 0.6172 | −0.13641 | 0.02135  | 0.05702  | 0.07156    | 0.08183  | 0.08342  | 0.08344  |
| 0.5000 | −0.20581 | −0.11477 | −0.06080 | −0.04272   | −0.03039 | −0.03800 | 0.03111  |
| 0.4531 | −0.21090 | −0.17119 | −0.10648 | −0.086636* | −0.07404 | −0.07503 | −0.07540 |
| 0.2813 | −0.15662 | −0.32726 | −0.27805 | −0.24427   | −0.22855 | −0.23176 | −0.23186 |
| 0.1719 | −0.10150 | −0.24299 | −0.38289 | −0.34323   | −0.33050 | −0.32393 | −0.32709 |
| 0.1016 | −0.06434 | −0.14612 | −0.29730 | −0.41933   | −0.40435 | −0.38324 | −0.38000 |
| 0.0703 | −0.04775 | −0.10338 | −0.22220 | −0.37827   | −0.43643 | −0.43025 | −0.41657 |
| 0.0625 | −0.04192 | −0.09266 | −0.20196 | −0.35344   | −0.42901 | −0.43590 | −0.42537 |
| 0.0547 | −0.03717 | −0.08186 | −0.18109 | −0.32407   | −0.41165 | −0.43154 | −0.42735 |
| 0.0000 | 0.00000  | 0.00000  | 0.00000  | 0.00000    | 0.00000  | 0.00000  | 0.00000  |

\* corrected from the gist's "−0.86636" (transcription error; see header).

## Table II — v(x) at y = 0.5

| x      | Re=100   | Re=400   | Re=1000  | Re=3200  | Re=5000  | Re=7500  | Re=10000 |
| ------ | -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| 1.0000 | 0.00000  | 0.00000  | 0.00000  | 0.00000  | 0.00000  | 0.00000  | 0.00000  |
| 0.9688 | −0.05906 | −0.12146 | −0.21388 | −0.39017 | −0.49774 | −0.53858 | −0.54302 |
| 0.9609 | −0.07391 | −0.15663 | −0.27669 | −0.47425 | −0.55069 | −0.55216 | −0.52987 |
| 0.9531 | −0.08864 | −0.19254 | −0.33714 | −0.52357 | −0.55408 | −0.52347 | −0.49099 |
| 0.9453 | −0.10313 | −0.22847 | −0.39188 | −0.54053 | −0.52876 | −0.48590 | −0.45863 |
| 0.9063 | −0.16914 | −0.23827 | −0.51500 | −0.44307 | −0.41442 | −0.41050 | −0.41496 |
| 0.8594 | −0.22445 | −0.44993 | −0.42665 | −0.37401 | −0.36214 | −0.36213 | −0.36737 |
| 0.8047 | −0.24533 | −0.38598 | −0.31966 | −0.31184 | −0.30018 | −0.30448 | −0.30719 |
| 0.5000 | 0.05454  | 0.05186  | 0.02526  | 0.00999  | 0.00945  | 0.00824  | 0.00831  |
| 0.2344 | 0.17527  | 0.30174  | 0.32235  | 0.28188  | 0.27280  | 0.27348  | 0.27224  |
| 0.2266 | 0.17507  | 0.30203  | 0.33075  | 0.29030  | 0.28066  | 0.28117  | 0.28003  |
| 0.1563 | 0.16077  | 0.28124  | 0.37095  | 0.37119  | 0.35368  | 0.35060  | 0.35070  |
| 0.0938 | 0.12317  | 0.22965  | 0.32627  | 0.42768  | 0.42951  | 0.41824  | 0.41487  |
| 0.0781 | 0.10890  | 0.20920  | 0.30353  | 0.41906  | 0.43648  | 0.43564  | 0.43124  |
| 0.0703 | 0.10091  | 0.19713  | 0.29012  | 0.40917  | 0.43329  | 0.44030  | 0.43733  |
| 0.0625 | 0.09233  | 0.18360  | 0.27485  | 0.39560  | 0.42447  | 0.43979  | 0.43983  |
| 0.0000 | 0.00000  | 0.00000  | 0.00000  | 0.00000  | 0.00000  | 0.00000  | 0.00000  |

## M3 usage instructions

1. Copy the **Re=100 and Re=1000 columns only** into
   `packages/core/src/fixtures/ghia.ts` as literal arrays
   `{ y: number[], u100: number[], u1000: number[] }` and
   `{ x: number[], v100: number[], v1000: number[] }`, with a header comment pointing
   at this file for provenance.
2. Comparison protocol: run the cavity to steady state (V2/V3 setup in
   `docs/VALIDATION.md`), extract the sim centerline profiles, and **linearly
   interpolate the SIM profile to the Ghia coordinates** (never the reverse — Ghia
   points are sparse and non-uniform). Remember the halfway-wall offset: with a moving
   lid implemented on the top boundary row, fluid node j maps to
   y_j = (j − 0.5)/H — get this mapping right before blaming physics for a ~half-cell
   systematic shift.
3. Gates: extrema within ±1.5% (Re=100, 256²) / ±2% (Re=1000, 512²) per
   `docs/VALIDATION.md`; additionally RMS error over all 17 points ≤ 1% of lid speed.
4. Moving-lid BC: prescribed-velocity bounce-back on the lid row
   (`f_ī = f*_i − 6·w_i·ρ·(e_i·u_lid)` for links crossing the lid — the standard
   halfway-BB wall-velocity correction; the corner cells belong to the lid by Ghia's
   convention).
