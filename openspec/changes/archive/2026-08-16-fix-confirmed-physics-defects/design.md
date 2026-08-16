## Context

See `proposal.md` — Why, for motivation, and `specs/` for the requirements.

Three constraints shape the approach:

**Parity is not an oracle here.** The handoff doctrine makes the WGSL a 1:1
transliteration of the CPU reference, and it is faithfully that. All three primary defects
are present in both implementations identically, so `parity3d.ts` passes on every one of
them. Any repair sequence that relies on parity to confirm correctness will confirm
nothing. The oracle must be the spec, an analytic target, or a manufactured input with a
known answer.

**The defects are not independent of the open investigations.** The recorded V11 mechanism
numbers (`ν_LES/ν_mol ≈ 276×` in undisturbed freestream, strain ratio `3.2194`) were
measured with the closure error active and an ill-posed outlet in the scene. The V13/V14
near-ground misses were measured with the height mapping off by a cell. Repairing the
defects therefore invalidates inputs to diagnoses that are currently treated as settled.

**Addendum (2026-08-15): the closure error is not what produces those numbers.** Two
candidate mechanisms are on the table for the freestream sensor firing, and this addendum
records evidence bearing on which — it does **not** settle it.

_Prior art, so this reads as a continuation and not a discovery:_
[D1](../../../docs/decisions/D1-resolution-wall.md) already establishes (2026-08-10) the
`ω⁻ = 1/(½ + Λ/(τ_eff−½))` collapse as `τ₀ → ½`, that it damps the period-2
staggered-momentum mode, and the contamination figures (1.04×10⁻³ at `τ₀ = 0.8` versus
0.519/0.604 at the high-Re rungs); `VALIDATION.md:225` and `M9.md:799` cite it. D1 also
names the **competing** explanation for the same observable — the projected second-order
regularization is anti-dissipative at high wavenumber once `τ₀ → ½` with a mean flow
present, "which also drives the subgrid model to fire on undisturbed freestream" — and
commit `a55f4e1` localizes the Ahmed instability there rather than in the lattice.

_What is added here:_ Task 6.7b ran the 2M Ahmed rung under the corrected
(√2 _smaller_) coefficient and the eddy viscosity went **up** — `ν_LES/ν_mol` p50 548.7 →
703.5, strain `medianRatio` 2.38 → 2.75, `Cd` 1.2045 → 1.3440. A smaller coefficient
producing **more** eddy viscosity is not a rescaling of a fixed field; it is a positive
feedback loop, and both candidate mechanisms predict one — lower `ν_t` lowers `τ_eff`, which
both collapses `ω⁻` further and pushes the regularization deeper into its anti-dissipative
regime. This evidence does not discriminate between them. It does rule out reading 6.7b as
a bookkeeping artifact.

Two supporting observations, also non-discriminating but worth having on the record:

- At the acceptance point the fixed `Λ = 3/16` (`collide.ts:411`,
  `stream_collide_3d.wgsl:391`, `lbm3d.ts:556` — defaulted, never overridden by any scene or
  harness) gives `ω⁺ ≈ 1.995` against `ω⁻ ≈ 6.6×10⁻³`: symmetric sector at the stability
  limit, antisymmetric sector effectively unrelaxed. `bands.ts:51` records this operator as
  validated "τ-independent over [0.51, 1.5]"; the acceptance run is at `τ₀ = 0.5000042`,
  three and a half orders below that bound. `ω⁻` is derived, never reported — no run file
  carries it.
- The §3.8 strain audit of `2026-08-14-1121-m9-closure-target` gives a directional
  fingerprint not previously extracted: the two shear components carrying an x-derivative
  are over-reported 3.40×/3.43× with **99.4%** of their energy at 2–4 cell wavelength, while
  `yz` — the one with no x-derivative — has slope 1.16 and 0.5%. That is a 2-cell
  _streamwise_ oscillation in the transverse velocities, the spatial form of the same
  period-2 mode D1 already ties to `ω⁻`.

**Neither is a test.** Discriminating requires making `ω⁻` an independent variable (freed
from `Λ`) and sweeping it with the regularization held fixed, on the empty tunnel where
freestream strain is analytically zero. Recorded here because it bounds what this change can
claim; repairing it is out of scope — see Non-Goals.

**Two of the three repairs move numbers in opposite directions from stability.** The
closure fix _removes_ 19–41% of the eddy viscosity, at an operating point (`τ₀ = 0.5000042`)
where the subgrid model supplies essentially all of it, and in a suite where V5 requires the
model to avoid divergence outright. The repair could destabilize cases that currently run.

## Goals / Non-Goals

**Goals:**

- Repair the three confirmed defects without losing the ability to reproduce any previously
  recorded number.
- Make the class of defect detectable going forward: spec-derived oracles rather than
  self-referential tests, and validation applied on every execution path.
- Give the validation suite one authoritative statement of what each case must achieve and
  whether it is enforced.
