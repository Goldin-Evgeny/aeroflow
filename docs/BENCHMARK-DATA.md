# Obtaining the AIJ benchmark data

The AIJ pedestrian-wind benchmark data is **not redistributed with this repository**. It is
published by the Architectural Institute of Japan and remains their material — see
[NOTICE](../NOTICE). This repository ships the loaders, the conversion scripts and the
scoring code, but you download the data yourself.

Everything else works without it. The 2D playground, the 3D demo, the cavity and cylinder
validations, and the whole test suite run on a fresh clone. Only the AIJ cases need this.

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
