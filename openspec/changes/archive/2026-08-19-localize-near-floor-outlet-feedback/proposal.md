## Why

The bounded near-floor pair proves that outlet selection changes the failure, but its first
recorded difference is only an aggregate boundary-inlet value at step 25. That evidence cannot
distinguish an H4 implementation defect, inlet/outlet or corner ownership error, intrinsic
zero-gradient feedback, or later collision/LES amplification, while the pressure alternative is
not promotable because it exceeds the existing mass-drift guard.

## What Changes

- Freeze the live outlet hypotheses, discriminating predictions, observation cadence, and
  repeatability limits before collecting new results.
- Add a smallest-grid CPU boundary audit that records population- and link-resolved inlet,
  outlet, wall, and free-slip transformations without deriving the oracle from the production
  boundary implementation.
- Refine the existing outlet pair to retain the exact first separating step, cell, lattice
  direction, boundary class/intersection, and pre/post population and moment state.
- Add same-outlet, parity, corner-ownership, LES-off, collision-neutral, and boundary-layout
  controls that distinguish boundary generation from downstream amplification.
- Classify the result as an implementation discrepancy, formulation-level feedback, a measured
  boundary interaction, or inconclusive, with explicit evidence requirements for each branch.
- Persist the complete evidence and update the defect ledger and decision record without changing
  a production outlet, collision/LES default, validation band, or historical verdict.
- Stop at a repair-ready causal record. Any solver or handoff change requires a separate proposal
  naming the measured mechanism and its published or normative replacement rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `near-floor-collision-diagnostics`: Require population/link-resolved localization and controlled
  causal classification before the open near-floor outlet-feedback defect can advance from an
  aggregate observation to a named mechanism.

## Impact

- CPU reference boundary diagnostics and focused harnesses in `packages/core`.
- Tests for H4 population copying, Esoteric parity, boundary intersections, evidence
  classification, and durable record generation.
- Validation artifacts, `docs/VALIDATION.md`, `docs/decisions/D1-resolution-wall.md`, and the
  machine-readable defect ledger.
- No production solver selection, WGSL kernel, acceptance band, numerical-health limit, external
  dependency, or production-scale V11-V15 run changes in this change.
