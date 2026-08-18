## Context

See `proposal.md` for motivation. The relevant foundation already exists:

- The CPU near-floor factorial reproduces the zero-gradient/`spec`/regularized failure at step 3346 and shows the pressure-outlet pair remains finite, but samples only coarse global summaries and does not localize the feedback path.
- `freestreamEddyViscosity` accepts one fixed face-exclusion distance. The 20,000-step run showed that a no-slip ground can reach beyond that selection, invalidating its analytic-zero interpretation.
- Urban runs already record whole-field health and boundary-flux closure; Case A/fetch records whole-field health but does not enable the open-boundary ledger. The artifact schema can express metric limits and unevaluated reasons, but most case-specific limits are absent.
- `bands.ts` is the authoritative band source, but current measured outcomes and open defects remain duplicated in prose. That duplication left a falsified Q27 rounding explanation active in `PHYSICS.md`.

This change crosses CPU analysis, browser validation, artifact policy, and documentation, so a design is needed even though it changes no production solver default.

## Goals / Non-Goals

**Goals:**

- Produce a deterministic, bounded outlet A/B that identifies the first observable separation before non-finite failure.
- Separate a truly boundary-free analytic-zero LES oracle from wall-bounded boundary-layer diagnostics.
- Turn AIJ numerical health from partially recorded evidence into a predeclared, machine-scoreable validity axis.
- Make current outcomes and defect/explanation status auditable from the same machine-readable ledger as their bands.

**Non-Goals:**

- Selecting or implementing a replacement collision operator, outlet rule, or LES sensor.
- Flipping the default from `legacy` to `spec` or changing `Cs`, `tau0`, acceptance bands, or physics tolerances.
- Closing the natural GPU-stall root cause, repairing SwiftShader, or running a production-scale V11/V14 acceptance case.
- Repairing the Q27 momentum drift; this change only removes the explanation already contradicted by evidence.

## Decisions

### D1 — Fork the outlet pair from a common deterministic initial state

Extend the existing CPU near-floor harness rather than create a GPU-first experiment. Build both arms from one canonical configuration, serialize or hash the initialized populations, and assert that the initial states and all material settings are identical before applying their distinct outlet rules. Run same-outlet A/A controls through the sampling path so the repeatability floor is measured before interpreting the A/B.

The first pass uses the existing small reproducer, `tau0 = 0.5000005`, `Cs = 0.1`, `lesNorm = spec`, TRT, regularization, and the same fixed step exposure that crosses step 3346. This is cheap enough to rerun and already reproduces the issue.

Alternative: instrument a production GPU Ahmed run. Rejected because it adds asynchronous execution and hours of cost before the CPU mechanism is localized.

### D2 — Record a synchronized causal-boundary bundle, not more unrelated scalar maxima

At each shared sample step, each arm records:

- total mass, momentum, density extrema, and first non-finite location;
- inlet and outlet mass/momentum exchange separately, plus cumulative closure;
- streamwise density and velocity profiles near the outlet;
- `tauEff`, `nu_t/nu_mol`, and strain-audit summaries by distance from the outlet and ground;
- resolved spectral energy grouped into 2–4, 4–8, and greater-than-8-cell wavelength bands.

The comparison computes the earliest interval where an A/B difference exceeds the A/A repeatability floor and records every candidate metric at that same interval. Thresholds are fixed from exact/roundoff expectations and the A/A control before examining the A/B result. The output branches are `outlet-feedback-observed`, `no-separation-in-exposure`, and `inconclusive`; none is named after an unmeasured internal cause.

Alternative: only compare divergence steps. Rejected because it reconfirms the known symptom without locating whether density/flux feedback precedes high-wavenumber and LES growth or follows it.

### D3 — Use a fully periodic uniform-flow run as the dynamic analytic-zero oracle

Keep the existing manufactured-field unit oracle for instrument correctness. Add a dynamic CPU `Solver3D` oracle with periodic x/y/z boundaries, a uniform mean flow, the acceptance-tier `tau0`, selectable closure convention, and no forcing or solid cells. Uniform flow is an exact solution with no boundary layer, so every cell remains eligible and any generated subgrid activity is numerical.

Wall-bounded empty-tunnel measurements remain valuable but are relabelled boundary-influenced diagnostics. Their selector derives the conservative exclusion for each measurement window from the largest observed boundary-influence distance; if no region survives, the analytic-zero verdict is unavailable. A fixed three-cell exclusion is never extrapolated to a longer run.

