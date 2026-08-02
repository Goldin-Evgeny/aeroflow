# Physics debugging playbook

How to debug LBM when the output looks wrong. This encodes the judgment a physics
debugger applies so it never has to be improvised. Read this BEFORE touching code —
the most expensive failure mode in this project is "fixing" the wrong layer.

## Iron rules (violating these is always the wrong move)

1. **Never weaken a validation tolerance to make a change pass** (CLAUDE.md rule 3).
   If a benchmark regressed, the change is wrong. (Engineering-spec corrections with
   written justification — like the parity-gate fp32 correction in
   `docs/handoff/H6-parity-panel.md` §4 — are documented spec fixes, not gate edits.)
2. **Never modify the CPU reference and a GPU kernel in the same commit.** One of them
   is always the fixed oracle for the other.
3. **One hypothesis, one change, re-run the relevant gate.** If you cannot name the
   hypothesis a change tests, don't make the change.
4. **The bisect ladder below runs top-down.** Do not start at the level where the
   symptom appeared; start at the lowest level not yet proven green today.

## The bisect ladder

Each rung has a pass criterion; the bug lives between the last green rung and the
first red one.

| #   | Rung                                   | Tool                             | Pass                                      |
| --- | -------------------------------------- | -------------------------------- | ----------------------------------------- |
| 1   | Lattice constants & moments            | `lattice(.3d).test.ts`           | identities to 1e-12                       |
| 2   | Equilibrium moments                    | same                             | ρ, ρu conserved to 1e-12                  |
| 3   | Single collision, one cell             | H1 T2/T5-style unit tests        | exact/1e-14                               |
| 4   | CPU solver, analytic flows             | Poiseuille / duct / cavity tests | gates in VALIDATION.md                    |
| 5   | CPU force identity                     | H2 T-FORCE                       | ≤1e-6                                     |
| 6   | Esoteric vs naive (CPU)                | H4 §8 bit-identity               | **exact equality**                        |
| 7   | GPU vs CPU, 10 steps                   | parity panel (H6)                | ≤1e-5                                     |
| 8   | GPU vs CPU, 200 steps                  | parity panel                     | ≤1e-4                                     |
| 9   | GPU forces vs CPU                      | parity panel force ext.          | ≤1e-4 rel (NOT bitwise — summation order) |
| 10  | Benchmark physics (St, Cd, Ghia, duct) | validation runner                | VALIDATION.md gates                       |
| 11  | Statistics/measurement                 | H7 synthetic tests               | H7 gates                                  |

Localization hints inside a rung: bit-identity failures report the first failing step —
step 1 = EVEN rules, step 2 = ODD rules or solid-scratch writes, near outlets =
snapshot pre-pass (H4 §10). Parity-panel argmax location: on the block boundary =
bounce-back branch; at inlet/outlet columns = BC code; interior scattered = collision.

## Symptom → likely cause (check in listed order)

