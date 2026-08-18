## Why

The bounded near-floor discriminator observed repeatable outlet-dependent feedback: the
zero-gradient arm separated at the first sampled boundary interval and became non-finite at
step 3346, while the pressure arm remained finite through step 3600 from the same initialized
state. The pressure outlet is therefore the evidence-backed candidate for Ahmed and AIJ
acceptance scenes, but it must be qualified and promoted explicitly rather than inferred from
one reduced CPU experiment or installed as a global default.

## What Changes

- Define a bounded qualification matrix for the pressure outlet across the affected near-floor
  Ahmed, ABL fetch, Case A, and urban scene families, including CPU/GPU parity, complete-shell
  conservation, numerical health, and exposure beyond the known zero-gradient failure.
- Establish one explicit acceptance-outlet selection for those scene families and require every
  scored runner, browser surface, artifact, and checkpoint/resume path to use and report it.
- Promote pressure only after the predeclared qualification gates pass; otherwise retain the
  current selection and record the failed or inconclusive evidence.
- Preserve the solver-wide zero-gradient default and the ability to reproduce historical runs.
  Existing artifacts remain labeled by their recorded boundary convention and are not rescored.
- Keep all physics acceptance bands, collision/LES defaults, and the open zero-gradient causal
  defect unchanged. This change qualifies a safer validation configuration; it does not claim
  an internal outlet root cause or repair the zero-gradient implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `near-floor-collision-diagnostics`: Add the evidence gates, explicit selection contract, and
  historical-compatibility rules for promoting the pressure outlet in near-floor validation
  scenes.

## Impact

Affected areas include the Ahmed/AIJ scene builders and runners, their CPU/GPU parity and
bounded browser harnesses, durable run/checkpoint metadata, validation-ledger documentation,
and tests that pin production defaults. No external dependency, data fixture, acceptance band,
public solver default, collision operator, or LES convention changes.
