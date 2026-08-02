# WGSL / WebGPU notes for AeroFlow kernels

Proven patterns and known traps for this codebase. The existing 2D kernel
(`apps/studio/src/sim/shaders/lbm2d.wgsl`) demonstrates most of the patterns; keep new
kernels consistent with it.

## Language traps

1. **Dynamic indexing of lattice-constant arrays.** Module-scope `const` arrays cannot
   be reliably indexed with runtime indices across all implementations. The proven
   pattern (used in lbm2d.wgsl): declare the tables as **function-local `var`
   arrays** at the top of the entry point; dynamic indexing of local `var` arrays is
   universally valid. Compilers hoist/unroll fine at these sizes.
2. **`let` vs `var`**: `let` bindings of arrays share the same indexing restriction
   history — use `var` for anything indexed dynamically.
3. **Integer sign traps**: cell coordinates as `i32` during neighbor math (`x − e`),
   cast to `u32` only after bounds are settled; `u32` underflow (0 − 1) is the classic
   silent wrap (guard the outlet's `idx − 1` with `select`, as the 2D kernel does).
4. **f32 literals**: write `1.0/9.0` not `1/9` (integer division truncates to 0 —
   compiles, runs, silently wrong weights; rung-1 tests on the CPU side won't see a
   WGSL-only typo, so keep the WGSL tables copy-pasted from `lattice.ts` output, not
   retyped).
5. **No f64 in WGSL** — all GPU math is f32; that is why parity gates are what they
   are (H6 §4).

## Structural patterns

6. **Ping-pong bind groups** (2D kernel): two premade bind groups (A→B, B→A), parity
   tracked host-side; after N steps the newest state is in `fBufs[N % 2]` — every
   readback and the parity panel must respect this. Esoteric-3D replaces this with a
   single buffer + `parity` uniform (H4 §9).
7. **Batching**: dispatch overhead is 24–71 µs — always encode many steps per command
   buffer (the 2D app adapts steps-per-frame; validation runs should batch 100–200).
   With uniforms that change per step (esoteric parity), either use two premade bind
   groups with two tiny uniform buffers (parity 0/1) alternating in the encode loop —
   NOT `writeBuffer` between dispatches, which serializes.
8. **Reductions without f32 atomics**: workgroup-shared array + `workgroupBarrier()`
   tree reduction + per-workgroup partials buffer + second reduce dispatch (full
   design in `docs/handoff/H2-momentum-exchange.md` §5). Guard each stride:
   `if (local_id.x < stride)`; barrier OUTSIDE the guard (barriers must be uniform
   control flow — inside the `if` is a validation error or worse).
9. **Readback protocol**: dedicated staging buffer (`MAP_READ | COPY_DST`),
   `copyBufferToBuffer` in the same encoder, `mapAsync` after submit; never map a
   buffer bound to in-flight passes; double-buffer staging when sampling repeatedly.
10. **Storage buffer in fragment shaders** (the 2D renderer does this): read-only
    storage is fine in fragment stage; no need for textures until 3D visualization.

## Capability & limits ladder (negotiate at init, once)

11. Request in `requestDevice`: `maxBufferSize` / `maxStorageBufferBindingSize` at
    `min(adapter max, need)`; spec defaults are 256 MiB / 128 MiB — enough for 2D,
    NOT for 256³ D3Q19 (needs multi-buffer splitting ≤1 GiB each; PHYSICS.md §11).
12. `shader-f16`: request if `adapter.features.has('shader-f16')`; add `enable f16;`
    ONLY into shaders compiled for that device path; keep an f32-storage variant
    compiled from the same source with a `// #if`-style string preprocess (simple
    `replace` on a tag — no build machinery needed).
13. Feature detection report (the capability panel in `gpu/context.ts`) is the ground
    truth to echo into every recorded benchmark/validation result (hardware column).
14. **Device-lost**: `device.lost.then(...)` is wired in `gpu/context.ts`; real
    recovery (recreate device+pipelines, reload from IndexedDB checkpoint) is M9 —
    until then, surface loudly, never retry silently.
15. **Timestamp queries** (`'timestamp-query'` feature): request opportunistically for
    precise MLUPs (M2+); fall back to wall-clock steps/s (current HUD) — document
    which one produced any published number.

## Numerical conventions on GPU

16. All arithmetic f32; storage may be f16 per `docs/handoff/H5-fp16-storage.md`
    (shifted DDFs; never accumulate in f16).
17. Cross-GPU float variance is expected and unfixable — never publish bitwise claims;
    tolerance bands only (DEBUGGING.md symptom table).
18. Division guards: `m / rho` with rho from a gathered fluid cell is safe by
    construction (equilibrium init, refill-on-erase); if a NaN storm appears anyway,
    the flags/refill invariant broke upstream — do not "fix" with `max(rho, eps)`
    (hides the real bug; DEBUGGING.md rule 3).

## Shader/source hygiene

19. WGSL lives in `.wgsl` files imported `?raw` (Vite); no template-string shaders.
20. Lattice constants in WGSL carry the header comment pointing at
    `packages/core/src/lattice(.3d).ts` as the source of truth (as lbm2d.wgsl does);
    when the 3D kernel lands, generate the constant block by copy-paste from a
    printed dump of the TS tables, not by hand.
21. The collision routine is written ONCE per dimension as a WGSL snippet shared
    between naive-3D (debug) and esoteric-3D kernels via string inclusion (H4 §9) —
    forked collision code invalidates the bit-identity chain.
