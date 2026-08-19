## Context

See `proposal.md` for motivation. The existing discriminator forks zero-gradient, pressure, and
pressure/pressure arms from identical material and initialized-state fingerprints. It records the
first aggregate difference at step 25 in boundary-inlet exchange and later observes the
zero-gradient arm becoming non-finite at step 3346. That establishes outlet dependence, not a
specific boundary mechanism.

The historical H4 outlet copies the upstream snapshot into every outlet population. H14 pressure
reconstructs every population at fixed density from the same upstream snapshot. Both CPU paths
have normative handoff rules and Esoteric parity constraints. Production acceptance choices,
physics bands, and the failed pressure qualification must remain unchanged while the mechanism is
localized.

## Goals / Non-Goals

**Goals:**

- Reduce the step-25 aggregate observation to the first exact abnormal boundary link or prove
  that all boundary links match their normative transforms through that point.
- Separate implementation/parity, boundary-intersection, formulation-level mass mode, collision,
  and LES amplification hypotheses with bounded deterministic controls.
- Produce a durable classifier result whose raw inputs can be independently replayed.
- End with evidence precise enough to scope a separate repair proposal.

**Non-Goals:**

- Implement or select a new outlet formulation.
- Change H4 or H14, the solver-wide default, V11-V15 policies, collision/LES defaults, numerical
  health limits, or acceptance bands.
- Port diagnostic-only paths to WGSL or run production-scale V11-V15 benchmarks.
- Treat pressure stability as evidence that its mass-drift qualification passed.

## Decisions

### D1. Freeze a versioned localization manifest before measurements

Create one manifest containing the candidate mechanisms, predictions, exact arm matrix,
configuration fingerprints, arithmetic/repeatability limits, stop conditions, and classifier
rules. Any post-observation edit creates a new manifest identity and cannot reinterpret the old
artifact.

This keeps a plausible story from becoming a classifier after its numbers are known.

Alternative: encode expectations only in test assertions. Rejected because assertions do not
retain the competing hypotheses or make a changed interpretation auditable.

### D2. Audit a boundary response from captured input state with an independent oracle

Add a diagnostic boundary-event record around the CPU reference step. For each transformed link it
captures coordinates, D3Q19 direction/opposite, source/destination classification, intersection
ownership, Esoteric parity, input population, canonical incoming value, replacement value, and
mass/momentum delta. The record is enabled only by diagnostic runners and does not alter normal
solver output.

Evaluate captured events with a small pure oracle that hand-executes the formulas stated by H4,
H11, H12, and H14. The oracle consumes immutable captured values and lattice constants; it must not
call the production boundary branch or share its indexing helper. Manufactured single-link and
edge/corner fixtures establish the oracle before it judges a run.

Alternative: compare naive and Esoteric solvers only. Rejected because code paths can share the
same conceptual ownership error and agreement would then reproduce, rather than detect, it.

### D3. Refine adaptively instead of recording every link for 3,600 steps

Use the existing cadence run to bracket the first aggregate abnormal response. Restore the
canonical initial state and rerun with progressively finer cadence, ending with exact-step event
capture around the bracket. Retain hashes outside the focused window and full events only inside
it. A replay from the saved pre-step state must reproduce the first discrepancy.

Alternative: dump all populations and boundary links throughout the exposure. Rejected because it
creates a large artifact without improving causal resolution and makes review harder.

### D4. Use a staged ablation matrix

Run controls in increasing complexity, stopping when a decisive failure invalidates downstream
interpretation:

1. Manufactured boundary transforms and independently hand-computed moments.
2. Same-outlet repeats and naive/Esoteric identity on a flat inlet/outlet domain.
3. Mean-density perturbations above and below unity to measure the global mass-mode response of
   zero-gradient and pressure outlets without solids or boundary intersections.
4. Add no-slip ground, free-slip faces, and their intersections one at a time.
5. Add production regularized TRT with LES disabled, then the configured LES closure.
6. Reproduce the bounded near-floor layout through the known failure interval only if the earlier
   stages remain interpretable.

Every arm starts from a shared serialized state where topology permits. The classifier reports the
earliest required stage, not merely the last stage that diverged.

Alternative: begin with the existing full bounded layout and add more metrics. Rejected because
all candidate stages are active there and a finer timestamp alone cannot separate them.

### D5. Keep result branches conservative

The classifier can report:

- `implementation-discrepancy`: a repeatable production/oracle mismatch from identical captured
  input;
- `boundary-intersection-dependent`: a named intersection is necessary and hosts the first
  abnormal response;
- `zero-gradient-formulation-feedback`: the implementation matches H4 and the abnormal mass mode
  persists in the flat, collision-neutral, LES-disabled control;
- `collision-amplified` or `les-amplified`: the boundary response stays bounded until that named
  stage is enabled;
- `inconclusive`: execution, evidence, repeatability, or uniqueness requirements fail.

A branch may retain secondary amplifiers, but it cannot collapse simultaneous candidates into one
root cause. `zero-gradient-formulation-feedback` describes measured system behavior, not a claim
that every zero-gradient boundary is defective.

Alternative: force a single root-cause label. Rejected because the current evidence already shows
that boundary selection and collision/LES response can be coupled.

### D6. Separate localization evidence from repair authority

The run writes a schema-versioned JSON artifact plus a human record and validation-index entry.
Only a decisive branch may update the open defect's causal title/evidence; closing it requires the
separate repair and closure evidence already demanded by the ledger. Historical artifacts remain
unchanged.

If the mechanism is an implementation discrepancy against an existing handoff, the follow-up can
propose the narrow correction. If the normative formulation is implicated, the follow-up must cite
a published replacement boundary method before code is changed.

## Risks / Trade-offs

- **[Risk] Diagnostic instrumentation perturbs ordering or floating-point behavior.** → Keep the
  normal path disabled and bit-identical; compare state hashes with capture disabled/enabled and
  capture immutable values after each production assignment rather than recomputing them inline.
- **[Risk] The independent oracle accidentally shares the production bug.** → Prohibit production
  boundary helpers, use manufactured values with hand-calculated expected moments, and test
  direction/opposite mappings independently.
- **[Risk] Tiny-grid feedback does not represent acceptance topology.** → Treat early stages as
  localization controls, then require the bounded reproducer to confirm the selected stage before
  updating the causal claim.
- **[Risk] A control removes the symptom by changing several variables.** → Change one topology or
  physics stage per arm and record material fingerprints.
- **[Trade-off] CPU evidence does not prove a GPU-only mechanism.** → This change targets a failure
  already reproduced by the Float64 CPU reference. GPU work remains a separate follow-up if CPU
  controls are clean.
- **[Trade-off] The outcome may remain inconclusive.** → Preserve surviving hypotheses and name the
  cheapest missing discriminator; do not convert uncertainty into a repair.

## Migration Plan

1. Land diagnostic-only types, oracle, and tests with normal solver output proven unchanged.
2. Land the frozen manifest and classifier before running the opt-in localization matrix.
3. Run the bounded CPU evidence workflow and commit its append-only artifacts regardless of
   outcome.
4. Update documentation and the defect ledger only to the state supported by that artifact.
5. Archive this change. Create a separate repair proposal if and only if a mechanism branch is
   decisive.

Rollback removes diagnostic-only code and leaves production behavior unchanged. Committed run
artifacts remain append-only historical evidence.
