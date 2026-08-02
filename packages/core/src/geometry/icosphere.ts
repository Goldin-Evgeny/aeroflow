/**
 * Procedural icosphere: an icosahedron subdivided `subdivisions` times, every vertex
 * normalized onto the sphere of the given radius around (cx, cy, cz).
 *
 * Used by the H8 voxelizer oracles (T-VOX-SPHERE) and the M8 CPU↔GPU voxelization parity
 * page — a deterministic, asset-free stand-in for a finely tessellated STL sphere.
 * Subdivision 3 gives 642 vertices / 1280 triangles; each level quadruples the faces.
 */
export interface TriangleMesh {
  /** xyz triplets. */
  positions: Float32Array;
  indices: Uint32Array;
}

export function icosphere(
  subdivisions: number,
  radius: number,
  cx: number,
  cy: number,
  cz: number,
): TriangleMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  // prettier-ignore
  const base: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  // prettier-ignore
  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const verts = base.map((v) => {
    const len = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / len, v[1] / len, v[2] / len];
  });
  const midpointCache = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    // 2^32 multiplier keeps the packed key collision-free up to 2^21 vertices (subdiv 9);
    // the previous 65536 multiplier collided beyond subdiv 6 (>65k vertices), silently
    // corrupting the fine meshes the M8 1M-triangle voxelization benchmark needs.
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const m = [
      (verts[a][0] + verts[b][0]) / 2,
      (verts[a][1] + verts[b][1]) / 2,
      (verts[a][2] + verts[b][2]) / 2,
    ];
    const len = Math.hypot(m[0], m[1], m[2]);
    verts.push([m[0] / len, m[1] / len, m[2] / len]);
    midpointCache.set(key, verts.length - 1);
    return verts.length - 1;
  };
  for (let s = 0; s < subdivisions; s++) {
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[3 * i] = cx + radius * verts[i][0];
    positions[3 * i + 1] = cy + radius * verts[i][1];
    positions[3 * i + 2] = cz + radius * verts[i][2];
  }
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[3 * i] = faces[i][0];
    indices[3 * i + 1] = faces[i][1];
    indices[3 * i + 2] = faces[i][2];
  }
  return { positions, indices };
}
