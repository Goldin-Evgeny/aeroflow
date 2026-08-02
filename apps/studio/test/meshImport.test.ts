import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import { icosphere } from '@aeroflow/core';
import {
  importMeshFile,
  mergeObjectGeometry,
  meshBounds,
  parseStl,
  scalePositions,
} from '../src/sim/meshImport';

/**
 * Mesh import (M8 step 5), headless half: STL parsing through Three's STLLoader (binary +
 * ASCII, both pure ArrayBuffer math — node-safe) and the glTF scene-merge logic on a
 * hand-built Object3D tree. The GLTFLoader byte-parsing glue itself is exercised in the
 * browser (?import3d); everything it feeds into is covered here.
 */

/** Serialize a triangle soup as a binary STL (80-byte header, u32 count, 50 B/triangle). */
function binaryStl(positions: Float32Array, indices: Uint32Array): ArrayBuffer {
  const triCount = indices.length / 3;
  const buf = new ArrayBuffer(84 + 50 * triCount);
  new DataView(buf).setUint32(80, triCount, true);
  const view = new DataView(buf);
  for (let t = 0; t < triCount; t++) {
    const base = 84 + 50 * t;
    // Normal left zero (12 bytes) — parsers must not rely on it (dirty-CAD reality).
    for (let k = 0; k < 3; k++) {
      const vi = indices[3 * t + k];
      for (let a = 0; a < 3; a++) {
        view.setFloat32(base + 12 + 12 * k + 4 * a, positions[3 * vi + a], true);
      }
    }
  }
  return buf;
}

describe('parseStl', () => {
  const sphere = icosphere(3, 5, 0, 0, 0); // 1280 triangles
  const stl = binaryStl(sphere.positions, sphere.indices);

  it('parses binary STL into a triangle soup with the right count and bounds', () => {
    const mesh = parseStl(stl);
    expect(mesh.source).toBe('stl');
    expect(mesh.indices).toBeNull();
    expect(mesh.triangleCount).toBe(1280);
    const b = meshBounds(mesh.positions);
    for (let a = 0; a < 3; a++) {
      expect(b.min[a]).toBeCloseTo(-5, 3);
      expect(b.max[a]).toBeCloseTo(5, 3);
      expect(b.size[a]).toBeCloseTo(10, 3);
    }
  });

  it('parses ASCII STL', () => {
    const ascii = `solid tri
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 0
    endloop
  endfacet
endsolid tri
`;
    const mesh = parseStl(new TextEncoder().encode(ascii).buffer as ArrayBuffer);
    expect(mesh.triangleCount).toBe(1);
    expect(meshBounds(mesh.positions).max).toEqual([10, 10, 0]);
  });
});

describe('importMeshFile', () => {
  it('dispatches .stl and rejects unknown extensions and empty meshes', async () => {
    const sphere = icosphere(2, 5, 0, 0, 0);
    const stl = binaryStl(sphere.positions, sphere.indices);
    const mesh = await importMeshFile('Rotor Blade.STL', stl);
    expect(mesh.triangleCount).toBe(320);
    await expect(importMeshFile('model.obj', stl)).rejects.toThrow('unsupported');
    await expect(
      importMeshFile('empty.stl', binaryStl(new Float32Array(0), new Uint32Array(0))),
    ).rejects.toThrow('no triangles');
  });
});

describe('mergeObjectGeometry', () => {
  it('merges indexed + non-indexed children with world transforms applied', () => {
    const root = new Group();

    const indexed = new BufferGeometry();
    indexed.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    indexed.setIndex([0, 1, 2]);
    const meshA = new Mesh(indexed);

    const soup = new BufferGeometry();
    soup.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 2, 0, 0, 0, 2], 3));
    const meshB = new Mesh(soup);
    meshB.position.set(10, 0, 0); // world transform must land in the merged positions

    const inner = new Group();
    inner.add(meshB);
    root.add(meshA, inner);

    const merged = mergeObjectGeometry(root);
    expect(merged.indices.length / 3).toBe(2);
    expect(merged.positions.length / 3).toBe(6);
    // Triangle 2's vertices are offset by the node translation.
    expect(Array.from(merged.positions.slice(9, 18))).toEqual([10, 0, 0, 10, 2, 0, 10, 0, 2]);
    // Indices of the soup child are synthesized and rebased past the indexed child.
    expect(Array.from(merged.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('scalePositions', () => {
  it('applies a uniform unit factor (mm→m) without mutating the input', () => {
    const src = new Float32Array([1000, -2000, 500]);
    const out = scalePositions(src, 1e-3);
    expect(Array.from(out)).toEqual([1, -2, 0.5]);
    expect(src[0]).toBe(1000);
  });
});
