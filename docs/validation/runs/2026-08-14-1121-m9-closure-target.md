# Run 2026-08-14-1121-m9-closure-target

M9 hard-closure run: one fresh 15.7M-cell target-tier Ahmed scene under the frozen
acceptance configuration, plus the four-hour / background / device-loss resilience
acceptance on that same run, plus wake diagnostics and the τ_eff / approach-strain
readback from the final field.

Raw artifacts (verbatim, as written by the harness) live beside this file in
[artifacts/2026-08-14-1121-m9-closure-target/](artifacts/2026-08-14-1121-m9-closure-target/).
Where this file summarizes, the JSON is authoritative.

---

## 1. Identity

| Field                          | Value                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run id                         | `2026-08-14-1121-m9-closure-target`                                                                                                                                                                                   |
| Artifact schema                | `aeroflow-m9-hard-closure-v1`                                                                                                                                                                                         |
| Wall start (UTC)               | 2026-08-14T11:21:25.283Z                                                                                                                                                                                              |
| Wall end (UTC)                 | 2026-08-14T15:23:51.888Z                                                                                                                                                                                              |
| Wall-clock duration            | 14,546,605 ms = 4.041 h                                                                                                                                                                                               |
| Acceptance window start (UTC)  | 2026-08-14T11:21:33.761Z                                                                                                                                                                                              |
| Acceptance recorded (UTC)      | 2026-08-14T11:45:29.888Z                                                                                                                                                                                              |
| Git commit                     | `a033193e54473252903d89d35e5bfa0949574cc0` ("Record the V11 acceptance result and the tau_eff readback it was missing")                                                                                               |
| Branch                         | `m9-force-audit`                                                                                                                                                                                                      |
| Dirty tree                     | **YES** — 65 tracked files modified, 14 untracked (see §1.1)                                                                                                                                                          |
| Working-tree diff sha256       | `f0a378cb85121f450290da1a5b85060ca610500d97fed920baf5fa7a8f0eed03` (`git diff HEAD`)                                                                                                                                  |
| Config hash (sha256)           | `b025c05df39597692dfe66c1afacedc7bcfd43647dd48f241cee70ef9672ae9a` (canonical JSON of `frozenConfiguration` minus `acceptanceStartedAt`, `scene`, `acceptanceBand`)                                                   |
| Acceptance artifact sha256     | `fd66e746682bff71ace7a1e6ba3313dfd340c82728a11ff49e925581df8e17da`                                                                                                                                                    |
| Command line                   | `npm run test:e2e:gpu` → `playwright test -c apps/studio/playwright.config.ts --project=gpu`, test `apps/studio/e2e/m9-closure.gpu.spec.ts:159` — "M9 closure: one target Ahmed acceptance plus four-hour resilience" |
| Hardware                       | NVIDIA GeForce RTX 3090 (driver 32.0.15.9186); Intel Core i9-12900K; 32 GiB system RAM; Windows 11 Pro 10.0.26200                                                                                                     |
| GPU as reported by the harness | `nvidia · ampere`                                                                                                                                                                                                     |
| Throughput                     | 4454.6 MLUPs                                                                                                                                                                                                          |
| τ readback cost                | 127,232 ms                                                                                                                                                                                                            |

### 1.1 Dirty-tree contents

The run was executed against an uncommitted working tree. The exact contents are pinned by
the diff hash above. Modified (65) and untracked (14) paths:

