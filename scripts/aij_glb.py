"""Minimal deterministic GLB writer used by the offline AIJ converters."""

import json
import struct


def _padded(data, byte, alignment=4):
    remainder = len(data) % alignment
    return data if remainder == 0 else data + byte * (alignment - remainder)


def write_glb(path, positions, indices, *, name, generator, extras):
    position_bytes = struct.pack(
        f"<{len(positions) * 3}f", *(value for position in positions for value in position)
    )
    index_bytes = struct.pack(f"<{len(indices)}I", *indices)
    padded_positions = _padded(position_bytes, b"\0")
    binary = padded_positions + _padded(index_bytes, b"\0")
    mins = [min(position[axis] for position in positions) for axis in range(3)]
    maxs = [max(position[axis] for position in positions) for axis in range(3)]
    gltf = {
        "asset": {"version": "2.0", "generator": generator},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {
                "name": name,
                "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}],
            }
        ],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(position_bytes), "target": 34962},
            {
                "buffer": 0,
                "byteOffset": len(padded_positions),
                "byteLength": len(index_bytes),
                "target": 34963,
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions),
                "type": "VEC3",
                "min": mins,
                "max": maxs,
            },
            {
                "bufferView": 1,
                "componentType": 5125,
                "count": len(indices),
                "type": "SCALAR",
                "min": [min(indices)],
                "max": [max(indices)],
            },
        ],
        "extras": extras,
    }
    json_chunk = _padded(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    binary_chunk = _padded(binary, b"\0")
    total_length = 12 + 8 + len(json_chunk) + 8 + len(binary_chunk)
    glb = b"".join(
        [
            struct.pack("<III", 0x46546C67, 2, total_length),
            struct.pack("<II", len(json_chunk), 0x4E4F534A),
            json_chunk,
            struct.pack("<II", len(binary_chunk), 0x004E4942),
            binary_chunk,
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(glb)