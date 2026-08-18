## Context

See `proposal.md` for motivation. The repository already implements both D3Q19 outlet
formulations, complete-shell boundary accounting, numerical-health policies, bounded 3D
CPU/GPU parity, durable AIJ artifacts, and checkpoint/resume. Ahmed acceptance already names
pressure explicitly in one studio constant, while Case A and urban runners still contain
zero-gradient literals. The solver constructors and general scene builders intentionally
default to zero-gradient for historical compatibility.

The discriminator is strong evidence for configuration selection but narrow evidence for
scale: it used a 10×8×7 CPU empty tunnel at `tau0=0.5000005`, found the first sampled
boundary-exchange separation at step 25, and observed zero-gradient divergence at 3346 while
pressure stayed finite through 3600. It did not exercise every body geometry, the GPU kernel,
checkpoint restore, or a scored production grid.

## Goals / Non-Goals

**Goals:**

- Make qualification a reproducible evidence decision rather than a literal replacement.
- Give V11–V15 one authoritative outlet policy that every execution and reporting path can
  verify.
- Exercise pressure on bounded representatives of Ahmed, fetch, Case A, and urban scenes under
  the numerical-health and parity contracts already in the repository.
- Preserve historical reproduction and prevent a diagnostic override from masquerading as an
  acceptance run.

**Non-Goals:**

- Diagnose or repair the internal zero-gradient feedback mechanism.
- Change solver or generic scene defaults, pressure reconstruction, collision, LES, health, or
  physics-band constants.
- Re-run production-scale V11/V14 or rescore existing artifacts as part of qualification.
- Claim that bounded stability proves production-scale accuracy or removes the need for health
  checks on future scored runs.

## Decisions

### D1. Put the acceptance selection in the validation policy, not solver defaults

Add a typed outlet policy keyed by V11–V15 beside the validation ledger and numerical-health
policies. Ahmed, Case A/fetch, and urban runners consume that policy rather than restating
`'pressure'`. Artifacts copy the resolved outlet value and policy identity into their material
configuration.

This keeps a validation configuration change narrower than a solver behavior change and gives
tests one place to detect drift. Keeping the existing studio-only Ahmed constant or replacing
all constructor defaults was rejected: the former leaves AIJ paths split; the latter changes
interactive and historical callers that the evidence did not cover.

### D2. Freeze the qualification manifest before inspecting new results

Represent the matrix as typed data with a stable identifier, required scene family, closure
convention, backend, exposure, and required verdict axes. At minimum it contains:

- the reduced empty-tunnel reproducer through at least step 3600 for both closure conventions;
- bounded Ahmed-body and AIJ Case A/fetch representatives;
- a bounded urban Case C representative including checkpoint/save/restore;
- near-floor 3D CPU/GPU parity with the pressure boundary layout; and
- same-configuration repeatability controls where a cross-backend comparison is not exact.

Every arm uses existing case numerical-health limits and complete-shell conservation policy.
The manifest is committed before its opt-in evidence run, and the classifier reports
`qualified`, `failed`, or `inconclusive` without editing thresholds after results are known.

A single empty-tunnel test was rejected because it cannot cover geometry, sparse probes,
artifact wiring, or resume. A production-scale acceptance run was rejected as a qualification
prerequisite because it conflates boundary plumbing with expensive physics convergence and
would make failures harder to classify.

### D3. Separate plumbing qualification from physics acceptance

The matrix gates execution, numerical health, conservation, and CPU/GPU agreement. It records
bounded physics measurements but does not compare under-resolved smoke scenes with V11–V15
acceptance bands. Once promoted, future correctly resolved runs use the existing bands normally.

This prevents a stable bounded field from being advertised as benchmark validation, while
still making a failed health or parity axis block promotion.

### D4. Make non-policy overrides visibly non-acceptance

Existing query parameters and diagnostic APIs retain both outlet choices. When they select a
non-policy outlet, the run artifact records the override and the UI/export suppresses the
physics verdict while retaining measurements. This mirrors existing under-resolution and
numerical-health suppression rather than removing useful reproduction paths.

### D5. Bind checkpoint compatibility to the material outlet configuration

The outlet and validation-policy identity participate in the configuration fingerprint used
for checkpoints and durable artifacts. Resume validates them before restoring state. This
prevents a pressure run from continuing zero-gradient populations, or the reverse, while
retaining normal same-configuration recovery.

### D6. Promote only from a durable qualification record

Run the matrix behind an explicit opt-in environment flag and write both machine-readable and
human records under `docs/validation/runs/`. Only a complete `qualified` record authorizes the
policy flip. A failed or inconclusive record is appended and leaves the active policy unchanged.

## Risks / Trade-offs

- **[Bounded pressure stability may not extrapolate to full grids]** → Continue applying
  numerical-health gates to every future scored run and make no accuracy claim from the smoke
  matrix.
- **[Pressure changes the physical solution and recorded coefficients]** → Treat subsequent
  values as new evidence under a different boundary convention; preserve and label historical
  values rather than comparing them as a regression without qualification.
- **[A single shared policy could hide case-specific needs]** → Key the policy by validation
  case even while V11–V15 currently resolve to the same outlet, and require the matrix to name
  each affected family.
- **[Scattered overrides could bypass policy]** → Add source/behavior consistency tests across
  scene, runner, artifact, export, and resume paths.
- **[The policy flip could land before evidence]** → Order tasks so the manifest, harness, and
  durable record land before the policy value changes; tests reject promotion without linked
  qualifying evidence.

## Migration Plan

1. Add the typed policy and frozen qualification manifest with the current acceptance selection,
   plus consistency tests and artifact/checkpoint identity plumbing.
2. Add bounded pressure arms for every required scene family and backend, without changing which
   outlet scored runs select.
3. Run the opt-in matrix and commit its complete evidence record.
4. If and only if the classifier returns `qualified`, set V11–V15 policy entries to pressure and
   update all acceptance surfaces to consume the policy. If it returns failed or inconclusive,
   record that outcome and do not promote.
5. Run bounded browser/parity regression, the full unit suite, strict OpenSpec validation, and a
   final audit proving solver defaults, acceptance bands, and operator constants are unchanged.

Rollback reverts the policy selection and consumers while retaining the qualification record.
Historical artifacts and the pressure implementation require no data migration.