```
M apps/studio/e2e/ahmed-baseline-2m.gpu.spec.ts
M apps/studio/e2e/ahmed-baseline.gpu.spec.ts
M apps/studio/e2e/ahmed-empty-tunnel.gpu.spec.ts
M apps/studio/e2e/ahmed-ladder.gpu.spec.ts
M apps/studio/e2e/m9-closure.gpu.spec.ts
M apps/studio/e2e/spheredrag.gpu.spec.ts
M apps/studio/src/dev/ahmedCpuGpuMatch.ts
M apps/studio/src/dev/ahmedEmptyTunnel.ts
M apps/studio/src/dev/cylinderValidation.ts
M apps/studio/src/dev/panel.ts
M apps/studio/src/dev/testHooks.ts
M apps/studio/src/sim/ahmedRun.ts
M apps/studio/src/sim/ahmedWorker.ts
M apps/studio/src/sim/cases/aijCaseA.ts
M apps/studio/src/sim/cases/aijUrban.ts
M apps/studio/src/sim/cases/sphereDrag.ts
M apps/studio/src/sim/lbm2d.ts
M apps/studio/src/sim/lbm3d.ts
M apps/studio/src/sim/parity3d.ts
M apps/studio/src/sim/q27GpuAuthority.ts
M apps/studio/src/sim/shaders/central_moment_d3q27_periodic.wgsl
M apps/studio/src/sim/shaders/lbm2d.wgsl
M apps/studio/src/sim/shaders/stream_collide_3d.wgsl
M apps/studio/src/ui/ahmed.ts
M apps/studio/src/ui/aij.ts
M apps/studio/src/ui/sphereDrag.ts
M apps/studio/test/aijUrbanRun.test.ts
M docs/PHYSICS.md
M docs/VALIDATION.md
M docs/WGSL-NOTES.md
M docs/handoff/H13-conservative-collision.md
M docs/handoff/H14-pressure-outlet.md
D openspec/specs/deferred-solver-stabilization/spec.md
M packages/core/src/abl.ts
M packages/core/src/analysis/blockConvergence.ts
M packages/core/src/analysis/strainComparison.ts
M packages/core/src/cpu/centralMomentD3Q27.ts
M packages/core/src/cpu/collide.ts
M packages/core/src/cpu/esoteric.ts
M packages/core/src/cpu/solver2d.ts
M packages/core/src/cpu/solver3d.ts
M packages/core/src/index.ts
M packages/core/src/scenes/ahmed3d.ts
M packages/core/src/scenes/aijCaseA.ts
M packages/core/src/scenes/sphere3d.ts
M packages/core/src/scenes/urbanDomain.ts
M packages/core/src/validation/aijCaseA.ts
M packages/core/test/abl.test.ts
M packages/core/test/ablInlet.test.ts
M packages/core/test/ahmed3d.test.ts
M packages/core/test/aijCaseA.test.ts
M packages/core/test/blockConvergence.test.ts
M packages/core/test/centralMomentD3Q27.test.ts
M packages/core/test/centralMomentEigenProof.test.ts
M packages/core/test/collide.test.ts
M packages/core/test/esoteric.test.ts
M packages/core/test/forces2d.test.ts
M packages/core/test/lateralFlux.test.ts
M packages/core/test/les.test.ts
M packages/core/test/shearModeTargeted.test.ts
M packages/core/test/sphere3d.test.ts
M packages/core/test/stlSphere3d.test.ts
M packages/core/test/strainComparison.test.ts
M packages/core/test/tauStats.test.ts
M packages/core/test/wakeProbe.test.ts
? apps/studio/e2e/cylinder-les-norm.gpu.spec.ts
? openspec/changes/fix-confirmed-physics-defects/.openspec.yaml
? openspec/changes/fix-confirmed-physics-defects/design.md
? openspec/changes/fix-confirmed-physics-defects/proposal.md
? openspec/changes/fix-confirmed-physics-defects/specs/acceptance-band-ledger/spec.md
? openspec/changes/fix-confirmed-physics-defects/specs/les-subgrid-closure/spec.md
? openspec/changes/fix-confirmed-physics-defects/specs/scene-boundary-legality/spec.md
? openspec/changes/fix-confirmed-physics-defects/specs/solver-failure-visibility/spec.md
? openspec/changes/fix-confirmed-physics-defects/specs/wall-height-convention/spec.md
? openspec/changes/fix-confirmed-physics-defects/tasks.md
? packages/core/src/validation/bands.ts
? packages/core/test/bands.test.ts
? packages/core/test/lesSubgridClosure.test.ts
? packages/core/test/nonFiniteSentinel.test.ts
```

---

## 2. Configuration (verbatim)

### 2.1 `frozenConfiguration`

