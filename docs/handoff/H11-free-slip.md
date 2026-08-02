# H11 — Free-slip (specular) boundaries, naive + Esoteric Pull

> **Handoff doc.** Milestone: M10 (ABL top/lateral far field). Derived from first
> principles within the H4 framework; nothing here consults FluidX3D (CLAUDE.md rule 1).
> **The correctness criterion is the bit-identity test in §7 plus the uniform-channel
> invariance test in §6 — not judgment.** If both pass, the index math is right by
> construction.

## 1. Physics and scope

Specular (free-slip) reflection: a population hitting the wall keeps its tangential
velocity and flips the wall-normal component. Zero tangential momentum exchange — the
wall exerts only normal force. This is the correct far-field closure for the ABL scenes:
M10's `abl-fetch` gate cannot hold with a no-slip lid (a solid top erodes the sheared
profile — measured in `ablInlet.test.ts`), and the M7-style freestream-Inlet far field
prescribes the inflow profile rather than letting the local flow slip.

**Scope (normative, keep it):** free-slip is a property of whole DOMAIN FACES, never of
interior geometry, and never of the ±x faces (flow axis: inlet/outlet live there).
Configured per solver as `freeSlip: { yMin?, yMax?, zMin?, zMax? }`; free-slip cells are
shell cells (`CellType.FreeSlip`) on configured faces. Corners shared with the inlet
face may be flagged either Inlet or FreeSlip (both well-defined; scenes choose).

## 2. Halfway specular reflection, exactly

Wall normal n̂ (outward), wall plane half a cell outside the last fluid layer (same
halfway convention as bounce-back). A population leaving fluid cell `y` at step `t` with
direction `j` (with `e_j·n̂ = +1`) reflects and arrives at step `t+1` at cell
`z = y + e_j − 2(e_j·n̂)n̂ = y + e_j^tangential`, with direction `i = R_n̂(j)` (normal
component negated, tangential preserved). Equivalently, in pull form — the form both
solvers implement:

> **Pull rule.** Fluid cell `z` gathering direction `i` whose source `s = z − e_i` is a
> FreeSlip cell reads `f_i^in(z, t+1) = f_J^out(S, t)` where `(S, J)` come from the
> **reflection resolution loop** of §3.

For normal incidence (`e_i = −n̂`, no tangential part) this degenerates to
`S = z, J = opp(i)` — identical to halfway bounce-back. Any implementation that breaks
this degeneracy is wrong.

## 3. Reflection resolution loop (shared, executable semantics)

One helper, used by BOTH solvers so their arithmetic is identical (bit-identity depends
on it):

```
resolvePull(z, i):
  S ← z − e_i          // the caller passes S already periodic-wrapped (naive solver
                       // supports periodic x; recomputing unwrapped coords here was
                       // the first implementation bug the invariance test caught)
  J ← i
  repeat (≤ 3 times):
    if flags[S] ≠ FreeSlip: break
    for each axis k ∈ {y, z} whose face S lies on AND which is configured free-slip:
       S_k ← S_k + (e_J)_k     // undo the normal part of the displacement
       (e_J)_k ← −(e_J)_k      // negate the normal component (J ← R_k(J))
  if flags[S] = Solid:  → SOLID FALLBACK (§3.1)
  else: read f_J^out(S, t) per solver (§4, §5)
```

Each iteration handles one face; a slip∩slip edge cell (top∩side) resolves in two
iterations (both components negated, both displacement components undone — the double
mirror). The loop terminates: every iteration moves `S` one cell off a face along an
axis with `(e_J)_k ≠ 0`, and only ≤ 3 axes exist.

Sanity anchors (all consequences of §2, all testable):

- normal incidence → `S = z, J = opp(i)` (bounce-back degeneracy);
- single tangential offset → `S` is `z` shifted one cell tangentially in `z`'s own
  layer, `J = R(i)`;
- final `S` may be Fluid, Inlet, or Outlet — all three EMIT outputs every step through
  the standard write rules, so `f_J^out(S, t)` is well-defined in both solvers.