- Sequence so that each moved number is attributable to exactly one cause.

**Non-Goals:**

- Repairing the documented open failures (V2, V8–V15) or the open mechanisms
  (regularization anti-dissipation, the `Π^neq` strain sensor, the Q27 deferral). This change
  clears the ground they are diagnosed on; it does not diagnose them.
- Unblocking regularization-with-forcing. Correctly guarded, documented in H10 §O1, and
  needs a force-aware projection — a design task of its own.
- Any migration of the WGSL authoring model. See the proposal's scope note; the `.wgsl`
  files are normative artifacts reviewed as transliterations, and changing what a reviewer
  reads is not something to bundle with a change whose numbers are already moving.
- Raising `Cs` to compensate if the closure fix destabilizes a case. That would reintroduce
  the same error under a different name.

## Decisions

### D1. The closure correction lands behind a two-valued convention flag, defaulting to legacy

**Chosen:** add an explicit convention selector, default it to the legacy (current)
behaviour, A/B the specified behaviour on a stability canary and a representative
acceptance rung, then flip the default and re-baseline.

**Alternative — correct it outright in one commit.** Cleaner history, but it conflates two
questions: "is the corrected closure right?" and "does the suite survive it?" With the
default flipped on landing, a destabilized V5 arrives as a broken build rather than as a
measurement, and every historical number becomes unreproducible at exactly the moment
comparison is most needed.

**Alternative — amend the documentation to match the code.** Rejected on evidence. An
independent derivation from `ν_t = Cs²|S|`, `|S| = √(2S:S)`, `S_αβ = −3Π_αβ/(2ρτ_eff)`
reproduces the documented `18√2` paired with the Frobenius norm. The documentation is
right; the code is wrong. Amending the doc would codify the error.

The flag is documented as an error preserved for reproducibility, not as a modelling
option, and is removed once every affected case is re-baselined.

### D2. The closure inversion is corrected in the same commit as the norm

`analysis/strainComparison.ts` recovers a strain rate from an observed `τ_eff`. Its current
inversion is tuned to the buggy convention and returns the correct strain under it. Change
the norm alone and the reported strain-audit ratio moves by `√2` for a purely bookkeeping
reason — which would look like the V11 mechanism diagnosis shifting.

Binding the two together, and asserting the round-trip is the identity under both
conventions, makes the audit invariant to the convention change. That invariance is the
evidence that the mechanism diagnosis survives the repair, and it is worth more than the
individual numbers.

### D3. Scene legality is enforced by extending the existing validators, not by a new mechanism

`cpu/esoteric.ts` already rejects an outlet with a solid upstream neighbour (H4 §10.9) and
`cpu/freeslip.ts` one with a free-slip upstream neighbour (H11 §3.2). "Upstream neighbour on
a domain face" is a third case of the same rule — the source population does not exist —
and belongs in the same place, with the same error shape.

`Lbm3D` calls none of these today; its comments delegate to the caller, and some callers
comply while `aijCaseA.ts:171` does not. Moving the call into `uploadFlags` makes compliance
structural rather than conventional.

### D4. Accelerated code signals unresolvable state with a sentinel, not by returning storage

WGSL cannot raise. Where the CPU reference throws, the kernel writes a non-finite sentinel
that `fieldStats` already detects and the run already surfaces. This reuses the existing
detection path rather than adding a second error channel, and it converts three silent
failure modes — the free-slip fallthrough, the singular Q27 pivot, and the NaN-density cell
reported as zero velocity — into loud ones.

The alternative, an error-flag buffer read back per step, costs a readback in the step loop
for a condition that should never occur. Rejected on that basis.

### D5. Acceptance bands become a typed ledger with a `gated | recording` status

**Chosen:** `packages/core/src/validation/bands.ts`, one entry per case carrying quantity,
band, source citation, and status. `validation/` already holds `cavity.ts`, `score.ts`,
`aijCaseA.ts`, so this is the established home.

The `status` field is what reconciles two requirements that otherwise conflict: physics
verdicts should be enforced, and CI should not be permanently red while known failures are
being repaired. A case is `recording` while broken and flips to `gated` in the same commit
that revalidates it. A meta-test asserting every `gated` entry is actually asserted
somewhere prevents silent regression back to record-only.

**Alternative — assert every band immediately.** The suite would go red on landing and stay
red through the entire repair, which trains everyone to ignore it.

### D6. Sequencing: non-perturbing first, then one perturbing change at a time

Phases run: infrastructure and observability (moves nothing) → outlet legality → closure →
height mapping → re-measurement. Each perturbing phase is A/B'd against the phase before it.

The reason is attribution. Three simultaneous repairs produce one number change and no way
to apportion it, on a suite where several cases are already failing for unknown reasons.
V7 (sphere Re=100) is the useful control throughout — it passes today, so any movement in
it is a clean read of a repair's magnitude rather than a mixture with an existing failure.