| Key                     | Value                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collision`             | `D3Q19 TRT`                                                                                                                                                                              |
| `equilibrium`           | `quadratic`                                                                                                                                                                              |
| `regularization`        | `projected second-order`                                                                                                                                                                 |
| `conserveMass`          | `true`                                                                                                                                                                                   |
| `conserveMassEffective` | `false`                                                                                                                                                                                  |
| `lesCs`                 | `0.1`                                                                                                                                                                                    |
| `precision`             | `fp16`                                                                                                                                                                                   |
| `forceOwnership`        | `BodySolid only`                                                                                                                                                                         |
| `forceSampling`         | `two consecutive steps`                                                                                                                                                                  |
| `convergence`           | `4+1 complete blocks; previous/current/union <= 0.03. Block length derived from the run's own sigma/mean so the block SE sits under the gate, clamped to [20, 400] T_conv (actual: 20).` |
| `acceptanceBudgetMs`    | `12900000`                                                                                                                                                                               |
| `productBudgetMs`       | `1800000`                                                                                                                                                                                |
| `acceptanceStartedAt`   | `1786706493761`                                                                                                                                                                          |
| `requestedCells`        | `15700000`                                                                                                                                                                               |
| `lateralBC`             | `freestream`                                                                                                                                                                             |
| `inletBC`               | `velocity`                                                                                                                                                                               |
| `outlet`                | `pressure`                                                                                                                                                                               |
| `ground`                | `no-slip halfway bounce-back`                                                                                                                                                            |

### 2.2 `scene`

| Key                   | Value                   |
| --------------------- | ----------------------- |
| `lesCs`               | `0.1`                   |
| `lesNorm`             | `legacy`                |
| `precision`           | `fp16`                  |
| `lateralBC`           | `freestream`            |
| `inletBC`             | `velocity`              |
| `outlet`              | `pressure`              |
| `nx`                  | `484`                   |
| `ny`                  | `136`                   |
| `nz`                  | `239`                   |
| `totalCells`          | `15731936`              |
| `dxMm`                | `8.63334353139077`      |
| `lengthCells`         | `120.92649808316142`    |
| `tau` (τ₀)            | `0.5000042281992336`    |
| `Re`                  | `4290000`               |
| `blockage`            | `0.049247433717488506`  |
| `frontalCells`        | `1564`                  |
| `bodyVoxels`          | `181640`                |
| `convectiveTimeSteps` | `2419`                  |
| `physU`               | `61.63793103448276` m/s |
| `uLattice`            | `0.05`                  |
| `noseX`               | `121`                   |

Body present: **yes** (Ahmed 25° slant, 181,640 solid voxels, nose at x = 121).
Acceptance band: `[0.242, 0.328]` (±15% around published Cd 0.285).

---

## 3. Results — every metric the harness produced

### 3.1 Acceptance

| Metric             | Value                                        |
| ------------------ | -------------------------------------------- |
| `outcome`          | `AHMED_CD_FAIL`                              |
| `cd`               | `0.8956091410058843`                         |
| `acceptanceBand`   | `[0.242, 0.328]`                             |
| `triggerTConv`     | `66.42744935923936`                          |
| `stopTConv`        | `166.66887143447707`                         |
| `blockSpread`      | `0.005162194621883878` (0.516%; gate ≤ 0.03) |
| `blockTConv`       | `20`                                         |
| `droppedSamples`   | `2`                                          |
| `postTriggerMean`  | `0.8954426610982393`                         |
| `postTriggerSigma` | `0.019045891787516624`                       |
| `samplesPerTConv`  | `9.99586776859504`                           |

Independent blocks (20 T_conv each, n = 200 samples each):

| #   | t0 (T_conv)        | t1 (T_conv)        | mean Cd            | n   |
| --- | ------------------ | ------------------ | ------------------ | --- |
| 1   | 66.5274906986358   | 86.43571723852831  | 0.8954628946836038 | 200 |
| 2   | 86.53575857792477  | 106.44398511781728 | 0.8924125417723987 | 200 |
| 3   | 106.54402645721372 | 126.45225299710624 | 0.8969088503161966 | 200 |
| 4   | 126.55229433650268 | 146.4605208763952  | 0.8970352133826525 | 200 |
| 5   | 146.56056221579166 | 166.46878875568416 | 0.8956091410058843 | 200 |

### 3.2 Product-budget snapshot (30-min terminal, separate from acceptance)

| Metric       | Value                |
| ------------ | -------------------- |
| `tConv`      | `208.88631665977675` |
| `totalSteps` | `505296`             |
| `meanCd`     | `0.8974735816116526` |
| `converged`  | `true`               |

### 3.3 Final sample (end of the 4-hour run)

| Metric               | Value                    |
| -------------------- | ------------------------ |
| `totalSteps`         | `4011392`                |
| `convectiveTimes`    | `1658.2852418354692`     |
| `cd` (instantaneous) | `0.8548473153272856`     |
| `meanCd` (20 T_conv) | `0.8952641401754315`     |
| `stdCd`              | `0.017060780670309743`   |
| `drift`              | `0.00007056243980270626` |
| `converged`          | `true`                   |
| `newtons`            | `227.91659181056653`     |
| `meanNewtons`        | `238.6923932970194`      |
| `mlups`              | `4454.605408030712`      |

