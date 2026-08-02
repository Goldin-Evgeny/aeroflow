# H3 — D3Q19 CPU reference solver (`Solver3D`): executable specification

> **Handoff doc.** Milestones: M6/M7 (oracle can be built immediately after H1 lands).
> `Solver3D` is the readable, unoptimized, Float64 truth that the esoteric CPU
> implementation (H4) must match bit-for-bit and the 3D WGSL kernels must match via
> the parity panel (H6 §6). Optimize nothing.

## 1. Constants: `packages/core/src/lattice3d.ts`

D3Q19 exactly as `docs/PHYSICS.md` §2 (that table is normative and frozen): rest w=1/3;
axis directions 1–6 w=1/18; diagonal 7–18 w=1/36; `opp(0)=0`, `opp(odd i)=i+1`,
`opp(even i>0)=i−1`. Equilibrium: same formula as 2D (`equilibrium()` generalized to
3D dot products). c_s² = 1/3.

Unit tests (mirror `lattice.test.ts`): Σw=1; Σw·e_α=0; Σw·e_α·e_β = (1/3)δ_αβ;
**Σw·e_α·e_β·e_γ·e_δ = (1/9)(δ_αβδ_γδ + δ_αγδ_βδ + δ_αδδ_βγ)** (the 4th-moment
isotropy identity — D3Q19 satisfies it; a transcription error in the table breaks it,
which is exactly why this test earns its place); opp consistency `e[opp[i]] = −e[i]`;
equilibrium moments conserve (ρ, ρu) to 1e-12.

## 2. `Solver3D` (`packages/core/src/cpu/solver3d.ts`)

- Mirror `Solver2D`'s shape: SoA direction-major `f[i·n + idx]`,
  `idx = x + nx·(y + ny·z)` (**this index convention is frozen — it matches the
  planned WGSL layout in PHYSICS.md §11**), two arrays + swap (naive on purpose),
  pull streaming with halfway bounce-back, equilibrium inlet, zero-gradient outlet
  (upstream copy, one-step lag), Guo/shift forcing, BGK/TRT/LES via the **shared**
  `collideCell()` from H1 §1 — same function object, not a copy.
- **Boundary shell precondition** (same as H4 §2): constructor validates that every
  non-periodic face consists entirely of non-Fluid cells; throw with a clear message
  otherwise. No OOB logic exists in the solver.
- Free-slip: **deferred** (not needed for duct/sphere/esoteric work; the AIJ cases at
  M10 need it — implement then, spec addendum to be written against the M10 case).
  Deviation from the original M6 sketch is deliberate and recorded here.
- Forces: identical link rule as H2 §1 (three components).
- `snapshotPostCollision(): Float64Array` — returns the current source array copy
  (the naive side of H4 §8's comparison).

## 3. The analytic oracle: square-duct Poiseuille

Pressure-/force-driven laminar flow along x in a square duct, side H, no-slip walls:

```
u_x(y, z) = (4·g·H² / (ν·π³)) · Σ_{n odd} (1/n³) · [ 1 − cosh(nπ(z−H/2)/H) / cosh(nπ/2) ] · sin(nπ·y/H)
```

with wall-anchored coordinates y, z ∈ [0, H] (u=0 at all four walls; standard
separation of variables — Shah & London 1978). **Prefactor corrected 2026-07-08 during
implementation**: an earlier revision said 16·g·H²/(νπ³) — that 16 belongs to the
half-width form (16·g·a²/(νπ³), a = H/2); with full-side H the constant is 4. Sanity
anchor: the center velocity evaluates to ≈ 0.2947·g·(H/2)²/ν, matching the standard
square-duct peak factor.

Implementation notes for the test:

- **Overflow-safe cosh ratio** (cosh(t)/cosh(T) overflows Float64 near n≈700·H/π…
  irrelevant at n≤101, but write it safely anyway since someone will raise n):
  `ratio = exp(t−T) · (1 + exp(−2t)) / (1 + exp(−2T))` for t, T ≥ 0, using
  t = nπ|z−H/2|/H, T = nπ/2.
- Truncate at n ≤ 101 (odd only); the series remainder is < 1e-6 relative — far below
  the gate.
- Halfway-wall geometry: with solid shells at lattice rows 0 and ny−1, the duct width
  is H = ny−2 and fluid node j sits at y_j = j − 0.5 ∈ (0, H) (same convention as the
  2D Poiseuille test).

**T-DUCT spec:** nx=4 (periodicX), ny=nz=18 (H=16); solid shell on ±y and ±z faces;
τ=0.8 (ν=0.1), collision 'trt' Λ=3/16, forcing 'guo',
g chosen for a small peak velocity: `g = u_target·ν / (0.2947·(H/2)²)` with
u_target = 0.02 (0.2947 is the standard square-duct peak factor — but do NOT bake the
gate on it; the comparison is pointwise against the series itself). Converge with the
H1 T1 criterion. **Gate: max over all interior fluid nodes of
|u_sim − u_series|/u_peak ≤ 2%** (expect ≲1%: halfway-BB is 2nd order and TRT removes
the τ-slip; the residual is pure discretization of the corner singularity).
Also assert u_y = u_z = 0 to 1e-10 and the 4-fold symmetry of the profile to 1e-12.

Runtime budget: 4·18·18·19·(≈40k steps) ≈ 1.0×10⁹ inner ops — seconds-class in Node;
if it exceeds ~20 s, lower to ny=nz=14 and keep the same gate.

**T-MASS-3D:** closed box (full solid shell), perturbed init, 200 steps, total mass
constant to 1e-12 relative.

**T-FORCE-3D:** per H2 §4 (duct + plate, identity gate 1e-6).

## 4. Order of work

1. `lattice3d.ts` + moment tests (minutes, catches table typos forever).
2. `Solver3D` skeleton + T-MASS-3D.
3. T-DUCT (the physics gate).
4. T-FORCE-3D.
5. Then and only then: H4 (`EsotericPull3D` + bit-identity), then WGSL per H4 §9.

## 5. Pitfalls

1. Index convention drift (`x + nx·(y + ny·z)` vs `z`-major) between CPU and future
   WGSL — frozen above; write the helper once and export it.
2. The 4th-moment test failing = a typo in the direction table (most common: a sign
   in the 13/14 or 17/18 pairs). Fix the table, never the test.
3. Duct series evaluated with y measured from the centerline while the sine expects
   wall-anchored y (formula above is wall-anchored; the cosh term is center-anchored —
   they are different on purpose).
4. Peak-factor 0.2947 used as the oracle instead of the series (it's only for sizing g).
5. Skipping the shell validation and "handling" OOB ad hoc — H4 depends on the shell
   invariant; keep one precondition, not two code paths.
