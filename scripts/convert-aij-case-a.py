#!/usr/bin/env python3
"""Convert the AIJ Case A workbook into the repo's raw validation fixture (M10 step 5).

Source (downloaded 2026-07-20 through a real browser; the AIJ site sits behind an AWS
WAF browser challenge that a plain HTTP fetch cannot pass):

    https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseA%281_1_2%29.xls
    sha256 c2fab8c1494e777381c3819cb8874a10d3f1c5595f701d3f83119d09bad74cff

The fixture stores the measurements RAW — lengths in units of b, velocities in m/s,
exactly as tabulated — so the file stays a verbatim record of the wind-tunnel data.
Normalization by the reference velocity happens in the loader
(packages/core/src/validation/aijCaseA.ts), where it is one visible, testable constant.

Usage (needs xlrd, which is NOT a project dependency — use a throwaway venv):
    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install xlrd
    /tmp/venv/bin/python scripts/convert-aij-case-a.py <path-to-xls> <out.json>

KNOWN SOURCE DEFECT: in the 'z=1.25b' sheet the z column reads 0.125 for all 60 rows
(stale, copied from the z=0.125b sheet and never updated). The plane height is therefore
taken from the sheet TITLE for that plane, not from the column. Verified 2026-07-20.
"""

import hashlib
import json
import sys

import xlrd

from aij_attribution import attribution

# AIJ requires each derived file to record what was done to the source data (see
# scripts/aij_attribution.py).
FIXTURE_PROCESSING = (
    "Converted by scripts/convert-aij-case-a.py from the AIJ Case A workbook: the Inflow "
    "and three Results sheets transcribed verbatim to JSON in the workbook's own units "
    "(lengths in multiples of b, velocity components in raw m/s), with the z=1.25b "
    "plane's height taken from the sheet title to work around a stale z column in the "
    "source. Nothing is normalized here; the loader divides by uRefMps."
)

B_METERS = 0.08  # prism width; the building is 1:1:2, so H = 2b = 0.16 m
# Reference velocity: the Inflow sheet's tabulated U at z/b = 2.0 (= building height H).
# Exact table entry, no interpolation. The workbook itself states no normalization
# convention (every cell of all five sheets was searched), so this choice is ours and is
# recorded here rather than baked into the numbers.
U_REF_ZOVERB = 2.0

PLANES = [
    ("Results (Ver. sec.)", "vertical-centerplane", None),
    ("Results(Hol. sec.; z=0.125b）", "horizontal-0.125b", 0.125),
    ("Results (Hol. sec.; z=1.25b）", "horizontal-1.25b", 1.25),
]


def rows(sheet, z_override):
    """Yield measurement rows; header is row 1, data starts at row 2."""
    out = []
    for r in range(2, sheet.nrows):
        idx = sheet.cell_value(r, 0)
        if idx == "":
            continue
        z = z_override if z_override is not None else sheet.cell_value(r, 3)
        out.append(
            {
                "i": int(idx),
                "xOverB": sheet.cell_value(r, 1),
                "yOverB": sheet.cell_value(r, 2),
                "zOverB": z,
                "U": sheet.cell_value(r, 4),
                "V": sheet.cell_value(r, 5),
                "W": sheet.cell_value(r, 6),
                "sigmaU": sheet.cell_value(r, 7),
                "sigmaV": sheet.cell_value(r, 8),
                "sigmaW": sheet.cell_value(r, 9),
                "k": sheet.cell_value(r, 10),
            }
        )
    return out


def main(xls_path, out_path):
    with open(xls_path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    book = xlrd.open_workbook(xls_path)

    inflow = []
    sheet = book.sheet_by_name("Inflow")
    for r in range(2, sheet.nrows):
        if sheet.cell_value(r, 1) == "":
            continue
        inflow.append(
            {
                "zOverB": sheet.cell_value(r, 1),
                "U": sheet.cell_value(r, 2),
                "sigmaU": sheet.cell_value(r, 3),
                "sigmaV": sheet.cell_value(r, 4),
                "sigmaW": sheet.cell_value(r, 5),
                "k": sheet.cell_value(r, 6),
            }
        )

    u_ref = next(p["U"] for p in inflow if p["zOverB"] == U_REF_ZOVERB)

    planes = []
    for name, slug, z_override in PLANES:
        pts = rows(book.sheet_by_name(name), z_override)
        entry = {"name": slug, "sheet": name, "points": pts}
        if z_override is not None:
            entry["zFromSheetTitle"] = True
        planes.append(entry)

    fixture = {
        "source": (
            "AIJ Guidebook for CFD Predictions of Urban Wind Environment, Case A "
            "(isolated 1:1:2 prism; split-film wind-tunnel measurements by Meng & Hibi). "
            "Downloaded 2026-07-20 from "
            "https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseA%281_1_2%29.xls "
            "(linked from https://www.aij.or.jp/jpn/publish/cfdguide/index_e.htm). "
            "Official AIJ distribution, not a mirror."
        ),
        "attribution": attribution("A", FIXTURE_PROCESSING),
        "synthetic": False,
        "sourceFile": "CaseA(1_1_2).xls",
        "sourceSha256": digest,
        "retrieved": "2026-07-20",
        "units": {
            "length": "multiples of b (multiply by bMeters for model-scale meters)",
            "velocity": "m/s, as tabulated (NOT normalized)",
            "k": "m2/s2",
        },
        "coordinates": (
            "Data convention: origin at the building center on the ground, x streamwise "
            "(+x downstream), y lateral, z vertical (up)."
        ),
        "bMeters": B_METERS,
        "buildingHeightMeters": 2 * B_METERS,
        "uRefMps": u_ref,
        "uRef": (
            f"{u_ref} m/s = the Inflow sheet's tabulated approach-flow U at z/b = "
            f"{U_REF_ZOVERB} (building height H = 2b). Exact table entry, no "
            "interpolation. The workbook states no normalization convention of its own, "
            "so this reference is the repo's documented choice; velocities in this file "
            "are RAW m/s and consumers divide by uRefMps."
        ),
        "notes": [
            "Source defect: the 'z=1.25b' sheet's z column reads 0.125 for every row "
            "(stale copy of the z=0.125b sheet). zOverB for that plane is taken from the "
            "sheet title instead; zFromSheetTitle marks the affected planes.",
            "M10 scores the vertical centerplane and the horizontal 0.125b plane (the "
            "2.5 m full-scale pedestrian level). The 1.25b plane is retained for "
            "completeness and is not part of the gate.",
        ],
        "inflow": inflow,
        "planes": planes,
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(fixture, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"wrote {out_path}")
    print(f"  uRefMps = {u_ref}")
    print(f"  inflow samples = {len(inflow)}")
    for p in planes:
        print(f"  plane {p['name']}: {len(p['points'])} points")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
