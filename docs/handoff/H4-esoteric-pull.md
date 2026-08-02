# H4 — Esoteric Pull in-place streaming: complete executable specification

> **Handoff doc.** Milestone: M6 (CPU oracle can be built any time after M2). This is
> the hardest algorithm in AeroFlow. Everything needed is IN THIS FILE — do not consult
> FluidX3D source (license-barred, `CLAUDE.md` rule 1). The scheme below is derived
> from first principles with the same properties as Lehmann 2022 (_Computation_
> 10(6):92, CC-BY): single-copy in-place streaming, implicit bounce-back, two-step
> cycle. Cite the paper; implement from this spec.
>
> **The correctness criterion is not judgment — it is the bit-identity test in §8.**
> If your implementation passes it, the index math is right by construction. If it
> fails, your implementation is wrong (not the test).

## 1. Why this exists

The naive solver keeps two copies of the distribution functions (gather from `fSrc`,
write to `fDst`, swap). In 3D at D3Q19/FP32 that doubles the dominant memory cost
(2×76 B/cell just for DDFs). Esoteric-style in-place streaming keeps **one** array and
still avoids read/write races, enabling the 93 B/cell (FP32) → 55 B/cell (FP16)
budgets in `docs/PHYSICS.md` §11 that make 256³ fit on consumer GPUs.

The price: reads/writes follow different rules on even and odd timesteps, and the
array layout is only "canonical" every second step. Every rule is specified below.

## 2. Definitions and notation

- Lattice: D3Q19, constants and ordering **exactly** as `docs/PHYSICS.md` §2:
  opposite directions are adjacent pairs; for odd `i`, `opp(i) = i+1`; `opp(0) = 0`.
- **Pairs**: `(a, b)` with `a ∈ {1,3,5,7,9,11,13,15,17}` (odd), `b = a+1 = opp(a)`.
  `e_b = −e_a`. There are 9 pairs + the rest direction 0.
- `A[c][i]` — the single DDF array, cell `c`, direction slot `i`
  (memory layout: SoA direction-major, `A[i*N + idx]`, same as the 2D app).
