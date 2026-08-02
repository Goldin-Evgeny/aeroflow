# H5 — FP16 shifted-DDF storage: executable specification

> **Handoff doc.** Milestone: M6 (after FP32 esoteric passes parity — H4 §9 port
> order). Deliverables when executed: `packages/core/src/half.ts` (CPU reference for
> the bit semantics + tests) and the WGSL packing helpers. FP16 storage is what turns
> 93 B/cell into 55 B/cell and doubles effective bandwidth — it is a _storage_ format
> only; **all arithmetic stays FP32**.

## 1. binary16 encode/decode (CPU reference, `half.ts`)

IEEE 754 binary16: 1 sign bit, 5 exponent bits (bias 15), 10 mantissa bits.
Implement with a shared `Float32Array(1)`/`Uint32Array(1)` view pair.

**Decode (half → f32), exact:**

```
s = (h >> 15) & 1;  e = (h >> 10) & 0x1F;  m = h & 0x3FF
e == 0:    value = (−1)^s · m · 2^−24               // zero/subnormal
e == 31:   value = m ? NaN : (−1)^s · Infinity
else:      value = (−1)^s · (1 + m/1024) · 2^(e−15)
```

**Encode (f32 → half), round-to-nearest-even.** Take the f32 bits `b`:

```
sign = (b >> 16) & 0x8000
e32  = (b >> 23) & 0xFF;  m32 = b & 0x7FFFFF
if e32 == 0xFF:            return sign | 0x7C00 | (m32 ? 0x200 : 0)    // Inf/NaN (quiet)
E = e32 − 127                                                           // unbiased
if E > 15:                 return sign | 0x7C00                        // overflow → Inf
if E >= −14:                                                            // normal half
    // 13 mantissa bits are dropped; RNE on the dropped bits:
    m  = m32 | 0x800000                       // implicit 1 (for uniformity below)
    h  = sign | ((E + 15) << 10) | ((m >> 13) & 0x3FF)
    round = m & 0x1FFF                        // dropped 13 bits
    if round > 0x1000 || (round == 0x1000 && (m >> 13) & 1): h += 1    // RNE (carry may
    return h                                                            // legally overflow
if E >= −24:                                                            // subnormal half
    shift = −14 − E                            // 1..10
    m = (m32 | 0x800000) >> (13 + shift)
    // RNE on the (13+shift) dropped bits, same pattern as above
    return sign | m (+ rounding)
return sign                                                             // underflow → ±0
```

(The `h += 1` carry propagating mantissa→exponent is CORRECT behavior — it rounds
65519.999… to Inf and subnormal-max to normal-min; do not "fix" it.)

**Mandatory test vectors** (assert both directions where exact):

| f32                                        | half bits                           |
| ------------------------------------------ | ----------------------------------- |
| 0.0 / −0.0                                 | 0x0000 / 0x8000                     |
| 1.0                                        | 0x3C00                              |
| −2.0                                       | 0xC000                              |
| 65504 (half max)                           | 0x7BFF                              |
| 65520                                      | 0x7C00 (Inf — overflow via RNE)     |
| 6.103515625e−5 (2⁻¹⁴, normal min)          | 0x0400                              |
| 5.960464477539063e−8 (2⁻²⁴, subnormal min) | 0x0001                              |
| 1/3                                        | 0x3555 (decodes to 0.333251953125)  |
| NaN                                        | e=31, m≠0 (assert isNaN round-trip) |

Plus a property test over ~10⁴ fixed pseudo-random floats in [−2, 2] (seeded LCG, not
Math.random — determinism): `|decode(encode(x)) − x| ≤ 2⁻¹¹·max(|x|, 2⁻¹⁴)`.

## 2. Why DDFs are stored SHIFTED (the worked numbers — this is the point of the doc)

DDF values sit near their weights: `f_i ≈ w_i·(1 + O(u))` with the _physics_ living in
perturbations of relative size ~10⁻²…10⁻⁴ of w_i. Half precision has an 11-bit
significand: absolute quantization step near a value x is `ulp(x) ≈ 2^(⌊log₂x⌋ − 10)`.

