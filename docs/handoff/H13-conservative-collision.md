# H13 — Finite-precision conservative collision

> **Status:** CPU-oracle phase started 2026-08-01 after the M3 long-run drift probe.
> Doctrine: this document and the Float64 identities land first, then D2Q9 WGSL and its
> 4-million-step discriminator, then D3Q19 WGSL + parity before M9 uses the option.

## Why

The H=64 Re=100 cavity reaches the Float64 answer at 20k steps, then gains density almost
linearly in FP32. At 4M steps plain TRT has gained 4.214% mass and regularized TRT 3.051%;
the velocity decay tracks that gain. Replaying every moving-wall addition in f32 predicts
only about 1e-8 mass/step, versus the measured 3.1e-5 to 4.3e-5. H10 reduces the bias but
does not remove it, so ghost modes and moving-wall arithmetic are both falsified as the
root cause. The remaining source is finite-precision collision: its algebra conserves the
zeroth moment exactly, but independently rounded output populations do not.

This matters beyond M3. M9 requires four-hour 3D runs, where a systematic per-cell bias
can accumulate long after ordinary 100-step parity has passed.

## Algorithm

The gathered density `rhoIn` is already computed before equilibrium and collision. After
BGK/TRT relaxation and any Guo source term, compute the represented output density in
direction order and put its residual into the rest population:

```text
rhoOut = sum(i = 0..q-1, fOut[i])
delta = rhoIn - rhoOut
fOut[0] += delta
```

In exact arithmetic `delta = 0`, so this is not a new physical model. It projects only
the floating-point residual back onto the conserved zeroth moment. Because the rest
direction has `e_0 = 0`, changing `f_0` changes neither momentum nor any second-or-higher
kinetic moment containing velocity factors. Do not renormalize every population: that
would rescale momentum and viscous stress.

The correction is initially opt-in as `conserveMass`. Published configurations remain
unchanged until their validation gates are rerun. CPU Float64 performs the same operation
as WGSL so parity remains a transliteration test, even though its residual is much smaller.

## Gates

1. **C1 moment identity, D2Q9 + D3Q19:** across BGK/TRT, LES off/on, the corrected and
   uncorrected outputs differ only in direction 0. Momentum and all six second moments are
   bit-identical; corrected mass equals incoming mass to Float64 roundoff.
2. **C2 CPU solver identity:** naive `Solver3D` and `EsotericPull3D` remain bit-identical
   with `conserveMass` enabled.
3. **C3 D2Q9 long-run discriminator:** H=64 Re=100, 4M steps, same scene as the finding.
   Preserve the uncorrected result as the negative control. With correction, absolute mass
   drift must be below 1e-4 and `u_min` must remain within 0.5% of its 20k value.
4. **C4 GPU parity:** the full H6 D2Q9 matrix and H6 3D matrix pass their existing bars
   with the option enabled. No tolerance changes.
5. **C5 M9 checkpoint:** the 64³ raw-FP16 checkpoint gate remains bit-identical when the
   option is enabled; checkpoint bytes need no format change because the option is static
   scene configuration, not dynamic state.

## Port order

1. Add `conserveMass` to the shared CPU collision context and all three CPU solver option
   surfaces; land C1 and C2.
2. Add the D2Q9 uniform flag and exact post-collision loop; run C4 then C3 on a real GPU.
3. Add a compile-time `CONSERVE_MASS` D3Q19 variant, porting the same direction-order sum;
   run 3D parity in FP32 and FP16 checkpoint parity.
4. Only after those gates pass, enable it in the M9 Ahmed runner and execute an endurance
   probe. Never infer 3D/fp16 behavior solely from the D2Q9 result.

## Pitfalls

- Correct after the Guo source, whose exact zeroth moment is also zero.
- Sum `rhoOut` in the same direction order on CPU and GPU; reassociation weakens parity.
- Add the residual only to direction 0. Distributing it over moving populations changes
  momentum or stress.
- This fixes collision conservation only. Inlet/outlet scenes are open systems and their
  global mass need not be constant; use closed/periodic gates when measuring conservation.
- FP16 storage quantizes after collision. C5 and the later 3D endurance probe decide
  whether the correction survives storage; do not assume it.