### 3.1 Solid fallback (slip∩solid edges, normative approximation)

If the resolved `S` is Solid (diagonal crossing a free-slip face into the no-slip
ground ring), apply plain local bounce-back of the ORIGINAL direction:
`f_i^in(z) = f_opp(i)^out(z, t−1)`, exactly as if `z − e_i` were Solid. This makes the
one-link-wide slip∩solid edge locally no-slip — consistent with the adjacent no-slip
ground, strictly local, and identical in both solvers. Do not attempt a mixed
specular/bounce composition; it buys nothing at screening resolution and breaks the
locality the esoteric audit below depends on.

### 3.2 Validation rules (constructor, both solvers)

- FreeSlip cells only on configured faces (position check); throw otherwise.
- Configured faces must be y/z faces only.
- A FreeSlip cell directly upstream (−x) of an Outlet cell is ill-posed (the outlet
  would copy a passive cell's scratch — same class as H4 §10.9): reject. Scene rule:
  on the outlet face, the ring adjacent to a free-slip face stays FreeSlip, so outlets
  start one row in.

## 4. Naive solver (`Solver3D`) — reference semantics

FreeSlip cells are PASSIVE (never execute, like Solid). In the gather loop, when the
source cell is FreeSlip, run §3 and read `fSrc[J][S]` (post-collision of step `t` —
exact timing, no latency). Solid fallback reads `fSrc[opp(i)][z]` (the existing bounce
path). Nothing else changes; no force is accumulated for free-slip links (specular
walls exchange no tangential momentum with the flow; normal force on the far field is
not an observable we report).

## 5. Esoteric Pull — where `f_J^out(S, t)` lives, and why no pre-pass is needed

The outlet BC (H4 §3.5) needs a snapshot pre-pass because its reads violate slot
ownership. The free-slip reads do NOT — they land in slots no active cell touches in
the current step. Audit:

**Step t+1 EVEN (previous step ODD → canonical layout):**
`f_J^out(S, t) = A[S][J]` (canonical, H4 §7).
_Ownership:_ on EVEN, slot `(S, J)`'s unique reader/writer is the cell `S + e_J`
(H4 §6). By construction `e_J`'s reflected components point back toward the free-slip
face(s), so `S + e_J` is a shell cell (FreeSlip, or the Solid ground ring at slip∩solid
edges) — **passive**. No active cell reads or writes `(S, J)` this step; `z`'s extra
read races with nothing. ✔

**Step t+1 ODD (previous step EVEN):**
By the EVEN write rule (H4 §4.2), cell `S` wrote `f_J^out(S)` into
`A[S + e_J][opp(J)]`. So read `f_J^out(S, t) = A[S + e_J][opp(J)]`.
_Existence:_ the write happened because `S` is active (Fluid/Inlet/Outlet — §3
guarantees non-FreeSlip, §3.1 diverts Solid) and `S + e_J` is in bounds (it is a shell
cell; the H4 scatter only skips out-of-domain targets, which cannot occur here because
`S` sits ≥ 1 cell inside every reflected axis). ✔
_Uniqueness:_ slot `(S+e_J, opp(J))`'s EVEN writer is unique and is exactly `S`
(H4 §6) — the value is not clobbered by any other crosswise write. ✔
_Ownership on ODD:_ ODD rules are local — the owner of `(S+e_J, ·)` is `S+e_J` itself,
which is passive shell. The only other cross-cell ODD reads are Solid bounce reads
into Solid neighbors' slots; `S + e_J` is FreeSlip (or the value was diverted by §3.1
before this path). No race. ✔

**Degeneracy check** (normal incidence, single face): `S = z`, `J = opp(i)`.
EVEN: read `A[z][opp(i)]` — the H4 §5 EVEN bounce read verbatim. ODD:
`A[z + e_opp(i)][i] = A[z − e_i][i]` — the H4 §5 ODD bounce read verbatim. ✔ The
free-slip rule contains bounce-back as its zero-tangential special case in BOTH
parities, exactly as the physics demands.