### 3.4 Topology

| Metric                               | Value                   |
| ------------------------------------ | ----------------------- |
| `classification`                     | `TOPOLOGY_RECORDED`     |
| `slantSeparationObserved`            | `true`                  |
| `counterRotatingCPillarPairObserved` | `true`                  |
| `bubbleResolved`                     | `false`                 |
| `minRecircLengthCells` (gate)        | `1`                     |
| `minBaseReverseFraction` (gate)      | `0.15`                  |
| `wake.baseReverseFraction`           | `0.041946949159463204`  |
| `wake.baseCells`                     | `1126542`               |
| `wake.slantReverseFraction`          | `0.4224952741020794`    |
| `wake.slantCells`                    | `3174`                  |
| `wake.recircLengthCells`             | `0`                     |
| `wake.recircLengthBodyLengths`       | `0`                     |
| `wake.gammaLeft`                     | `49.10510530327532`     |
| `wake.gammaRight`                    | `-51.910962930095295`   |
| `wake.cPillarAsymmetry`              | `0.027776349603488702`  |
| `wake.meanAbsOmegaX`                 | `0.0034166597671149595` |
| `wake.peakAbsOmegaX`                 | `0.032188164070248604`  |
| `wake.vorticityCells`                | `1259278`               |

### 3.5 Resilience

| Metric                       | Value                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `wallStartedAt`              | `1786706485283` (2026-08-14T11:21:25.283Z)                                                                                |
| `endedAt`                    | `1786721031888` (2026-08-14T15:23:51.888Z)                                                                                |
| `elapsedMs`                  | `14546605`                                                                                                                |
| `checkpoint.bytes`           | `597813568`                                                                                                               |
| `checkpoint.ms`              | `1166.800000011921`                                                                                                       |
| `checkpoint.totalSteps`      | `726`                                                                                                                     |
| `checkpoint.savedAt`         | `1786706490498`                                                                                                           |
| `recovered.recoveries`       | `1`                                                                                                                       |
| `recovered.totalSteps`       | `726`                                                                                                                     |
| `aged.attempted`             | `true`                                                                                                                    |
| `aged.startStep`             | `4009214`                                                                                                                 |
| `aged.checkpoint.bytes`      | `597813568`                                                                                                               |
| `aged.checkpoint.ms`         | `1022.2999999821186`                                                                                                      |
| `aged.checkpoint.totalSteps` | `4009698`                                                                                                                 |
| `aged.checkpoint.savedAt`    | `1786720890944`                                                                                                           |
| `aged.recovered.recoveries`  | `2`                                                                                                                       |
| `aged.recovered.totalSteps`  | `4009698`                                                                                                                 |
| `aged.advancedAfterRecovery` | `true`                                                                                                                    |
| `postRecoveryFinalStep`      | `4011392`                                                                                                                 |
| `monotonicAfterRecovery`     | **`false`**                                                                                                               |
| `backgroundStartedAt`        | `1786706493745`                                                                                                           |
| `backgroundEndedAt`          | `1786710101113`                                                                                                           |
| `backgroundMs`               | `3607368` (1.002 h)                                                                                                       |
| `hiddenAtStart`              | `true`                                                                                                                    |
| `hiddenAtEnd`                | `true`                                                                                                                    |
| `backgroundStartStep`        | `968`                                                                                                                     |
| `backgroundEndStep`          | `1009382`                                                                                                                 |
| `advancedWhileBackgrounded`  | `true`                                                                                                                    |
| `visibilityMethod`           | `cover target foreground + standard hidden/visibilitychange emulation (Chromium automation reports every target visible)` |

### 3.6 Field health and diagnostics

