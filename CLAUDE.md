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

## Run history persistence (mandatory)

Every execution of a validation/acceptance run, **of any duration**, is persisted to the
repo before the result is reported to anyone. This is not optional and does not wait to be
asked for.

### Where

- `docs/validation/runs/<YYYY-MM-DD>-<HHMM>-<short-run-id>.md` — one file per run, UTC.
- `docs/validation/INDEX.md` — a single append-only table, newest row at the bottom.
- Raw harness artifacts go in `docs/validation/runs/artifacts/<run-id>/`. `test-results/`
  is gitignored, so anything left only there is lost.

### Per-run file contents

1. **Identity** — UTC timestamp, git commit SHA, dirty-tree flag (and, if dirty, the
   `git diff HEAD` sha256 plus the file list), config hash, the command line used,
   wall-clock duration, hardware.
2. **Configuration** — grid dims + cell count, Re, Cs, precision, τ₀, collision operator,
   every BC flag, body present/absent. Verbatim, not summarized.
3. **Result** — every metric the harness produced. Never omit a metric because it looks
   uninteresting. Where a metric is a large array, summarize in the file and commit the
   raw artifact alongside it.
4. **Verdicts, reported separately** — never collapsed into one PASS/FAIL:
   - `INFRA` — non-finite cells, mass drift, ledger closure, checkpoint/recovery,
     convergence achieved, block spread. Green = the harness is healthy.
   - `PHYSICS_TARGET` — did the measured quantity land in the acceptance band. A miss is
     `PHYSICS_TARGET_MISS`: a research outcome, never reported as an error or a bug.
   - `TOPOLOGY` — `PASS` / `RECORDED` / `FAIL`.
5. **Anomalies** — anything unexpected, stated plainly, with no attempt to diagnose or fix
   it unless asked.

### Immutability

- Run files are append-only. Never edit or delete an existing run file.
- A result later invalidated is **not** removed. Append a `## WITHDRAWN` section stating
  the date, the reason, and the commit or analysis that invalidated it, and flag its INDEX
  row `WITHDRAWN`. The original numbers stay readable forever.
- INDEX rows are only appended or status-flagged, never rewritten.

### Commit

After writing the files, `git add` + `git commit` them:
`validation: <run-id> <primary-metric>=<value> [INFRA=.. PHYSICS=..]`.
This happens even if the run failed, diverged, or crashed — especially then. A crashed run
gets a file too, with whatever partial data exists.

### Reporting

Report the physics result and the infra result as two separate statements, and give the
path to the run file. Do not ask permission to write it.