Consequences (mirror of H4 §5): FreeSlip cells' slots are functional scratch — the
EVEN crosswise writes into them are load-bearing (they carry `f_J^out(S)` to the ODD
read). Never skip writes into FreeSlip cells, never "optimize" their storage away.

## 6. Invariance test (physics gate)

Uniform flow parallel to free-slip walls must stay EXACTLY uniform (bounce-back walls
decay it; that contrast is the point of the test):

- naive: periodic x and z, `freeSlip: {yMin, yMax}`, init uniform `ux = 0.05`; after
  ≥ 50 steps every fluid cell has `|ux − 0.05| ≤ 1e−14`, `|uy|,|uz| ≤ 1e−14`.
- esoteric (no periodic support): x Inlet/Outlet at the same uniform `u`, y and z
  free-slip; same assertion (the inlet feeds the identical equilibrium, so the interior
  remains a collision fixed point).
- control: the same setup with Solid y-walls must NOT stay uniform (confirms the test
  can fail).

## 7. Bit-identity (normative gate, extends H4 §8)

Same protocol as H4 §8: fixed literal obstacle list, ≥ 100 steps, compare
`snapshotCanonical()` per step with **exact Float64 equality**, on a scene exercising
every path at once: inlet profile (sheared), outlet, Solid ground + interior obstacle,
free-slip top (yMax) and both z faces, including slip∩slip edges and the slip∩solid
ground ring (§3.1). Forces must also match exactly (identical gather order).

## 8. WGSL port map (deferred until a browser parity run is available)

| CPU reference                                     | WGSL                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `resolvePull` loop                                | same loop, function-local; FreeSlip flag value synced by hand with `lattice.ts` (CLAUDE.md convention) |
| EVEN read `A[S][J]` / ODD read `A[S+e_J][opp(J)]` | same indexing off the `parity` uniform                                                                 |
| reflect tables                                    | copy `reflectX/Y/Z` constants; note pairing in the header comment                                      |

Port order per H4 §9: naive-WGSL parity vs `Solver3D` first, then esoteric WGSL vs
`EsotericPull3D`, then FP16. **Every `.wgsl` commit carries a parity-panel line
(CLAUDE.md rule 0) — CPU-side work lands first and alone.**

## 9. Pitfalls

1. **Reflecting unconfigured faces.** A FreeSlip corner cell on the inlet face must
   reflect only its configured axis; reflecting x is nonsense. The loop keys off the
   CONFIG, not off "any face the cell touches".
2. **Wrong displacement bookkeeping**: undo the normal displacement BEFORE negating the
   component (`S_k += (e_J)_k` then negate). Doing it after shifts the source two cells.
3. **Skipping the EVEN writes into FreeSlip cells** — kills the ODD read (§5), exactly
   like H4 pitfall 2.
4. **Accumulating forces on free-slip links** — the walls are far field; only Solid
   bounces contribute (H2).
5. **Outlet downstream of a FreeSlip cell** — rejected at construction (§3.2); scenes
   keep the outlet face's slip-adjacent ring FreeSlip.
6. **Using `reflect` where the resolved direction crosses TWO faces but only one is
   configured free-slip** (top configured, z-walls Solid): the loop reflects the top
   axis, then §3.1 catches the Solid z-wall — verify the fallback path is hit, not an
   accidental double reflection.

## 10. Status

Derived and implemented CPU-side 2026-07-18 (naive + esoteric, invariance + bit-identity
tests). WGSL port landed 2026-07-19 per §8 (`stream_collide_3d.wgsl` freeSlipRead +
reflect tables synced with `lattice3d.ts`): Float64 emulation of the kernel matches
`EsotericPull3D` <1e-6 (`kernel3dEmu.test.ts` ABL scene), and the `?parity3d` v9-abl
ABL config PASSES on SwiftShader (real WGSL): rho=2.13e-6 u=5.81e-6 (bar 5e-5),
force=1.54e-6 (bar 1e-4). Ampere re-run recommended next browser session
(`parity3d.gpu.spec.ts`).
