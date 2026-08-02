import { Mesh, Vector3, type Object3D } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Mesh file import for M8 (step 5): parse `.stl` (binary + ASCII) and `.gltf`/`.glb` into
 * one flat triangle list ready for the voxelizer. Uses Three.js loaders (a dependency
 * since M6 — no new runtime deps, M8 prerequisite note).
 *
 * Conventions (M8 pitfall "coordinate conventions"):
 *  - glTF is Y-up with units in METERS by spec — positions pass through unchanged.
 *  - STL is unit-less; the caller applies a user-chosen unit scale (`scalePositions`),
 *    default mm in the wizard (CAD-typical). The wizard displays the physical bbox so a
 *    silent mm-as-m import (Re wrong by 10³) is visible immediately.
 * Positions stay in physical units here; `fitMeshToDomain`/`toLatticeSpace` (fitMesh.ts)
 * own the physical→lattice transform.
 */

export interface ImportedMesh {
  /** xyz triplets in source physical units. */
  positions: Float32Array;
  /** Triangle indices, or null for a non-indexed soup (STL). */
  indices: Uint32Array | null;
  triangleCount: number;
  source: 'stl' | 'gltf';
}

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export function meshBounds(positions: Float32Array): MeshBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Uniform unit conversion (e.g. mm→m: factor 1e-3). Returns a new array. */
export function scalePositions(positions: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) out[i] = positions[i] * factor;
  return out;
}

/**
 * Flatten every Mesh under `root` into one indexed triangle list, applying node WORLD
 * transforms (glTF scenes routinely nest transforms; ignoring them scatters the parts).
 * Non-indexed child geometries get synthesized consecutive indices.
 */
export function mergeObjectGeometry(root: Object3D): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  root.updateMatrixWorld(true);
  const posChunks: Float32Array[] = [];
  const idxChunks: Uint32Array[] = [];
  let vertexBase = 0;
  const v = new Vector3();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const geo = node.geometry;
    const attr = geo.getAttribute('position');
    if (!attr) return;
    const chunk = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(node.matrixWorld);
      chunk[3 * i] = v.x;
      chunk[3 * i + 1] = v.y;
      chunk[3 * i + 2] = v.z;
    }
    posChunks.push(chunk);
    const index = geo.getIndex();
    const n = index ? index.count : attr.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = vertexBase + (index ? index.getX(i) : i);
    idxChunks.push(idx);
    vertexBase += attr.count;
  });

  const positions = new Float32Array(posChunks.reduce((s, c) => s + c.length, 0));
  const indices = new Uint32Array(idxChunks.reduce((s, c) => s + c.length, 0));
  let po = 0;
  for (const c of posChunks) {
    positions.set(c, po);
    po += c.length;
  }
  let io = 0;
  for (const c of idxChunks) {
    indices.set(c, io);
    io += c.length;
  }
  return { positions, indices };
}

/** Parse an STL buffer (STLLoader auto-detects binary vs ASCII). Output is a soup. */
export function parseStl(buffer: ArrayBuffer): ImportedMesh {
  const geo = new STLLoader().parse(buffer);
  const attr = geo.getAttribute('position');
  const positions = new Float32Array(attr.array.length);
  positions.set(attr.array as Float32Array);
  return {
    positions,
    indices: null,
    triangleCount: attr.count / 3,
    source: 'stl',
  };
}

/** Parse a glTF/GLB buffer; merges the whole scene graph (world transforms applied). */
export async function parseGltf(buffer: ArrayBuffer): Promise<ImportedMesh> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const merged = mergeObjectGeometry(gltf.scene);
  return {
    positions: merged.positions,
    indices: merged.indices,
    triangleCount: merged.indices.length / 3,
    source: 'gltf',
  };
}

/** Dispatch on file extension. Throws on unsupported types and empty meshes. */
export async function importMeshFile(name: string, buffer: ArrayBuffer): Promise<ImportedMesh> {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  let mesh: ImportedMesh;
  if (ext === 'stl') mesh = parseStl(buffer);
  else if (ext === 'glb' || ext === 'gltf') mesh = await parseGltf(buffer);
  else throw new Error(`unsupported mesh format ".${ext}" — use .stl, .glb, or .gltf`);
  if (mesh.triangleCount === 0) throw new Error(`"${name}" contains no triangles`);
  return mesh;
}
