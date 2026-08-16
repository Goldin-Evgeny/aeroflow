## Why

An audit of the solver against its own normative specs found three defects that no
existing test or parity gate can detect, because **CPU/GPU parity is not a correctness
oracle**: the WGSL is a faithful 1:1 transliteration of the CPU reference, including
where the CPU reference departs from `docs/PHYSICS.md`. Parity passes; the physics is
still wrong. The oracle that caught these was the spec, not the other implementation.

All three sit directly upstream of the measurements currently being used to diagnose the
open validation failures (V11 Ahmed, V13/V14 AIJ, the LES-sensor mechanism). Until they
are cleared, further investigation of those failures is measuring a contaminated signal.

## What Changes

**BREAKING (physics numbers move; every affected case is re-baselined, not re-gated):**

- **Smagorinsky subgrid term is √2 too large.** `docs/PHYSICS.md:290-298` specifies
  `τ_t = ½(√(τ₀² + 18√2·Cs²·Π̄/ρ) − τ₀)` with `Π̄` the Frobenius norm
  `√(Σ_αβ Π_αβ²)`. `packages/core/src/cpu/collide.ts:111-115` returns `√(2·Π:Π)` =
  `√2·Π̄` and pairs it with `lesK = 18√2·Cs²` (`collide.ts:180`), so the kernel evaluates
  `36·Cs²·Π̄`. Effective `Cs = 0.119`, not `0.1`; `ν_t` high by 19% at the `τ₀→½`
  operating point and 41% in the small-`τ_t` limit. Replicated identically in
  `stream_collide_3d.wgsl:329-331`, `lbm2d.wgsl:220`, `centralMomentD3Q27.ts:169-170`,
  and re-declared locally in two test files — so **the tests assert the code against
  itself**. Lands behind a `lesNorm: 'spec' | 'legacy'` flag defaulting to `legacy`,
  A/B'd, then flipped.

- **Outlet cells sit on domain faces in the V11 acceptance configuration.**
  `scenes/ahmed3d.ts:296-299` (`'freestream'`, which is `AHMED_ACCEPTANCE_LATERAL_BC`)
  writes Outlet over the full `z` range; the `'freeslip'` arm immediately above is
  strictly interior _with a comment stating why that is required_. Same split in
  `scenes/sphere3d.ts:182-195`. The odd-parity outlet snapshot then reads a population
  `EsotericPull3D.scatter` never wrote, and CPU and GPU invent **different** wrong
  values (CPU silently reads a wrapped cell in the wrong direction plane; GPU relies on
  out-of-bounds robustness).

- **Near-ground height mapping is off by a full cell.** `abl.ts:71`,
  `scenes/aijCaseA.ts:248` and `validation/aijCaseA.ts:193-194` mutually agree that
  lattice row `y` sits at `(y+0.5)·dx`, but the ground is Solid at `y=0` and halfway
  bounce-back puts the wall plane at `y=0.5`, making the true height `(y−0.5)·dx`. The
  first fluid node is prescribed `u(1.5·dx)`, and an AIJ probe at `z=0.01 m`,
  `dx=5 mm` lands at 5 mm rather than 10 mm — precisely where V13's misses concentrate
  and where V14 fails with an explicitly unknown mechanism.

**Non-breaking correctness and observability:**

- `Lbm3D` calls none of `EsotericPull3D.validate` / `validateShell` / `validateFreeSlip`,
  so the GPU runs scene configurations the CPU refuses at construction.
- GPU `freeSlipRead` (`stream_collide_3d.wgsl:267-287`) drops both `throw` paths of
  `cpu/freeslip.ts:54-78` and falls through to a passive shell cell's scratch, silently.
- The Q27 GPU authority drops the CPU's `|pivot| < 1e-14` singular-basis guard in f32,
  where conditioning is worst.
- `CONSERVE_MASS` is a no-op under `STORAGE_FP16` — the `~1e-7` correction is quantized
  away by the next `f16` store, so `massDriftRel` reports on a knob that does nothing.
