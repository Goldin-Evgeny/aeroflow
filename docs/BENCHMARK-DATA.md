# Obtaining the AIJ benchmark data

The AIJ pedestrian-wind benchmark data is **not redistributed with this repository**. It is
published by the Architectural Institute of Japan and remains their material — see
[NOTICE](../NOTICE). This repository ships the loaders, the conversion scripts and the
scoring code, but you download the data yourself.

Everything else works without it. The 2D playground, the 3D demo, the cavity and cylinder
validations, and the whole test suite run on a fresh clone. Only the AIJ cases need this.

## Citing these data — required

AIJ asks that **users of the benchmark data cite the data paper _and_ the original
publications** for the individual case. This is a condition of use, not a courtesy, and it
applies to you once you download the data below — citing "AIJ" alone does not satisfy it.

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

The converters write all of this — the citations, what the conversion did, and AIJ's
disclaimer — into every file they produce, and the loaders refuse to load an AIJ fixture
that is missing them. So the files on your disk stay self-describing if they travel; you
still have to put the citations in whatever you publish.

**AIJ does not guarantee the converted files.** They are created and processed
independently by these scripts; the authoritative data are the ones AIJ publishes. AIJ has
not reviewed or endorsed AeroFlow or its results. Full terms: [NOTICE](../NOTICE) §1.

## What runs without the data

| Case                     | Without AIJ data                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `?aij` (Case A)          | Runs against a **synthetic placeholder**; the page shows a SYNTHETIC banner and the score is never a verdict |
| `?aijurban` (Cases C, E) | Fails to load with a message pointing here                                                                   |
| `npm test`               | Passes; the artifact-dependent assertions skip themselves                                                    |

## Getting it

1. Download the workbooks from the AIJ CFD guidebook page:
   <https://www.aij.or.jp/jpn/publish/cfdguide/index_e.htm>

   | File                     | SHA-256                                                            |
   | ------------------------ | ------------------------------------------------------------------ |
   | `CaseA(1_1_2).xls`       | `c2fab8c1494e777381c3819cb8874a10d3f1c5595f701d3f83119d09bad74cff` |
   | `CaseC(City_blocks).xls` | `72b031820ef2c0c46977cb12b0b58dae0579258913b44fac96d89ff2d6cccb73` |
   | `CaseE(Niigata).xls`     | `6c4421a81d8f4c7199e83bd02958f8fae0f2701e041f1f0bcd4e25a5981a25d1` |

   Case E geometry additionally needs `CaseE_dxf.zip` from the same page.

   AIJ has also republished each case openly on Zenodo under **CC BY 4.0**, which is the
   clearest licensing to obtain them under. These are each case's dataset of record:

   | Case | Zenodo record                             |
   | ---- | ----------------------------------------- |
   | A    | <https://doi.org/10.5281/zenodo.15050148> |
   | C    | <https://doi.org/10.5281/zenodo.15401792> |
   | E    | <https://doi.org/10.5281/zenodo.15429018> |

   The converters expect the guidebook-page workbook layout, so if you take the Zenodo
   copies you may need to adjust them. The checksums above are what the numbers in
   [VALIDATION.md](VALIDATION.md) were produced from.

2. Put them in `apps/studio/src/sim/cases/data/source/` (gitignored).

3. Convert:

   ```bash
   python scripts/convert-aij-case-a.py    # -> apps/studio/src/sim/cases/data/aij-case-a.json
   python scripts/convert-aij-case-c.py    # -> apps/studio/public/benchmarks/aij/case-c/
   python scripts/convert-aij-case-e.py    # -> apps/studio/public/benchmarks/aij/case-e/
   ```

   The Case A converter overwrites the synthetic placeholder with the measured fixture, and
   the SYNTHETIC banner disappears. To restore the placeholder:

   ```bash
   node scripts/make-synthetic-case-a.mjs
   ```

The checksums above identify the exact inputs the recorded results were produced from. If a
download does not match, the workbook has been revised and the numbers in
[VALIDATION.md](VALIDATION.md) may not be reproducible against it.
