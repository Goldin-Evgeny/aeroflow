# The AIJ benchmark data in this repository

The AIJ pedestrian-wind cases are AeroFlow's urban validation targets (V12–V15 in
[VALIDATION.md](VALIDATION.md)). This page covers what ships here, what you must cite, and
how to regenerate the files from AIJ's originals.

**What ships:** the derived files — measurement values and geometry converted into JSON and
glTF for the solver — redistributed with the agreement of the AIJ CFD guideline working
group, on the terms in [NOTICE](../NOTICE) §1.

**What does not:** AIJ's original `.xls` workbooks and DXF archive. Those remain AIJ's
publication; they are gitignored inputs to the offline converters in `scripts/`.

## Citing these data — required

AIJ asks that **users of the benchmark data cite the data paper _and_ the original
publications** for the individual case. This is a condition of use, not a courtesy, and it
applies to you as soon as you use these fixtures or publish a number scored against them —
citing "AIJ" alone does not satisfy it.

Cite for any case:

> Kikumoto, H., Okaze, T., Yoshie, R., Tachibana, T., Ishihara, T., Nonomura, Y., Kiyota, N.,
> Kondo, H., Mochida, A. & Tominaga, Y. (2026), "Comprehensive Experimental Database for
> Validating CFD Simulations in Urban Wind Environment: Benchmark Cases Curated by the
> Architectural Institute of Japan", _Japan Architectural Review_ 9(1), e70083.
> <https://doi.org/10.1002/2475-8876.70083>

Plus the experiment behind the case you use:

| Case | Original publication                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Meng & Hibi (1998), _Wind Engineers, JAWE_ 1998(76), 55-64. <https://doi.org/10.5359/jawe.1998.76_55>                                                                                               |
| C    | Nonomura, Kobayashi, Tominaga & Mochida (2003), _JAWE Annual Meeting_ 41. <https://doi.org/10.14887/jaweam.2003.0.41.0>                                                                             |
| E    | Yoshie et al. (2007), _JWEIA_ 95(9-11), 1551-1578. <https://doi.org/10.1016/j.jweia.2007.02.023>, and AIJ (2020), _Guidebook for CFD Predictions of Urban Wind Environment_, ISBN 978-4-8189-2718-6 |

Two guideline papers govern how these cases are set up and scored. **If you are running an
LES code — as AeroFlow is — Okaze et al. (2026) is the directly applicable one**; AIJ asked
specifically that it be used alongside Tominaga et al. (2008):

- Tominaga et al. (2008), _JWEIA_ 96(10-11), 1749-1761. <https://doi.org/10.1016/j.jweia.2008.02.058>
- Okaze et al. (2026), "AIJ guidelines on the applications of large-eddy simulation to
  pedestrian wind environment: Recommendations and validation benchmarks", _JWEIA_ 269, 106321. <https://doi.org/10.1016/j.jweia.2025.106321>

Every derived file carries these citations, what the conversion did, and AIJ's disclaimer in
an `attribution` block, and the loaders **refuse to load** a file that has lost or altered
them. The citation and disclaimer also render beside the score in the app and are copied
into every exported run report — so an artifact stays self-describing if it travels. You
still have to put the citations in whatever you publish.

**AIJ does not guarantee these files.** They were created and processed independently for
AeroFlow; the authoritative data are the ones AIJ publishes. AIJ has not reviewed or
endorsed AeroFlow or its results. Full terms: [NOTICE](../NOTICE) §1.

## Where AIJ publishes the data

AIJ has republished each case openly on Zenodo under **CC BY 4.0**. These are each case's
dataset of record and the clearest licensing to obtain the originals under:

| Case | Zenodo record                             |
| ---- | ----------------------------------------- |
| A    | <https://doi.org/10.5281/zenodo.15050148> |
| C    | <https://doi.org/10.5281/zenodo.15401792> |
| E    | <https://doi.org/10.5281/zenodo.15429018> |

The workbooks are also on the AIJ CFD guidebook page:
<https://www.aij.or.jp/jpn/publish/cfdguide/index_e.htm>

## Regenerating the derived files

The files here were derived from the guidebook-page workbooks, not the Zenodo copies. To
reproduce them:

1. Download the workbooks and verify them against the checksums the conversion was run
   against:

   | File                     | SHA-256                                                            |
   | ------------------------ | ------------------------------------------------------------------ |
   | `CaseA(1_1_2).xls`       | `c2fab8c1494e777381c3819cb8874a10d3f1c5595f701d3f83119d09bad74cff` |
   | `CaseC(City_blocks).xls` | `72b031820ef2c0c46977cb12b0b58dae0579258913b44fac96d89ff2d6cccb73` |
   | `CaseE(Niigata).xls`     | `6c4421a81d8f4c7199e83bd02958f8fae0f2701e041f1f0bcd4e25a5981a25d1` |

   Case E geometry additionally needs `CaseE_dxf.zip` (sha256
   `58d0f99015f874eec1cb7f881e736f6643268c504bcf4eeae6b652388383158f`) from the same page.

   If a download does not match, the workbook has been revised and the numbers in
   [VALIDATION.md](VALIDATION.md) may not be reproducible against it.

2. Put them in `apps/studio/src/sim/cases/data/source/` (gitignored).

3. Convert:

   ```bash
   python scripts/convert-aij-case-a.py    # -> apps/studio/src/sim/cases/data/aij-case-a.json
   python scripts/convert-aij-case-c.py    # -> apps/studio/public/benchmarks/aij/case-c/
   python scripts/convert-aij-case-e.py    # -> apps/studio/public/benchmarks/aij/case-e/
   ```

The converters rewrite the files in place, attribution block included. Adding a new AIJ case
means adding its experiment citation to **both** `scripts/aij_attribution.py` and
`packages/core/src/validation/aijAttribution.ts` — a case without its own publication fails
the loader by design, and a test pins the two files against each other byte for byte.

## The synthetic Case A placeholder

`scripts/make-synthetic-case-a.mjs` writes an analytic stand-in over
`apps/studio/src/sim/cases/data/aij-case-a.json` — a power-law inflow with a crude wake,
matching the schema and containing no AIJ content. It exists for schema work without the
real data present.

It carries **no** AIJ citation, deliberately: claiming AIJ provenance for data AIJ did not
produce is the same defect as dropping the citation from data they did. The loader exempts
`synthetic: true` fixtures from the attribution requirement, the app shows a SYNTHETIC
banner, and any score against it is never presented as a result. To restore the real
fixture, re-run `scripts/convert-aij-case-a.py` or check the file out of git.
