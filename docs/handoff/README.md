# The Handoff Package (read this first)

This directory was written on 2026-07-08 by the strongest model available to the
project, on its last day of availability, specifically so that **everything
capability-critical in AeroFlow is now specified to the point of mechanical
execution + mechanical verification.** If you are the model doing the work: you do not
need to invent any physics or any index math. You need to implement what is written,
in the order given, and iterate until the named oracles are green. That is the whole
job.

## The doctrine (three rules that replace brilliance)

1. **CPU oracle first.** Every hard algorithm is implemented first as a readable
   Float64 CPU reference in `packages/core` with the tests specified in its H-doc.
   Correctness there is _decided by analytic identities_ (exact parabolas, momentum
   balance, bit-identity, moment identities) — not judged by eye.
2. **GPU = transliteration.** WGSL kernels are line-by-line ports of the CPU
   reference (same names, same loop structure, shared collision code). Never "improve"
   physics in the WGSL that isn't in the reference.
3. **Parity gates everything.** The in-app parity panel (H6 — build it first) compares
   GPU state to the CPU oracle. Every commit touching a `.wgsl` file includes a parity
   result line in its message. A red parity panel means STOP; `docs/DEBUGGING.md` has
   the bisect ladder.

## Execution order (maps to the milestone roadmap)

**STATUS UPDATE 2026-07-08: the CPU-oracle side of H1, H2, H3 and H4 is DONE and
green (43 tests)** — `packages/core/src/cpu/{collide,solver2d,solver3d,esoteric}.ts`.
V1 τ-independence, the 2D/3D force identities, the duct oracle, and the esoteric
bit-identity (200 steps, both parities, LES on/off, forces bitwise-equal) all pass.
Remaining work in those rows is the GPU/WGSL side only. Two findings from execution
are folded into the docs: the period-2 staggered momentum mode (H2 §4a) and the
solid-upstream-of-outlet constraint (H4 §10.9).

| Order | Doc                                             | What gets built                               | Milestone       | Status                                                                                                             |
| ----- | ----------------------------------------------- | --------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1     | `H6-parity-panel.md`                            | the verification instrument                   | M2 (first task) | **DONE** — parity panel live at `?dev`, green on Ampere                                                            |
| 2     | `H1-trt-les-forcing.md`                         | TRT + Guo forcing (CPU→tests→WGSL)            | M2              | **DONE** — CPU V1 + GPU parity both PASS (M2 complete)                                                             |
| 3     | `H9-fixtures-ghia.md`                           | cavity fixtures (copy-paste)                  | M3              | **DONE** — `fixtures/ghia.ts` embedded + used; moving-lid BC validated vs Ghia Re=100 (M3 CPU). GPU cavity remains |
| 4     | `H2-momentum-exchange.md` + `H7-measurement.md` | forces + St/Cd measurement                    | M4              | **2D/3D CPU forces DONE**; GPU + H7 open                                                                           |
| 5     | `H1` §3 (LES part)                              | Smagorinsky (CPU→tests→WGSL)                  | M5              | **CPU+tests DONE**; WGSL open                                                                                      |
| 6     | `H3-solver3d.md`                                | D3Q19 CPU reference + duct oracle             | M6 prep         | **DONE**                                                                                                           |
| 7     | `H4-esoteric-pull.md`                           | in-place streaming (CPU bit-identity → WGSL)  | M6              | **CPU bit-identity DONE**; WGSL open                                                                               |
| 8     | `H5-fp16-storage.md`                            | FP16 shifted storage (only after FP32 parity) | M6              | open                                                                                                               |
| 9     | `H8-voxelizer.md`                               | mesh → mask (CPU → GPU)                       | M8              | open                                                                                                               |

Later milestones are protocol and product work rather than capability-critical
algorithms, and were deliberately NOT re-specified here.

## Per-doc completeness checklist (all should hold; if one doesn't, it's a doc bug)

Every H-doc contains: (1) worked math with sources, (2) implementation-shaped
pseudocode, (3) exact test oracles with numbers and tolerances, (4) an ordered
pitfalls list of the mistakes most likely to actually happen, (5) the WGSL/GPU mapping
where applicable.

## Non-negotiables inherited from `CLAUDE.md`

- FluidX3D source is license-barred: implement Esoteric Pull from `H4` (self-contained
  derivation) + the CC-BY paper — never from that repository's code.
- Physics tolerances in `docs/VALIDATION.md` are never weakened to pass. The single
  documented engineering-spec correction (M2's fp32 parity number) is in `H6` §4.
- Honest claims only: derived performance numbers stay labeled derived until measured.

## Known open judgment calls intentionally left to execution time

- Packed-u32 fp16 lane pairing (H5 §3): ship `shader-f16`-or-FP32 first; the packed
  path is a measured performance follow-up.
- Free-slip boundaries: deferred to M10 (H3 §2 records the deviation).
- GPU flood-fill (H8 §4): port only if the CPU flood measurably bottlenecks.