| Metric                        | Value                    |
| ----------------------------- | ------------------------ |
| `diagnostics.totalSteps`      | `4011392`                |
| `diagnostics.convectiveTimes` | `1658.2852418354692`     |
| `cdCommanded`                 | `0.8952641401754315`     |
| `cdBulk`                      | `0.9031763842024164`     |
| `cdCore`                      | `0.8761949420411507`     |
| `uCommanded`                  | `0.05`                   |
| `referenceStationX`           | `118`                    |
| `reNominal`                   | `4290000`                |
| `reBulk`                      | `4271167.468972862`      |
| `reCore`                      | `4336431.753264279`      |
| `field.fluidCells`            | `15125716`               |
| `field.totalMass`             | `15125541.188741386`     |
| `field.massDriftRel`          | `-1.1557222059045883e-5` |
| `field.rhoMin`                | `0.9942160248756409`     |
| `field.rhoMax`                | `1.0072656869888306`     |
| `field.rhoMean`               | `0.999988442777941`      |
| `field.uMax`                  | `0.08003527368902986`    |
| `field.machMax`               | `0.13862516042708029`    |
| `field.nonFiniteCells`        | `0`                      |
| `lateral.top`                 | `3.4895244908822955`     |
| `lateral.zMin`                | `2.962633718425361`      |
| `lateral.zMax`                | `4.412427773124423`      |
| `lateral.net`                 | `10.864585982432079`     |
| `lateral.groundLayerUy`       | `185.94850615747035`     |
| `lateral.cells.top`           | `114234`                 |
| `lateral.cells.zMin`          | `64588`                  |
| `lateral.cells.zMax`          | `64588`                  |
| `lateral.cells.groundLayer`   | `114234`                 |
| `lateralNetOverInflow`        | `0.0068536419005652644`  |

Inflow stations:

| x   | fluidCells | meanRho            | areaMeanUx           | massFlux           | bulkUx              | stdUx                 | nonUniformity       | coreMeanUx           | coreCells | yCore | blThicknessCells | cellsFromInlet | cellsToNose |
| --- | ---------- | ------------------ | -------------------- | ------------------ | ------------------- | --------------------- | ------------------- | -------------------- | --------- | ----- | ---------------- | -------------- | ----------- |
| 2   | 31758      | 1.0005279482086642 | 0.04991453534877042  | 1586.057621271886  | 0.04991563407139533 | 0.003766495557305444  | 0.07545889250471059 | 0.0502230321278707   | 31521     | 2     | 1                | 2              | 119         |
| 61  | 31758      | 1.0004139470021065 | 0.049754200244412385 | 1580.7400167175879 | 0.04975395002448628 | 0.0055186884837425485 | 0.1109190471685317  | 0.050447541484001664 | 30810     | 5     | 4                | 61             | 60          |
| 118 | 31758      | 1.000253681767474  | 0.04978576559157161  | 1581.33038254612   | 0.04978050663138534 | 0.009245939973865528  | 0.18571452831953242 | 0.0505411626254578   | 30099     | 8     | 7                | 118            | 3           |

### 3.7 τ_eff / LES readback

Global: `parity` 0 · `tau0` 0.5000042281992336 · `nuMolecular` 1.4093997445415358e-6 ·
`lesK` 0.25455844122715715 · `lesCs` 0.1 · `Re` 4290000 · `fluidCells` 15125716 ·
`freeSlipAdjacentSkipped` 0 · `nonFinite` 0 · `bodyHeight` 39 · `slantStartX` 219 ·
readback time 127,232 ms.

Per region (τ mean/max; ν_LES/ν_mol p50/p99/mean/max; fractions in %):

| Region                         | cells    | τ mean  | τ max   | ν p50  | ν p99  | ν mean | ν max  | at-floor | LES-dominant | LES-overwhelming |
| ------------------------------ | -------- | ------- | ------- | ------ | ------ | ------ | ------ | -------- | ------------ | ---------------- |
| whole domain                   | 15125716 | 0.50124 | 0.50675 | 281.00 | 664.73 | 292.69 | 1595.4 | 0.0      | 100.0        | 99.99            |
| ground layer (y < 8)           | 789062   | 0.50090 | 0.50675 | 170.98 | 706.20 | 211.88 | 1595.4 | 0.0      | 100.0        | 100.00           |
| ground band (y < 39)           | 4163528  | 0.50108 | 0.50675 | 222.15 | 675.27 | 253.62 | 1595.4 | 0.0      | 100.0        | 99.99            |
| approach freestream            | 2730240  | 0.50119 | 0.50456 | 274.43 | 604.83 | 279.52 | 1078.4 | 0.0      | 100.0        | 99.95            |
| around body                    | 2044738  | 0.50137 | 0.50634 | 305.43 | 731.36 | 322.32 | 1499.2 | 0.0      | 100.0        | 100.00           |
| slant                          | 405914   | 0.50131 | 0.50458 | 295.97 | 699.77 | 309.88 | 1082.2 | 0.0      | 100.0        | 100.00           |
| near wake (≤1 body length aft) | 2208129  | 0.50116 | 0.50428 | 252.00 | 652.46 | 273.03 | 1010.9 | 0.0      | 100.0        | 100.00           |
| station x=2                    | 31758    | 0.50040 | 0.50470 | 77.28  | 771.92 | 93.41  | 1111.7 | 0.0      | 100.0        | 99.76            |
| station x=61                   | 31758    | 0.50120 | 0.50388 | 278.11 | 614.25 | 283.73 | 917.7  | 0.0      | 100.0        | 100.00           |
| station x=118                  | 31758    | 0.50117 | 0.50445 | 258.52 | 658.06 | 275.52 | 1052.0 | 0.0      | 100.0        | 100.00           |

