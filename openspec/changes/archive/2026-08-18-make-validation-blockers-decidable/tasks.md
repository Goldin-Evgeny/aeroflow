## 1. Establish the authoritative validation ledger

- [x] 1.1 Add typed current-outcome, numerical-health-policy, and defect records beside the existing acceptance-band entries, with lookup and validation helpers.
- [x] 1.2 Populate current V1–V15 outcomes from durable evidence, including revision, conventions, observation time, artifact reference, and band comparison without changing any gate status.
- [x] 1.3 Populate the confirmed defect inventory with stable IDs, priorities, closure criteria, statuses, and evidence; represent GPU-stall survivability as mitigated separately from the open natural-stall cause.
- [x] 1.4 Mark the Q27 mirror-rounding explanation superseded by the measured superlinear drift evidence while leaving the momentum-drift defect open.
- [x] 1.5 Add tests that reject duplicate IDs, invalid status transitions, missing closure evidence, missing outcome provenance, and band/outcome comparison inconsistencies.

## 2. Make AIJ numerical health scoreable

- [x] 2.1 Define and document numerical-health policies for V12, V13, V14, and V15 before running new evidence, with metric direction, limit, unit, and invariant or numerical provenance.
- [x] 2.2 Add a pure health-policy evaluator that returns pass, fail, or unevaluated and retains a machine-readable reason for each missing metric or limit.
- [x] 2.3 Enable complete-shell open-boundary conservation accounting in the Case A/fetch runner and expose its closure result with the existing whole-field health snapshot.
- [x] 2.4 Apply the declared policy when writing Case A/fetch and urban artifacts, preserving the concrete limits and per-metric results used by each artifact.
- [x] 2.5 Prevent a missing or failed health axis from being promoted as a trustworthy physics verdict while retaining the measured q, r, row, and point evidence.
- [x] 2.6 Add unit and bounded browser tests for healthy, unhealthy, and missing-health AIJ outcomes, including Case A boundary closure and old-artifact readability.

## 3. Repair the analytic-zero LES oracle

- [x] 3.1 Add a bounded fully periodic CPU `Solver3D` uniform-flow oracle at the acceptance-tier near-floor relaxation time for both closure conventions.
- [x] 3.2 Verify that the periodic oracle reports every cell selected, zero analytic strain, and any generated subgrid activity without a boundary-exclusion assumption; include a perturbed-field control proving the instrument responds.
- [x] 3.3 Extend wall-bounded subgrid analysis to record boundary-influence distance over time and select each window using the largest supported distance in that window.
- [x] 3.4 Return an unavailable analytic-zero result when no cells survive, while retaining the same samples as explicitly boundary-contaminated diagnostics.
- [x] 3.5 Update tests and historical interpretation so the 20,000-step fixed-three-cell reading is no longer presented as pure analytic-zero evidence and its raw measurement remains unchanged.

## 4. Run the outlet-feedback discriminator

- [x] 4.1 Extend the near-floor harness to create zero-gradient, pressure, and same-outlet control arms from one canonical initialized state and assert matching state/configuration fingerprints.
- [x] 4.2 Record synchronized mass, momentum, density, boundary exchange, streamwise profile, subgrid/strain, and wavelength-band diagnostics at a fixed cadence through the known failure interval.
- [x] 4.3 Derive and freeze repeatability thresholds from the same-outlet controls before comparing the outlet A/B arms.
- [x] 4.4 Implement the three result branches—outlet feedback observed, no separation in exposure, and inconclusive—with earliest-separation and last-common-interval evidence.
- [x] 4.5 Add deterministic tests for each result branch, diagnostic omission, configuration mismatch, and preservation of the established uninstrumented divergence behavior.
- [x] 4.6 Run the opt-in bounded factorial, commit its machine-readable artifact and append-only run record, and update the ledger only from the recorded outcome.

## 5. Reconcile documentation from the ledger

- [x] 5.1 Add focused consistency checks or generated compact tables for validation outcomes, defect statuses, closure evidence, and current causal explanations.
- [x] 5.2 Correct `PHYSICS.md` so mirror-direction rounding is recorded as a superseded Q27 hypothesis and the superlinear collision-carried drift remains open.
- [x] 5.3 Update `VALIDATION.md`, the validation index, and relevant decision records with the AIJ health contract, analytic-zero qualification, and outlet-discriminator result.
- [x] 5.4 Confirm historical evidence is appended or relabelled rather than deleted or silently rescored.

## 6. Verification and handoff

- [x] 6.1 Run formatting, lint, typecheck, and the full unit test suite; record exact commands and results.
- [x] 6.2 Run the bounded AIJ browser regressions and any required CPU/GPU parity checks without starting a production-scale V11 or V14 run.
- [x] 6.3 Run `openspec validate make-validation-blockers-decidable --strict` and resolve every artifact or delta-spec error.
- [x] 6.4 Audit the final diff to prove no acceptance band, physics tolerance, production collision/boundary/LES default, or Q27 operator changed.
- [x] 6.5 Record which evidence-backed solver change should be proposed next, or explicitly record that the discriminator remained inconclusive; do not implement that repair in this change.
