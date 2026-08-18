## 1. The null test first (design.md D1) — no new code

- [x] 1.1 Write a CPU test that runs the existing regularized empty-tunnel configuration
      (`pressureOutlet3d.test.ts:299-321` settings: `τ₀=0.5000005`, TRT, `les.cs=0.1`,
      `regularize: true`, `conserveMass: true`) twice, identical but for `lambda` set to two
      widely separated values, and compares every population for bit-identity.
- [x] 1.2 Run it. Record the outcome against design.md D1's three-way table **before**
      interpreting it, and state which branch was taken.
      **Branch taken: "Bit-identical."** Λ ∈ {3/16, 3}, `regularize: true`, τ₀ = 0.5000005,
      300 steps: 0 of 13,300 populations differ. Mechanism (A) (ω⁻ collapse) is excluded at
      every regularized operating point, which is every near-floor acceptance configuration.
- [x] 1.3 Add the negative control from the spec: the same two `lambda` values with
      `regularize: false` MUST differ, proving 1.1 tests an invariant and not a dead path.
      Control passes at 150 steps. Calibration note: unregularized, Λ = 3 goes non-finite at
      step 228 while Λ = 3/16 survives ≥ 400 — so 300 was not a usable control budget, and the
      unregularized tunnel is *strongly* ω⁻-sensitive, which is what makes the null meaningful.
- [x] 1.4 If 1.1 shows a difference: **stop and report.** That is an implementation defect in
      the collision core, outranks the rest of this change, and needs its own decision before
      continuing. — **Not triggered.** No difference; `collide.ts:391` does what it claims.

## 2. Expose the relaxation rates (design.md D2)

- [x] 2.1 Add `omegaMinus?: number` to `makeCollideContext`'s options and to `CollideContext`;
      when unset, `collideCell` MUST execute the existing `1/(0.5 + lambda/(tauEff − 0.5))`
      expression **character-for-character unchanged** (not an algebraically-equal rewrite).
- [x] 2.2 Reject an out-of-range `omegaMinus` at context construction with an error naming the
      parameter and the admissible interval, alongside the existing `tau <= 0.5` guard.
- [x] 2.3 Append `ω⁺` and `ω⁻` to `ctx.macro` (append only — do not reorder indices 0–4).
- [x] 2.4 Thread `omegaMinus` through `Solver2DOptions`, `Solver3DOptions`, and the
      `EsotericPull3D` path.
- [x] 2.5 **Bit-identity regression**, covering the Esoteric path specifically: a case run
      without `omegaMinus` produces populations bit-identical to a stored pre-change fixture.
      This is the gate for the whole of section 2.
- [x] 2.6 Test the positional stability of `macro[0..4]` against known values on a known cell.
- [x] 2.7 Tests for the spec's remaining scenarios: per-cell rate variation under LES, equal
      rates under BGK, explicit override beating the derived value.

## 3. Freestream eddy-viscosity probe (design.md D3)

- [x] 3.1 Add the probe to `packages/core/src/analysis/`: given a solver state and a scene, it
      reports the `ν_t/ν_mol` distribution over cells outside a stated boundary-influence
      distance from every inlet, outlet and wall, plus the excluded and surviving cell counts.
- [x] 3.2 Reuse `strainComparison.ts`'s boundary-distance binning convention rather than
      inventing a second one.
- [x] 3.3 Treat an empty surviving selection as a harness error, not a zero reading.
- [x] 3.4 Validate the probe against a manufactured uniform-flow field whose eddy viscosity is
      known to be exactly zero — a test of the instrument before it is used as one.
- [x] 3.5 Size the empty-tunnel probe scene so a freestream interior survives exclusion;
      confirm the surviving count is reported and non-trivial.

## 4. The discriminating factorial (design.md D4)

- [x] 4.1 Build the factorial harness: `{regularize on|off} × {lesNorm legacy|spec} ×
      {ω⁻ derived|raised}` at `τ₀ = 0.5000005`, to a fixed step budget past the known ~3,500
      divergence, emitting a machine-readable record per cell.
- [x] 4.2 Per cell record: finite/non-finite, step at divergence, freestream `ν_t/ν_mol`
      distribution, `strainComparison` `medianRatioSlope`, and the `ω⁺`/`ω⁻` in force.
- [x] 4.3 Keep the `{regularize: on, ω⁻ raised}` arm even if D1 proved it null — it is a
      regression detector for the invariant.
- [x] 4.4 Write the predictions table from design.md D4 into the harness output **before**
      running, so the comparison is prediction-vs-result and not narrative.
- [x] 4.5 Run the factorial. Compare against the predictions; state which mechanism the result
      indicates, or state plainly that it indicates neither.
      **Result:** neither standing mechanism explains the regularized acceptance configuration;
      ω⁻ collapse is confirmed only in the unregularized controls. The reproducing
      zero-gradient/spec/regularized arm diverged at step 3346 at both derived ω⁻ and ω⁻=1.0,
      while removing regularization accelerated divergence to step 382.

## 5. Record (design.md D5)

- [x] 5.1 Write the run file under `docs/validation/runs/` with identity, full configuration,
      every metric, and the five verdict axes (`PHYSICS_TARGET` is `N/A` — this measures a
      mechanism, not a benchmark).
- [x] 5.2 Commit raw factorial artifacts to `docs/validation/runs/artifacts/<run-id>/`.
      Committed as `644a750` together with the append-only run record and INDEX row.
- [x] 5.3 Append the INDEX row.
- [x] 5.4 Keep observation separate from interpretation in the run file; name competing
      readings rather than asserting one.

## 6. Feed the result back to the blocked tasks

- [x] 6.1 Record the finding against `fix-confirmed-physics-defects` tasks 6.9, 8.1 and 8.3 —
      whichever way it came out, including "neither mechanism indicated."
- [x] 6.2 If a mechanism is indicated, state what 6.9 would now need in order to be attempted
      again. **Do not attempt the flip here** — out of scope per design.md Non-Goals.
- [x] 6.3 If the near-floor mechanism turns out to be one D1-resolution-wall already describes,
      propose the amendment to that record rather than writing a competing account.

## 7. Verification

- [x] 7.1 `npm run lint && npm run typecheck && npm test` green; 84 files passed, 576 tests
      passed, and one opt-in test skipped.
- [x] 7.2 Confirm by diff review that no acceptance band, tolerance, gate, or production
      default moved — this change adds observables and runs experiments only.
- [x] 7.3 Confirm no `.wgsl` file is touched, so the commit needs no parity-panel line.
