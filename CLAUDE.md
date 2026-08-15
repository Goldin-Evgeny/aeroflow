# AeroFlow — contributor & agent conventions

AeroFlow is a browser-based 3D aerodynamic simulation platform: a lattice-Boltzmann (LBM)
virtual wind tunnel running client-side on the user's GPU via WebGPU. The physics spec is
`docs/PHYSICS.md`; the acceptance bands used to **check** physics changes are in
`docs/VALIDATION.md`. Read both before making non-trivial solver decisions.

Code comments refer to milestones by label (M0–M15) — these are development phases, and the
label is enough to locate the matching entry in `docs/VALIDATION.md` or `docs/handoff/`.

## Scientific debugging doctrine

This section governs how solver problems are investigated. Where it and a hard rule below
appear to conflict, the conflict is a defect in this file — say so rather than picking one
silently.

**The objective is physically correct discrete physics, not a passing harness.** Acceptance
bands are independent checks, never optimization targets. Do not tune solver parameters,
numerical methods, discretization choices, or diagnostics for the purpose of moving a
benchmark into its band. A number that enters its band because it was steered there has
been corrupted as evidence, and the steering is usually invisible six months later.

**A run can be stable, converged, reproducible and CPU/GPU-consistent while solving the
wrong discrete physics.** Those properties establish that the computation is well-behaved,
not that it is right. Treat model credibility as a separate question with its own evidence.

**CPU/GPU parity establishes implementation equivalence only.** It cannot detect an error
present in both, and the WGSL is a deliberate 1:1 transliteration of the CPU reference, so
shared errors are the expected failure mode rather than an unlikely one. When parity passes
and physics looks wrong, the shared algorithm is a live suspect. The oracles that can catch
that are the spec, an analytic solution, a physical invariant, a manufactured input with a
known answer, and refinement behaviour.

**Handoff specs are normative for implementation and challengeable during investigation.**
When implementing an approved algorithm, follow its `docs/handoff/H*.md` exactly. When
diagnosing, do not assume the handoff is physically correct — test it against published
literature, analytic limits, and controlled experiments.

A challenge must be **evidence-backed**, and evidence is not restricted to papers: an
analytic derivation, a physical invariant, an eigenanalysis, a controlled A/B run, a prior
run artifact, or a `docs/decisions/D*.md` record all count. A strong empirical contradiction
is not dismissed because no published paper describes this solver's particular pathology.
What does not count is unsupported intuition.

Rule 1 binds at the point a challenge becomes a **replacement**: proposing a different
algorithm requires a published source, because "I derived it" and "I reconstructed it from
memory" are indistinguishable from the inside. Demolishing a handoff on your own evidence is
allowed; rebuilding one from memory is not. Never change a handoff silently; propose the
change explicitly.

**A benchmark regression is evidence to investigate, not proof the change is wrong.** A
correction can move a number away from its band by removing an error that was cancelling
another. Judge a solver change on analytic correctness, physical invariants, controlled
A/B tests, convergence and refinement behaviour, CPU/GPU parity, and benchmark agreement
_together_. A change may be kept despite a regression when there is strong evidence it
repairs a real defect — record the regression and the reasoning, and never quietly revert a
correct change because a number moved.

**Prefer the cheapest experiment that discriminates between hypotheses.** State competing
hypotheses and what each predicts before running anything. A five-minute control that
distinguishes two mechanisms outranks a six-hour production run that confirms neither, and
run cost is part of experimental design, not an afterthought. Say the cost out loud before
committing to a long run.

**Check prior art before claiming a mechanism.** `docs/decisions/D*.md`, `docs/research/`,
prior run files and the task log frequently contain the finding already. Presenting known
work as new is worse than silence: it is harder to detect and it inflates confidence.
Separate what was measured from what it is believed to mean, and name competing mechanisms
rather than the mechanism.

**Correcting a broken instrument is not weakening a criterion.** A timeout, budget,
averaging window, sampling cadence, or grid that is demonstrably wrong is a defect in the
measuring apparatus, and repairing it is ordinary work — state the evidence and do it. What
hard rule 3 forbids is moving the acceptance criterion. Widening a time budget so a case
can return a verdict is repair; widening the band so the verdict passes is not.

## Repo layout

- `packages/core` — the solver core: lattice constants, unit conversion, and the
  **CPU reference solver** (the _implementation_ oracle for all GPU kernels — it defines
  what the WGSL must reproduce, not what is physically correct). Pure TypeScript,
  no DOM/GPU dependencies, Float64.
