# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m9-closure.gpu.spec.ts >> M9 closure: one target Ahmed acceptance plus four-hour resilience
- Location: apps\studio\e2e\m9-closure.gpu.spec.ts:159:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - heading "M9 — Ahmed body 25° long run" [level=2] [ref=e3]
    - paragraph [ref=e4]: "Screening-grade uniform grid, no wall functions: published band is ±15% around Cd 0.285. Runs in a worker (background-tab safe), checkpoints to IndexedDB every 5 min and on tab-hide, auto-recovers from GPU device loss."
    - generic [ref=e5]:
      - combobox [ref=e6] [cursor=pointer]:
        - option "15.7M cells (M9 target tier)"
        - option "8M cells (memory-short)"
        - option "2M cells (smoke test)"
        - option "15.70M cells (e2e override)" [selected]
      - generic [ref=e7]:
        - text: Re
        - spinbutton "Re" [ref=e8]: "4290000"
      - generic [ref=e9]:
        - text: Cs
        - spinbutton "Cs" [ref=e10]: "0.1"
      - generic [ref=e11]:
        - checkbox "FP16 storage (falls back if not granted)" [checked] [ref=e12]
        - text: FP16 storage (falls back if not granted)
      - button "Start fresh" [ref=e13] [cursor=pointer]
      - button "Resume from checkpoint" [ref=e14] [cursor=pointer]
      - button "Stop" [disabled] [ref=e15] [cursor=pointer]
      - button "Checkpoint now" [disabled] [ref=e16] [cursor=pointer]
      - button "Approach-flow diagnostics" [ref=e17] [cursor=pointer]
      - button "τ_eff / LES diagnostics" [active] [ref=e18] [cursor=pointer]
      - button "Simulate device loss" [disabled] [ref=e19] [cursor=pointer]
    - generic [ref=e20]: "τ_eff @ 1658.3 T_conv — Re 4.29e+6 Cs 0.1000 τ₀ 0.500004 ν_mol 1.409e-6 parity 0 fluid 15,125,716 skipped(freeSlip) 0 whole domain n= 15125716 τ p50 0.50119 p99 0.50281 max 0.50675 ν_LES/ν_mol p50 281.00 p99 664.73 max 1595.4 floor 0.0% dom 100.0% overwhelm 100.0% ground layer (y < 8) n= 789062 τ p50 0.50073 p99 0.50299 max 0.50675 ν_LES/ν_mol p50 170.98 p99 706.20 max 1595.4 floor 0.0% dom 100.0% overwhelm 100.0% ground band (y < 39) n= 4163528 τ p50 0.50094 p99 0.50286 max 0.50675 ν_LES/ν_mol p50 222.15 p99 675.27 max 1595.4 floor 0.0% dom 100.0% overwhelm 100.0% approach freestream n= 2730240 τ p50 0.50116 p99 0.50256 max 0.50456 ν_LES/ν_mol p50 274.43 p99 604.83 max 1078.4 floor 0.0% dom 100.0% overwhelm 100.0% around body n= 2044738 τ p50 0.50130 p99 0.50310 max 0.50634 ν_LES/ν_mol p50 305.43 p99 731.36 max 1499.2 floor 0.0% dom 100.0% overwhelm 100.0% slant n= 405914 τ p50 0.50126 p99 0.50296 max 0.50458 ν_LES/ν_mol p50 295.97 p99 699.77 max 1082.2 floor 0.0% dom 100.0% overwhelm 100.0% near wake (≤1 body length aft) n= 2208129 τ p50 0.50107 p99 0.50276 max 0.50428 ν_LES/ν_mol p50 252.00 p99 652.46 max 1010.9 floor 0.0% dom 100.0% overwhelm 100.0% station x=2 n= 31758 τ p50 0.50033 p99 0.50327 max 0.50470 ν_LES/ν_mol p50 77.28 p99 771.92 max 1111.7 floor 0.0% dom 100.0% overwhelm 99.8% station x=61 n= 31758 τ p50 0.50118 p99 0.50260 max 0.50388 ν_LES/ν_mol p50 278.11 p99 614.25 max 917.7 floor 0.0% dom 100.0% overwhelm 100.0% station x=118 n= 31758 τ p50 0.50110 p99 0.50279 max 0.50445 ν_LES/ν_mol p50 258.52 p99 658.06 max 1052.0 floor 0.0% dom 100.0% overwhelm 100.0% approach strain n=2,656,675 FD p50 8.654e-3 p95 1.581e-2 p99 1.912e-2 Pi p50 2.787e-2 p95 5.125e-2 p99 6.042e-2 approach agreement Pearson 0.9116 Spearman 0.9107 median(Pi/FD) 3.2271 relative L1 residual 0.1503 rejected(stencil) 73,565 invalid 0 density-weighted FD p50 8.654e-3 Pearson 0.9116 Spearman 0.9107 median(Pi/FD-rho) 3.2269 relative L1 0.1503 Pi tensor xx: Pearson -0.1493 Spearman -0.1651 alpha0 -0.6525 OLS -0.6571 + -1.012e-5 nRMS 0.9889 sign 43.6% Pi tensor yy: Pearson -0.6161 Spearman -0.5930 alpha0 -1.2519 OLS -1.2528 + 1.406e-5 nRMS 0.7879 sign 27.5% Pi tensor zz: Pearson -0.5673 Spearman -0.5244 alpha0 -1.1445 OLS -1.1445 + -6.492e-7 nRMS 0.8235 sign 31.4% Pi tensor xy: Pearson 0.9765 Spearman 0.9775 alpha0 3.3959 OLS 3.3959 + 9.637e-6 nRMS 0.2157 sign 93.8% Pi tensor xz: Pearson 0.9773 Spearman 0.9791 alpha0 3.4338 OLS 3.4338 + -5.964e-7 nRMS 0.2120 sign 94.1% Pi tensor yz: Pearson 0.9838 Spearman 0.9838 alpha0 1.1559 OLS 1.1559 + -9.243e-8 nRMS 0.1790 sign 95.3% Pi tensor global alpha 2.9235 nRMS 0.4219 deviatoric alpha 2.9815 Pearson 0.9245 Spearman 0.8379 nRMS 0.3813 Pi trace alpha -2.8962 Pearson -0.9151 Spearman -0.9012 nRMS 0.4032"
    - generic [ref=e21]: "step 4,011,392 1658.3 T_conv 4455 MLUPs elapsed 240.2 min Cd(t) 0.8548 mean(20 T_conv) 0.8953 ± 0.0171 drift 0.01% (gate <3%) drag 227.92 N (mean 238.69 N at U≈62 m/s) converged: YES checkpoints: last 6:21:30 PM (598 MB in 1.0 s) recoveries: 2"
    - generic [ref=e24]: Cd 0.895 Cl amp — St — (0.0 periods)
    - generic [ref=e25]: "ACCEPTANCE CONFIGURATION — live running-mean trigger reached at Cd 0.8953 (outside ±15% [0.242, 0.328]). Reported, not a verdict: final PASS/FAIL requires the predeclared m9-closure terminal budget and independent blocks"
    - generic [ref=e26]: "6:23:48 PM τ_eff @ 1658.3 T_conv: whole-domain ν_LES/ν_mol p50 281.00, LES-dominant 100.0% 6:21:42 PM diagnostics @ 1658.3 T_conv: bulk/cmd 99.6% 6:21:39 PM stopped at step 4,011,392 6:21:33 PM recovered (#2) at step 4,009,698 6:21:31 PM device lost — re-requesting adapter and restoring… 6:21:31 PM DEVICE LOST (device lost mid-step) — recovering… 6:21:31 PM CHAOS: forcing device loss (acceptance 4) 6:21:30 PM checkpoint saved at step 4,009,698 — 6:21:30 PM (598 MB in 1.0 s) 6:19:05 PM stability @ 1640.8 T_conv: mass drift -6.561e-6 ρ [0.99467, 1.00736] Ma_max 0.1462 non-finite 0 (208 ms) 6:17:41 PM checkpoint saved at step 3,945,568 — 6:17:41 PM (598 MB in 0.8 s) 6:16:12 PM stability @ 1620.8 T_conv: mass drift -1.528e-5 ρ [0.99443, 1.00708] Ma_max 0.1477 non-finite 0 (239 ms) 6:13:20 PM stability @ 1600.8 T_conv: mass drift -2.713e-6 ρ [0.99318, 1.00725] Ma_max 0.1513 non-finite 0 (207 ms) 6:12:40 PM checkpoint saved at step 3,861,110 — 6:12:40 PM (598 MB in 0.8 s) 6:10:26 PM stability @ 1580.8 T_conv: mass drift -7.912e-6 ρ [0.99349, 1.00729] Ma_max 0.1439 non-finite 0 (240 ms) 6:07:39 PM checkpoint saved at step 3,776,652 — 6:07:39 PM (598 MB in 0.8 s) 6:07:33 PM stability @ 1560.7 T_conv: mass drift -9.742e-7 ρ [0.99373, 1.00742] Ma_max 0.1468 non-finite 0 (286 ms) 6:04:37 PM stability @ 1540.7 T_conv: mass drift -8.749e-6 ρ [0.99272, 1.00729] Ma_max 0.1443 non-finite 0 (213 ms) 6:02:37 PM checkpoint saved at step 3,693,404 — 6:02:37 PM (598 MB in 0.9 s) 6:01:44 PM stability @ 1520.7 T_conv: mass drift -8.260e-6 ρ [0.99341, 1.00730] Ma_max 0.1431 non-finite 0 (235 ms) 5:58:52 PM stability @ 1500.7 T_conv: mass drift 4.484e-6 ρ [0.99449, 1.00741] Ma_max 0.1435 non-finite 0 (212 ms) 5:57:36 PM checkpoint saved at step 3,608,946 — 5:57:36 PM (598 MB in 0.8 s) 5:55:59 PM stability @ 1480.7 T_conv: mass drift 4.701e-6 ρ [0.99430, 1.00724] Ma_max 0.1452 non-finite 0 (223 ms) 5:53:06 PM stability @ 1460.7 T_conv: mass drift -1.597e-5 ρ [0.99388, 1.00736] Ma_max 0.1434 non-finite 0 (216 ms) 5:52:34 PM checkpoint saved at step 3,524,488 — 5:52:34 PM (598 MB in 0.8 s) 5:50:13 PM stability @ 1440.7 T_conv: mass drift -9.801e-7 ρ [0.99372, 1.00745] Ma_max 0.1427 non-finite 0 (231 ms) 5:47:33 PM checkpoint saved at step 3,440,030 — 5:47:33 PM (598 MB in 0.8 s) 5:47:20 PM stability @ 1420.7 T_conv: mass drift -1.663e-6 ρ [0.99245, 1.00726] Ma_max 0.1541 non-finite 0 (222 ms) 5:44:28 PM stability @ 1400.7 T_conv: mass drift -1.504e-5 ρ [0.99472, 1.00739] Ma_max 0.1453 non-finite 0 (207 ms) 5:42:31 PM checkpoint saved at step 3,355,572 — 5:42:31 PM (598 MB in 0.8 s) 5:41:34 PM stability @ 1380.7 T_conv: mass drift -6.058e-6 ρ [0.99323, 1.00714] Ma_max 0.1494 non-finite 0 (229 ms) 5:38:42 PM stability @ 1360.7 T_conv: mass drift -1.297e-5 ρ [0.99365, 1.00733] Ma_max 0.1453 non-finite 0 (227 ms) 5:37:30 PM checkpoint saved at step 3,271,356 — 5:37:30 PM (598 MB in 0.9 s) 5:35:45 PM stability @ 1340.7 T_conv: mass drift 4.648e-8 ρ [0.99371, 1.00745] Ma_max 0.1429 non-finite 0 (215 ms) 5:32:53 PM stability @ 1320.6 T_conv: mass drift -7.784e-7 ρ [0.99472, 1.00738] Ma_max 0.1516 non-finite 0 (204 ms) 5:32:29 PM checkpoint saved at step 3,188,108 — 5:32:29 PM (598 MB in 0.8 s) 5:29:59 PM stability @ 1300.6 T_conv: mass drift -6.866e-6 ρ [0.99282, 1.00746] Ma_max 0.1466 non-finite 0 (202 ms) 5:27:28 PM checkpoint saved at step 3,103,650 — 5:27:28 PM (598 MB in 0.8 s) 5:27:06 PM stability @ 1280.6 T_conv: mass drift -4.046e-6 ρ [0.99455, 1.00733] Ma_max 0.1471 non-finite 0 (225 ms) 5:24:14 PM stability @ 1260.6 T_conv: mass drift -2.187e-6 ρ [0.99383, 1.00732] Ma_max 0.1422 non-finite 0 (218 ms) 5:22:26 PM checkpoint saved at step 3,019,192 — 5:22:26 PM (598 MB in 0.8 s) 5:21:21 PM stability @ 1240.6 T_conv: mass drift -4.011e-7 ρ [0.99462, 1.00737] Ma_max 0.1492 non-finite 0 (227 ms) 5:18:29 PM stability @ 1220.6 T_conv: mass drift -5.993e-6 ρ [0.99373, 1.00729] Ma_max 0.1469 non-finite 0 (214 ms) 5:17:25 PM checkpoint saved at step 2,934,734 — 5:17:25 PM (598 MB in 0.8 s) 5:15:35 PM stability @ 1200.6 T_conv: mass drift -4.842e-6 ρ [0.99418, 1.00729] Ma_max 0.1450 non-finite 0 (243 ms) 5:12:43 PM stability @ 1180.6 T_conv: mass drift -2.008e-6 ρ [0.99430, 1.00738] Ma_max 0.1483 non-finite 0 (216 ms) 5:12:23 PM checkpoint saved at step 2,850,518 — 5:12:23 PM (598 MB in 0.8 s) 5:09:46 PM stability @ 1160.6 T_conv: mass drift -8.150e-6 ρ [0.99340, 1.00736] Ma_max 0.1527 non-finite 0 (212 ms) 5:07:22 PM checkpoint saved at step 2,767,028 — 5:07:22 PM (598 MB in 0.8 s) 5:06:53 PM stability @ 1140.6 T_conv: mass drift 1.680e-6 ρ [0.99396, 1.00731] Ma_max 0.1553 non-finite 0 (215 ms) 5:04:01 PM stability @ 1120.6 T_conv: mass drift -6.989e-6 ρ [0.99459, 1.00731] Ma_max 0.1468 non-finite 0 (223 ms) 5:02:21 PM checkpoint saved at step 2,682,570 — 5:02:21 PM (598 MB in 0.9 s) 5:01:08 PM stability @ 1100.6 T_conv: mass drift 4.261e-8 ρ [0.99312, 1.00722] Ma_max 0.1420 non-finite 0 (228 ms) 4:58:15 PM stability @ 1080.5 T_conv: mass drift -6.436e-6 ρ [0.99290, 1.00732] Ma_max 0.1480 non-finite 0 (215 ms) 4:57:19 PM checkpoint saved at step 2,598,112 — 4:57:19 PM (598 MB in 0.7 s) 4:55:22 PM stability @ 1060.5 T_conv: mass drift -3.476e-6 ρ [0.99311, 1.00735] Ma_max 0.1465 non-finite 0 (220 ms) 4:52:30 PM stability @ 1040.5 T_conv: mass drift -5.527e-6 ρ [0.99432, 1.00736] Ma_max 0.1417 non-finite 0 (225 ms) 4:52:18 PM checkpoint saved at step 2,513,654 — 4:52:18 PM (598 MB in 0.8 s) 4:49:35 PM stability @ 1020.5 T_conv: mass drift -1.292e-6 ρ [0.99406, 1.00732] Ma_max 0.1443 non-finite 0 (239 ms) 4:47:16 PM checkpoint saved at step 2,429,680 — 4:47:16 PM (598 MB in 0.8 s) 4:46:42 PM stability @ 1000.5 T_conv: mass drift -8.177e-6 ρ [0.99367, 1.00719] Ma_max 0.1454 non-finite 0 (218 ms) 4:43:50 PM stability @ 980.5 T_conv: mass drift -4.926e-6 ρ [0.99390, 1.00735] Ma_max 0.1492 non-finite 0 (221 ms) 4:42:16 PM checkpoint saved at step 2,345,464 — 4:42:16 PM (598 MB in 0.8 s) 4:40:56 PM stability @ 960.5 T_conv: mass drift -4.079e-6 ρ [0.99396, 1.00724] Ma_max 0.1485 non-finite 0 (222 ms) 4:38:04 PM stability @ 940.5 T_conv: mass drift 3.250e-6 ρ [0.99441, 1.00722] Ma_max 0.1522 non-finite 0 (249 ms) 4:37:15 PM checkpoint saved at step 2,261,248 — 4:37:15 PM (598 MB in 0.9 s) 4:35:11 PM stability @ 920.5 T_conv: mass drift 1.936e-6 ρ [0.99193, 1.00734] Ma_max 0.1420 non-finite 0 (227 ms) 4:32:18 PM stability @ 900.5 T_conv: mass drift -8.898e-6 ρ [0.99398, 1.00735] Ma_max 0.1500 non-finite 0 (226 ms) 4:32:13 PM checkpoint saved at step 2,176,790 — 4:32:13 PM (598 MB in 0.9 s) 4:29:25 PM stability @ 880.5 T_conv: mass drift -6.310e-6 ρ [0.99405, 1.00715] Ma_max 0.1494 non-finite 0 (223 ms) 4:27:12 PM checkpoint saved at step 2,092,574 — 4:27:12 PM (598 MB in 1.1 s) 4:26:31 PM stability @ 860.5 T_conv: mass drift 7.278e-6 ρ [0.99474, 1.00728] Ma_max 0.1435 non-finite 0 (325 ms) 4:23:37 PM stability @ 840.4 T_conv: mass drift -1.165e-5 ρ [0.99376, 1.00734] Ma_max 0.1473 non-finite 0 (321 ms) 4:22:11 PM checkpoint saved at step 2,009,084 — 4:22:10 PM (598 MB in 1.1 s) 4:20:42 PM stability @ 820.4 T_conv: mass drift -4.248e-6 ρ [0.99366, 1.00728] Ma_max 0.1431 non-finite 0 (338 ms) 4:17:44 PM stability @ 800.4 T_conv: mass drift 4.436e-6 ρ [0.99446, 1.00739] Ma_max 0.1450 non-finite 0 (361 ms) 4:17:09 PM checkpoint saved at step 1,926,562 — 4:17:09 PM (598 MB in 1.1 s) 4:14:49 PM stability @ 780.4 T_conv: mass drift -6.228e-6 ρ [0.99379, 1.00737] Ma_max 0.1446 non-finite 0 (334 ms) 4:12:08 PM checkpoint saved at step 1,843,072 — 4:12:08 PM (598 MB in 1.1 s) 4:11:54 PM stability @ 760.4 T_conv: mass drift -9.177e-6 ρ [0.99408, 1.00720] Ma_max 0.1467 non-finite 0 (295 ms) 4:09:00 PM stability @ 740.4 T_conv: mass drift -3.481e-6 ρ"
  - group [ref=e27]:
    - generic "AeroFlow" [ref=e28] [cursor=pointer]
