# D2 — Redistributing the AIJ benchmark data: permission, and what it obliges

**Status:** accepted, 2026-08-05
**Affects:** [NOTICE](../../NOTICE), [BENCHMARK-DATA.md](../BENCHMARK-DATA.md),
[VALIDATION.md](../VALIDATION.md), the conversion scripts, the fixture loaders, the
validation UIs and the exported run reports

## Why this record exists

This project validates against the Architectural Institute of Japan's pedestrian-wind
benchmark cases (A, C and E). It does not redistribute AIJ's workbooks, and — since the
commit that stripped them — it does not redistribute values derived from them either. What
ships is the loaders, the scoring code and the offline converters; a developer downloads
the data and converts it on their own machine.

That left a question the project could not answer for itself: **may files derived from AIJ's
published data be redistributed in a public MIT-licensed repository at all, and on what
terms?** Removing the data was a holding position taken while that question was open, not
an answer to it.

It was put to AIJ directly. This record fixes the answer and the obligations that come with
it, so no future change has to re-derive them from an email.

## What was asked, and what AIJ answered

Asked (August 2026, to Hideki Kikumoto, Yoshihide Tominaga and the AIJ CFD guideline
working group): AeroFlow validates against AIJ Cases A, C and E; it does not redistribute
the original workbooks, only derived JSON/glTF recording source URL, SHA-256 and download
date; is redistribution in a public MIT repository, with attribution, acceptable — and is
there preferred wording?

Answered by **Prof. Hideki Kikumoto** (Institute of Industrial Science, The University of
Tokyo), on behalf of the working group: **no objection in principle**, provided three
things are clearly stated and followed.

1. **Users cite the data paper _and_ the original publications** describing the individual
   benchmark cases and experiments, as referenced in the data paper.
2. **It is clearly stated that the derived files were created and processed independently
   for AeroFlow, and that AIJ does not guarantee their quality, accuracy, completeness, or
   suitability for any particular purpose.**
3. **The derived files retain attribution and provenance** — source, download date, and any
   processing or conversion performed.

Two further facts came with the reply and change the surrounding picture:

- The benchmark cases now have a **data paper**: Kikumoto et al. (2026), _Japan
  Architectural Review_ 9(1), e70083, https://doi.org/10.1002/2475-8876.70083. It did not
  exist when this repository's earlier attribution was written, which cited only Tominaga
  et al. (2008).
- The datasets have been **republished openly, per case, under CC BY 4.0** (Zenodo — Case A
  `10.5281/zenodo.15050148`, Case C `10.5281/zenodo.15401792`, Case E
  `10.5281/zenodo.15429018`). These are each case's dataset of record and the clearest
  licensing under which a user can obtain them.

AIJ also asked that implementation and evaluation of the benchmarks refer not only to
Tominaga et al. (2008) but to **Okaze et al. (2026)**, _J. Wind Eng. Ind. Aerodyn._ 269,
106321, https://doi.org/10.1016/j.jweia.2025.106321 — the AIJ LES guideline. AeroFlow is an
LES code, so this is the directly applicable guideline, not background reading.

## Decision

1. **This repository continues to ship no AIJ-derived files.** The permission is recorded
   and available, but not exercised: users obtain the data themselves
   ([BENCHMARK-DATA.md](../BENCHMARK-DATA.md)). Nothing here depends on AIJ's grant, which
   is the most conservative position and costs the project nothing.
2. **The three conditions are nonetheless binding on what this project produces**, because
   the converters generate derived files on users' machines and this project publishes
   numbers scored against AIJ data. They are treated as terms, not as a style preference.
3. **The conditions are enforced by code, not by prose.** A machine-readable `attribution`
   block — data paper, case sources, dataset of record, LES guideline, processing, and
   AIJ's disclaimer verbatim — is written into every file the converters produce, and the
   fixture loaders **refuse to load an AIJ fixture that lacks it**
   ([`aijAttribution.ts`](../../packages/core/src/validation/aijAttribution.ts)). A
   benchmark file that reaches a user without its attribution is a bug, and the loader is
   the place that guarantees it cannot.
4. **The synthetic Case A placeholder carries no AIJ citation.** It contains no AIJ content,
   so claiming AIJ provenance on it would be a false claim; the loader exempts
   `synthetic: true` fixtures from the attribution requirement, and a test asserts the
   fixture is either an unattributed placeholder or fully attributed real data — never
   AIJ measurements without AIJ's citations.
5. **The citation and the disclaimer render next to the score**, on the Case A page and the
   urban validation page, and are copied into every exported run report — not only into
   NOTICE, which a person reading a q value never opens.
6. **The MIT grant still does not extend to these data.** AIJ's permission is permission to
   redistribute with attribution; it is not a relicensing of their measurements.
7. **Okaze et al. (2026) is the LES reference for the benchmark work**, cited from
   NOTICE, BENCHMARK-DATA.md and VALIDATION.md.

## What this record obliges

- Any new AIJ-derived case repeats the pattern: convert with a `scripts/convert-aij-*.py`
  that embeds `attribution(caseId, processing)`, and add the case's own experiment citation
  to `scripts/aij_attribution.py` **and**
  `packages/core/src/validation/aijAttribution.ts`. Adding a case without its experiment
  paper fails the loader by design.
- Published numbers (site, README, papers, posts) carry the data-paper citation plus the
  case's original publications. "Validated against AIJ Case C" alone does not satisfy the
  terms this permission was granted under.
- If this repository ever does ship derived files again, conditions 1–3 apply to them
  directly and the machinery to satisfy them is already in place — but NOTICE §1 must stop
  saying that nothing is redistributed.
- If AIJ's wording ever changes, `AIJ_DISCLAIMER` is the single place to change it; the
  tests pin the converters and any present fixture against that constant.
- The honest-claims rule (CLAUDE.md rule 5) now has a second edge here: AIJ explicitly does
  not warrant these derived files and has not reviewed AeroFlow, so no AeroFlow material may
  imply AIJ endorsement, review or validation of AeroFlow's results.
