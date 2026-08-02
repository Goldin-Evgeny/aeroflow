import type { TriangleMesh } from './icosphere.js';

/**
 * Ahmed reference body (Ahmed, Ramm & Faltin 1984, SAE 840300) as a watertight triangle
 * soup for the M8 import/voxelization pipeline (M9 step 1).
 *
 * Exact published dimensions, in MILLIMETERS (CAD-typical; the wizard's default STL unit):
 * length 1044, width 389, height 288; front rounded with R=100 fillets; rear slant chord
 * 222 at `slantAngleDeg` from horizontal (25° is the hard validation case, Cd = 0.285);
 * ground clearance 50.
 *
 * Axes match the solver scenes: +x = flow/length, +y = up (ground plane y=0), z = width
 * (centered). The body floats at `groundClearance`; the four 30 mm support stilts are
 * OMITTED by default — at the M9 target resolution (dx ≈ 4.2 mm) a stilt is ~7 cells wide
 * and badly under-resolved, so we take the documented spec option of leaving them out and
 * noting the (small) drag contribution in the published error discussion (M9 step 1).
 *
 * Construction: a loft of rectangular cross-sections along x, closed with flat front/rear
 * caps — watertight by construction (consecutive stations share their 4 corner vertices).
 *   - Nose, x ∈ [0, R]: stations at θ ∈ [0, π/2], x = R(1−cosθ), inset d = R(1−sinθ) on
 *     all four sides — the cylindrical face fillets sampled with `noseSegments` ≥ 16 arcs
 *     (spec). The four front CORNER blends become sharp inset-rectangle corners rather
 *     than sphere patches: a deliberate screening-grade approximation, confined to four
 *     ~R×R regions (~4% of the frontal perimeter, sub-cell detail at dx ≈ 4 mm).
 *   - Mid body: full 389 × 288 rectangle (sharp longitudinal edges, as on the real body).
 *   - Slant, x ∈ [L − 222·cos α, L]: top edge drops linearly by 222·sin α (sharp slant
 *     break edge, as published); sides/bottom continue full section.
 *   - Caps: front face (the inset rectangle at x=0) and the vertical rear base.
 */
export interface AhmedBodyOptions {
  /** Rear slant angle in degrees from horizontal. Default 25 (the validation case). */
  slantAngleDeg?: number;
  /** Ground clearance added to all y coordinates. Default 50 mm (SAE 840300). */
  groundClearance?: number;
  /** Arc segments approximating the front fillets. Default 24 (spec: ≥ 16). */
  noseSegments?: number;
}

export const AHMED = {
  length: 1044,
  width: 389,
  height: 288,
  noseRadius: 100,
  slantChord: 222,
  groundClearance: 50,
} as const;

interface Station {
  x: number;
  halfWidth: number;
  yBottom: number;
  yTop: number;
}

export function ahmedBody(opts: AhmedBodyOptions = {}): TriangleMesh {
  const alpha = ((opts.slantAngleDeg ?? 25) * Math.PI) / 180;
  const clearance = opts.groundClearance ?? AHMED.groundClearance;
  const noseSegments = opts.noseSegments ?? 24;
  if (noseSegments < 16) throw new Error('ahmedBody: spec requires ≥ 16 nose arc segments');
  const { length: L, width: W, height: H, noseRadius: R, slantChord } = AHMED;

  const slantDx = slantChord * Math.cos(alpha);
  const slantDrop = slantChord * Math.sin(alpha);

  const stations: Station[] = [];
  // Nose: θ = 0 is the flat front face ring (inset R), θ = π/2 the full section at x = R.
  for (let s = 0; s <= noseSegments; s++) {
    const theta = (s / noseSegments) * (Math.PI / 2);
    const d = R * (1 - Math.sin(theta));
    stations.push({
      x: R * (1 - Math.cos(theta)),
      halfWidth: W / 2 - d,
      yBottom: clearance + d,
      yTop: clearance + H - d,
    });
  }
  // Slant break (full section) and tail: duplicate x-stations are avoided because the
  // last nose station already sits at x = R with the full section.
  stations.push({ x: L - slantDx, halfWidth: W / 2, yBottom: clearance, yTop: clearance + H });
  stations.push({
    x: L,
    halfWidth: W / 2,
    yBottom: clearance,
    yTop: clearance + H - slantDrop,
  });

  // 4 shared corner vertices per station: 0=bottom-left(−z), 1=bottom-right(+z),
  // 2=top-right, 3=top-left.
  const positions: number[] = [];
  const indices: number[] = [];
  const corner = (st: Station, c: number): [number, number, number] => {
    switch (c) {
      case 0:
        return [st.x, st.yBottom, -st.halfWidth];
      case 1:
        return [st.x, st.yBottom, st.halfWidth];
      case 2:
        return [st.x, st.yTop, st.halfWidth];
      default:
        return [st.x, st.yTop, -st.halfWidth];
    }
  };
  const vertexIndex: number[][] = [];
  for (const st of stations) {
    const row: number[] = [];
    for (let c = 0; c < 4; c++) {
      row.push(positions.length / 3);
      positions.push(...corner(st, c));
    }
    vertexIndex.push(row);
  }
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, c, a, c, d);
  };
  // Side strips between consecutive stations (bottom, +z side, top, −z side).
  for (let s = 0; s < stations.length - 1; s++) {
    const p = vertexIndex[s];
    const n = vertexIndex[s + 1];
    quad(p[0], p[1], n[1], n[0]); // bottom
    quad(p[1], p[2], n[2], n[1]); // +z side
    quad(p[2], p[3], n[3], n[2]); // top (becomes the slant over the last strip)
    quad(p[3], p[0], n[0], n[3]); // −z side
  }
  // Front cap (x = 0 ring) and rear base cap (x = L ring).
  const f = vertexIndex[0];
  quad(f[3], f[2], f[1], f[0]);
  const r = vertexIndex[stations.length - 1];
  quad(r[0], r[1], r[2], r[3]);

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
