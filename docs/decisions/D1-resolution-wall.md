# D1 — The uniform-grid resolution wall

**Status:** accepted, 2026-07-25; amended 2026-07-27, 2026-07-28, and 2026-08-10
**Supersedes:** the deferred scheduling of grid refinement in roadmap Risk #2
**Affects:** M7 (criteria 2–4), M9 (grid choice), M10 (probe height), M11 (Case C **and** E), M12 (by inheritance), M15 (visitor-re-runnability)

> **M7 force-audit amendment (2026-08-10):** the table below preserves the evidence that
> originally motivated this decision, but its M7 force values and its **unique-cause
> attribution to boundary-layer under-resolution are withdrawn**.
>
> Every force in that table was read from a single timestep on an even sample interval,
> pinning every sample to one parity of a period-2 staggered-momentum mode. That mode is
> damped by ω⁻ = 1/(½ + Λ/(τ_eff−½)), which collapses as τ₀ → ½, so the contamination is
> 1.04×10⁻³ at τ₀=0.8 but 0.519 and 0.604 at the Re 1e5 and Re 4.29e6 rungs. The failing
> M7 cases sit at ω⁻ = 0.019 (Re=1000) and 1.9×10⁻³ (Re=10⁴) — squarely in that regime.
>
> Re-run with consecutive-step force averaging: Re=1000 Cd **0.5692**, Re=10⁴
> freestream/free-slip **0.6047/0.2727**, FP16/FP32 deltas **2.702%/0.320%** at
> Re=1000/Re=10⁴. Same pass/fail outcomes, but they are now measurements of a drag, and
> nothing in them isolates boundary-layer resolution as the cause. M9 subsequently measured
> a competing mechanism at the same operating points — the projected second-order
> regularization is anti-dissipative at high wavenumber once τ₀ → ½ with a mean flow present,
> which also drives the subgrid model to fire on undisturbed freestream. See
> [VALIDATION](../VALIDATION.md#v11-disposition--2026-08-10) and
> [PHYSICS §2](../PHYSICS.md).
>
> The cell-count ceiling this ADR decides is unaffected: it is a hardware/binding limit, not
> a physics attribution. Only the explanation offered for the M7 sphere failures changes.

> **Current outcome (2026-07-28):** the four-way `macro` split is implemented and
> validated. At the measured 2 GiB cap the base FP16 ceiling is now **214,748,364 cells**,
> so Wall 2 no longer blocks M11 Case C's 183 M-cell grid. Case E remains **DEFERRED** by
> Wall 1.
>
> **V14 now has a physics result, and it is a FAIL.** The strict grid ran to completion in
> **5.96 h** (365,560 steps, 120/120 points) and scored **q = 0.458 against the q ≥ 0.66
> gate**. No band was weakened. **This is the first Case C score taken at a grid that
> satisfies the 3rd-node probe rule** — so unlike M10 Case A, resolution at probe height is
> ruled out by construction and cannot be the explanation. See
> [the 2026-07-28 amendment](#2026-07-28--wall-3-an-intermittent-hang-and-the-first-case-c-q).

## Why this record exists

Roadmap Risk #2 predicted a "uniform-grid resolution wall for full city blocks" and deferred multi-level grid refinement to later roadmap work. **The wall arrived at M7 instead — four milestones early — and has since been absorbed case-by-case as "screening-grade" rather than decided once.** That per-milestone absorption is why the program accumulated six simultaneously-open milestones: each one hit the same wall, wrote its own local deviation, and moved on.

This record decides it once, names the numbers, and states what is and is not claimable.

## There are two independent walls, and they were being conflated

### Wall 1 — physics: cells needed to resolve the flow

| Case              | What it needs                                        | Measured consequence                                                                                                                                                         |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M7 sphere Re=1000 | boundary layer ~D/√Re                                | Cd **0.569** vs literature 0.47 (~21% over) at the ladder grid                                                                                                               |
| M7 sphere Re=10⁴  | BL ~D/100, unresolved                                | freestream **0.55** / free-slip **0.263** — neither brackets [0.38, 0.50]. Lowering blockage _raised_ drag (D=36 → 0.618), proving resolution, not confinement, is the lever |
| M7 FP16 A/B       | —                                                    | 2.25% (Re=100) and 2.98% (Re=1000) over the 2% bar; **0.40% at Re=10⁴**. The A/B failure tracks under-resolution, not fp16 storage                                           |
| M10 Case A        | 2 m probe at ≥3rd fluid node                         | 16 cells/b → q 0.532 FAIL; 24 cells/b → q 0.754. Resolution _was_ the whole story                                                                                            |
| M11 Case E        | 2 m probe at 3rd node under 5H/10H/5H + ≤3% blockage | **2.735 B cells (~150 GB fp16)** at 0°/90°; 4.44 B (~245 GB) at 45°                                                                                                          |
| M11 Case C        | same rule                                            | **183 M cells (~13 GB)**                                                                                                                                                     |

Wall 1 is real physics and no hardware purchase removes it — it sets _how many cells the answer needs_.

### Wall 2 — architecture: cells the kernel can address (this one was invisible)

> ⚠️ **Superseded in part on 2026-07-27 by measurement.** The ceiling figures below were
> derived from the DDF planes alone and are too generous at FP16; the plan to unblock Case C
> by honoring a 2 GiB binding is falsified. Both corrections are in
> [the 2026-07-27 amendment](#2026-07-27--measured-and-the-3-unblock-plan-is-falsified).
> The section is kept verbatim because the reasoning it records is still how the wall was
> found.

The kernel splits the 19 D3Q19 direction planes across storage buffers, each ≤ `min(negotiated maxStorageBufferBindingSize, MAX_BINDING_BYTES = 1 GiB)`, and `Lbm3D` accepts at most **`MAX_DDF_BUFFERS = 4`** of them. Fitting 19 planes into 4 bindings requires ≥5 planes per binding, so:

| Precision | Max addressable cells      | Total allocation |
| --------- | -------------------------- | ---------------- |
| FP16      | **107,374,182** (~107.4 M) | ~5.50 GiB        |
| FP32      | **53,687,091** (~53.7 M)   | ~4.65 GiB        |

Pinned by test in [`apps/studio/test/ddfLayout.test.ts`](../../apps/studio/test/ddfLayout.test.ts) via `maxAddressableCells()`.

**Three consequences that were not previously visible:**

1. **The RTX 3090's 24 GB is already ~4× more than the kernel can use.** The test box has never been the constraint. Storage-binding count is.
2. **M11 Case C V14 was not runnable, contrary to what M11.md recorded.** At 183 M cells FP16 a plane is 366 MB — it fits a 1 GiB binding — but only 2 planes fit per binding, needing `ceil(19/2) = 10` buffers. The documented command (`AEROFLOW_M11_CELLS=190000000`) would have thrown at solver construction, not produced a score. `gridFits()` failed to predict this because it checked only single-plane fit, never the buffer count; it now enforces both, and `Lbm3D`'s error names the ceiling and says the limit is bindings, not VRAM.
3. **Case E cannot even be allocated.** One direction plane at 2.735 B cells FP16 is 5.47 GB, over the 1 GiB per-binding cap on its own — it fails before any buffer-count question arises.

The 1 GiB clamp is **self-imposed for iOS portability**, not a WebGPU limit (field data: ~2 GB requestable on ~79% of devices, iOS ~1 GB). Honoring a 2 GiB negotiated binding on desktop would double the ceiling to ~214.7 M cells FP16 — which **would admit Case C's 183 M grid at exactly 4 buffers.**

## 2026-07-27 — measured, and the §3 unblock plan is falsified

The precondition in Decision 3 was executed as [`apps/studio/e2e/caps.gpu.spec.ts`](../../apps/studio/e2e/caps.gpu.spec.ts). Reading on the reference box (RTX 3090, Chrome, `nvidia · ampere`):

| Limit                             | Value                       |
| --------------------------------- | --------------------------- |
| `maxStorageBufferBindingSize`     | **2.000 GiB** (2³¹ exactly) |
| `maxBufferSize`                   | 2.000 GiB                   |
| `maxStorageBuffersPerShaderStage` | **16**                      |

It produced two corrections, one to the arithmetic above and one to the decision built on it.

### (a) `macro`, not the DDF planes, is what binds first at FP16

The ceiling table counted only DDF planes. But the kernel also binds **`macro` — ρ and **u** as f32, 16 B/cell — as one whole buffer**, and that is larger than any DDF plane group. Since 19 planes must fit 4 bindings, a binding carries ≥5 planes, i.e. 5·`ddfBytes` per cell:

| Precision | DDF binding cost | `macro` cost | Binds first | Ceiling at 1 GiB                 |
| --------- | ---------------- | ------------ | ----------- | -------------------------------- |
| FP32      | 5 × 4 B = 20 B   | 16 B         | DDF         | 53,687,091 — unchanged           |
| FP16      | 5 × 2 B = 10 B   | 16 B         | **`macro`** | **67,108,864** (was 107,374,182) |

The FP16 figure published above was **1.6× too generous**. `gridFits()` and `maxAddressableCells()` now model both bindings, `Lbm3D` rejects an over-cap `macro` with a named ceiling instead of failing opaquely at bind-group creation, and the corrected numbers are pinned in `ddfLayout.test.ts`.

### (b) Honoring the negotiated binding does **not** unblock Case C

Case C at 183 M cells FP16 needs a per-binding cap of 183 M × 16 B = **2.727 GiB**. The device grants **2.000 GiB**. Decision 3's "a 2 GiB binding admits 183 M at exactly 4 buffers" followed from the DDF-only figure and does not survive the correction: **Case C stays BLOCKED after the clamp lift.**

The clamp was lifted anyway (2026-07-27) because it was independently wrong — the negotiated value already _is_ the device's answer, and iOS reports ~1 GiB by itself, so clamping only shrank desktop. `MAX_BINDING_BYTES` is now `DEFAULT_BINDING_BYTES`, a fallback for callers with no device, and call sites pass `deviceBindingCap(caps) = min(binding, buffer)`. What it bought:

| Precision | Ceiling before | Ceiling after (2 GiB) |
| --------- | -------------- | --------------------- |
| FP16      | 67.1 M cells   | **134.2 M cells**     |
| FP32      | 53.7 M cells   | **107.4 M cells**     |

The binding-**count** worry is also settled: 16 granted against a worst-case need of 10 (4 DDF + flags + macro + outlet + cellForce + 2 ABL). `MAX_DDF_BUFFERS` could rise — but it would not help, because `macro` binds before the DDF planes do.

### The four-way `macro` split, costed

`macro` is four independent f32 fields sharing one binding. Splitting it into 4 bindings of 4 B/cell moves FP16 back to the DDF bound, and that clears Case C on the **existing** test box:

| Check            | After a 4-way `macro` split at a 2 GiB cap                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| FP16 ceiling     | 2 GiB / 10 B = **214,748,364 cells** > 183 M ✅                                                                        |
| Largest buffer   | DDF group, 5 × 366 MB = 1.83 GB ≤ 2 GiB ✅                                                                             |
| Storage bindings | 4 DDF + 4 macro + flags + outlet + 2 ABL = **12** ≤ 16 ✅                                                              |
| VRAM             | 55 B/cell × 183 M = **10.1 GB** ≤ 24 GB ✅                                                                             |
| Wall time        | ~~~200 k steps × 183 M / 7069 MLUPs ≈ **1.4 h**~~ — **falsified by measurement 2026-07-28: ≥ 8.7 h**, see Wall 3 below |

So **V14 was reachable behind one architectural change, not a hardware purchase.** The 1.4 h estimate still misses the ≤30-min gate, which the M11 spec already records as a spec conflict at the strict grid.

## 2026-07-28 — four-way `macro` split implemented

The costed lever above has landed. `Lbm3D` now stores ρ, ux, uy, and uz in four planar f32
buffers while preserving interleaved `[rho, ux, uy, uz]` at `readMacro()` and
`readMacroPoints()` API boundaries. The visualization packer reads the three velocity
planes directly. Total macro allocation remains 16 B/cell; only the per-binding cost
changes, from 16 B/cell to 4 B/cell.

Measured/executable consequences on the RTX 3090 (`nvidia · ampere`, Chromium):

| Check                             | Result                                         |
| --------------------------------- | ---------------------------------------------- |
| Binding / buffer cap              | 2.000 GiB / 2.000 GiB                          |
| Base FP16 addressable ceiling     | **214,748,364 cells**                          |
| Case C required per-binding cap   | **1.704 GiB** (5 FP16 DDF planes)              |
| Case C urban storage bindings     | **12 needed / 16 granted**                     |
| Worst case, including `cellForce` | **13 needed / 16 granted**                     |
| Strict Case C allocation verdict  | **Runnable; V14 physics result still pending** |

`cellForce` remains one optional 16 B/cell binding and is validated separately when
`forces: true`; the Case C urban runner does not allocate it. The capacity model is pinned
by `ddfLayout.test.ts`, and the real-device caps panel now reports Case C runnable.

Mandatory real-GPU parity after the WGSL change (`[v9-abl]`, 2026-07-28):

```text
PASS TRT (plain): rho=1.70e-6 u=8.42e-6 (bar 5e-5)
PASS TRT + REGULARIZE (H10): rho=1.48e-6 u=6.93e-6 (bar 5e-5)
PASS TRT + REGULARIZE + 4-buffer split (#5): rho=1.48e-6 u=6.93e-6 (bar 5e-5)
PASS TRT + LES (M7, Cs=0.1): rho=1.70e-6 u=8.12e-6 (bar 5e-5)
PASS TRT + forces (M7 momentum exchange): rho=1.70e-6 u=8.42e-6 (bar 5e-5) force=7.92e-6 (bar 1e-4)
PASS TRT + ABL BCs (M10: free-slip H11 + VelocityInlet H12) + forces: rho=2.14e-6 u=4.99e-6 (bar 5e-5) force=1.45e-6 (bar 1e-4)
```

Post-change gates: lint and all three TypeScript projects pass; **322 Vitest tests across
52 files** pass; Tier A is **15/15**; the 12k-cell Case C workbench smoke passes sparse
probe readback and checkpoint/resume; the production 3D scene renders nonblank on desktop
and mobile without overflow or device loss.

## 2026-07-28 — Wall 3: an intermittent hang, and the first Case C q

> **Read the correction below before quoting this section.** Its original text attributed the
> failed first attempt to a 57%-overhead throughput wall and projected ≥8.7 h. **That was
> wrong.** A later run completed the same grid in **5.96 h at 97–99% compute duty**. The 43%
> figure was an artifact of an intermittent **hang**, not of overhead. The falsification of
> the ~1.4 h estimate stands; the mechanism given for it did not.

The V14 acceptance run was executed on the reference box immediately after the split landed.
**It produced no q.** The architectural verdict above holds — the 187.5 M-cell grid allocated,
initialized, and stepped without error, which is exactly what the split was for — but the run
exceeded the harness's 2 h completion timeout while still inside its transient.

Command: `AEROFLOW_M11_CELLS=190000000 npx playwright test --project=gpu aij-urban.gpu.spec.ts
--grep "V14 Case C"` (RTX 3090, Chromium, 2026-07-28). Note the documented `npm run … -- -g`
form silently drops `-g` (npm consumes it as `--global`) and runs the Case E specs too; use
`npx playwright … --grep` instead.

| Quantity                   | Measured                                                |
| -------------------------- | ------------------------------------------------------- |
| Grid actually built        | **883 × 303 × 701 = 187,551,849 cells**, dx 0.00793 m   |
| Solid voxels               | 175,084                                                 |
| Steps reached              | **54,834**                                              |
| Compute time (`elapsedMs`) | **3,121 s**                                             |
| Wall time                  | 7,200 s (harness timeout)                               |
| Averaging progress         | **0.00 / 10 flow-throughs** — still in the 3T transient |
| q / verdict                | **pending / PENDING** — no physics result               |

Three numbers falsify the ~1.4 h estimate, each independently:

1. **In-scene throughput is ~3295 MLUPs, not 7069.** 54,834 steps × 187.5 M cells / 3,121 s.
   The estimate used the clean 256³ benchmark figure; a real scene with BCs, a voxelized
   solid mask, and ABL inlet runs **2.1× slower**. Benchmark MLUPs are not scene MLUPs, and
   this record should never again schedule a run using the former.
2. ~~**Only 43% of wall time is compute** … the readback round-trip and the
   `requestAnimationFrame` yield.~~ **Retracted — see "What the 43% actually was" below.**
   The mechanism was inferred, never measured, and direct measurement refuted it.
3. **The target is 365,560 steps, not ~200 k.** `planAijUrbanAveraging` sets
   `targetSteps = 13 T` (3T transient + 10T averaging). Measured `sampleIntervalSteps = 1406`
   ⇒ `T = 28,120` ⇒ `13 T = 365,560`. (An earlier bound of "≥237,600" here was derived from a
   guessed sample interval; the measured value supersedes it.)

### What the 43% actually was

Three measurements, in order, each killing the hypothesis before it:

- **Checkpointing is not the cost.** One checkpoint at this grid is **6.64 GiB in 8.0 s
  (847 MiB/s)** — _faster_ per byte than M9's small-grid 634 MB/s, so IndexedDB scales fine
  here. At ~24 saves that is ~192 s, **4.7%** of the missing time. The flat 5-minute trigger
  is grid-blind and worth fixing for tidiness, but it did not cost the run.
- **There is no overhead ramp.** A 30-second-interval duty-cycle series held **95.9 → 97.9 →
  98.6 → 98.9 → 97.3 → 97.9%**, advancing a steady 1406 steps per ~85 s with a flat 4 s of
  unaccounted time per sample. Nothing degrades.
- **The run hangs.** At wall 928 s / step 15,466 the series froze — steps, compute **and**
  wall-clock together, with **GPU and CPU both at 0%** and 10.9 GB still resident. That is a
  stall, not slowness. The first attempt therefore did ~53 min of healthy work and then hung
  for ~68 min while the wall clock kept accruing; averaging the two yields the misleading 43%.

**Root cause unknown, and it is intermittent.** A subsequent 5.96 h run of the identical grid
completed with **zero stalls**, so the hang did not reproduce and no fix is claimed for it.
The suspects — a silently lost device leaving an `await` unresolved, or a TDR-class reset from
the ~80 s single submission of 1406 steps — are untested. **This is an open defect against any
unattended long run, including M9 acceptance 4.**

### The strict run does complete: 5.96 h

Re-run 2026-07-28 under a stall-resilient harness (checkpoint-resume on a 6-minute no-progress
detector; it was never triggered): **365,560 steps, 120/120 points scored, wall 21,454 s =
5.96 h** on the RTX 3090, ~3261 scene MLUPs at 97–99% duty. So the honest wall-time figure is
**~6 h/direction**, not the ≥8.7 h this record briefly claimed and not the ~1.4 h it originally
estimated. Against the spec's ≤30-min/direction target that is still **~12× over**, and M12
wants 12–16 directions of it — the spec conflict stands, only its magnitude changed.

**The checkpoint does not rescue this run.** `?urban` auto-checkpoints every 5 minutes, but
Playwright's launched browser uses an ephemeral profile that is destroyed at context close, so
the IndexedDB checkpoint died with it and the 2 h of compute is unrecoverable. The harness also
only ever clicks `urban-run` (`start(false)`); the `urban-resume` path exists but no spec
drives it. **A checkpointed long run whose harness cannot resume it is not actually durable** —
that is a harness defect, not a physics one, and it is what makes each failed attempt cost the
full elapsed time.

### V14 physics result: q = 0.458, FAIL

The completed run is the first Case C score in the program.

| Quantity        | Value                                                         |
| --------------- | ------------------------------------------------------------- |
| Grid            | 883 × 303 × 701 = **187,551,849 cells**, dx 0.00793 m         |
| Steps           | **365,560** (3 T transient + 10 T averaging, T = 28,120)      |
| Points scored   | **120 / 120** — `underResolved` false, verdict not suppressed |
| **Hit rate q**  | **0.4583**                                                    |
| Gate            | q ≥ 0.66 → **FAIL**                                           |
| Wall / hardware | 21,454 s = **5.96 h**, RTX 3090, Chromium, FP16               |

**No tolerance was touched** (CLAUDE.md rule 3); the gate is recorded as missed by 0.20.

The important structural point: **this grid satisfies the 3rd-node probe rule**, which is why
the runner let the verdict print at all. M10 Case A's story was "resolution was the whole
story" — 16 cells/b scored q 0.532, 24 cells/b scored q 0.754. That lever is now spent for
Case C: the probe height is compliant by construction and q is still 0.458, **below even the
under-resolved Case A reading**. Whatever is wrong here is not probe-height resolution, and
the next investigation should not start by adding cells.

**The statistic candidate is closed — verified correct, 2026-07-29.** The `|⟨u⟩|` vs `⟨|u|⟩`
question that reopened M10 #4 was the cheapest suspect, and Case C's fixture declared
`⟨|u|⟩` with no provenance note (unlike its `uRef` field), so it was suspected of having been
inherited from Case E. It holds: Case C was measured by **multi-point thermistor anemometry**,
and the benchmark literature states that "the wind tunnel tests register time averages of the
instantaneous scalar velocity, while the simulations use the velocity vector's time averages"
([Kikumoto et al. 2026](https://onlinelibrary.wiley.com/doi/10.1002/2475-8876.70083)). The
fixture's shape agrees — scalar `speed` per probe, no mean-component table of the kind that
justified `|⟨u⟩|` for Case A. **q = 0.458 measures the right quantity.**

Remaining candidates, none tested, in evidence order:

1. **Wake under-prediction** — the documented failure mode of this benchmark; published CFD
   comparisons on this exact case underestimate wind speed in building wakes, matching the
   near-wake residual misses M10 Case A also showed.
2. **Resolved-fluctuation deficit.** `⟨|u|⟩ ≥ |⟨u⟩|` by a margin that grows with turbulence
   intensity, so a scalar-speed comparison charges the solver for fluctuations it does not
   resolve. An under-resolved LES recovers only the resolved part and is biased **low**,
   worst in exactly the high-turbulence canyon and wake points. **This is a Wall 1 effect
   that the 3rd-node probe rule does not address** — the probe rule fixes where the sample is
   taken, not whether the spectrum reaching it is resolved. It is the first candidate here
   that would genuinely be helped by local grid refinement.
3. **Probe height.** The workbook places probes at Z = 0.02 m; a secondary source claims
   5 mm and the repo deliberately did not substitute it. The near-ground gradient is steep,
   so this is worth bounding by rescoring at both heights before anything expensive.

**Wall 3 is not Wall 1, and neither explains this q.** Wall 3 (the hang, and the ~6 h budget)
is a harness/throughput matter. Wall 1 sets how many cells the answer needs, and the answer
here had them. V14 is therefore **FAIL, measured** — not blocked, not pending, not deferred.

### 2026-08-18 amendment — Wall 3 now has discriminating operation boundaries

The two historical stops remain **root-cause unknown**. Their evidence established that the step
heartbeat stopped while CPU and GPU utilization were idle, but it did not observe whether the last
responsive boundary was command submission, queue completion, staging-buffer mapping, checkpoint
I/O, or CPU scoring. Neither event establishes Windows TDR, a driver reset, silent device loss,
Chromium/Dawn failure, hardware failure, or an application deadlock.

The schema-2 harness narrows any future incident without rewriting that history. Simulation
intervals now cross a supervised queue-completion boundary every bounded batch; probe and health
copies cross another queue boundary before a separately supervised map; checkpoint chunks and
scoring have their own deadlines. Submitted and completed steps identify uncommitted in-flight
work. `device.lost`, uncaptured errors, and short owned error scopes retain direct evidence with the
active operation identity.

These boundaries can distinguish device loss, queue non-completion, map non-completion, checkpoint
I/O timeout, scoring timeout, WebGPU validation error, and ordinary application rejection. They
still cannot identify an operating-system or vendor root cause without a corresponding direct
signal. Deterministic injected failures establish classification and automatic checkpoint recovery;
they do not recreate either natural stall. A future successful soak is exposure evidence only and
does not retroactively assign or disprove a cause for the 2026-07-28 or 2026-08-15 incidents.

## Decision

1. **No tolerance, band, or probe-height rule is weakened.** CLAUDE.md rule 3 stands. Under-resolved runs keep suppressing their verdicts rather than printing a flattering number; deviations are published as deviations.
2. **M7 closes as CLOSED-SCREENING** with criteria 2, 3, and 4 recorded FAIL and explained as Wall 1. Re=100 is the in-band anchor. Public numbers carry the screening-grade caveat.
3. ~~**M11 Case C is unblocked by raising Wall 2, not by hardware.** Honor the negotiated binding size on non-iOS devices (keep the 1 GiB clamp where `maxStorageBufferBindingSize` is genuinely ~1 GiB) and re-check the buffer count. This is the cheapest unblock in the program and needs no rental. **Precondition:** one browser run recording the 3090's actual `maxStorageBufferBindingSize` and `maxStorageBuffersPerShaderStage`.~~
   **3′ (2026-07-27, measured).** The precondition ran and falsified the plan: the device grants 2.000 GiB and Case C needed 2.727 GiB, because `macro` (16 B/cell, one binding) — not the DDF planes — set the FP16 ceiling. The clamp was lifted regardless (it was independently wrong; ceiling FP16 67.1 M → 134.2 M), but **Case C remained BLOCKED at that point**. The named next lever was splitting `macro` into four 4 B/cell bindings.
   **3″ (2026-07-28, implemented).** The split landed with real-GPU parity. FP16 is DDF-bound again at **214.7 M cells** on the measured 2 GiB cap; Case C needs 1.704 GiB and 12/16 storage bindings. The architectural blocker is closed and **V14 is PENDING**, not passed, until the strict 183 M-cell q run completes.
   **3‴ (2026-07-28, run completed).** The first attempt did not finish (54,834 steps in a 2 h
   timeout) — an intermittent hang, not a throughput wall; the "43% duty cycle / ≥8.7 h"
   reading published briefly here is retracted above. A stall-resilient re-run **completed in
   5.96 h at 97–99% duty** and scored **q = 0.458 against q ≥ 0.66 — FAIL**. The
   architectural claim in 3″ is confirmed by a full run. **V14 is now FAIL, measured**, at a
   grid that satisfies the probe-height rule, so adding cells is not the indicated next move.
4. **M11 Case E stays DEFERRED** pending a benchmark-faithful domain crop using the official AIJ test-section definition. Not weakened, not brute-forced.
5. **Local grid refinement is promoted from deferred work to the named real fix for Wall 1**, because it is the only lever that helps _the product_ — which runs on the user's laptop, where no rental exists. It is not scheduled here.

## Cloud GPUs: scoped, not adopted

Considered 2026-07-25 and deliberately narrowed.

- **Renting a larger GPU changes nothing while Wall 2 stands.** A 192 GB MI300X is capped at the same few GiB the 3090 is, because the limit is per-binding, not per-device. Wall 2 must be raised first — and the 2026-07-27 amendment shows the raise that matters (splitting `macro`) puts Case C inside the 3090 anyway.
- **Where cloud genuinely pays: M7's higher-Re sphere cases.** They need ~2–4× the cells for boundary-layer resolution — tens of GB, inside an 80 GB-class card and inside the buffer cap. Executable as a straight extension of the existing CDP harness (`scripts/e2e-gpu-chrome.sh` against a rented box running headless Chrome), with **no second solver and no CUDA port** — porting would fork the kernel away from its CPU parity oracle and violate the handoff doctrine.
- **Where cloud does not help: Case E.** Its ≤30-min/direction criterion is a _throughput_ gate. At 2.735 B cells and ~455 k steps (13 flow-throughs of a 1750-cell streamwise domain at u≈0.05) the run is ~1.2×10¹⁵ cell-updates: ~70 h per direction even at a generous 5000 MLUPs, against a 30-minute target. Bigger silicon fails the same gate by a smaller multiple, and M12 wants 12–16 directions of it.
- **Cloud-batch stays scoped to M12+ multi-direction runs**, where a throughput gate rules out the client-side path. It is not the validation path.

## The M15 conflict, stated explicitly

M15's acceptance is _"every case re-runnable by visitors in their own browser."_ Any case validated only on rented hardware is **not** visitor-re-runnable, and the visitor-re-runnable validation page is how this project substantiates its numbers.

Therefore: **the M15 trust page publishes only cases a visitor can re-run.** Cases that need more than a consumer GPU are published as _reference results with their hardware stated_, in a visually distinct tier, never mixed into the re-runnable set. A cloud-only headline number would quietly convert an open-core differentiator into an ordinary cloud-CFD claim.

## What this record obliges

- Update roadmap Risk #2 (done) and [VALIDATION.md](../VALIDATION.md) (done) to state what uniform grids honestly reach.
- ~~Record the 3090's `maxStorageBufferBindingSize` / `maxStorageBuffersPerShaderStage` before any binding-cap change or hardware spend.~~ **Done 2026-07-27** — 2.000 GiB / 16, and it is now a standing Tier-B spec (`caps.gpu.spec.ts`) rather than a one-off, so every new GPU re-answers it.
- Keep `maxAddressableCells()` and the ledger in sync: if the ceiling test changes, this record changes.
- **Before any future hardware spend, re-check which binding fails first.** This record was wrong once by pricing only the DDF planes; the corrected model is in `maxAddressableCells()` and `bindingCapForCells()`, and the honest question is always "which single binding does this grid blow, and what does it cost per cell?"

## PROPOSED amendment 2026-08-17 — the anti-dissipation attribution is contradicted at the near-floor point

**Status: PROPOSED, NOT ACCEPTED.** Nothing above is modified. Raised under
`openspec/changes/discriminate-near-floor-instability` task 6.3, which requires that a finding
bearing on an existing record be proposed as an amendment to it rather than written up as a
competing account. Accepting or rejecting this is the record owner's call.

**What is being questioned.** The 2026-08-10 M7 force-audit amendment at the head of this record
closes with:

> M9 subsequently measured a competing mechanism at the same operating points — the projected
> second-order regularization is anti-dissipative at high wavenumber once τ₀ → ½ with a mean
> flow present, which also drives the subgrid model to fire on undisturbed freestream.

That sentence makes two claims. New evidence **corroborates the second and contradicts the
causal force of the first** at the near-floor operating point.

**Evidence.** Run
[2026-08-17-1832-near-floor-factorial](../validation/runs/2026-08-17-1832-near-floor-factorial.md)
— a `{outlet} × {regularize} × {lesNorm} × {ω⁻}` factorial on the CPU empty tunnel at
τ₀ = 0.5000005, CPU reference only, no GPU. It reproduces the motivating near-floor
destabilization exactly (divergence at step 3346 against a recorded "between 3000 and 3500").

1. **"The subgrid model fires on undisturbed freestream" — corroborated, and quantified against
   an analytic zero for the first time.** In an empty domain, outside the boundary-influence
   distance of every face, the analytic strain rate is exactly zero, so the correct ν_t is
   exactly zero. Measured: `ν_t/ν_mol` p50 ≈ 5.2×10³ over 1,440 surviving cells. In absolute
   terms τ_eff ≈ 0.5027 against τ₀ = 0.5000005 — the ratio is large chiefly because ν_mol is
   1.67×10⁻⁷, and the honest statement is that the subgrid model supplies ~99.98% of the
   viscosity where there is no resolved strain to justify any of it.

2. **"The regularization is the destabilizing mechanism" — contradicted.** Turning the
   projection **off**, with every other setting fixed, moves the same case from divergence at
   step 3346 to divergence at step **382** — 8.8× sooner. The ordering holds on both grids, both
   outlets and both norms. At this operating point the projection is strongly **stabilizing**.

   This does not falsify anti-dissipation at high wavenumber as a property; a scheme can be
   anti-dissipative in one band and net stabilizing overall. What it falsifies is the
   _attribution_ — the projection cannot be the cause of the near-floor failures it was offered
   as a competing explanation for.

3. **The ω⁻ mechanism this record's amendment relies on is excluded wherever regularization is
   on.** The projection is even in `e_i`, so the antisymmetric non-equilibrium is identically
   zero and ω⁻ multiplies nothing. Verified twice: Λ = 3/16 vs Λ = 3 over 300 steps leaves 0 of
   13,300 populations differing; and the diverging `'spec'` arm diverges at the _same step 3346_
   at ω⁻ ≈ 0.042 and at ω⁻ = 1.0.

   **This does not touch the M7 withdrawal itself.** The M7 cases were unregularized force
   readings, and ω⁻ collapse is confirmed as a real destabilizer there: all eight
   `regularize: off` derived-ω⁻ arms diverged (steps 351–806) and raising ω⁻ to 1.0 rescued all
   eight. The scope correction is only that the ω⁻ mechanism does not carry over to regularized
   configurations — which is what M9 onward actually runs.

**Proposed change.** Amend the 2026-08-10 block's final sentence to scope its two claims
separately: keep "drives the subgrid model to fire on undisturbed freestream" (now measured
against an analytic zero, not inferred), and restate the anti-dissipation clause as a property
observed at high wavenumber that is **not** established as the cause of near-floor
destabilization, citing the run above. Add that ω⁻ collapse is confirmed for unregularized
configurations and excluded for regularized ones.

**What this proposal does not establish.** It is CPU-reference evidence on an empty tunnel with
no body; it says nothing about the M7 sphere grids, nothing about GPU behaviour, and nothing
about the cell-count ceiling this ADR actually decides. It also leaves the near-floor mechanism
for regularized configurations **unidentified** — a newly-found outlet dependence (the failure
reproduces only with the zero-gradient outlet, never with the pressure outlet) is the leading
open thread and is not explained.