Full nine-point percentile vectors per region, and the per-y wall-layer profiles at
x = 2 / 61 / 118 (`tau.layers`), are in the JSON artifact.

### 3.8 Approach strain comparison (scalar magnitude)

`selectedCells` 2730240 · `stencilCells` 2656675 · `rejectedIncompleteStencil` 73565 ·
`invalidCells` 0.

| Metric                                       | Value                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| FD min / mean / p50 / p95 / p99 / max        | 1.3645424186250254e-4 / 8.894942935545878e-3 / 8.65387899446802e-3 / 1.5812331118460244e-2 / 1.911547825138579e-2 / 3.526108774266205e-2  |
| Π-implied min / mean / p50 / p95 / p99 / max | 4.285808896597477e-4 / 2.8472422065920027e-2 / 2.7870393955102848e-2 / 5.1254870403897215e-2 / 6.042321484996703e-2 / 0.10747174184267803 |
| `pearsonCorrelation`                         | 0.9115844977026617                                                                                                                        |
| `spearmanRankCorrelation`                    | 0.9107359583660385                                                                                                                        |
| `medianRatioSlope`                           | 3.2271462351130618                                                                                                                        |
| `meanAbsoluteResidual`                       | 0.004279941348183073                                                                                                                      |
| `rootMeanSquareResidual`                     | 0.005541918315308084                                                                                                                      |
| `relativeL1Residual`                         | 0.15031883618028882                                                                                                                       |

Density-weighted variant: FD mean 8.895696207708317e-3, p50 8.65426798736334e-3,
Pearson 0.9115983492756494, Spearman 0.9107462086961107, medianRatioSlope
3.2268505627363084, relativeL1Residual 0.15031290453988255.

### 3.9 Approach Π tensor comparison

`selectedCells` 2730240 · `tensorCells` 2656675 · `rejectedIncompleteStencil` 73565 ·
`invalidCells` 0.

| Component            | samples  | Pearson              | Spearman             | slope (0-int)       | slope (OLS)         | intercept              | nRMS resid          | sign agree          |
| -------------------- | -------- | -------------------- | -------------------- | ------------------- | ------------------- | ---------------------- | ------------------- | ------------------- |
| xx                   | 2656675  | -0.14934279545688953 | -0.16512442574666317 | -0.6525142203758532 | -0.6571306512937137 | -1.0117442462055455e-5 | 0.988915136749473   | 0.43551261787796514 |
| yy                   | 2656675  | -0.6161448049518702  | -0.5929690097062569  | -1.251882478915565  | -1.252825490050495  | 1.4058330763001922e-5  | 0.7879196827907016  | 0.2754909802666867  |
| zz                   | 2656675  | -0.5673349325503444  | -0.5244094654118705  | -1.1444918079932258 | -1.1444947331622557 | -6.491722652149866e-7  | 0.8234878264116736  | 0.31397592855731316 |
| xy                   | 2656675  | 0.9764531249198056   | 0.9775367175275381   | 3.395902499331512   | 3.3959370420353157  | 9.637439717704254e-6   | 0.21574631210569503 | 0.9375738470080082  |
| xz                   | 2656675  | 0.9772666583199698   | 0.9790709245897832   | 3.433812127078788   | 3.4338122306104863  | -5.96379622418257e-7   | 0.2120139248837042  | 0.9405501237449067  |
| yz                   | 2656675  | 0.9838421467619176   | 0.9838134337846338   | 1.1559325459670426  | 1.1559325827596316  | -9.242549636566017e-8  | 0.17903811291282912 | 0.9533002719564869  |
| global               | 23910075 | 0.9066214898880969   | 0.785609017218619    | 2.9234693905964075  | 2.9234714238635005  | 1.547572733143907e-6   | 0.42194531453600437 | 0.7430921042588463  |
| deviatoric           | 23910075 | 0.9244547482450065   | 0.8379184712749476   | 2.9815203610385885  | 2.981522459496178   | 1.5945499121542535e-6  | 0.38129230806377756 | 0.7788688659487685  |
| trace (hydrodynamic) | 2656675  | -0.9151257930004465  | -0.9012149068967261  | -2.89616486726387   | -2.896164997054968  | -3.553851061607485e-7  | 0.4031685246864793  | 0.1315433765891575  |
| trace (−divergence)  | 2656675  | -0.9151015625665031  | -0.9012126469188738  | -0.9681107300231081 | -0.9681107597834446 | -3.1689509866434884e-7 | 0.40322349896144954 | 0.1315433765891575  |

