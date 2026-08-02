import { describe, expect, it } from 'vitest';
import { preprocessShader } from '../src/sim/shaderPreprocess';

describe('preprocessShader', () => {
  const src = [
    'let base = 1;',
    '//#ifdef STORAGE_FP16',
    'let store = f16;',
    '//#else',
    'let store = f32;',
    '//#endif',
    'let n = ${NX};',
  ].join('\n');

  it('takes the #ifdef branch when defined', () => {
    const out = preprocessShader(src, { STORAGE_FP16: true, NX: 256 });
    expect(out).toContain('let store = f16;');
    expect(out).not.toContain('let store = f32;');
    expect(out).toContain('let n = 256;');
  });

  it('takes the #else branch when undefined', () => {
    const out = preprocessShader(src, { NX: 128 });
    expect(out).toContain('let store = f32;');
    expect(out).not.toContain('let store = f16;');
    expect(out).toContain('let n = 128;');
  });

  it('handles #ifndef', () => {
    const out = preprocessShader('//#ifndef TRT\nbgk;\n//#endif', {});
    expect(out).toContain('bgk;');
    expect(preprocessShader('//#ifndef TRT\nbgk;\n//#endif', { TRT: true })).not.toContain('bgk;');
  });

  it('supports nested conditionals', () => {
    const nested = ['//#ifdef A', 'a', '//#ifdef B', 'ab', '//#endif', '//#endif'].join('\n');
    expect(preprocessShader(nested, { A: true, B: true })).toContain('ab');
    expect(preprocessShader(nested, { A: true })).not.toContain('ab');
    expect(preprocessShader(nested, { B: true })).toBe('');
  });

  it('treats false-valued flags as undefined', () => {
    expect(preprocessShader('//#ifdef X\ny\n//#endif', { X: false })).not.toContain('y');
  });

  it('throws on unterminated / stray directives and missing substitutions', () => {
    expect(() => preprocessShader('//#ifdef A\nx', {})).toThrow(/unterminated/);
    expect(() => preprocessShader('//#endif', {})).toThrow(/#endif without/);
    expect(() => preprocessShader('let n = ${NX};', {})).toThrow(/not defined/);
  });
});

/**
 * The real 3D kernel compiled both ways. `FREESLIP` was added 2026-07-27 after the M6
 * benchmark ladder was found ~25–37% below its recorded figures: H11's free-slip branch and
 * its `freeSlipRead` call sat unguarded in the innermost gather loop, costing occupancy on a
 * bandwidth-bound kernel even in scenes with no free-slip face. Every other optional feature
 * (FORCES, ABL, LES, REGULARIZE) was already compile-time selected; this one was not.
 *
 * These assertions are structural, not physical — the physics gate is the `?parity3d` panel,
 * which exercises the free-slip variant against the CPU reference (CLAUDE.md rule 0).
 */
describe('preprocessShader — the 3D kernel free-slip variant (M6 throughput)', () => {
  const defines = {
    STORAGE_FP16: false,
    TRT: true,
    REGULARIZE: false,
    LES: false,
    NEED_TENSOR: false,
    MULTI_DDF: false,
    PER_BUFFER: 19,
    NUM_DDF_BUFFERS: 1,
    B_FLAGS: 2,
    B_MACRO_RHO: 3,
    B_MACRO_UX: 4,
    B_MACRO_UY: 5,
    B_MACRO_UZ: 6,
    B_OUTLET: 7,
    FORCES: false,
    B_FORCE: 8,
    ABL: false,
    B_PROFILE: 8,
    B_VELRHO: 9,
  };

  /** Cheap proof the guard did not cut an `if/else if/else` chain in half. */
  const balanced = (code: string): boolean => {
    let depth = 0;
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth < 0) return false;
    }
    return depth === 0;
  };

  it('omits the free-slip gather entirely when no face is configured', async () => {
    const src = (await import('../src/sim/shaders/stream_collide_3d.wgsl?raw')).default;
    const off = preprocessShader(src, { ...defines, FREESLIP: false });
    expect(off).not.toContain('freeSlipRead');
    expect(off).not.toContain('fn freeSlipRead');
    expect(off).not.toContain('${B_MACRO');
    expect(off.match(/var<storage, read_write> macro(Rho|Ux|Uy|Uz)/g)).toHaveLength(4);
    expect(balanced(off)).toBe(true);
    // The plain-fluid fallback the guarded branch sat in front of must survive.
    expect(off).toContain('f[a] = va;');
  });

  it('includes it — definition and both call sites — when a face is configured', async () => {
    const src = (await import('../src/sim/shaders/stream_collide_3d.wgsl?raw')).default;
    const on = preprocessShader(src, { ...defines, FREESLIP: true });
    expect(on).toContain('fn freeSlipRead');
    // Both halves of the paired-direction gather loop call it.
    expect(on.match(/= freeSlipRead\(/g)).toHaveLength(2);
    expect(balanced(on)).toBe(true);
  });

  it('only REMOVES lines — the lean build is a subsequence of the free-slip build', async () => {
    // The property that matters: guarding changed no surviving line. If the two builds ever
    // diverge in shared code, the variants have drifted and parity on one says nothing about
    // the other.
    const src = (await import('../src/sim/shaders/stream_collide_3d.wgsl?raw')).default;
    const off = preprocessShader(src, { ...defines, FREESLIP: false }).split('\n');
    const on = preprocessShader(src, { ...defines, FREESLIP: true }).split('\n');
    let i = 0;
    for (const line of on) if (i < off.length && off[i] === line) i++;
    expect(i).toBe(off.length); // every lean line matched, in order
    expect(off.length).toBeLessThan(on.length); // …and the full build has strictly more
  });
});
