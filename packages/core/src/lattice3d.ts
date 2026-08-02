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
