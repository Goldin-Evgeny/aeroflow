# H6 — In-app CPU↔GPU parity panel: executable specification

> **Handoff doc. BUILD THIS FIRST** (before any other GPU change — it is the tool that
> verifies all of them). Milestone: M2, first task. Effort: small (a day-class task).
> After this exists, the rule in `CLAUDE.md` applies: **every commit that touches a
> WGSL kernel must include a parity-panel result in its message.**

## 1. What it is

A dev-only panel in the studio app that runs the Float64 CPU reference solver and the
GPU kernel on the SAME tiny scene for N steps, reads the GPU distribution buffer back,
and reports the maximum relative error over all cells/directions plus per-field
summaries. One click, ~a second, pass/fail on screen. It converts "does the GPU kernel
implement the physics?" from a judgment call into a number.

## 2. The fixed test scene (never change it — results must be comparable across months)

- Grid 32×32. Flags: solid rows y=0 and y=31; inlet column x=0; outlet column x=31;
  solid block at x ∈ [10,13] × y ∈ [12,19] (asymmetric on purpose — symmetric scenes
  hide sign bugs, so place the block off-center: use y ∈ [12,19] which is centered…
  therefore shift it: **y ∈ [14,21]**).
- Params: τ = 0.8, u_in = 0.05, ρ0 = 1, equilibrium init at (1, u_in, 0).
- Base config matrix (run all): BGK | TRT(Λ=3/16) | BGK+LES(cs=0.1) | TRT+LES.
- H10 extension (2026-08-01, also run all): append BGK+REG | TRT+REG | BGK+LES+REG |
  TRT+LES+REG. The M3 extension runs all eight configs on the fixed moving-lid cavity too,
  for 16 result rows at each N gate.
- Everything hardcoded as literals in one file (`apps/studio/src/dev/parityScene.ts`)
  shared by nothing else.

## 3. Protocol

1. Construct `Solver2D` from `@aeroflow/core` with the scene (Float64).
2. Construct the GPU sim at 32×32 with identical flags/params. Requirements on the
   GPU side: f-buffers created with `COPY_SRC` (add the usage flag), a
   `readDistributions(): Promise<Float32Array>` method (copy the CURRENT source buffer
   — mind ping-pong parity: after N steps the newest state is in `fBufs[N % 2]` —
   into a staging buffer, `mapAsync`, copy out, unmap).
3. Step both N steps. Compare per slot:
   `err = |gpu − cpu| / (|cpu| + 1e-12)`; track max, plus max over the velocity field.
4. Report: max f-error, max vel-error, the (cell, direction) argmax location, and
   pass/fail per gate.

Run it for **two N values, both gates must pass**:

| N   | Gate (max rel f-error) | What it checks                                                 |
| --- | ---------------------- | -------------------------------------------------------------- |
| 10  | ≤ 1e-5                 | algorithmic identity (fp32 rounding barely accumulated)        |
| 200 | ≤ 1e-4                 | drift behavior (accumulated fp32 rounding only, no divergence) |

## 4. Why these gates (and the correction to M2's original number)

The GPU computes in fp32 (~1.2e-7 relative rounding per op chain); the CPU oracle in
Float64. Per-step relative divergence is O(1e-7) and grows roughly linearly in this
laminar, strongly-damped scene: expect ~1e-6 at 10 steps and ~2e-5…5e-5 at 200. The
gates sit ~10× above the expectation: real index/physics bugs produce errors many
orders of magnitude larger (typically 1e-2…1, or NaN), so the gates have enormous
separation between "correct" and "buggy" — there is no gray zone in practice.

**Spec correction (documented, deliberate):** the M2 spec originally said
"GPU ≡ CPU to ≤1e-6 after 1000 steps". That is not achievable fp32-vs-fp64 (rounding
alone exceeds it) and was a spec error, not a physics tolerance — it is superseded by
the two-gate table above. This paragraph exists so nobody treats the change as
"weakening a tolerance" (CLAUDE.md rule 3 governs _physics benchmarks vs literature_,
which are untouched). If bitwise-strict checking is ever wanted, the correct method is
an fp32 CPU mode (`Math.fround` after every arithmetic op) compared exactly — noted as
optional future work, not required.

## 5. UI

- Hidden behind `?dev` query param (or a keyboard shortcut) — a small overlay with one
  "Run parity" button, a config-matrix table of results, and a copy-to-clipboard
  summary line formatted for commit messages:
  `parity 32x32: bgk 10=3.1e-7/200=2.2e-5 trt 10=…/200=… les… PASS`.
- No framework, no styling effort — this is an instrument, not a feature.
- It must construct its own offscreen GPU sim instance (do not reuse/perturb the
  visible tunnel).

## 6. Extension points (later milestones, same pattern)

- M6: a 16³ 3D variant against `Solver3D`, then against `EsotericPull3D` (H4 §9 port
  order); parity-aware readback per H4 §7.
- M7: add force comparison — GPU force vs CPU force within 1e-4 relative (float
  summation order differs; see H2 §5/§6 — NOT bitwise).
- FP16 storage (M6): compare against CPU within the H5-derived tolerance instead
  (≈2e-3 at 200 steps); run the FP32 gates on the FP32 build in the same session.

## 7. Pitfalls

1. Reading the wrong ping-pong buffer after odd N (off-by-one parity) — symptom:
   errors ~O(1) at N=10 but sensible at N=11.
2. Forgetting that the CPU scene must use forcing='guo'/'shift' consistent with the
   GPU kernel (the GPU tunnel kernel has NO body force — set gravity 0 in the scene).
3. Comparing against `macroscopics()` only — velocity can look fine while one
   direction slot is systematically wrong; always compare the raw f array.
4. Mapping a buffer still in use by queued work (copy to a dedicated staging buffer in
   the same encoder, map after `onSubmittedWorkDone`/`mapAsync` resolves).
5. Denominator-free relative error (divide by |cpu| without the +1e-12 floor) — NaN
   storms at near-zero slots.
6. Running the panel on the visible sim (user's obstacles pollute the scene).