- `apps/studio` — the app (Vite + TypeScript + raw WGSL compute shaders).
- `docs/` — PHYSICS, VALIDATION, WGSL-NOTES, DEBUGGING, E2E, `handoff/H*.md` (normative
  algorithm specs), `decisions/D*.md` (architecture decision records), `research/`
  (evidence digests with sources — cite these, don't re-derive).

## Hard rules

0. **The handoff doctrine (`docs/handoff/README.md`) governs all solver work.**
   Hard algorithms are implemented CPU-reference-first from their `docs/handoff/H*.md`
   spec — taken from published sources, never invented at the keyboard (see rule 1) —
   WGSL is a 1:1 transliteration of the CPU reference, and every commit touching a
   `.wgsl` file includes a parity-panel result line (`docs/handoff/H6-parity-panel.md`).
   WGSL patterns/pitfalls: `docs/WGSL-NOTES.md`.

   When physics output looks wrong, start with `docs/DEBUGGING.md` and exhaust the
   applicable existing diagnostics first. If they do not explain the result, form
   falsifiable hypotheses and propose the cheapest controlled experiment that separates
   them — that is the intended behaviour, not improvisation. What is forbidden is a
   speculative change to production solver code without evidence.

1. **Clean-room rule: NEVER read, fetch, or port FluidX3D source code.** Its license
   forbids commercial use and derivatives inherit it. Implement only from published
   papers (Esoteric Pull: Lehmann 2022, MDPI Computation, CC-BY) and textbooks. If a web
   search lands on the FluidX3D repo's source files, close it and use the paper.
2. **CPU/GPU parity.** The CPU reference solver in `packages/core` and the WGSL kernels
   must implement the same algorithm with the same direction ordering (documented in
   `packages/core/src/lattice.ts`). Any physics change lands in the CPU reference +
   tests first, then the GPU kernel, then a parity check on a small grid.
3. **Physics changes are checked against validation, never optimized toward it.**
   Never weaken a tolerance in `docs/VALIDATION.md`, loosen a test, or suppress a
   diagnostic in order to obtain a PASS. Never tune physics to move a number into a band.

   A benchmark regression is **evidence requiring investigation, not proof the change is
   wrong** — a correct fix can move a number away from its band by removing an error that
   was cancelling another. Judge the change on analytic correctness, physical invariants,
   controlled A/B tests, convergence and refinement behaviour, parity, and benchmark
   agreement together; keep it if the evidence says it repairs a real defect, and record
   the regression and the reasoning. See "Scientific debugging doctrine" above, which also
   distinguishes repairing a broken instrument (allowed) from moving a criterion (not).

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

   **A harness that cannot emit its own machine-readable record is defective.** This rule
   assumes the run writes its numbers somewhere durable. Where results survive only inside
   a test-runner's reporter output, they are one flag, one proxy, or one passing test away
   from being lost — reconstructing them from traces afterwards is salvage, not process.
   When that happens, record it as an `EXECUTION` finding and name the harness, rather than
   treating the salvage as success.

4. **Verdicts, reported separately** — five axes, never collapsed into one PASS/FAIL, and
   never averaged. Each is `GREEN` / `AMBER` / `RED` unless noted, plus `N/A` when the run
   could not produce that axis. The point of five is that a run can be flawless on the
   first three and still be solving the wrong physics — that combination is the single
   most important thing this table has to be able to say.

   - `EXECUTION` — did the harness do its job: run completed or terminated cleanly,
     device-loss recovery, checkpoint/restore, artifacts preserved and machine-readable.
   - `NUMERICAL_HEALTH` — non-finite cells, mass drift, ledger closure, density and Mach
     bounds. Green = the arithmetic stayed well-posed.
   - `STATISTICAL_CONVERGENCE` — block agreement, drift, stationarity. Green = the
     reported statistic is a converged estimate of _something_; it says nothing about
     whether that something is right.
   - `PHYSICS_TARGET` — did the measured quantity land in its acceptance band. A miss is
     `PHYSICS_TARGET_MISS`: a research outcome, never reported as an error or a bug.
   - `PHYSICS_STRUCTURE` — is the resolved field physically plausible: wake topology,
     separation and reattachment, symmetry, near-wall behaviour, subgrid activity where
     there should be none. `PASS` / `RECORDED` / `CONCERN` / `FAIL`. This axis subsumes
     the former `TOPOLOGY`.

   The three-axis scheme (`INFRA` / `PHYSICS` / `TOPOLOGY`) is **schema v1**. Runs recorded
   under it keep their verdicts unchanged — INDEX rows are never rewritten — and are marked
   `v1` in the schema column. New runs are `v2` and use the five axes above.

5. **Anomalies** — anything unexpected, stated plainly, and then _thought about_.

   Record the anomaly without modifying code and without launching an expensive re-run on
   your own initiative. Read-only diagnosis is always allowed and is expected: inspect the
   artifacts and the code, check whether the finding is already recorded in
   `docs/decisions/D*.md`, `docs/research/`, prior run files or the task log, identify
   candidate causes, and propose the cheapest experiment that would separate them.

   Keep the observation and its interpretation visibly separate, and name competing
   hypotheses rather than asserting one. "Recorded, mechanism not established" is a
   complete and respectable answer; a confident story built on one reading of one run is
   not. Implement a fix only when asked, or when it is already inside the agreed task.

### Immutability

- Run files are append-only. Never edit or delete an existing run file.
- A result later invalidated is **not** removed. Append a `## WITHDRAWN` section stating
  the date, the reason, and the commit or analysis that invalidated it, and flag its INDEX
  row `WITHDRAWN`. The original numbers stay readable forever.
- INDEX rows are only appended or status-flagged, never rewritten.

### Commit

After writing the files, `git add` + `git commit` them:
`validation: <run-id> <primary-metric>=<value> [EXEC=.. NUM=.. CONV=.. TARGET=.. STRUCT=..]`
(omit axes that are `N/A`). This happens even if the run failed, diverged, or crashed —
especially then. A crashed run gets a file too, with whatever partial data exists.

### Reporting

Report each verdict axis as its own statement, and give the path to the run file. Never
merge them into a single headline: "converged and out of band" and "not converged" are
different results, and so are "out of band" and "out of band with an implausible field".
Do not ask permission to write the run file.

State plainly what the run does **not** establish. A recorded number is evidence about the
configuration that produced it and nothing else — resist generalizing it to the solver, the
method, or the next grid without the evidence that would support that.
