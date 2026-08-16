import { describe, expect, it } from 'vitest';

/**
 * fix-confirmed-physics-defects, solver-failure-visibility: two WGSL kernels
 * (stream_collide_3d.wgsl's `freeSlipRead`, central_moment_d3q27_periodic.wgsl's collide)
 * surface unresolvable state as `bitcast<f32>(0x7fc00000u)` rather than falling through to
 * read unrelated storage, because WGSL cannot throw. This test pins the bit pattern itself:
 * a typo in the hex constant would silently turn the sentinel into a large-but-finite
 * number that `fieldStats`'s non-finite detection would miss entirely.
 */
describe('non-finite sentinel bit pattern (0x7fc00000)', () => {
  it('decodes to a quiet NaN under IEEE 754 single precision', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, 0x7fc00000, true);
    const value = view.getFloat32(0, true);
    expect(Number.isNaN(value)).toBe(true);
    expect(Number.isFinite(value)).toBe(false);
  });
});