```

# Test source

```ts
  565 |                 ? ('TOPOLOGY_PASS' as const)
  566 |                 : ('TOPOLOGY_RECORDED' as const),
  567 |           wake: w,
  568 |         };
  569 |       })()
  570 |     : { classification: 'TOPOLOGY_FAIL' as const };
  571 | 
  572 |   const artifact = {
  573 |     artifactSchema: 'aeroflow-m9-hard-closure-v1',
  574 |     frozenConfiguration: {
  575 |       collision: 'D3Q19 TRT',
  576 |       equilibrium: 'quadratic',
  577 |       regularization: 'projected second-order',
  578 |       conserveMass: true,
  579 |       // H13's correction is quantized away by the very next f16 store (docs/WGSL-NOTES.md
  580 |       // #23) — this frozen configuration requests conserveMass under fp16 storage, so the
  581 |       // correction is NOT actually active. Record both the request and the fact, rather
  582 |       // than let `conserveMass: true` alone be read as "the correction held".
  583 |       conserveMassEffective: false,
  584 |       lesCs: 0.1,
  585 |       precision: 'fp16',
  586 |       forceOwnership: 'BodySolid only',
  587 |       forceSampling: 'two consecutive steps',
  588 |       convergence:
  589 |         `${MIN_BLOCKS}+1 complete blocks; previous/current/union <= ${BLOCK_GATE}. ` +
  590 |         `Block length derived from the run's own sigma/mean so the block SE sits under the ` +
  591 |         `gate, clamped to [${BLOCK_TCONV_MIN}, ${BLOCK_TCONV_MAX}] T_conv ` +
  592 |         `(actual: ${acceptance?.blockTConv ?? 'n/a'}).`,
  593 |       acceptanceBudgetMs: ACCEPTANCE_BUDGET_MS,
  594 |       productBudgetMs: PRODUCT_BUDGET_MS,
  595 |       acceptanceStartedAt,
  596 |       requestedCells: TARGET_CELLS,
  597 |       // Reported from what the worker actually BUILT, never from what this file expects.
  598 |       lateralBC: scene.lateralBC,
  599 |       inletBC: scene.inletBC,
  600 |       outlet: scene.outlet,
  601 |       ground: 'no-slip halfway bounce-back',
  602 |     },
  603 |     gpu: ready.gpu,
  604 |     scene,
  605 |     acceptance,
  606 |     productBudgetSnapshot,
  607 |     acceptanceBand: CD_BAND,
  608 |     topology,
  609 |     resilience: {
  610 |       wallStartedAt,
  611 |       endedAt: Date.now(),
  612 |       elapsedMs: Date.now() - wallStartedAt,
  613 |       checkpoint,
  614 |       recovered,
  615 |       // The early cycle proves the plumbing; the aged one proves it on a multi-hour field.
  616 |       aged: agedResilience,
  617 |       postRecoveryFinalStep: final?.totalSteps,
  618 |       monotonicAfterRecovery,
  619 |       backgroundStartedAt,
  620 |       backgroundEndedAt,
  621 |       backgroundMs: backgroundEndedAt ? backgroundEndedAt - backgroundStartedAt : 0,
  622 |       hiddenAtStart,
  623 |       hiddenAtEnd,
  624 |       backgroundStartStep,
  625 |       backgroundEndStep,
  626 |       advancedWhileBackgrounded: backgroundEndStep > backgroundStartStep,
  627 |       visibilityMethod:
  628 |         'cover target foreground + standard hidden/visibilitychange emulation (Chromium automation reports every target visible)',
  629 |     },
  630 |     finalSample: final,
  631 |     diagnostics,
  632 |     diagnosticsError,
  633 |     tau,
  634 |     tauMs,
  635 |     tauError,
  636 |     eventCounts: Object.fromEntries(
  637 |       [...new Set(events(h).map((e) => e.type))].map((type) => [
  638 |         type,
  639 |         events(h).filter((e) => e.type === type).length,
  640 |       ]),
  641 |     ),
  642 |   };
  643 | 
  644 |   writeFileSync(resolve(OUT_DIR, 'm9-final-acceptance.json'), JSON.stringify(artifact, null, 1));
  645 |   writeFileSync(
  646 |     resolve(OUT_DIR, 'm9-final-samples.json'),
  647 |     JSON.stringify({ samples: all }, null, 1),
  648 |   );
  649 |   const screenshot = await page.screenshot({ fullPage: true });
  650 |   writeFileSync(resolve(OUT_DIR, 'm9-final-panel.png'), screenshot);
  651 |   await testInfo.attach('m9-final-acceptance', {
  652 |     body: JSON.stringify(artifact, null, 1),
  653 |     contentType: 'application/json',
  654 |   });
  655 |   await testInfo.attach('m9-final-panel', { body: screenshot, contentType: 'image/png' });
  656 | 
  657 |   console.log(`\nM9 FINAL ACCEPTANCE\n${JSON.stringify(artifact, null, 1)}\n`);
  658 | 
  659 |   expect(hiddenAtStart, 'solver tab was not hidden behind the cover tab').toBe(true);
  660 |   expect(hiddenAtEnd, 'solver tab did not remain hidden for the full background window').toBe(true);
  661 |   expect(backgroundEndedAt! - backgroundStartedAt).toBeGreaterThanOrEqual(BACKGROUND_MS);
  662 |   expect(backgroundEndStep).toBeGreaterThan(backgroundStartStep);
  663 |   expect(checkpoint.totalSteps).toBeGreaterThan(0);
  664 |   expect(recovered.totalSteps).toBeGreaterThan(0);
> 665 |   expect(monotonicAfterRecovery).toBe(true);
      |                                  ^ Error: expect(received).toBe(expected) // Object.is equality
  666 |   expect(Date.now() - wallStartedAt).toBeGreaterThanOrEqual(ENDURANCE_MS);
  667 |   expect(diagnostics?.field.nonFiniteCells ?? 1).toBe(0);
  668 |   // The tau snapshot is the reason this run exists (private b2b7fd9): without it there is no
  669 |   // basis for quoting the Cd against its nominal Re, so a run that loses it is a failed run
  670 |   // even though its Cd is recorded.  Everything above is already on disk either way.
  671 |   expect(tauError, 'tau readback failed').toBeUndefined();
  672 |   expect(tau, 'no tau report was captured').toBeDefined();
  673 |   // Scoped to errors that predate the deliberate aged device loss — that cycle provokes one
  674 |   // on purpose, and its own outcome is recorded in resilience.aged rather than asserted.
  675 |   expect(erroredBeforeAged, 'the solver errored during the acceptance window').toBe(false);
  676 | });
  677 | 
```