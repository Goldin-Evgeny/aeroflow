"""Attribution blocks embedded in every file derived from the AIJ benchmark data.

AIJ's CFD benchmark working group agreed to this repository redistributing derived files
on three conditions (correspondence with Prof. Hideki Kikumoto, August 2026): cite the
data paper and the case's original publications, state that the files are AeroFlow's own
independent work that AIJ does not warrant, and keep source/date/processing in them.

The strings below are the Python side of that contract and must stay byte-identical to
packages/core/src/validation/aijAttribution.ts, which refuses to load a fixture whose
data paper or disclaimer does not match. packages/core/test/aijAttribution.test.ts and
apps/studio/test/aijUrbanArtifacts.test.ts pin the shipped files against the TS side, so
a drift here is caught by `npm test`, not by a reader.
"""

DATA_PAPER = (
    "Kikumoto, H., Okaze, T., Yoshie, R., Tachibana, T., Ishihara, T., Nonomura, Y., "
    "Kiyota, N., Kondo, H., Mochida, A. & Tominaga, Y. (2026), \"Comprehensive Experimental "
    "Database for Validating CFD Simulations in Urban Wind Environment: Benchmark Cases "
    "Curated by the Architectural Institute of Japan\", Japan Architectural Review 9(1), "
    "e70083. https://doi.org/10.1002/2475-8876.70083"
)

LES_GUIDELINE = (
    "Okaze, T., Kikumoto, H., Ikegaya, N., Nakao, K., Ono, H., Nakajima, K., Imano, M., "
    "Hasama, T., Tabata, Y., Kishida, T., Yoshie, R. & Tominaga, Y. (2026), \"AIJ guidelines "
    "on the applications of large-eddy simulation to pedestrian wind environment: "
    "Recommendations and validation benchmarks\", J. Wind Eng. Ind. Aerodyn. 269, 106321. "
    "https://doi.org/10.1016/j.jweia.2025.106321"
)

DISCLAIMER = (
    "These derived files were created and processed independently for AeroFlow. The "
    "Architectural Institute of Japan (AIJ) does not guarantee their quality, accuracy, "
    "completeness, or suitability for any particular purpose."
)

GUIDELINE_2008 = (
    "Tominaga, Y., Mochida, A., Yoshie, R., Kataoka, H., Nozu, T., Yoshikawa, M. & "
    "Shirasawa, T. (2008), \"AIJ guidelines for practical applications of CFD to pedestrian "
    "wind environment around buildings\", J. Wind Eng. Ind. Aerodyn. 96(10-11), 1749-1761. "
    "https://doi.org/10.1016/j.jweia.2008.02.058"
)

CASE_SOURCES = {
    "A": [
        "Meng, Y. & Hibi, K. (1998), \"Turbulent measurements of the flow field around a "
        "high-rise building\", Wind Engineers, JAWE 1998(76), 55-64. "
        "https://doi.org/10.5359/jawe.1998.76_55",
        GUIDELINE_2008,
    ],
    "C": [
        "Nonomura, Y., Kobayashi, N., Tominaga, Y. & Mochida, A. (2003), \"The cross "
        "comparison of CFD prediction for flow field around building blocks (part 3)\", "
        "Summaries of Technical Papers of Annual Meeting, Japan Association for Wind "
        "Engineering 2003, 41. https://doi.org/10.14887/jaweam.2003.0.41.0",
        GUIDELINE_2008,
    ],
    "E": [
        "Yoshie, R., Mochida, A., Tominaga, Y., Kataoka, H., Harimoto, K., Nozu, T. & "
        "Shirasawa, T. (2007), \"Cooperative project for CFD prediction of pedestrian wind "
        "environment in the Architectural Institute of Japan\", J. Wind Eng. Ind. Aerodyn. "
        "95(9-11), 1551-1578. https://doi.org/10.1016/j.jweia.2007.02.023",
        "AIJ (2020), Guidebook for CFD Predictions of Urban Wind Environment (in Japanese), "
        "Architectural Institute of Japan, ISBN 978-4-8189-2718-6.",
        GUIDELINE_2008,
    ],
}

# AIJ's own open republication of each case's measurements (CC BY 4.0). These are the
# datasets of record; the files here were derived from the workbooks on the AIJ guidebook
# page at the checksums each fixture records, not from the Zenodo copies.
DATASETS = {
    "A": {
        "title": "AIJ UWE Benchmark Dataset - Case A (112): Wind Tunnel Experiment for Flow "
        "around a 1:1:2 Shape Building Model (Ishihara, Hibi, Tominaga, Kikumoto & Okaze, 2025)",
        "doi": "https://doi.org/10.5281/zenodo.15050148",
        "license": "CC BY 4.0",
    },
    "C": {
        "title": "AIJ UWE Benchmark Dataset - Case C (Blocks): Wind Tunnel Experiment for Flow "
        "within Simple Building Blocks (Nonomura, Tominaga, Kikumoto & Okaze, 2025)",
        "doi": "https://doi.org/10.5281/zenodo.15401792",
        "license": "CC BY 4.0",
    },
    "E": {
        "title": "AIJ UWE Benchmark Dataset - Case E (Niigata): Wind Tunnel Experiment for Flow "
        "within an Actual Urban Area in Niigata (Tominaga, Kikumoto & Okaze, 2025)",
        "doi": "https://doi.org/10.5281/zenodo.15429018",
        "license": "CC BY 4.0",
    },
}


def attribution(case_id, processing):
    """Build the attribution block for one derived file of `case_id`."""
    return {
        "dataPaper": DATA_PAPER,
        "caseSources": list(CASE_SOURCES[case_id]),
        "dataset": dict(DATASETS[case_id]),
        "implementationGuidance": [LES_GUIDELINE],
        "processing": processing,
        "disclaimer": DISCLAIMER,
    }
