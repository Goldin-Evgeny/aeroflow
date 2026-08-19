## 1. Freeze the localization contract

- [x] 1.1 Define a versioned localization manifest with stable hypothesis, arm, topology, metric,
      threshold, stop-condition, and classifier-branch identifiers.
- [x] 1.2 Encode the predictions and required evidence for implementation discrepancy,
      boundary-intersection dependence, zero-gradient formulation feedback, collision amplification,
      LES amplification, and inconclusive outcomes.
- [x] 1.3 Derive Float64 arithmetic tolerances from operation counts and same-outlet repeatability
      controls before reading localization results; record the derivation beside the manifest.
- [x] 1.4 Add manifest hashing and validation that rejects duplicate identities, missing branch
      evidence, material configuration mismatches, and reinterpretation of an artifact under a changed
      manifest.

## 2. Build the independent boundary oracle

- [x] 2.1 Implement pure diagnostic evaluators for the H4 zero-gradient, H11 free-slip, H12
      velocity-inlet, no-slip bounce, and H14 pressure transforms without calling production boundary
      branches or their indexing helpers.
- [x] 2.2 Add hand-calculated manufactured single-link fixtures that verify D3Q19 direction and
      opposite-direction identities, source/destination populations, density, momentum, and boundary
      mass exchange.
- [x] 2.3 Add edge and corner fixtures that establish boundary-rule ownership and ordering for
      inlet/ground, outlet/ground, inlet/free-slip, and outlet/free-slip intersections.
- [x] 2.4 Make the oracle return an explicit ambiguous-ownership result when captured evidence
      cannot uniquely reconstruct the applicable rule, and test that this cannot yield a causal branch.

## 3. Capture and replay exact boundary events

- [x] 3.1 Define the diagnostic boundary-event schema with exact step, cell and neighbor
      coordinates, lattice direction/opposite, boundary class/intersection, parity, pre-transform,
      canonical, replacement, and mass/momentum values.
- [x] 3.2 Add opt-in event capture to the naive and Esoteric CPU reference paths while proving that
      capture-disabled and capture-enabled solver states remain bit-identical after stripping evidence.
- [x] 3.3 Record source and destination ownership explicitly at every shell intersection and add
      tests that catch a wrong neighbor, wrong parity, wrong opposite direction, or duplicate owner.
- [x] 3.4 Add diagnostic save/replay of the immutable state immediately before a focused step and
      prove that repeated replay reproduces the same ordered event stream and state hash.
- [x] 3.5 Implement cadence refinement from the existing step-25 bracket to an exact first abnormal
      step, retaining hashes outside the focused window and complete events inside it.

## 4. Implement the staged ablation harness

- [x] 4.1 Add flat inlet/outlet same-outlet repeat controls for both outlet formulations and enforce
      the frozen repeatability and naive/Esoteric identity gates.
- [x] 4.2 Add matched positive and negative mean-density perturbation arms that measure the global
      mass-mode response of zero-gradient and pressure outlets without solids or intersecting faces.
- [x] 4.3 Add topology arms that introduce no-slip ground, free-slip faces, and each edge/corner
      intersection one at a time from a shared initialized state.
- [x] 4.4 Add collision-stage arms that compare boundary-only or collision-neutral response with
      plain TRT and production regularized TRT while leaving the boundary topology fixed.
- [x] 4.5 Add LES-stage arms that compare LES disabled, legacy closure, and specified closure only
      after the preceding collision controls remain interpretable.
- [x] 4.6 Integrate the existing bounded near-floor reproducer as the final confirmation arm through
      the known failure interval, guarded by upstream stop conditions.

## 5. Classify and persist the result

- [x] 5.1 Implement the conservative classifier branches from the frozen manifest and retain every
      surviving competing mechanism and required secondary amplifier.
- [x] 5.2 Add deterministic classifier tests for every decisive branch, simultaneous compatible
      branches, repeatability failure, oracle mismatch, ambiguous ownership, missing evidence, and
      execution/numerical-health invalidation.
- [x] 5.3 Define and validate a schema-versioned durable artifact containing the manifest,
      configuration and state fingerprints, arm outcomes, focused event stream, oracle comparisons,
      perturbation response, classifier reasons, and non-claims.
- [x] 5.4 Add a write-gated record test that emits deterministic machine-readable evidence without
      making an opt-in run part of the ordinary unit suite.

## 6. Run and interpret the bounded evidence workflow

- [x] 6.1 Run the manufactured oracle and exact-replay controls first; stop and record an
      instrumentation failure if they do not pass.
- [x] 6.2 Run the flat, perturbation, topology, collision, and LES arms in dependency order, applying
      every predeclared stop condition without editing the manifest from observed values.
- [x] 6.3 If the upstream arms remain interpretable, run the bounded near-floor confirmation through
      at least step 3600 and preserve finite/non-finite, first-separation, health, and conservation data.
- [x] 6.4 Commit the raw JSON artifact, a schema-v2 human run record, and an append-only validation
      index entry for the result, including failed or inconclusive outcomes.
- [x] 6.5 Compare the classifier output with the original step-25/3346 evidence and state exactly
      which hypotheses were supported, rejected, or left alive without starting a production-scale
      benchmark.

## 7. Reconcile policy and documentation

- [x] 7.1 Update the machine-readable defect ledger only as far as the durable result permits;
      retain the defect as open unless separate repair evidence satisfies its closure criterion.
- [x] 7.2 Update `VALIDATION.md` and the D1 decision addendum with the localized stage, evidence
      scope, surviving alternatives, and explicit non-claims.
- [x] 7.3 Verify that H4, H14, all production outlet/collision/LES policies, numerical-health limits,
      acceptance bands, and historical artifacts remain unchanged.
- [x] 7.4 Record the cheapest next proposal: a narrow normative implementation repair if H4 is
      violated, a published-source boundary replacement if the formulation is implicated, or the next
      missing discriminator if the result is inconclusive.

## 8. Final verification

- [x] 8.1 Run changed-file formatting, lint, typecheck, and the full unit suite; record exact
      commands, pass counts, skipped opt-in tests, revision, and dirty-state fingerprint.
- [x] 8.2 Run focused default-bit-identity, naive/Esoteric, conservation, outlet-policy,
      qualification-policy, and artifact-compatibility regressions.
- [x] 8.3 Run `openspec validate localize-near-floor-outlet-feedback --strict` and strict main-spec
      validation, resolving every structural or delta-spec error.
- [x] 8.4 Run `git diff --check` and audit the final diff for accidental WGSL, production physics,
      gate, policy, or immutable historical-run changes.
