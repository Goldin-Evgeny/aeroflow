# H12 — Flux-imposing velocity inlet (extrapolated-density equilibrium)

> **Handoff doc.** Milestone: M10 (unblocks acceptance 3, the 5% fetch gate). Companion
> to H11; assumes H4 §§3–6 (parity rules, slot ownership, the outlet snapshot pre-pass).
> Correctness criteria: the bit-identity test (§5) and the fetch gate in
> `packages/core/test/abl-fetch.test.ts` flipping from `it.fails` to green.

## 1. Why (measured, 2026-07-18)

The plain equilibrium inlet (`CellType.Inlet`, H4 §3.4) emits `f^eq(ρ=1, u_in)` and is
NOT a velocity BC: only the populations it sends carry `u_in`, and a standing density
discontinuity at the interface can absorb any momentum mismatch. Measured on a
frictionless all-free-slip duct fed from rest: the flow settles at **u = 0.660·u_in
with interior ρ = 1.030**, dead flat and steady; with a no-slip ground, friction drags
long runs to the same sagged attractor (~0.61·u_in at 12k steps). The M7 sphere/Ahmed
scenes never see this because their freestream-Inlet lateral far field pins `u`
everywhere; an ABL scene with free-slip far field (H11) has no such anchor.

## 2. The rule

New cell type `CellType.VelocityInlet` (= 5), allowed ONLY on the x = 0 face, its +x
neighbor REQUIRED to be Fluid (validated at construction; scenes keep corners/edges as
plain Inlet or FreeSlip). Per step:

> `f_i^out(x, t) = f_i^eq(ρ_up(t−1), u = (u_in(z), 0, 0))` for all i, written with the
> current parity's standard write rules — where `ρ_up(t−1) = Σ_i f_i^out(nb, t−1)` is
> the PREVIOUS step's post-collision density of the +x fluid neighbor `nb`.

This is the classic zero-gradient-density velocity inlet: prescribing `u_in` at the
interior's own density removes the interface density jump the sag lives on, so the
momentum-flux balance forces `u → u_in`. `u_in(z)` comes from `inletProfile` /
`inletVelocity` exactly as for plain Inlet cells.

## 3. Naive solver

During the sweep, a VelocityInlet cell sums `ρ_up = Σ_i fSrc[i][nb]` in direction order
i = 0..18 (`fSrc` is the immutable previous post-collision state — no pre-pass needed)
and writes `f^eq(ρ_up, u_in)` to `fDst`. Nothing else changes.

## 4. Esoteric Pull — snapshot pre-pass required

Reading the neighbor's 19 populations mid-sweep violates slot ownership at EVEN parity
(slot `(nb, a)` is owned — read AND written — by `nb + e_a` during the sweep): exactly
the outlet problem, with the same cure (H4 §3.5). The existing outlet snapshot pre-pass
is extended: before the sweep, for every VelocityInlet cell, gather the neighbor's
previous post-collision populations via the H4 §7 parity mapping —

- current step EVEN (previous ODD → canonical): `f_i^out(nb) = A[nb][i]`;
- current step ODD (previous EVEN): `f_0 = A[nb][0]`; per pair `f_a = A[nb+e_a][b]`,
  `f_b = A[nb−e_a][a]` —

and store `ρ_up = Σ_i f_i` (sum in direction order i = 0..18, so the Float64 sum is
bit-identical to the naive solver's). During the sweep the VelocityInlet cell emits
`f^eq(ρ_snap, u_in)` with the standard parity writes (same code path as Inlet).

Ownership: pre-pass reads complete before any sweep write — safe by construction, the
same argument as the outlet snapshot. The +x neighbor of an x=0-face cell always exists
and is Fluid (validated), so the pair-mapped reads never leave the domain.

## 5. Gates

1. Bit-identity (H4 §8 protocol): a scene with VelocityInlet (sheared profile) + free-
   slip + solids, ≥100 steps, Float64-exact, forces included.
2. Flux imposition: the frictionless-duct case of `abl-fetch.test.ts` driven by
   VelocityInlet from rest converges to `u_in` (the plain-Inlet control stays at 0.66).
3. The 5% fetch gate flips from `it.fails` to green using VelocityInlet.
4. No regression: plain `Inlet` semantics are UNTOUCHED (M2–M9 validated numbers depend
   on them); VelocityInlet is strictly additive.

## 6. WGSL port (deferred; parity line required per CLAUDE.md rule 0)

The snapshot pre-kernel already exists for outlets; extend it to write a per-cell ρ
side buffer for VelocityInlet cells, and add the cell-type branch in the main kernel.
Sync the new CellType constant by hand and note the pairing.

## 7. Pitfalls

1. **Changing plain Inlet instead of adding a type** — silently invalidates every
   validated Cd number from M2–M9. VelocityInlet is a new type; scenes opt in.
2. **Summing ρ in a different direction order** on the two paths — breaks bit-identity
   through float non-associativity even though the values are identical.
3. **Reading the neighbor mid-sweep in the esoteric path** — order-dependent corruption
   at EVEN parity; the pre-pass is mandatory (§4).
4. **VelocityInlet off the x=0 face or with a non-Fluid neighbor** — rejected at
   construction; corners stay plain Inlet/FreeSlip.
5. **The ρ feedback loop** (inlet emits ρ_up which influences ρ_up) is one-step damped
   and standard; if instability is ever suspected, check τ/regularization first — the
   BC itself is the textbook zero-gradient-ρ velocity inlet.

## 8. Status

Derived and implemented CPU-side 2026-07-18 (naive + esoteric + gates 1–4). WGSL landed
2026-07-19 per §6 (`ABL` variant: snapshot pass extended with the per-column ρ side
buffer, direction-order sum; `Lbm3D` `inletProfile`/`velocityInlet` opts): Float64
kernel emulation matches `EsotericPull3D` <1e-6, `?parity3d` v9-abl ABL config PASSES
on SwiftShader — rho=2.13e-6 u=5.81e-6 (bar 5e-5), force=1.54e-6 (bar 1e-4). Ampere
re-run recommended next browser session.
