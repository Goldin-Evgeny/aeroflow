#!/usr/bin/env python3
"""Convert the official AIJ Case E workbook and DXF archive to JSON + GLB.

Sources (official AIJ distribution):

    https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseE%28Niigata%29.xls
    https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseE_dxf.zip

The workbook stores full-scale probe coordinates and already-normalized scalar-speed
means. The DXF stores full-scale geometry in meters with Z up. The generated GLB uses
the glTF right-handed Y-up convention: (X, Y, Z)_DXF -> (X, Z, -Y)_glTF.

The DXF is composed from nested block inserts which repeat shared site geometry. Faces
are expanded to world coordinates and deduplicated before triangulation. The conversion
is deliberately pinned to source hashes, workbook layout, CAD extents, and mesh counts;
an upstream revision must be inspected rather than silently producing different data.

Usage (xlrd and ezdxf are conversion tooling, not runtime dependencies):
    python scripts/convert-aij-case-e.py <source.xls> <source_dxf.zip> <out.json> <out.glb>
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import ezdxf
import xlrd
from ezdxf.disassemble import recursive_decompose

from aij_glb import write_glb

WORKBOOK_SHA256 = "6c4421a81d8f4c7199e83bd02958f8fae0f2701e041f1f0bcd4e25a5981a25d1"
DXF_SHA256 = "58d0f99015f874eec1cb7f881e736f6643268c504bcf4eeae6b652388383158f"
WORKBOOK_URL = (
    "https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseE%28Niigata%29.xls"
)
DXF_URL = "https://www.aij.or.jp/jpn/publish/cfdguide/data/CaseE_dxf.zip"
EXPECTED_SHEETS = [
    "Geometry&Points",
    "Inflow",
    "Results (Before Construction)",
    "Results (After Construction)",
]
COMPASS_DIRECTIONS = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
]
RESULT_SHEETS = {
    "Before Construction": "Results (Before Construction)",
    "After Construction": "Results (After Construction)",
}
SELECTED_VARIANT = "After Construction"
MODEL_SCALE = 250.0
PROBE_HEIGHT_METERS = 2.0
BOUNDARY_LAYER_HEIGHT_METERS = 250.0
BOUNDARY_LAYER_REFERENCE_MPS = 7.8
RESULT_REFERENCE_HEIGHT_METERS = 15.9
POWER_LAW_ALPHA = 0.25
RESULT_REFERENCE_MPS = BOUNDARY_LAYER_REFERENCE_MPS * (
    RESULT_REFERENCE_HEIGHT_METERS / BOUNDARY_LAYER_HEIGHT_METERS
) ** POWER_LAW_ALPHA

EXPECTED_DXF_MIN = (-246.0, -250.0, 0.0)
EXPECTED_DXF_MAX = (254.0, 250.0, 60.0)
EXPECTED_EXPANDED_FACES = 57_443
EXPECTED_UNIQUE_POLYGONS = 15_980
EXPECTED_TRIANGLES = 22_906


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def number(sheet, row, column, label):
    value = sheet.cell_value(row, column)
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{sheet.name}: {label} at row {row + 1} is not finite")
    return float(value)


def integer_id(sheet, row, column, label):
    value = number(sheet, row, column, label)
    if not value.is_integer():
        raise ValueError(f"{sheet.name}: {label} at row {row + 1} is not an integer")
    return str(int(value))


def parse_source_inflow(book):
    sheet = book.sheet_by_name("Inflow")
    if [sheet.cell_value(1, column) for column in range(1, 4)] != [
        "z/ZR",
        "U/UR",
        "k/UR2",
    ]:
        raise ValueError("Inflow: unexpected header")
    samples = []
    for row in range(2, 14):
        samples.append(
            {
                "zOverZr": number(sheet, row, 1, "z/ZR"),
                "uOverUr": number(sheet, row, 2, "U/UR"),
                "kOverUr2": number(sheet, row, 3, "k/UR2"),
            }
        )
    if len(samples) != 12 or samples[0]["zOverZr"] != 0.005 or samples[-1] != {
        "zOverZr": 1.0,
        "uOverUr": 1.0,
        "kOverUr2": 0.002,
    }:
        raise ValueError("Inflow: unexpected sample count or endpoints")
    if any(a["zOverZr"] >= b["zOverZr"] for a, b in zip(samples, samples[1:])):
        raise ValueError("Inflow: heights are not strictly increasing")
    if "250m (actual scale)" not in str(sheet.cell_value(19, 2)):
        raise ValueError("Inflow: missing 250 m actual-scale boundary-layer note")
    if "7.8m/s" not in str(sheet.cell_value(20, 2)):
        raise ValueError("Inflow: missing 7.8 m/s reference-speed note")
    return samples


def parse_workbook(path, digest):
    book = xlrd.open_workbook(path, formatting_info=True)
    if book.sheet_names() != EXPECTED_SHEETS:
        raise ValueError(f"unexpected sheets: {book.sheet_names()}")

    geometry = book.sheet_by_name("Geometry&Points")
    if [geometry.cell_value(1, column) for column in range(1, 4)] != ["No.", "X", "Y"]:
        raise ValueError("Geometry&Points: unexpected header")
    if "Unit : m in actual scale" not in str(geometry.cell_value(1, 4)):
        raise ValueError("Geometry&Points: missing full-scale-meter unit note")
    if "Origin : center of the reproducing area" not in str(geometry.cell_value(2, 4)):
        raise ValueError("Geometry&Points: missing origin note")

    coordinates = []
    for row in range(2, 82):
        coordinates.append(
            {
                "id": integer_id(geometry, row, 1, "probe id"),
                "x": number(geometry, row, 2, "X"),
                "y": number(geometry, row, 3, "Y"),
            }
        )
    if [point["id"] for point in coordinates] != [str(index) for index in range(1, 81)]:
        raise ValueError("Geometry&Points: expected probe IDs 1..80 in order")

    variants = {}
    for variant, sheet_name in RESULT_SHEETS.items():
        sheet = book.sheet_by_name(sheet_name)
        if sheet.cell_value(1, 1) != "No.":
            raise ValueError(f"{sheet_name}: unexpected probe header")
        if "normalized by the inflow velocity at 15.9m" not in str(sheet.cell_value(1, 2)):
            raise ValueError(f"{sheet_name}: missing 15.9 m normalization note")
        headers = [sheet.cell_value(2, column) for column in range(2, 18)]
        if headers != COMPASS_DIRECTIONS:
            raise ValueError(f"{sheet_name}: unexpected directions {headers}")
        rows = []
        for row in range(3, 83):
            probe_id = integer_id(sheet, row, 1, "probe id")
            if probe_id != coordinates[row - 3]["id"]:
                raise ValueError(f"{sheet_name}: probe order differs at row {row + 1}")
            rows.append([number(sheet, row, column, headers[column - 2]) for column in range(2, 18)])
        variants[variant] = rows

    directions = []
    for direction_index, label in enumerate(COMPASS_DIRECTIONS):
        angle = direction_index * 22.5
        probes = []
        for probe_index, coordinate in enumerate(coordinates):
            by_variant = {
                variant: variants[variant][probe_index][direction_index]
                for variant in RESULT_SHEETS
            }
            probes.append(
                {
                    "id": coordinate["id"],
                    "x": coordinate["x"],
                    "y": coordinate["y"],
                    "z": PROBE_HEIGHT_METERS,
                    "speed": by_variant[SELECTED_VARIANT],
                    "speedByVariant": by_variant,
                }
            )
        directions.append(
            {
                "sourceAngleDegrees": angle,
                "sourceDirection": label,
                "windFromDegrees": angle,
                "uRefMps": RESULT_REFERENCE_MPS,
                "probes": probes,
            }
        )

    return {
        "schemaVersion": 1,
        "caseId": "E",
        "source": {
            "url": WORKBOOK_URL,
            "file": path.name,
            "sha256": digest,
            "retrieved": "2026-07-24",
        },
        "geometryVariant": SELECTED_VARIANT,
        "coordinates": {
            "lengthUnit": "full-scale-m",
            "modelScale": MODEL_SCALE,
            "xAxisEnu": {"east": 1, "north": 0},
            "yAxisEnu": {"east": 0, "north": 1},
            "origin": (
                "Center of the 500 m x 500 m reproduced area shared by the workbook "
                "probes and DXF; source +X is east and +Y is north."
            ),
        },
        "measurement": {
            "speedUnit": "u/uRef",
            "statistic": "time-mean-of-instantaneous-scalar-speed",
            "uRef": (
                "Workbook velocity ratio normalized by inflow velocity at 15.9 m. "
                f"For lattice-unit mapping, {RESULT_REFERENCE_MPS:.12g} m/s is derived "
                "from the published alpha=0.25 profile and workbook UR=7.8 m/s at ZR=250 m; "
                "the already-normalized measurements are not divided again."
            ),
            "uRefHeightMeters": RESULT_REFERENCE_HEIGHT_METERS,
            "probeHeightMeters": PROBE_HEIGHT_METERS,
            "probeHeightFullScaleMeters": PROBE_HEIGHT_METERS,
        },
        "inflow": {
            "kind": "power",
            "alpha": POWER_LAW_ALPHA,
            "note": (
                "Wind-tunnel validation profile: alpha=0.25 (Yoshie et al. 2007; "
                "Hagbo and Giljarhus 2022). Normalized to Uref at 15.9 m."
            ),
        },
        "sourceInflow": {
            "kind": "tabulated-u-over-ur",
            "zRFullScaleMeters": BOUNDARY_LAYER_HEIGHT_METERS,
            "zRModelMeters": 1.0,
            "uRMps": BOUNDARY_LAYER_REFERENCE_MPS,
            "samples": parse_source_inflow(book),
            "note": "Inflow worksheet transcribed verbatim; retained separately from the V15 alpha=0.25 BC.",
        },
        "directions": directions,
        "notes": [
            "Results (After Construction) is selected because the official CAD contains the 60 m tower.",
            "Results (Before Construction) is retained in every probe's speedByVariant field.",
            "Direction headers N..NNW are interpreted as meteorological FROM bearings clockwise from north.",
            "The DXF and workbook use full-scale meters; no model-to-full-scale multiplication is applied.",
        ],
    }


def quantized_vertex(vertex):
    return tuple(round(float(value), 9) for value in vertex)


def triangle_area_squared(a, b, c):
    ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    cross = (
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    )
    return sum(value * value for value in cross)


def parse_dxf(path):
    doc = ezdxf.readzip(path)
    if doc.units != 6 or doc.header.get("$INSUNITS") != 6:
        raise ValueError(f"DXF: expected meter units (6), found {doc.units}")
    auditor = doc.audit()
    if auditor.errors:
        raise ValueError(f"DXF: audit found {len(auditor.errors)} errors")

    expanded = [
        entity
        for entity in recursive_decompose(doc.modelspace())
        if entity.dxftype() == "3DFACE"
    ]
    if len(expanded) != EXPECTED_EXPANDED_FACES:
        raise ValueError(
            f"DXF: expected {EXPECTED_EXPANDED_FACES} expanded faces, found {len(expanded)}"
        )

    unique = {}
    for face in expanded:
        vertices = list(
            dict.fromkeys(quantized_vertex(vertex) for vertex in face.wcs_vertices(close=False))
        )
        if len(vertices) not in (3, 4):
            raise ValueError(f"DXF: unsupported {len(vertices)}-vertex 3DFACE")
        unique.setdefault(tuple(sorted(vertices)), vertices)
    if len(unique) != EXPECTED_UNIQUE_POLYGONS:
        raise ValueError(
            f"DXF: expected {EXPECTED_UNIQUE_POLYGONS} unique polygons, found {len(unique)}"
        )

    source_vertices = sorted({vertex for polygon in unique.values() for vertex in polygon})
    source_min = tuple(min(vertex[axis] for vertex in source_vertices) for axis in range(3))
    source_max = tuple(max(vertex[axis] for vertex in source_vertices) for axis in range(3))
    if source_min != EXPECTED_DXF_MIN or source_max != EXPECTED_DXF_MAX:
        raise ValueError(f"DXF: extents {source_min}..{source_max} differ from pinned source")

    vertex_index = {vertex: index for index, vertex in enumerate(source_vertices)}
    indices = []
    for polygon in unique.values():
        for offset in range(1, len(polygon) - 1):
            triangle = (polygon[0], polygon[offset], polygon[offset + 1])
            if triangle_area_squared(*triangle) <= 1e-18:
                raise ValueError(f"DXF: degenerate triangle at {triangle}")
            indices.extend(vertex_index[vertex] for vertex in triangle)
    if len(indices) // 3 != EXPECTED_TRIANGLES:
        raise ValueError(
            f"DXF: expected {EXPECTED_TRIANGLES} triangles, found {len(indices) // 3}"
        )

    # Preserve right-handedness while converting Z-up DXF to Y-up glTF.
    positions = [(x, z, -y) for x, y, z in source_vertices]
    return positions, indices


def main(workbook_name, dxf_name, fixture_name, glb_name):
    workbook_path = Path(workbook_name)
    dxf_path = Path(dxf_name)
    fixture_path = Path(fixture_name)
    glb_path = Path(glb_name)
    workbook_digest = sha256(workbook_path)
    dxf_digest = sha256(dxf_path)
    if workbook_digest != WORKBOOK_SHA256:
        raise ValueError(
            f"unexpected workbook SHA-256 {workbook_digest}; expected {WORKBOOK_SHA256}"
        )
    if dxf_digest != DXF_SHA256:
        raise ValueError(f"unexpected DXF SHA-256 {dxf_digest}; expected {DXF_SHA256}")

    fixture = parse_workbook(workbook_path, workbook_digest)
    fixture["geometry"] = {
        "url": DXF_URL,
        "file": dxf_path.name,
        "sha256": dxf_digest,
        "retrieved": "2026-07-24",
        "convertedFile": glb_path.name,
        "coordinateTransform": "DXF (X,Y,Z) -> glTF (X,Z,-Y)",
    }
    positions, indices = parse_dxf(dxf_path)
    write_glb(
        glb_path,
        positions,
        indices,
        name="AIJ Case E - Niigata after construction",
        generator="AeroFlow AIJ Case E converter",
        extras={
            "case": "AIJ Case E (Niigata), after construction",
            "workbookSha256": workbook_digest,
            "dxfSha256": dxf_digest,
            "sourceCoordinates": "full-scale meters, X east, Y north, Z up",
            "gltfCoordinates": "X east, Y up, Z south",
            "expandedFaces": EXPECTED_EXPANDED_FACES,
            "uniquePolygons": EXPECTED_UNIQUE_POLYGONS,
            "triangles": EXPECTED_TRIANGLES,
        },
    )
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {fixture_path}")
    print(f"wrote {glb_path}")
    print(f"  workbook sha256 = {workbook_digest}")
    print(f"  dxf sha256 = {dxf_digest}")
    print(f"  directions/probes = {len(fixture['directions'])} x 80")
    print(f"  Uref(15.9 m, alpha=0.25) = {RESULT_REFERENCE_MPS:.12g} m/s")
    print(f"  vertices/triangles = {len(positions)} / {len(indices) // 3}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: convert-aij-case-e.py <source.xls> <source_dxf.zip> <out.json> <out.glb>"
        )
    main(*sys.argv[1:])