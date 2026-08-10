# Deferred solver stabilization

## Status

Deferred after M9. This specification records a trigger and evidence boundary; it is not an
approved production migration or a solution design.

## Trigger

Reopen solver-stabilization work only if the remaining M10/M11 validation work demonstrates
that the current production D3Q19 operator has no defensible operating envelope for the M12
mean-velocity product:

1. run the converged GPU empty-domain fetch gate;
2. rerun 24-cells/building AIJ Case A using |⟨u⟩| semantics;
3. perform the wind-dial and α 0.25→0.15 manual check; and
4. assess those results together with the existing M11 urban evidence.

An Ahmed force-validation failure alone does not satisfy this trigger. Nor does a single
urban failure without evidence that no bounded production configuration remains defensible.

## What the deferred problem is

The production D3Q19 operator's **projected second-order regularization is anti-dissipative
at high wavenumber once τ₀ → ½ and a mean flow is present** — gain 1.004405 per step at
λ ≈ 2.65 cells at the Ahmed operating point, stable everywhere at u = 0, strongly damped at
τ = 0.8. Π^neq over-reports strain 2.06× in the same band, which drives Smagorinsky to fire
on undisturbed freestream. This is a property of that collision at that operating point,
measured on D3Q19; **no D3Q27 comparison at the same τ₀ exists in the evidence set**, so it
is not a demonstrated property of the lattice.

The in-lattice fix was tried and failed: **RR3** — the D3Q19-supported third-order
equilibrium with recursively reconstructed nonequilibrium Hermite moments, the intervention
the mechanism itself points at — misses both predeclared gates (`targetDamped`,
`targetConstitutive`) at λ = 3.2. That negative result is why an alternative operator is
carried forward at all.

## Candidate carried forward

The D3Q27 central-moment collision path, preserved because it **damps the mode the in-lattice
fix could not**: gain 0.99731 at λ = 3.2 against 1.00249 for the production operator, at a
comparable constitutive ratio (Π/Π_hydro 1.504 vs 1.527). CPU eigen, nonlinear and
production tests pass; the GPU transliteration matches the CPU authority to 3.822×10⁻⁶
relative on populations. Streaming is exact.

## Blocking evidence, and why it may not be a defect

The real-GPU periodic momentum gate fails at mode λ16 after 120 steps: **7.678×10⁻⁵** against
a **5×10⁻⁵** limit, concentrated in P_z. The audit shows streaming contributes exactly zero
(it is a permutation) and collision contributes all of it.

That gate is **unnormalized**, which the artifact itself records. The harness is 64 cells in
1-D with total |p| = 3.2, so 5×10⁻⁵ absolute is a **1.6×10⁻⁵ relative** bar for an f32 kernel
over 120 steps — roughly 1.7 f32 eps per step of linear accumulation. P_z is identically zero
by symmetry in that harness, so f32 reconstruction summing mirror directions in different
orders is the natural explanation.

The disposition is therefore **not yet demonstrated correct**, not **demonstrated broken**.
Before any migration decision, and independently of the trigger above:

1. normalize the momentum gate (relative to total momentum, or to the base flow); and
2. test whether the drift grows linearly in steps (rounding) or superlinearly (a mode) by
   re-running the same case at 2× and 4× the step count.

Neither has been run. Until they are, no claim about a Q27 port defect is supported.

## Non-goals

- Do not migrate production to D3Q27 under this deferred item.
- Do not weaken the momentum tolerance or the existing validation gates.
- Do not select, tune, or prescribe a stabilization technique before the trigger is met.
- Do not claim that D3Q19 is universally invalid or that existing urban means are
  contaminated without case-specific evidence.
- Do not attribute the measured instability to the lattice. It is the regularized-TRT
  collision at τ₀ → ½ with a mean flow, measured on D3Q19.
- Do not discard the Q27 sources, tests, or artifacts while the item is deferred.