Sign-agreement sample counts: xx 2656667, all others equal to their sample count;
global 23910067.

### 3.10 Approach scale spectra

`selectedCells` 2730240 · `commonStencilCells` 2443888 · `rejectedIncompleteStencil` 286352 ·
`maxStencilRadius` 4 · `minimumSpectralLineLength` 8.

Method (verbatim): _"directional 1-D DFT of h-centered derivative contributions; per-line
affine detrend; Hann window; one-sided residual power renormalized to unwindowed residual
energy; affine energy assigned to >16 cells."_

Limitations (verbatim): _"Wavelengths are directional along each derivative axis, not
isotropic 3-D |k|. Component band fractions mix the two contribution energies and cannot
uniquely allocate their cross term. A single finite window broadens neighboring bins."_

Per-component band fractions (energy fraction by wavelength band, cells):

| Component | >16                   | 8–16                  | 4–8                  | 2–4                  | cross-term fraction    |
| --------- | --------------------- | --------------------- | -------------------- | -------------------- | ---------------------- |
| xy        | 0.0020808098106207926 | 0.0014024109952593127 | 0.002553589332901917 | 0.9939631898612291   | 0.0003961333116484738  |
| xz        | 0.0020138009513295555 | 0.0012607865126411076 | 0.002415101336318955 | 0.9943103111997031   | -0.0003349960952011023 |
| yz        | 0.31217152160168504   | 0.46363428652022604   | 0.21953294178147104  | 0.004661250096614261 | -0.021152477755758792  |

Per-contribution spectra (e.g. `duxDy`: lines 26564, samples 2443888, shortLinesRejected 0,
trendEnergy 7.779012594124535e-3, residualEnergy 0.3707545934686336, totalEnergy
0.37853360606275815; bands >16 0.16752041780552146, 8–16 0.348158322223824,
4–8 0.4332132690454114, 2–4 0.0511079909252498) and the 47-mode spectra, the three
`shortWaveLocalization` coordinate profiles per component, and the
`residualByBoundaryDistance` profiles are in the JSON artifact.

### 3.11 Event counts

| Event              | Count |
| ------------------ | ----- |
| `status`           | 4     |
| `ready`            | 1     |
| `sample`           | 16577 |
| `stability`        | 83    |
| `checkpoint-saved` | 50    |
| `device-lost`      | 2     |
| `recovered`        | 2     |
| `stopped`          | 1     |
| `diagnostics`      | 1     |
| `tau`              | 1     |

---

## 4. Verdicts

### INFRA — AMBER

| Check                                           | Result                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Non-finite cells                                | 0 — green                                                                                          |
| Mass drift (relative)                           | −1.156e-5 — green                                                                                  |
| ρ range                                         | [0.99422, 1.00727] — green                                                                         |
| Ma max                                          | 0.1386 — green                                                                                     |
| Lateral ledger closure (`lateralNetOverInflow`) | 0.00685 — green                                                                                    |
| Convergence achieved                            | yes; 4+1 complete blocks — green                                                                   |
| Block spread                                    | 0.516% against a 3% gate — green                                                                   |
| Checkpoint                                      | 50 saves, 598 MB in ~0.8–1.2 s each — green                                                        |
| Recovery from device loss                       | 2 of 2 succeeded, including the aged cycle at step 4,009,214; `advancedAfterRecovery` true — green |
| Background execution                            | advanced 968 → 1,009,382 over 1.002 h hidden — green                                               |
| Sample-stream step monotonicity                 | `monotonicAfterRecovery` **false** — **amber**, see §5                                             |