**Storing f directly (BAD).** Take the D3Q19 rest weight w₀ = 1/3 ≈ 0.3333 and a
physically meaningful perturbation δ = 10⁻³·w₀ ≈ 3.33×10⁻⁴:
ulp(0.333) = 2⁻¹² ≈ 2.44×10⁻⁴ → quantization error up to ~1.2×10⁻⁴ = **37% of the
signal δ**. The physics drowns in rounding.

**Storing f − w_i (GOOD).** The stored value IS the perturbation δ ≈ 3.33×10⁻⁴:
ulp(3.33×10⁻⁴) = 2⁻²² ≈ 2.4×10⁻⁷ → relative-to-signal error ~4×10⁻⁴. **A ~10³×
precision improvement from a subtraction.** (General rule: the shift re-centers the
representable grid onto the signal.) This is why PHYSICS.md §11 mandates shifted
storage; FluidX3D's README describes the same trick — implement from here, not from
its source.

Consequences to encode in tests/design:

- Shift by the direction's own w_i at pack time, add it back at unpack. The shift
  constants live in one shared table (same source as the lattice constants).
- Equilibrium-at-rest stores as exactly 0.0 (test this — it's the sanity canary).
- The V10 FP16-vs-FP32 A/B gate (≤2% on Cd) has a large safety margin over the
  ~4×10⁻⁴-per-value storage noise; if A/B exceeds ~0.5% investigate before blaming
  "just fp16" (usually a missing shift on ONE direction table entry).

## 3. WGSL packing

Preferred: `enable f16;` + `array<f16>` storage when the device reports the
`shader-f16` feature (arithmetic still f32 — convert at load/store).

Universal fallback (works everywhere): pack two halves per u32 with the built-ins —
`pack2x16float(vec2f)` / `unpack2x16float(u32)`:

```wgsl
// storage: array<u32>, length ceil(19·N/2); slot s = i·N + idx; word = s >> 1
fn loadDDF(s: u32) -> f32 {
  let v = unpack2x16float(ddf[s >> 1u]);
  return select(v.x, v.y, (s & 1u) == 1u) + wShift(s / N);   // + w_i unshift
}
```

**The write hazard (must be designed around, not discovered):** two half-values share
one u32 word. A read-modify-write of one lane races if ANOTHER invocation owns the
neighboring lane in the same pass. Make lane-pairing safe by construction: keep the
SoA layout `i·N + idx` and pack adjacent `idx` (same direction) into one word — then
under H4's ownership rules the two lanes of a word belong to… different cells, which
DO race on EVEN steps (neighbor writes). The correct resolution, and the one to
implement: **pad each direction plane to an even cell count and make the esoteric
kernel process two adjacent cells (one word) per invocation for load/store** — or
simpler and preferred for the first port: **use the `shader-f16` path where available
and fall back to FP32 storage (not packed-u32) elsewhere.** Record which path shipped;
packed-u32 with paired-cell invocations is a performance follow-up with its own parity
run, not a correctness assumption.

## 4. Where FP16 is allowed

- ✅ DDF storage (shifted), macroscopic output fields for visualization.
- ❌ Accumulators (forces, reductions, statistics) — always f32.
- ❌ The CPU oracle — always Float64 (it emulates the f16 storage only inside
  `half.ts`-based A/B tests, i.e. quantize→dequantize each stored value per step when
  running in "fp16-emulation mode"; this emulation mode is how V10's expected error is
  predicted BEFORE the GPU implementation exists).

## 5. Pitfalls

1. Round-toward-zero encode (plain `>> 13`) instead of RNE — systematic energy drain,
   visible as slow mass drift in fp16-emulation runs.
2. Missing subnormal handling — flows with tiny perturbations quantize to zero and the
   simulation "freezes" near equilibrium.
3. Shifting by the WRONG direction's weight (SoA index arithmetic off by one plane) —
   the at-rest-stores-zero test catches it immediately.
4. Doing arithmetic in f16 because the storage is f16 — never; load→f32, compute,
   f32→store.
5. Packed-u32 lane races (§3) — do not ship packed-u32 without the paired-cell design
   and a dedicated parity run.
6. Testing round-trip only on nice values — the property test with seeded randoms and
   the subnormal vectors are the ones that catch real bugs.