- `f_i^out(x, t)` — the post-collision population produced by cell `x` at step `t`.
- **Canonical layout**: `A[c][i]` holds `f_i^out(c)` for all `i` (this is exactly the
  naive solver's storage convention: arrays hold post-collision values).
- **Step parity**: steps are counted from 0. Step `t` is **EVEN** if `t % 2 == 0`.
  The array is in canonical layout **before every EVEN step** (i.e., at t=0 after
  initialization, and after every completed ODD step).
- All cells are one of Fluid / Solid / Inlet / Outlet (`CellType` in
  `packages/core/src/lattice.ts`). **Hard precondition: the domain boundary is a
  one-cell shell of non-Fluid cells on every non-periodic face** (validate in the
  constructor and throw otherwise). This removes all out-of-bounds cases: a fluid
  cell's neighbor always exists. Periodic axes wrap indices instead.

## 3. The rules

Every active cell (Fluid/Inlet/Outlet — Solid cells never execute) performs, per step:
**gather all inputs into registers → compute outputs → write outputs.** Reads must
complete before any write of that same cell (per-cell atomicity). No other ordering
constraint exists — §6 proves cells can run in any order or in parallel.

### 3.1 EVEN step (t even), fluid cell x

For the rest direction: read `f_0^in = A[x][0]`; after collision write
`A[x][0] ← f_0^out`.

For each pair `(a, b)`, with neighbors `n_a = x − e_a` and `n_b = x + e_a` (= x − e_b):

|                                     | direction a           | direction b           |
| ----------------------------------- | --------------------- | --------------------- |
| **read** (normal)                   | `f_a^in = A[n_a][a]`  | `f_b^in = A[n_b][b]`  |
| **read** (neighbor Solid)           | `f_a^in = A[x][b]`    | `f_b^in = A[x][a]`    |
| **write** (always, even into Solid) | `A[n_a][a] ← f_b^out` | `A[n_b][b] ← f_a^out` |

Read as: EVEN pulls normally (from the upwind neighbor's own slot), then writes
**crosswise** — each outgoing population goes into the slot it was read from, but
swapped within the pair, which pre-positions it for the ODD step.

### 3.2 ODD step (t odd), fluid cell x

Rest: read `A[x][0]`, write `A[x][0]`.

For each pair `(a, b)`:

|                           | direction a          | direction b          |
| ------------------------- | -------------------- | -------------------- |
| **read** (normal)         | `f_a^in = A[x][b]`   | `f_b^in = A[x][a]`   |
| **read** (neighbor Solid) | `f_a^in = A[n_a][a]` | `f_b^in = A[n_b][b]` |
| **write** (always)        | `A[x][a] ← f_a^out`  | `A[x][b] ← f_b^out`  |

Read as: ODD is fully local — inputs sit in the cell's own slots (swapped within the
pair), outputs restore the canonical layout. The bounce-back reads reach into the
**Solid neighbor's slots**, which the EVEN step used as scratch (§5).

### 3.3 Collision

Between gather and write, run the **shared** collision routine (identical code object
to the naive `Solver3D` — same function, same floating-point operation order; this is
what makes bit-identity possible): compute ρ, u, equilibrium, TRT/LES per
`docs/handoff/H1-trt-les-forcing.md`, producing `f_i^out` from `f_i^in`.

### 3.4 Inlet cells (prescribed equilibrium)

Inlet cells skip gather and collision; their outputs are `f_i^out = f_i^eq(ρ=1, u_in)`.
They perform **exactly the standard writes** for the current parity (§3.1/§3.2 write
rows, including writes into Solid neighbors' slots). Nothing else.

### 3.5 Outlet cells (zero-gradient) — REQUIRES A PRE-PASS

Outlet cell x copies the **previous step's post-collision state** of its upstream
neighbor `z` (e.g. `z = x − x̂` for an outlet on the +x face) and re-emits it as its
own output: `f_i^out(x, t) = f_i^out(z, t−1)`, written with the current parity's
standard write rules.

Where `f_i^out(z, t−1)` lives depends on the parity of step `t−1`:

- If current step is **EVEN** (previous was ODD/init → canonical):
  `f_i^out(z) = A[z][i]` for every i.
- If current step is **ODD** (previous was EVEN):
  `f_0^out(z) = A[z][0]`, and per pair: `f_a^out(z) = A[z + e_a][b]`,
  `f_b^out(z) = A[z − e_a][a]`.

**These reads touch slots owned by other cells in the current step (§6), so they MUST
be snapshotted before the main sweep**: a pre-pass loops over outlet cells, gathers the
19 values above into a side buffer (one `float[19]` per outlet cell), and the main
sweep reads only the snapshot. On CPU: a plain loop before the sweep. On GPU: a
separate small pre-kernel dispatch before the main kernel **in the same command
encoder** (dispatch-order guarantees make the snapshot complete before the sweep).
Skipping the pre-pass produces order-dependent corruption that the bit-identity test
(§8) catches immediately.

## 4. Why the rules are consistent (transport audit)

You should be able to re-derive every rule from these four facts; if an implementation
question isn't answered above, answer it by repeating this audit:

1. **EVEN reads are correct streaming.** Before an EVEN step the layout is canonical,
   so `A[n_a][a] = f_a^out(n_a, t−1)` — precisely the a-population that left `n_a`
   and must arrive at `x = n_a + e_a`. ✔
2. **EVEN writes feed ODD reads.** EVEN cell `y` writes `f_a^out(y)` into
   `A[y + e_a][b]`. The cell that must consume it at the next step is `y + e_a`; the
   ODD rule reads `f_a^in` from own slot `b`. ✔ Symmetrically `f_b^out(y)` goes to
   `A[y − e_a][a]`, consumed by `y − e_a = y + e_b` reading own slot `a`. ✔
3. **ODD writes restore canonical.** ODD writes `f_i^out(x)` to `A[x][i]`, which is
   the canonical convention, and the next (EVEN) step's normal reads expect exactly
   that. ✔
4. **Two-step cycle.** canonical → (EVEN) swapped/shifted → (ODD) canonical. ✔

## 5. Implicit bounce-back through Solid slots

Halfway bounce-back needs `f_i^in(x, t) = f_opp(i)^out(x, t−1)` when the upwind
neighbor is Solid (same convention as the 2D solver and PHYSICS.md §7).

- **EVEN, neighbor `n_a` Solid:** the previous ODD step stored `f_b^out(x)` at
  `A[x][b]` (canonical). So the bounce read is the cell's **own** slot `b`. ✔
  Meanwhile the EVEN write `A[n_a][a] ← f_b^out` still executes — the Solid cell's
  slot becomes scratch storage.
- **ODD, neighbor `n_a` Solid:** the value needed is `f_b^out(x, EVEN)`, which the
  EVEN step wrote into... `A[x − e_a][a] = A[n_a][a]` — the Solid cell's slot. So the
  ODD bounce read is exactly that scratch location. ✔

Consequence: **Solid cells' array slots are functional storage, not dead memory.**
Initialize them like everything else (equilibrium is fine); never "optimize" them away
or skip the writes into them.

## 6. Slot ownership (why sequential CPU ≡ parallel GPU)

Claim: in each step, every array slot is touched by **at most one active cell** —
therefore any execution order (sequential loop, GPU threads in any interleaving)
produces identical results, provided each cell gathers before it writes.

Audit for EVEN (ODD is the same argument with local slots):

- Slot `(c, a)` (a odd): normal reader is the cell `c + e_a` (its rule reads
  `A[(c+e_a) − e_a][a]`); the writer is also `c + e_a` (its rule writes `f_b^out` to
  `A[(c+e_a) − e_a][a]`). Same single owner. ✔
- Slot `(c, b)`: owner is `c − e_a = c + e_b` by the mirrored argument. ✔
- Bounce case: cell x reads `A[x][b]` only when `x − e_a` is Solid — but the normal
  owner of `(x, b)` on EVEN is exactly `x − e_a`, which is Solid and inactive, so x is
  still the only active toucher. ✔ The scratch write into `A[n_a][a]` belongs to x by
  the normal ownership rule already. ✔
- Rest slots `(c, 0)`: owner c. ✔
- The **only** violation is the Outlet zero-gradient read (§3.5) — hence the mandatory
  snapshot pre-pass.

This ownership property is also why the CPU reference (a plain sequential loop over
cells, in any order) is a **bit-exact model of the GPU kernel**. That equivalence is
the entire foundation of the parity-gate strategy (`docs/handoff/H6-parity-panel.md`).

## 7. Initialization, macroscopics, and forces

- **Init**: write equilibrium into `A[c][i]` canonically for ALL cells including
  Solid; step counter 0 (next step is EVEN).
- **Reading state at parity P = (completed steps) % 2:**
  - P = 0 (after an ODD step or at init): canonical — `f_i(x) = A[x][i]`.
  - P = 1 (after an EVEN step): `f_0(x) = A[x][0]`; per pair:
    `f_a(x) = A[x + e_a][b]`, `f_b(x) = A[x − e_a][a]`.
    Implement once as `snapshotCanonical(): Float64Array` and use it for macroscopics,
    checkpoints, and the bit-identity test. GPU macroscopic/visualization kernels must
    take the parity as a uniform and apply the same mapping.
- **Momentum-exchange forces**: the bounce contribution rule is unchanged from
  `docs/handoff/H2-momentum-exchange.md` — when a bounce read replaces direction i's
  gather at cell x, the into-solid direction is `opp(i)` and the link contributes
  `2 · e_opp(i) · (the bounced value)`. Accumulate during gather, both parities.

## 8. THE test: bit-identity against the naive solver (normative)

`packages/core/test/esoteric.test.ts` (when built):

1. Grid 8×6×5 (tiny — this is an index-math test, not physics). One-cell shell:
   x=0 plane Inlet (u_in = 0.05), x=max plane Outlet, all other faces Solid.
2. Interior: seed ~10 random Solid cells from a **fixed** literal list (no RNG at
   runtime — hardcode the coordinates in the test so failures reproduce).
3. Construct `Solver3D` (naive two-array) and `EsotericPull3D` with identical options
   (τ = 0.8, TRT Λ = 3/16, LES off; then a second case with LES on), identical flags,
   identical init.
4. Step both 1 step at a time for **≥ 200 steps**. After EVERY step compare
   `esoteric.snapshotCanonical()` against the naive solver's post-collision array:
   **`expect(a).toBe(b)` per element — exact Float64 equality, not toBeCloseTo.**
   (Both paths share the same collision function and gather pure copies, so equality
   is achievable; any deviation means an index bug, and the first failing step number
   localizes it: failures at step 1 = EVEN rules; step 2 = ODD rules or scratch;
   near outlets = snapshot pre-pass.)
5. Also assert mass conservation on a fully-closed variant (all-Solid shell, no
   inlet/outlet): total mass constant to 1e-12 relative over 200 steps.

Runtime: 8·6·5·19·200·2 ≈ 1.8M cell-direction ops — milliseconds.

## 9. WGSL transliteration map (M6)

| CPU reference                     | WGSL kernel                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `EsotericPull3D.step()` cell loop | one invocation per cell, `@workgroup_size(64)` 1D                                                                                          |
| step parity                       | `uniform u32 parity` (host alternates per dispatch; batch N dispatches per submit)                                                         |
| pair loop over 9 pairs + rest     | unrolled or `for (var p = 0u; p < 9u; p++)` with pair tables in function-local `var` arrays (see `docs/WGSL-NOTES.md` on dynamic indexing) |
| `A` Float64Array                  | single storage buffer `array<f32>` (FP32 first; FP16 packing per `docs/handoff/H5-fp16-storage.md` ONLY after FP32 passes parity)          |
| outlet snapshot pre-pass          | separate small kernel dispatched before the main kernel in the same encoder, writing `array<f32, 19>` per outlet cell to a side buffer     |
| `snapshotCanonical()`             | parity-aware readback/visualization kernels                                                                                                |
| shared `collideCell()`            | the SAME collision WGSL text as the naive-3D debug kernel — string-share it (single `collide.wgsl` inlined into both), never fork it       |

Port order (do not deviate): (1) naive two-buffer D3Q19 WGSL, pass 16³ parity vs
`Solver3D`; (2) esoteric FP32 WGSL, pass 16³ parity vs `EsotericPull3D` (which itself
passed §8); (3) only then FP16 storage, re-run parity within the H5 tolerance; (4) only
then performance work (the M6 MLUPs gate).

## 10. Pitfalls (each of these WILL happen; check here first)

1. **Swapped-write direction confusion**: on EVEN, `f_a^out` goes to the _b_ slot of
   `x + e_a` (destination side), `f_b^out` to the _a_ slot of `x − e_a`. Writing them
   unswapped passes step 1 and corrupts step 2.
2. **Skipping writes into Solid slots** ("it's solid, why write?") — breaks ODD
   bounce-back (§5). The scratch writes are load-bearing.
3. **Gather/write interleaving within a cell**: all 19 reads must complete before the
   first write (registers first). Interleaving self-corrupts the bounce slots.
4. **Outlet without the snapshot pre-pass** — order-dependent corruption (§3.5).
5. **Macroscopics read at the wrong parity** (visualization "flickers" or shows
   checkerboard every other frame): apply §7's parity mapping.
6. **Odd number of steps per batch** leaves the array non-canonical — fine, but any
   readback/checkpoint must use the parity mapping; prefer even batch sizes.
7. **Pair table not matching `opp()`**: pairs MUST be (1,2),(3,4)…(17,18) per
   PHYSICS.md §2. If someone reorders the velocity set, every rule here silently
   breaks — the D3Q19 ordering is frozen and normative.
8. **Periodic wrap forgotten** on periodic axes (test uses a full shell precisely to
   avoid OOB; if you enable periodic axes, wrap `n_a`/`n_b` indices).
9. **A Solid cell directly upstream of an Outlet** (measured during implementation,
   2026-07-08): the zero-gradient copy from a solid neighbor is physically meaningless
   and implementation-dependent — the naive solver copies the solid's zeros while the
   esoteric layout yields scratch values, so bit-identity fails exactly at the
   outlet's neighbors on step 2. Both CPU solvers now REJECT the configuration at
   construction. Consequence for M6+ scene building: keep ≥1 non-solid cell upstream
   of every outlet cell (voxelizers must leave an outlet buffer zone).

## 11. References

- M. Lehmann, "Esoteric Pull and Esoteric Push: Two Simple In-Place Streaming Schemes
  for the Lattice Boltzmann Method on GPUs", _Computation_ 10(6):92, 2022 — open
  access CC-BY: https://www.mdpi.com/2079-3197/10/6/92 (cite for the concept; this
  spec is self-contained and clean-room).
- Memory budgets and the FP16 plan: `docs/PHYSICS.md` §11, `docs/handoff/H5-fp16-storage.md`.
- Naive 3D reference solver spec: `docs/handoff/H3-solver3d.md`.
