/**
 * D3Q19 lattice constants — NORMATIVE ordering per docs/PHYSICS.md §2 (frozen).
 *
 * Opposite directions are adjacent pairs: opp(0)=0, opp(odd i)=i+1, opp(even i>0)=i−1.
 * Rest weight 1/3; axis directions (1–6) 1/18; face-diagonals (7–18) 1/36.
 * The esoteric-pull scheme (docs/handoff/H4-esoteric-pull.md) depends on this pairing.
 */
export const D3Q19 = {
  q: 19,
  ex: [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0] as const,
  ey: [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1] as const,
  ez: [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1] as const,
  w: [
    1 / 3,
    1 / 18,
    1 / 18,
    1 / 18,
    1 / 18,
    1 / 18,
    1 / 18,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
  ] as const,
  opp: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17] as const,
  /**
   * Specular reflection tables (H11): reflect•[i] is the direction with that axis
   * component negated and the other two preserved — the free-slip mirror across a wall
   * normal to that axis. Derived by hand from the frozen ordering above; e.g.
   * reflectY[7]: e_7 = (+1,+1,0) → (+1,−1,0) = e_9. Composing all three axes gives
   * opp(i) (full reversal) — the test asserts both properties per entry.
   */
  reflectX: [0, 2, 1, 3, 4, 5, 6, 10, 9, 8, 7, 14, 13, 12, 11, 15, 16, 17, 18] as const,
  reflectY: [0, 1, 2, 4, 3, 5, 6, 9, 10, 7, 8, 11, 12, 13, 14, 18, 17, 16, 15] as const,
  reflectZ: [0, 1, 2, 3, 4, 6, 5, 7, 8, 9, 10, 13, 14, 11, 12, 17, 18, 15, 16] as const,
  cs2: 1 / 3,
} as const;

/**
 * D3Q27 tensor-product lattice for the central-moment CPU authority.
 *
 * This ordering is intentionally different from the pair-adjacent D3Q19 ordering above:
 * direction = (cx + 1) * 9 + (cy + 1) * 3 + (cz + 1), with each component in {-1,0,1}.
 * It is the frozen ordering audited by the M9 Q27 eigen and nonlinear periodic proofs. The
 * browser/GPU solver remains D3Q19 until its own bounded migration and parity gate.
 */
const d3q27Velocities = Object.freeze(
  Array.from({ length: 27 }, (_, direction) => {
    const x = Math.floor(direction / 9) - 1;
    const y = Math.floor((direction % 9) / 3) - 1;
    const z = (direction % 3) - 1;
    return [x, y, z] as const;
  }),
);

const oneDimensionalD3Q27Weight = (component: number): number => (component === 0 ? 2 / 3 : 1 / 6);

export const D3Q27 = {
  q: 27,
  rest: 13,
  velocities: d3q27Velocities,
  ex: Object.freeze(d3q27Velocities.map((velocity) => velocity[0])),
  ey: Object.freeze(d3q27Velocities.map((velocity) => velocity[1])),
  ez: Object.freeze(d3q27Velocities.map((velocity) => velocity[2])),
  w: Object.freeze(
    d3q27Velocities.map(
      ([x, y, z]) =>
        oneDimensionalD3Q27Weight(x) * oneDimensionalD3Q27Weight(y) * oneDimensionalD3Q27Weight(z),
    ),
  ),
  opp: Object.freeze(Array.from({ length: 27 }, (_, direction) => 26 - direction)),
  cs2: 1 / 3,
} as const;
