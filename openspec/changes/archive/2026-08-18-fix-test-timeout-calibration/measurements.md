# Timeout calibration measurements

Measured 2026-08-17 on an Intel Core i9-12900K (24 logical processors), Node 22.14.0,
Vitest 3.2.7. Idle samples ran files sequentially with no synthetic load. Loaded samples ran
with 20 concurrent PowerShell CPU busy loops; every pass tracked exact worker PIDs and reported
zero workers remaining after `finally` cleanup.

The replacement formula is:

`ceilTo5s(max(3 * worstMeasured, worstMeasured + 30 s))`

The `forces2d` loaded drag test first expired at its old 120 s ceiling, then completed in
140.763 s with a temporary 600 s measurement ceiling. Its final 425 s value below is derived
from the uncensored runtime. The original timeout is shown in the table.

| File | Timed test | Idle min / median / max (s) | Loaded (s) | Worst (s) | Old (s) | New (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| abl-fetch | diagnosis | 4.460 / 4.594 / 4.607 | 8.815 | 8.815 | 30 | 40 |
| abl-fetch | H12 profile | 9.814 / 9.837 / 13.034 | 20.447 | 20.447 | 60 | 65 |
| abl-fetch | plain-inlet expected failure | 4.530 / 4.537 / 4.731 | 9.243 | 9.243 | 30 | 40 |
| ahmedForceSampling | pair-averaging | 91.885 / 93.097 / 97.036 | 166.200 | 166.200 | 600 | 500 |
| aijCaseA | naive/Esoteric identity | 5.600 / 5.638 / 5.742 | 11.635 | 11.635 | 60 | 45 |
| cavity | Ghia profiles | 19.121 / 19.468 / 19.631 | 39.550 | 39.550 | 60 | 120 |
| cylinder-re200-repro | Re=200 plain | 15.292 / 15.383 / 19.094 | 31.840 | 31.840 | 60 | 100 |
| cylinder-re200-repro | Re=200 LES | 20.696 / 20.886 / 22.331 | 47.694 | 47.694 | 60 | 145 |
| cylinder-re200-repro | Re=100 plain | 15.469 / 15.594 / 16.197 | 34.506 | 34.506 | 60 | 105 |
| esoteric | parameterized identity (3 cases) | 0.049 / 0.050 / 0.051 | 0.097 | 0.097 | 30 | 35 |
| fetch-steadiness | driftScaled | 25.868 / 25.927 / 26.744 | 56.324 | 56.324 | 120 | 170 |
| forceLedger | T-STAGGER-CURE | 12.661 / 13.033 / 13.077 | 26.723 | 26.723 | 60 | 85 |
| forces2d | symmetry | 2.179 / 2.179 / 2.196 | 4.525 | 4.525 | 60 | 35 |
| forces2d | steady drag | 62.076 / 62.277 / 62.892 | 140.763 | 140.763 | 120 | 425 |
| groundForceContamination | body/ground separation | 157.134 / 160.947 / 161.256 | 284.600 | 284.600 | 300 | 855 |
| les | Re=300 stability | 55.132 / 55.522 / 55.726 | 115.961 | 115.961 | 120 | 350 |
| les | Re=20 non-interference | 34.093 / 34.142 / 34.186 | 72.879 | 72.879 | 90 | 220 |
| nearFloorFactorial | enabled factorial | 704.595 / 706.264 / 730.400 | 1560.206 | 1560.206 | 3600 | 4685 |
| pressureOutlet3d | density anchors | 1.288 / 1.312 / 1.315 | 2.737 | 2.737 | 30 | 35 |
| pressureOutlet3d | boundary budgets (3 cases) | 2.061 / 2.072 / 2.089 | 4.459 | 4.459 | 60 | 35 |
| regularize | plain control | 7.630 / 7.646 / 8.036 | 15.991 | 15.991 | 120 | 50 |
| regularize | regularized finite | 10.915 / 11.320 / 11.695 | 25.681 | 25.681 | 120 | 80 |
| regularize | Re=20 non-interference | 35.069 / 35.729 / 37.215 | 82.959 | 82.959 | 120 | 250 |
| solver2d | T-FORCE | 5.310 / 5.327 / 5.432 | 13.197 | 13.197 | 30 | 45 |
| solver3d | T-DUCT | 1.162 / 1.163 / 1.234 | 2.522 | 2.522 | 60 | 35 |
| solver3d | T-FORCE-3D | 12.965 / 13.125 / 13.790 | 32.606 | 32.606 | 60 | 100 |
| sphere | reflection symmetry | 4.948 / 4.966 / 5.048 | 11.824 | 11.824 | 30 | 45 |
| velocityInlet | flux convergence | 11.850 / 12.036 / 12.361 | 28.029 | 28.029 | 30 | 85 |
| ahmed3d | freestream default identity | 0.854 / 0.876 / 0.904 | 1.837 | 1.837 | 5 default | 35 |
| ahmed3d | whole-shell free-slip pulls | 1.816 / 1.846 / 1.988 | 3.938 | 3.938 | 5 default | 35 |
| ahmed3d | inlet 2x2 stepping | 1.811 / 1.834 / 1.863 | 3.807 | 3.807 | 5 default | 35 |
| ahmed3d | outlet 2x2 stepping | 1.840 / 1.854 / 1.953 | 3.882 | 3.882 | 5 default | 35 |
| centralMomentEigenProof | D3Q27 periodic shear | 1.258 / 1.276 / 1.306 | 2.568 | 2.568 | 5 default | 35 |
| shearWaveStress | targeted controls (P16 worst) | 1.322 / 1.360 / 1.374 | 2.947 | 2.947 | 5 default | 35 |
| urbanScene | naive/Esoteric identity | 1.857 / 1.879 / 1.927 | 3.569 | 3.569 | 5 default | 35 |

The loaded ground-force (284.6 s) and Ahmed-force (166.2 s) values are the qualifying preserved
measurements named in the proposal. The enabled near-floor loaded run is recorded and committed
as `be2ea0a`; its idle records are `644a750`, `ca961f9`, and `880b55c`. All other table values
were collected in the apply workflow captured by this change.

All six fresh idle executions of the two heavy synchronous tests passed their assertions but
exited 1 because Vitest reported `[vitest-worker]: Timeout calling "onTaskUpdate"`. The enabled
factorial did the same at idle and under load. These errors are evidence for the event-loop yield
work in design D5, not inputs to the test-timeout formula.

The first full loaded-suite gate also exposed seven tests in four files that still depended on
Vitest's 5 s default watchdog. Their three fresh idle samples and isolated 20-worker loaded sample
are included above. Each derives to the 35 s floor. The same gate identified six additional
long-running callbacks that needed cooperative yields; those yields preserve the original step
counts, assertions, solver inputs, and numerical thresholds.

The final loaded full-suite gate ran all 84 files under the same 20-worker load in 401.83 s:
576 tests passed, one opt-in test was skipped, no transport error occurred, Vitest exited 0,
and cleanup reported `LOAD_WORKERS_REMAINING=0`. Earlier discovery gates reached about 269 s for
Ahmed sampling and 411 s for ground-force contamination; those observations set the final
100-step transport-yield cadence but do not replace the isolated per-test calibration samples.