### D7. Two normative behaviours are checked against the specification, not assumed

The out-of-bounds storage read in the outlet defect, and the f16 rounding behaviour behind
the ineffective conservation correction, both turn on what the platform is _required_ to do.
Whether the GPU-side wrong value is deterministic decides whether pre-fix Ahmed runs are
reproducible at all. These get checked against the WebGPU/WGSL specifications rather than
inferred from observed behaviour on one adapter.

### D8. A resilience check partitions the sample stream at each recovery

**Chosen:** partition the sample stream at each `recovered` event; assert strict monotonicity
within each segment, forward progress across each boundary, and
`recovered.totalSteps === checkpoint.totalSteps`.

A checkpoint/restore cycle rewinds the step counter by construction — that is what restoring
_is_. A global strict-monotonicity assertion over a window containing two deliberately
induced restores asserts the negation of the behaviour under test, and does so flakily, since
it only trips when a sample happens to land in the sub-second window between the checkpoint
and the induced loss.

Segmenting states the real contract, and is strictly stronger than what it replaces: it adds
the no-data-loss invariant (the rewind never exceeds the checkpoint), which the current
assertion never expressed.

**Alternative — filter by index rather than value.** Fixes the mis-scoped filter but still
spans both cycles, so the induced rollback remains inside the asserted window.

**Alternative — demote to a recorded observation,** as the aged cycle already does for its own
failures. Consistent with the file, but discards a real invariant that is cheap to state
correctly.

**Alternative — suppress duplicate samples in the worker.** Rejected: it hides genuine
regressions at the producer, and the replayed steps are real work, not a reporting artifact.

## Risks / Trade-offs

**The closure fix destabilizes V5, or the near-floor acceptance runs.** → A/B before
flipping the default, with V5 as the designated canary. If it destabilizes, that is a
finding worth recording — it would mean V5's stability rested on a 19% error — and it goes
into `docs/VALIDATION.md` as such. Do not compensate by raising `Cs`.

**Realized, 2026-08-14 (task 6.9).** V5/V6 held, but `les.test.ts` (Re=1000, CPU) and then
`pressureOutlet3d.test.ts` (τ₀ = 0.5000005, the actual acceptance operating point) went
non-finite under `'spec'`; the flip was reverted twice. The risk was stated correctly, but
"V5's stability rested on a 19% error" understates what the near-floor cases lean on: the
eddy viscosity is what holds `τ_eff` off the floor, and everything that degrades as
`τ₀ → ½` — `ω⁻`'s collapse (D1) and the regularization's anti-dissipation (`a55f4e1`) —
degrades further when `ν_t` is reduced. Which of those the Smagorinsky term is actually
propping up is **not** established here; both are consistent with the two reverts. This
supports 6.9's conclusion that the repair belongs in the collision operator without
identifying which part. Still do not compensate by raising `Cs` — that buys the same crutch
under a third name.

**The repairs do not move V11 materially.** → Likely, and not a failure of this change. A
19% viscosity correction does not close a 3.2× drag error, and the change does not claim it
will. The value is that subsequent investigation measures a clean signal. The mechanism
work is explicitly out of scope.

**Re-baselining costs substantial GPU time on a single reference machine.** → Sequence so
each phase's A/B is the smallest scene that can show the effect (2M rung, not 15.7M), and
reserve full-ladder runs for after the last perturbing phase.

**The height fix changes V13/V14 enough to invalidate the D1-resolution-wall analysis.** →
That analysis concluded the V14 failure is not probe-height resolution and that the next
step should not be adding cells. A one-cell mapping offset is a different claim — the probe
is at the wrong height, not under-resolved — and is consistent with that conclusion rather
than contradicting it. Record the re-scored result against the original either way.

**Removing the legacy convention flag too early strands historical numbers.** → Removal is
gated on every affected case being re-baselined, and the ledger's per-result convention
field makes the remaining set enumerable.

**The `gated | recording` field becomes a place to park failures indefinitely.** → The
ledger reports its own gated/recording counts, so the ratio is visible rather than buried in
per-harness code.

## Migration Plan

1. Ledger and CPU regression gates land first; nothing moves.
2. Observability and validation wiring land; nothing moves, but ill-posed scenes now fail.
3. Outlet legality: A/B on V7 and the 2M Ahmed rung, record both columns, then re-baseline
   the sphere and Ahmed entries.
4. Closure: land flagged at legacy, A/B on V5/V6/V7 and the 2M rung, flip the default only
   if V5 and V6 hold, then re-baseline every `Cs=0.1` entry.
5. Height mapping: fix all consumers together, re-run V12, rescore V13 at both resolutions.
6. Re-measure the V11 τ_eff readback and strain audit on the corrected solver; promote cases
   to `gated` individually as they revalidate.

**Rollback:** each perturbing phase is independently revertible, and the closure phase is
revertible by configuration alone until the legacy convention is removed.
