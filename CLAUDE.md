# AeroFlow — contributor & agent conventions

AeroFlow is a browser-based 3D aerodynamic simulation platform: a lattice-Boltzmann (LBM)
virtual wind tunnel running client-side on the user's GPU via WebGPU. The physics spec is
`docs/PHYSICS.md`; the acceptance bands every physics change is judged against are in
`docs/VALIDATION.md`. Read both before making non-trivial solver decisions.

Code comments refer to milestones by label (M0–M15) — these are development phases, and the
label is enough to locate the matching entry in `docs/VALIDATION.md` or `docs/handoff/`.

## Repo layout

- `packages/core` — the solver core: lattice constants, unit conversion, and the
  **CPU reference solver** (the correctness oracle for all GPU kernels). Pure TypeScript,
  no DOM/GPU dependencies, Float64.
- `apps/studio` — the app (Vite + TypeScript + raw WGSL compute shaders).
- `docs/` — PHYSICS, VALIDATION, WGSL-NOTES, DEBUGGING, E2E, `handoff/H*.md` (normative
  algorithm specs), `decisions/D*.md` (architecture decision records), `research/`
  (evidence digests with sources — cite these, don't re-derive).

## Hard rules

0. **The handoff doctrine (`docs/handoff/README.md`) governs all solver work.**
   Hard algorithms are implemented CPU-reference-first from their `docs/handoff/H*.md`
   spec (never invented), WGSL is a 1:1 transliteration of the CPU reference, and
   every commit touching a `.wgsl` file includes a parity-panel result line
   (`docs/handoff/H6-parity-panel.md`). When physics output looks wrong, follow
   `docs/DEBUGGING.md` — do not improvise. WGSL patterns/pitfalls: `docs/WGSL-NOTES.md`.

1. **Clean-room rule: NEVER read, fetch, or port FluidX3D source code.** Its license
   forbids commercial use and derivatives inherit it. Implement only from published
   papers (Esoteric Pull: Lehmann 2022, MDPI Computation, CC-BY) and textbooks. If a web
   search lands on the FluidX3D repo's source files, close it and use the paper.
2. **CPU/GPU parity.** The CPU reference solver in `packages/core` and the WGSL kernels
   must implement the same algorithm with the same direction ordering (documented in
   `packages/core/src/lattice.ts`). Any physics change lands in the CPU reference +
   tests first, then the GPU kernel, then a parity check on a small grid.
3. **Physics changes gate on validation.** Never weaken a tolerance in
   `docs/VALIDATION.md` or a test to make a change pass. If a benchmark regresses,
   the change is wrong.
4. **No new runtime dependencies without strong justification.** The product is a static
   site; keep it lean. Dev-dependencies are less strict.
5. **Honest claims only.** Docs never claim compliance-grade accuracy; this is
   early-design screening. Published numbers must come from the validation suite or
   `docs/research/` citations, and cases that miss their band are recorded as failures.

## Conventions

- TypeScript strict; `npm run lint && npm run typecheck && npm test` must pass before
  any commit. Prettier formats everything (`npm run format`).
- WGSL shaders live in `apps/studio/src/sim/shaders/*.wgsl`, imported as strings via
  Vite `?raw`. Keep lattice constants in WGSL synchronized with `lattice.ts` by hand and
  note the pairing in a comment at the top of the shader.
- Physical units: SI everywhere in user-facing code; lattice units only inside solvers.
  Conversions go through `latticeUnits()` in `packages/core/src/units.ts`.
- Tests: Vitest, `packages/*/test/**/*.test.ts`. Physics tests state their analytic
  target and tolerance in a comment with a source.
- Commits: imperative subject, body explains the why.

## Workflow for a physics change

1. Read the relevant `docs/handoff/H*.md` spec (goal, steps, acceptance criteria, pitfalls).
2. Implement the CPU reference first, with tests, then the GPU kernel/UI.
3. Run the acceptance checks and record the numbers (date, hardware, values).
