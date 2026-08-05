#!/usr/bin/env python3
"""Convert the official AIJ Case C workbook to a raw, provenance-preserving fixture.

Source (official AIJ distribution):

    https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseC%28City_blocks%29.xls
    sha256 72b031820ef2c0c46977cb12b0b58dae0579258913b44fac96d89ff2d6cccb73

The workbook stores physical wind-tunnel meters and velocities. Coordinates remain in
model meters: multiplying them by a geometric scale before solving would change Reynolds
number. The workbook itself states no model/full-scale ratio, so no full-scale equivalent
is invented here.

The Geometry sheet establishes H = 0.2 m: surrounding buildings are H-cubes with 0.2 m
footprints, arranged on a 0.4 m center grid (0.2 m clear gaps); the selected center is 2H.
Result columns 0H/1H/2H are all retained, while `speed` explicitly selects 2H.

Positive source angles rotate the downstream arrow from +X toward +Y. With source +X
treated as local east and +Y as local north, source 0/22.5/45 degrees become
meteorological FROM 270/247.5/225 degrees respectively.

Usage (xlrd is conversion tooling, not a project runtime dependency):
    python3 -m venv /tmp/aij-venv
    /tmp/aij-venv/bin/pip install xlrd
    /tmp/aij-venv/bin/python scripts/convert-aij-case-c.py <source.xls> <out.json> <out.glb>
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import xlrd

from aij_attribution import attribution
from aij_glb import write_glb

# AIJ requires each derived file to record what was done to the source data (see
# scripts/aij_attribution.py); these two strings are that record for Case C.
FIXTURE_PROCESSING = (
    "Converted by scripts/convert-aij-case-c.py from the AIJ Case C workbook: the "
    "Inflow and Results(0/22.5/45_deg) sheets transcribed to JSON in the workbook's own "
    "units (model meters, m/s), all 0H/1H/2H result columns retained per probe with 2H "
    "selected into `speed`, and workbook angles converted to meteorological FROM "
    "bearings. No measurement value is rescaled, smoothed or interpolated."
)
GEOMETRY_PROCESSING = (
    "Converted by scripts/convert-aij-case-c.py from the AIJ Case C workbook Geometry "
    "sheet: the 3x3 block layout (H = 0.2 m cubes on a 0.4 m center grid, 2H center "
    "building) rebuilt as triangulated boxes and written as glTF with workbook "
    "(X,Y,Z) -> glTF (X,Z,-Y)."
)

SOURCE_SHA256 = "72b031820ef2c0c46977cb12b0b58dae0579258913b44fac96d89ff2d6cccb73"
SOURCE_URL = (
    "https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseC%28City_blocks%29.xls"
)
EXPECTED_SHEETS = [
    "Geometry",
    "Inflow",
    "Results(0_deg)",
    "Results(22.5_deg)",
    "Results(45_deg)",
]
VARIANTS = {"0H": 5, "1H": 6, "2H": 7}
SELECTED_VARIANT = "2H"
PROBE_HEIGHT_METERS = 0.02
SOURCE_DIRECTIONS = {
    "Results(0_deg)": 0.0,
    "Results(22.5_deg)": 22.5,
    "Results(45_deg)": 45.0,
}
EXPECTED_GEOMETRY_VERTICES = 72
EXPECTED_GEOMETRY_TRIANGLES = 108


def close(actual, expected, tolerance=1e-12):
    return math.isclose(actual, expected, rel_tol=0.0, abs_tol=tolerance)


def number(sheet, row, column, label):
    value = sheet.cell_value(row, column)
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{sheet.name}: {label} at row {row + 1} is not finite")
    return float(value)


def parse_inflow(book):
    sheet = book.sheet_by_name("Inflow")
    if [sheet.cell_value(1, column) for column in range(1, 5)] != [
        "Z(mm)",
        "Z(m)",
        "U (m/s)",
        "σu (m/s)",
    ]:
        raise ValueError("Inflow: unexpected header")
    samples = []
    for row in range(2, sheet.nrows):
        if sheet.cell_value(row, 1) == "":
            continue
        z_mm = number(sheet, row, 1, "Z(mm)")
        z_m = number(sheet, row, 2, "Z(m)")
        if not close(z_mm * 1e-3, z_m):
            raise ValueError(f"Inflow: inconsistent millimeter/meter height at row {row + 1}")
        samples.append(
            {
                "z": z_m,
                "speed": number(sheet, row, 3, "U"),
                "sigmaSpeed": number(sheet, row, 4, "sigmaU"),
            }
        )
    if len(samples) != 16:
        raise ValueError(f"Inflow: expected 16 samples, found {len(samples)}")
    if any(a["z"] >= b["z"] for a, b in zip(samples, samples[1:])):
        raise ValueError("Inflow: heights are not strictly increasing")
    return samples


def parse_direction(book, sheet_name, u_ref_mps):
    sheet = book.sheet_by_name(sheet_name)
    source_angle = SOURCE_DIRECTIONS[sheet_name]
    expected_label = f"{source_angle:g} deg"
    if sheet.cell_value(0, 1) != expected_label:
        raise ValueError(
            f"{sheet_name}: angle label {sheet.cell_value(0, 1)!r} != {expected_label!r}"
        )
    if [sheet.cell_value(1, column) for column in range(1, 8)] != [
        "point",
        "X",
        "Y",
        "Z",
        "0H",
        "1H",
        "2H",
    ]:
        raise ValueError(f"{sheet_name}: unexpected result header")

    probes = []
    seen_ids = set()
    for row in range(2, sheet.nrows):
        if sheet.cell_value(row, 1) == "":
            continue
        point_number = number(sheet, row, 1, "point")
        if not point_number.is_integer():
            raise ValueError(f"{sheet_name}: non-integer point id at row {row + 1}")
        point_id = str(int(point_number))
        if point_id in seen_ids:
            raise ValueError(f"{sheet_name}: duplicate point id {point_id}")
        seen_ids.add(point_id)
        z = number(sheet, row, 4, "Z")
        if not close(z, PROBE_HEIGHT_METERS):
            raise ValueError(f"{sheet_name}: point {point_id} has Z={z}, expected 0.02 m")
        speeds = {
            variant: number(sheet, row, column, variant)
            for variant, column in VARIANTS.items()
        }
        probes.append(
            {
                "id": point_id,
                "x": number(sheet, row, 2, "X"),
                "y": number(sheet, row, 3, "Y"),
                "z": z,
                "speed": speeds[SELECTED_VARIANT],
                "speedByVariant": speeds,
            }
        )
    if len(probes) != 120:
        raise ValueError(f"{sheet_name}: expected 120 probes, found {len(probes)}")
    return {
        "sourceAngleDegrees": source_angle,
        "windFromDegrees": (270.0 - source_angle) % 360.0,
        "uRefMps": u_ref_mps,
        "probes": probes,
    }


def append_box(positions, indices, center_x, center_y, height):
    base = len(positions)
    x0, x1 = center_x - 0.1, center_x + 0.1
    y0, y1 = center_y - 0.1, center_y + 0.1
    # glTF is Y-up and right-handed: source (X, Y, Z) -> glTF (X, Z, -Y).
    positions.extend(
        [
            (x0, 0.0, -y0),
            (x1, 0.0, -y0),
            (x1, height, -y0),
            (x0, height, -y0),
            (x0, 0.0, -y1),
            (x1, 0.0, -y1),
            (x1, height, -y1),
            (x0, height, -y1),
        ]
    )
    for index in [
        0,
        2,
        1,
        0,
        3,
        2,
        4,
        5,
        6,
        4,
        6,
        7,
        0,
        1,
        5,
        0,
        5,
        4,
        3,
        7,
        6,
        3,
        6,
        2,
        0,
        4,
        7,
        0,
        7,
        3,
        1,
        2,
        6,
        1,
        6,
        5,
    ]:
        indices.append(base + index)


def case_c_geometry():
    positions = []
    indices = []
    for center_y in (-0.4, 0.0, 0.4):
        for center_x in (-0.4, 0.0, 0.4):
            height = 0.4 if center_x == 0.0 and center_y == 0.0 else 0.2
            append_box(positions, indices, center_x, center_y, height)
    if len(positions) != EXPECTED_GEOMETRY_VERTICES:
        raise ValueError(
            f"Case C geometry: expected {EXPECTED_GEOMETRY_VERTICES} vertices, "
            f"found {len(positions)}"
        )
    if len(indices) // 3 != EXPECTED_GEOMETRY_TRIANGLES:
        raise ValueError(
            f"Case C geometry: expected {EXPECTED_GEOMETRY_TRIANGLES} triangles, "
            f"found {len(indices) // 3}"
        )
    return positions, indices


def main(source_path, output_path, glb_path):
    source = Path(source_path)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError(f"unexpected source SHA-256 {digest}; expected {SOURCE_SHA256}")

    book = xlrd.open_workbook(source, formatting_info=True)
    if book.sheet_names() != EXPECTED_SHEETS:
        raise ValueError(f"unexpected sheets: {book.sheet_names()}")

    inflow = parse_inflow(book)
    u_ref = next(
        (sample["speed"] for sample in inflow if close(sample["z"], PROBE_HEIGHT_METERS)),
        None,
    )
    if u_ref is None:
        raise ValueError("Inflow: no exact U sample at the 0.02 m probe height")

    directions = [
        parse_direction(book, sheet_name, u_ref) for sheet_name in SOURCE_DIRECTIONS
    ]
    canonical = {
        probe["id"]: (probe["x"], probe["y"], probe["z"])
        for probe in directions[0]["probes"]
    }
    for direction in directions[1:]:
        current = {
            probe["id"]: (probe["x"], probe["y"], probe["z"])
            for probe in direction["probes"]
        }
        if current != canonical:
            raise ValueError(
                f"probe coordinates differ at source angle {direction['sourceAngleDegrees']}"
            )

    fixture = {
        "schemaVersion": 1,
        "caseId": "C",
        "source": {
            "url": SOURCE_URL,
            "file": source.name,
            "sha256": digest,
            "retrieved": "2026-07-23",
        },
        "attribution": attribution("C", FIXTURE_PROCESSING),
        "geometryVariant": SELECTED_VARIANT,
        "coordinates": {
            "lengthUnit": "model-m",
            "xAxisEnu": {"east": 1, "north": 0},
            "yAxisEnu": {"east": 0, "north": 1},
            "origin": (
                "Center of the variable central building footprint on the wind-tunnel "
                "floor; source +X and +Y are the Geometry-sheet axes."
            ),
        },
        "measurement": {
            "speedUnit": "u/uRef",
            "statistic": "time-mean-of-instantaneous-scalar-speed",
            "uRef": (
                f"{u_ref} m/s, the Inflow-sheet U at z=0.02 m. The workbook states "
                "that each velocity ratio is normalized by inflow velocity at the same height."
            ),
            "uRefHeightMeters": PROBE_HEIGHT_METERS,
            "probeHeightMeters": PROBE_HEIGHT_METERS,
        },
        "inflow": {
            "kind": "measured",
            "speedUnit": "m/s",
            "samples": inflow,
            "note": "Inflow sheet transcribed verbatim (Z(m), U, sigmaU).",
        },
        "directions": directions,
        "notes": [
            "All coordinates remain in physical wind-tunnel model meters; the workbook states no geometric scale.",
            "Geometry sheet: H=0.2 m cubes, 0.2 m clear gaps, selected center height 2H=0.4 m.",
            "All 0H/1H/2H result columns are retained in speedByVariant; speed selects 2H.",
            "Positive workbook angles rotate downstream from +X toward +Y; converted to meteorological FROM bearings.",
            "The primary workbook places every probe at Z=0.02 m; a secondary validation page's 5 mm claim is not substituted for the source values.",
        ],
    }

    output = Path(output_path)
    glb = Path(glb_path)
    fixture["geometry"] = {
        "url": SOURCE_URL,
        "file": source.name,
        "sha256": digest,
        "retrieved": "2026-07-23",
        "convertedFile": glb.name,
        "geometryVariant": SELECTED_VARIANT,
        "coordinateTransform": "workbook (X,Y,Z) -> glTF (X,Z,-Y)",
    }
    positions, indices = case_c_geometry()
    write_glb(
        glb,
        positions,
        indices,
        name="AIJ Case C - 2H city blocks",
        generator="AeroFlow AIJ Case C converter",
        extras={
            "case": "AIJ Case C, 2H center building",
            "workbookSha256": digest,
            "sourceUrl": SOURCE_URL,
            "retrieved": "2026-07-23",
            "sourceCoordinates": "model meters, X/Y horizontal, Z up",
            "gltfCoordinates": "X source-X, Y up, Z negative-source-Y",
            "vertices": EXPECTED_GEOMETRY_VERTICES,
            "triangles": EXPECTED_GEOMETRY_TRIANGLES,
            "attribution": attribution("C", GEOMETRY_PROCESSING),
        },
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {output}")
    print(f"wrote {glb}")
    print(f"  source sha256 = {digest}")
    print(f"  inflow samples = {len(inflow)}; Uref(z=0.02m) = {u_ref} m/s")
    print(f"  vertices/triangles = {len(positions)} / {len(indices) // 3}")
    for direction in directions:
        print(
            f"  source {direction['sourceAngleDegrees']:g} deg -> FROM "
            f"{direction['windFromDegrees']:g} deg: {len(direction['probes'])} probes"
        )


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: convert-aij-case-c.py <source.xls> <out.json> <out.glb>")
    main(*sys.argv[1:])