- `write_macro` reports `u = 0` for a NaN-`rho` cell, so velocity-only reducers see a
  clean zero rather than a diverged cell.
- `PRESSURE_OUTLET` drops the Guo shift that `cpu/outlet3d.ts:20-25` applies (latent);
  moving-wall momentum exchange omits the Ladd term; `PHYSICS.md` §6 is stale on both
  the forcing scheme and `Solver2D.macroscopics()`.
- `parity3d.ts` gates only TRT at `τ=0.8` with interior outlets, which is why none of
  the above was visible to it.

**Verification infrastructure:**

- A single machine-readable acceptance-band ledger replaces the current duplication:
  `AHMED_CD_BAND` at `ahmedRun.ts:428` is re-typed verbatim as `CD_BAND` at
  `m9-closure.gpu.spec.ts:110`, and every other band exists only as prose in
  `docs/VALIDATION.md`.
- Each case carries `status: 'gated' | 'recording'`, so a case flips to a hard assertion
  in the same commit that revalidates it and CI never goes permanently red.
- The M9 closure harness's recovery check asserts global step monotonicity across a window
  containing its own induced checkpoint restores, producing a flaky `INFRA` failure that is
  a harness defect rather than a run outcome.

## Capabilities

### New Capabilities

- `les-subgrid-closure`: the Smagorinsky closure convention — which tensor norm pairs
  with which coefficient, how `τ_eff` is derived, and how any diagnostic that inverts
  the closure stays consistent with it.
- `scene-boundary-legality`: which boundary-cell configurations are well-posed under
  Esoteric Pull, validated at scene construction and before GPU upload rather than
  discovered as silent wrong values.
- `wall-height-convention`: the mapping between lattice row index and physical height
  under halfway bounce-back, and its use by inlet profiles and probe placement.
- `solver-failure-visibility`: the solver must fail loudly rather than plausibly —
  undefined state must not be reported as a finite, in-range value.
- `acceptance-band-ledger`: one authoritative machine-readable source for every
  validation case's acceptance band and gate status.

### Modified Capabilities

None. `openspec/specs/` is currently empty.

## Impact

**Core solver:** `packages/core/src/cpu/collide.ts` (norm and `lesK`),
`cpu/esoteric.ts` and `cpu/freeslip.ts` (new outlet validator),
`scenes/ahmed3d.ts`, `scenes/sphere3d.ts` (outlet extents), `abl.ts`,
`scenes/aijCaseA.ts`, `validation/aijCaseA.ts` (height mapping — must move as one unit),
`analysis/strainComparison.ts:298` (closure inversion, coupled to the norm change),
`cpu/centralMomentD3Q27.ts`.

**GPU:** `shaders/stream_collide_3d.wgsl`, `shaders/lbm2d.wgsl`,
`shaders/central_moment_d3q27_periodic.wgsl`, `sim/lbm3d.ts`, `sim/parity3d.ts`.
Every commit touching a `.wgsl` file carries a parity-panel result line per the handoff
doctrine.

**New:** `packages/core/src/validation/bands.ts`, exported via `packages/core/src/index.ts`.

**Docs:** `docs/PHYSICS.md` §6 (stale forcing text), §7.1 (height convention),
`docs/VALIDATION.md` (line 124 claims "V1–V6 … all measured in band", contradicting the
recorded V2 FAIL; plus re-baselined entries).

**Tests:** `tauStats.test.ts:99` and `centralMomentEigenProof.test.ts:1206,1857`
re-declare the LES constant locally and must import it instead.

**Recorded results invalidated:** every LES run at `Cs=0.1` (V5, V6, V11, V13, V14) by
the norm fix; sphere and Ahmed numbers by the outlet fix; V12/V13/V14 by the height fix.

**Explicitly out of scope:** the regularization-plus-forcing throw
(`collide.ts:190`) is correctly guarded and documented in H10 §O1 — unblocking it needs
a force-aware projection, which is a design task, not a defect repair.

**No new runtime dependencies.**
