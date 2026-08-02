# H2 — Momentum-exchange forces + GPU reduction: executable specification

> **Handoff doc.** Milestones: M4 (2D), M7 (3D). Reference: Mei, Yu, Shyy & Luo,
> Phys. Rev. E 65:041203 (2002); PHYSICS.md §8. This spec pins the two places
> implementations classically go wrong: **which direction indexes the link** and
> **where the factor 2 comes from** — then gives the exact GPU reduction design.

## 1. The link rule inside the pull loop (normative)

Context: the pull-scheme gather (identical in `solver2d.ts`, `solver3d.ts`,
`esoteric.ts`, and the WGSL kernels). For fluid cell `x`, gathering direction `i`,
upwind neighbor `n = x − e_i`:

- If `flags[n] == Solid`, the gather is a bounce: `f_i^in(x) = f*_ī(x, t)` where
  `ī = opp(i)` (the cell's own previous post-collision opposite population).
- **The physical boundary link is (fluid cell x, direction ī):** `e_ī = −e_i` points
  FROM x INTO the solid at `x + e_ī = x − e_i = n`. Getting this backwards flips the
  force sign pattern on diagonal links (symptom: drag roughly right, lift garbage).
- **Link contribution to the force ON the solid:**

  ```
  F_link = 2 · e_ī · f*_ī(x, t)        // = −2 · e_i · (the value you just bounced)
  ```

  In code, at the moment the bounce branch runs you already hold
  `bounced = fSrc[ī·n + idx]`; accumulate `Fx += 2·ex[ī]·bounced; Fy += 2·ey[ī]·bounced`.

**Where the 2 comes from:** the wall receives the incoming population's momentum
`e_ī·f*_ī` AND emits the reflected population carrying `e_i·f_i = −e_ī·(same value)`
(halfway bounce-back reflects the value unchanged for stationary walls); the transfer
is the difference: `e_ī·f − (−e_ī·f) = 2·e_ī·f`. General (moving-wall) form is
`e_ī·(f*_ī + f_i^{after})` per PHYSICS.md §8; it degenerates to the factor 2 only for
stationary walls. When rotating geometry ever lands, the factor 2 shortcut is the
first thing to revisit (plus Galilean corrections, Wen et al. 2015).

## 2. Scope and masks

- Accumulate per step into `force = {x, y(, z)}` counting **only links whose upwind
  cell is flag-Solid** (domain-edge bounces on non-periodic borders have no solid cell
  and are wall forces of the virtual boundary — excluded by construction; keep test
  domains with explicit solid shells so nothing is ambiguous).
- Optional `forceMask?: Uint8Array` (per-cell, 1 = measured obstacle): maintain a
  second accumulator `maskedForce` counting only links whose solid cell has mask 1.
  This is how Cd of the cylinder is separated from channel-wall drag.
- Timing convention: the force reported for step t uses `f*(·, t−1)` values gathered
  during step t (one consistent convention everywhere; document it in the JSDoc — the
  identity test below is sensitive to double-counting, not to the half-step offset).
- Coefficients (2D, lattice units, ρ0=1): `Cd = Fx / (½·ρ0·U²·D)`, `Cl = Fy / (½·ρ0·U²·D)`
  with D = obstacle diameter in cells, U = inflow lattice velocity. 3D: divide by
  frontal area A instead of D.

## 3. Esoteric-pull compatibility

The rule is unchanged: the bounce branches in H4 §3.1/§3.2 each yield a `bounced`
value; contribute `2·e_ī·bounced` identically on EVEN and ODD steps. (The scratch-slot
mechanics change WHERE the value is read from, not what it is.)

## 4. The identity test (machine-precision oracle, no literature needed)

**T-FORCE — global momentum balance in a forced channel with an obstacle.**

Setup: nx=16, ny=18, periodicX; solid rows y=0, y=17; solid plate cells
{x=8, y=5…12} with `forceMask=1` on the plate; g=[1e-6, 0], forcing **'guo'**
(mandatory — the identity is exact only under Guo, per the derivation in H1 §4),
collision 'trt', τ=0.8, LES off. Run to convergence (|Δu_center| criterion, H1 T1).

At steady state, the fluid's momentum is constant, and every update injects exactly
`ρg` per fluid cell (H1 §4 bookkeeping). The only momentum sink is bounce-back links.
Therefore:

```
F_total_x  (walls + plate, unmasked accumulator)  ==  g · Σ_fluid ρ
```

**Gate: relative error ≤ 1e-6** (expect ~1e-9…1e-12 in Float64; the slack is only for
convergence residue). Also assert: `maskedForce_x > 0` (plate feels drag),
`|F_total_y| ≤ 1e-12 · F_total_x` (symmetry).

Why this test is precious: it validates the link rule, the factor 2, the mask
plumbing, AND the forcing bookkeeping **without any tolerance judgment** — any of the
classic bugs (§6) moves the balance by percent-level or worse, orders of magnitude
above the gate.

**T-FORCE-3D**: same construction in `solver3d` (duct + plate), same gate.

## 4a. The staggered momentum mode (measured 2026-07-08 — read before trusting any force)

When the CPU oracle was built, T-FORCE initially failed at 1.04e-3 relative — fully
converged, exact per-cell injection, exact ledger. Cause: **forced flows with
bounce-back settle into an exact period-2 limit cycle** (a non-hydrodynamic
"staggered" LBM eigenmode excited by the impulsive force start and undamped by
bounce-back). The instantaneous wall force alternates ±~5e-7 (±0.1% here) around the
true value **every step, forever**; the two-step average equals M·g to ~2.6e-12.

Rules derived from this:

- **All reported forces are two-consecutive-step averages.** The identity test does
  this explicitly; solver users must too (a `forceAveraged()` helper is a good idea
  when the GPU force plumbing lands).
- Convergence detectors comparing same-parity samples (every 500 steps, etc.) will
  report "converged" while the cycle persists — that is fine for detecting the cycle
  amplitude's envelope, but never compare single-step forces across parities.
- For unsteady runs (cylinder Cl/Cd series): the mode sits at the Nyquist frequency
  (period 2), far from any shedding frequency — pair-averaging each sample removes it
  cleanly and MUST be applied before the H7 frequency extraction.
- The negative-control assertion in the test (single-step reading must be ≳1e-5 off)
  intentionally documents the mode; if it ever starts "passing" single-step, something
  changed the mode's damping — investigate before celebrating.

## 5. GPU design: partial sums without f32 atomics (M4 WGSL)

WebGPU has no f32 atomics; do a two-stage reduction:

**Stage A — inside the step kernel** (avoid a separate pass; the values are in registers):

```wgsl
var<workgroup> wgForce: array<vec2f, 64>;          // one slot per invocation
// ...each invocation accumulates its own cell's link contributions into `myForce`...
wgForce[local_id.x] = myForce;
workgroupBarrier();
// tree-reduce 64 → 1 (strides 32,16,8,4,2,1 with barriers)
if (local_id.x == 0u) { partials[workgroup_id.x] = wgForce[0]; }
```

- `partials: array<vec2f>` storage buffer, length = workgroup count
  (1024×512 grid / 64 = 8192 entries = 64 KiB).
- Force accumulation happens only when a `collectForces: u32` uniform is 1 (skip the
  barrier cost otherwise); the host enables it on sampled steps (e.g. every batch's
  last step) — Cd statistics don't need every step at 17k steps/s.

**Stage B — reduce kernel**: one workgroup of 256 invocations strides over `partials`
summing into shared memory, tree-reduces, writes one `vec2f` to a 8-byte result
buffer. (Alternative — summing 8192 floats on the CPU after readback — is acceptable
for M4 and simpler; choose it if the reduce kernel stalls progress. Determinism note:
either way, float summation order differs from CPU order, so compare force values to
CPU within 1e-4 relative, not bitwise, in the parity panel.)

**Readback protocol**: copy result buffer → staging buffer (`MAP_READ | COPY_DST`) in
the same encoder; `mapAsync` after submit; never map buffers used by in-flight passes.
Double-buffer staging if sampling every batch.

## 6. Pitfalls

1. Using `e_i` instead of `e_ī` in the contribution (sign/direction — lift garbage,
   §1).
2. Factor 2 dropped (Cd low by ~2×) or applied twice (high by ~2×) — T-FORCE catches
   both instantly.
3. Counting domain-edge (non-solid) bounces into the obstacle force.
4. Accumulating force from Inlet/Outlet neighbors (they are not Solid; the gather
   there is not a bounce — if your code bounces on them, the flags handling is wrong
   upstream of forces).
5. GPU: missing `workgroupBarrier()` between store and tree-reduce strides; or
   reducing with `local_id` divergence (guard each stride with `if (local < stride)`).
6. GPU: reading `partials` on the CPU while the next batch is already writing it
   (use a copied staging snapshot, §5).
7. Comparing GPU force bitwise to CPU (different summation order — use 1e-4 relative;
   this is a float-order artifact, not a physics error; the parity panel's per-cell f
   comparison is the strict check).
8. Reporting Cd with U = current slider value while the force series was collected at
   an older U (bind the normalization to the run, not the widget).

## References

- Mei, Yu, Shyy & Luo 2002, Phys. Rev. E 65:041203 (momentum exchange, incl. why
  stress integration is discouraged).
- Wen et al. 2015 review (Galilean corrections for moving boundaries — future).
- PHYSICS.md §8; H1 §4 (the exactness derivation the identity test relies on).