The single non-green item is the sample-stream monotonicity assertion, which is what made
the Playwright test report `1 failed`. It is a harness assertion, not a physics tolerance.

### PHYSICS_TARGET — PHYSICS_TARGET_MISS

Cd = 0.8956 against the acceptance band [0.242, 0.328]. The measurement is 2.73× the
upper bound. This is a converged, numerically healthy, stable measurement that lands
outside the band — a research outcome, not a harness failure. It reproduces the earlier
recorded V11 result (Cd = 0.9011) essentially unchanged at this scale.

### TOPOLOGY — RECORDED

Slant separation observed (slantReverseFraction 0.4225, above the 0.15 bar) and a
counter-rotating C-pillar pair observed (γ_left +49.11, γ_right −51.91, opposite sign).
Base reverse fraction 0.0419 is below the 0.15 bar and `recircLengthCells` is 0, so the
bubble-resolution check declines to classify the wake as resolved. Classification is
therefore `TOPOLOGY_RECORDED`, not `TOPOLOGY_PASS`.

---

## 5. Anomalies

Stated plainly; no diagnosis attempted.

1. **`monotonicAfterRecovery` is `false`.** The harness checks that every `sample` event's
   reported step count strictly increases across the 16,577 samples collected from step 726
   onward. At least one consecutive pair did not strictly increase. The recovery mechanics
   themselves report healthy: checkpoint saved, both recoveries succeeded,
   `advancedAfterRecovery` true, final step 4,011,392 reached. This is the assertion that
   failed the Playwright run (`apps/studio/e2e/m9-closure.gpu.spec.ts:665`).

2. **`recircLengthCells` reads exactly 0** while `slantReverseFraction` is 42.2%. A wake
   with 42% reverse flow on the slant and a counter-rotating vortex pair reports zero
   recirculation length.

3. **Π tensor normal components anti-correlate with finite differences.** xx/yy/zz have
   negative Pearson correlations (−0.149 / −0.616 / −0.567) and sign-agreement rates of
   43.6% / 27.5% / 31.4%, while the shear components xy/xz/yz correlate at 0.976–0.984 with
   sign agreement 93.8–95.3%.

4. **Π/FD median ratio slope is ~3.23** on the scalar comparison (and ~2.92 global,
   ~2.98 deviatoric on the tensor), i.e. the Π-implied strain is roughly 3× the
   finite-difference strain in the approach region.

5. **`lesOverwhelmingFraction` is ~100% everywhere**, with ν_LES/ν_mol mean 293 and max
   1595 over the whole domain, and `atFloorFraction` 0 in every region.

6. **`droppedSamples` = 2** in the acceptance window.

7. **The run executed against a dirty working tree** (65 modified tracked files, 14
   untracked). The tree is pinned only by the diff hash in §1, not by a commit.

8. **`aged.startStep` (4,009,214) precedes `aged.checkpoint.totalSteps` (4,009,698)**, and
   `resilience.recovered.totalSteps` for the first cycle equals `checkpoint.totalSteps`
   (726) exactly.

---

## 6. Artifacts

| File                                                                                                                                                 | Size     | sha256                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| [`artifacts/2026-08-14-1121-m9-closure-target/m9-final-acceptance.json`](artifacts/2026-08-14-1121-m9-closure-target/m9-final-acceptance.json)       | 671.3 KB | `fd66e746682bff71ace7a1e6ba3313dfd340c82728a11ff49e925581df8e17da` |
| [`artifacts/2026-08-14-1121-m9-closure-target/m9-final-panel.png`](artifacts/2026-08-14-1121-m9-closure-target/m9-final-panel.png)                   | 286.9 KB | final dev-panel screenshot                                         |
| [`artifacts/2026-08-14-1121-m9-closure-target/playwright-error-context.md`](artifacts/2026-08-14-1121-m9-closure-target/playwright-error-context.md) | 18.7 KB  | Playwright failure context, including the full live event log      |

Not retained in-repo: `m9-final-samples.json` (5.6 MB, the raw 16,577-entry per-sample time
series) and the Playwright `trace.zip` (1.6 GB). Both were left in the gitignored
`test-results/` tree.