Alternative: increase the fixed exclusion until the 20,000-step sample looks clean. Rejected because it chooses validity from the observed answer and will fail again at another duration.

### D4 — Put health policy beside each acceptance entry and preserve it in artifacts

Extend each applicable acceptance-ledger entry with a numerical-health policy naming required metrics, limits, units, comparison direction, and provenance. Treat these as validity guards, not physics bands. New limits are committed and tested before any result that they judge is run; they cannot be tuned in the same evidence commit after seeing a failure.

Reuse the existing artifact metric representation (`value`, `limit`, `pass`, `unit`) rather than bumping the artifact schema solely for populated fields it already supports. Each written health sample carries the concrete policy values, so later ledger changes do not reinterpret an old artifact. Case A/fetch enables the same complete-shell open-boundary conservation accounting already used by compatible 3D runs; urban continues using its existing closure sample.

The final artifact policy is:

1. any non-finite field is `fail` and suppresses a trustworthy physics verdict;
2. all required metrics present and inside limits is `pass`;
3. a missing metric or limit is `unevaluated` and retains the physics measurement without promoting it as a valid verdict.

Alternative: copy H14 limits into AIJ without provenance. Rejected because limits valid for one scene/window are not automatically valid for another and would turn a missing contract into an arbitrary one.

### D5 — Extend `bands.ts` into the validation ledger without deleting history

Keep `ACCEPTANCE_BANDS` and add typed current-outcome and defect records in the same validation module. Outcome records point to durable run artifacts and include revision, conventions, observation time, and comparison result. Defect records use stable IDs and the statuses `open`, `mitigated`, `closed`, or `superseded`; operational mitigation and causal closure remain separate records when necessary.

Add consistency tests for the validation summary, defect inventory, and causal statements that affect current interpretation. Historical narrative may remain in documentation, but a superseded explanation must be labelled as such and cannot remain the current explanation. The Q27 rounding text becomes an explicitly superseded hypothesis linked to the measured superlinear drift evidence.

Alternative: maintain a second Markdown defect table. Rejected because the current failure is precisely that independently edited prose drifts.

### D6 — Evidence commits do not contain a guessed production repair

The implementation ends by committing the bounded run artifacts and recording which discriminator branch occurred. If the result points to a repair, that repair receives a separate proposal with its own published basis, parity requirements, and regression ladder. This preserves the distinction between identifying a mechanism and validating a solver change.

## Risks / Trade-offs

- **[Risk] CPU and production GPU separate at the identified boundary.** → Record the CPU result as a discriminator, not a GPU proof; any later repair proposal includes a bounded GPU confirmation before acceptance reruns.
- **[Risk] Spectral or boundary diagnostics perturb runtime enough to move the failure.** → Sample from snapshots at a coarse fixed cadence, include an uninstrumented reproducer control, and compare divergence step against the established 3346 result.
- **[Risk] Fully periodic uniform flow stays exactly uniform and therefore misses noise injected by boundaries.** → That is intentional for the analytic-zero oracle; the wall-bounded run remains a separate diagnostic for boundary-generated contamination.
- **[Risk] New health limits become disguised acceptance tuning.** → Require invariant/numerical provenance, commit limits before results, and keep health status separate from the physics-target axis.
- **[Risk] Adding current outcomes to `bands.ts` makes it unwieldy.** → Keep typed arrays and lookup helpers separate within the validation module; split physical files later only if the single exported ledger remains authoritative.
- **[Risk] Documentation checks become brittle prose matching.** → Verify stable IDs, values, statuses, and evidence references or generate compact tables; do not snapshot entire paragraphs.

## Migration Plan

1. Add ledger types and populate them from existing durable evidence without changing any gate status.
2. Add health policies and artifact scoring tests before enabling new assertions in AIJ runners.
3. Add the periodic oracle and time-valid selector tests, then relabel contaminated historical measurements without rewriting their raw values.
4. Extend and run the outlet discriminator, commit its machine-readable artifact and human run record, then update the ledger from that evidence.
5. Correct generated/verified documentation, including the Q27 explanation, and run strict OpenSpec plus repository verification.

Rollback is a normal revert of the change. Existing schema-2 artifacts remain readable because their shape is unchanged; no stored result is migrated or silently rescored.