| Symptom                                                                                           | Likely causes                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NaN within ~10 steps                                                                              | ρ=0 cells (erased obstacle without equilibrium refill; uninitialized solid slots read via bounce), or τ ≤ 0.5 exactly                                                                                                                                                                                                                                                                               |
| NaN after thousands of steps, high Re                                                             | plain-BGK instability (τ too close to 0.5, u too high) — needs LES or lower u; check `latticeUnits().stable`                                                                                                                                                                                                                                                                                        |
| Cd/St = NaN on a case's FIRST real run that Status calls "known stable"                           | the case was likely never actually run — "known stable" was an assumption, not a measurement (grep the claim's provenance). Reproduce on the CPU reference to split physics from GPU. Near the TOP of a milestone's Re range τ₀→0.5, plain TRT can be Mach-unstable where LES / H10 regularization holds (M10/V5 cylinder Re=200, τ≈0.519, diverges ~5k steps). Fix the collision, never the band   |
| Slow exponential blow-up, low Re                                                                  | ωm sign flip on the b-member (H1 §7.1), or Λ mis-derived                                                                                                                                                                                                                                                                                                                                            |
| St off by factor ≈ 2                                                                              | measured Cd instead of Cl (H7 §5.1)                                                                                                                                                                                                                                                                                                                                                                 |
| Cd off by factor ≈ 2                                                                              | momentum-exchange factor-2 dropped/doubled (H2 §6.2) — T-FORCE catches it                                                                                                                                                                                                                                                                                                                           |
| Cd plausible, Cl garbage                                                                          | link direction e_i vs e_ī swapped (H2 §6.1)                                                                                                                                                                                                                                                                                                                                                         |
| Wake asymmetric in a symmetric setup                                                              | flags asymmetry (off-by-one obstacle stamp); direction table typo (run rung 1); or genuinely Re>47 physics — check Re before "fixing"                                                                                                                                                                                                                                                               |
| Mass drifts monotonically                                                                         | outlet BC leak (zero-gradient copying the wrong neighbor/parity); fp16 round-toward-zero encode (H5 §5.1)                                                                                                                                                                                                                                                                                           |
| Checkerboard / stripes in velocity                                                                | streaming direction sign flipped (pull vs push confusion); esoteric parity mapping wrong at readout (H4 §7)                                                                                                                                                                                                                                                                                         |
| Visualization flickers alternate frames                                                           | macroscopics read at wrong esoteric parity (H4 §10.5)                                                                                                                                                                                                                                                                                                                                               |
| GPU parity fails at N=10 but "physics looks fine"                                                 | it is NOT fine — index bug with slow error growth; fix before anything else                                                                                                                                                                                                                                                                                                                         |
| GPU parity passes, benchmark fails                                                                | setup/protocol layer: unit mapping, Re computation, domain size/blockage, transient discard, measurement window (rung 10/11, not the kernel)                                                                                                                                                                                                                                                        |
| A steadiness/convergence gate never becomes true; the run times out with the gate NEVER evaluated | a per-point RELATIVE drift normalized by each point's OWN magnitude, pinned >100% forever by a near-zero point (near-wall / no-slip node) jittered by LES. A CONDITIONING defect, not a budget one — more steps cannot help. Normalize the change by the field PEAK instead (M10 fetch `driftScaled`); inspect the driving `driftIndex`. Verify the field is genuinely converging first (rung 4/10) |
| Force/velocity oscillates with period exactly 2 steps                                             | the staggered momentum mode (measured: ±0.1% around truth in forced channels) — physical values are two-step averages; see H2 §4a. Not a bug; single-step force readings are wrong by construction                                                                                                                                                                                                  |
| Results differ across GPUs                                                                        | expected at float level (report tolerance bands, never bitwise claims); if physically different, capability fallback path differs (f16 vs f32 storage) — check the capability report                                                                                                                                                                                                                |
| Everything correct but slow                                                                       | you are memory-bound: check bytes/cell moved, batch size per submit, MLUPs HUD vs the bandwidth ceiling (PHYSICS.md §11)                                                                                                                                                                                                                                                                            |

## Protocol for "a validation case fails after a change"

1. `git stash` → re-run the case at HEAD~. If it fails there too, it was never green
   at that resolution/hardware — treat as new work, not regression.
2. If green at HEAD~: bisect your change hunk-by-hunk (the commits are small if rule 3
   was followed).
3. Write the failing case's numbers into the milestone Status section BEFORE fixing —
   history of near-misses is data, not shame.

## When genuinely stuck (the escalation that preserves the oracle discipline)

Reproduce the failure on the **CPU reference at the smallest grid that shows it**, and
print the full f-state of ONE offending cell and its neighbors for 2 steps. Every bug
so far in LBM implementations is visible in that dump when compared, direction by
direction, against a hand-executed step of the rules (H1 §2, H4 §3). Hand-execution of
one cell-step takes ~15 minutes and has never failed to localize an index bug. Do that
before architectural theories.
