# Validation run index

Append-only. Newest row at the bottom. Rows are never rewritten — a result that is later
invalidated keeps its row and its numbers, and gets its status flagged `WITHDRAWN` with the
reason recorded in a `## WITHDRAWN` section appended to its run file.

One row per executed validation/acceptance run of any duration, including runs that failed,
diverged, or crashed.

Verdict columns are reported separately and never collapsed.

There are two verdict schemas. **Rows are never rewritten**, so the v1 table below is closed
as-is and every run from 2026-08-15 onward is appended to the v2 table instead. Do not
back-fill v1 rows into v2 — their verdicts mean what they meant when recorded.

## Schema v1 (closed 2026-08-15)

- **INFRA** — harness health: non-finite cells, mass drift, ledger closure,
  checkpoint/recovery, convergence achieved, block spread. `GREEN` / `AMBER` / `RED`.
- **PHYSICS** — did the measured quantity land in its acceptance band.
  `IN_BAND` / `PHYSICS_TARGET_MISS` / `N/A`. A miss is a research outcome, not a bug.
- **TOPOLOGY** — `PASS` / `RECORDED` / `FAIL` / `N/A`.

v1 conflated three distinct questions inside `INFRA` — did the harness run, did the
arithmetic stay well-posed, and did the statistic converge — so a run could report
`INFRA=GREEN` while having converged to a physically implausible field. v2 separates them.

| Run                                                                                        | UTC start            | Case                                                  | Cells                   | Commit    | Dirty | Primary metric                                                             | INFRA | PHYSICS             | TOPOLOGY | Status       |
| ------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------- | ----------------------- | --------- | ----- | -------------------------------------------------------------------------- | ----- | ------------------- | -------- | ------------ |
| [2026-08-14-1121-m9-closure-target](runs/2026-08-14-1121-m9-closure-target.md)             | 2026-08-14T11:21:25Z | M9 closure — Ahmed 25°, target tier + 4 h resilience  | 15,731,936              | `a033193` | yes   | Cd = 0.8956 (band [0.242, 0.328])                                          | AMBER | PHYSICS_TARGET_MISS | RECORDED | RECORDED     |
| [2026-08-15-1327-v12-v13-aij-gpu-rerun](runs/2026-08-15-1327-v12-v13-aij-gpu-rerun.md)     | 2026-08-15T13:27Z    | V12 ABL fetch (empty domain), 16 cells/b              | 8,473,344               | `e8fde0c` | yes   | fetch deviation = 66.19% (band ≤ 5%)                                       | GREEN | PHYSICS_TARGET_MISS | N/A      | RECORDED     |
| [2026-08-15-1327-v12-v13-aij-gpu-rerun](runs/2026-08-15-1327-v12-v13-aij-gpu-rerun.md)     | 2026-08-15T13:32Z    | V13 AIJ Case A, 24 cells/b                            | 28,595,232              | `e8fde0c` | yes   | no verdict — steadiness not reached in 25 min (last q 0.659, r 0.850)      | AMBER | N/A                 | N/A      | INCONCLUSIVE |
| [2026-08-15-1430-v13-caseA-b16-recording](runs/2026-08-15-1430-v13-caseA-b16-recording.md) | 2026-08-15T14:30Z    | V13 AIJ Case A, 16 cells/b — recording only           | 8,473,344               | `ac3ae0a` | yes   | q = 0.4762, r = 0.7835 (no band at this resolution; was ≈0.532 pre-repair) | GREEN | N/A                 | N/A      | RECORDED     |
| [2026-08-15-1450-v14-caseC-aborted](runs/2026-08-15-1450-v14-caseC-aborted.md)             | 2026-08-15T14:50Z    | V14 AIJ Case C 270°, strict grid — aborted at ~59 min | 190,000,000 (requested) | `80dfc5b` | yes   | no result — harness budget 2 h vs 5.96 h measured (D1)                     | RED   | N/A                 | N/A      | ABORTED      |

## Schema v2 (current)

Five axes, never collapsed and never averaged. A run can be `GREEN` on the first three and
still be solving the wrong discrete physics — saying exactly that is the reason this table
has five columns instead of one.

- **EXEC** (`EXECUTION`) — run completed or terminated cleanly, device-loss recovery,
  checkpoint/restore, artifacts preserved and machine-readable. `GREEN` / `AMBER` / `RED`.
- **NUM** (`NUMERICAL_HEALTH`) — non-finite cells, mass drift, ledger closure, density and
  Mach bounds. `GREEN` / `AMBER` / `RED`.
- **CONV** (`STATISTICAL_CONVERGENCE`) — block agreement, drift, stationarity.
  `GREEN` / `AMBER` / `RED` / `N/A`. Green means the statistic is a converged estimate of
  something; it says nothing about whether that something is right.
- **TARGET** (`PHYSICS_TARGET`) — did the measured quantity land in its acceptance band.
  `IN_BAND` / `PHYSICS_TARGET_MISS` / `N/A`. A miss is a research outcome, not a bug.
- **STRUCT** (`PHYSICS_STRUCTURE`) — is the resolved field physically plausible: wake
  topology, separation and reattachment, symmetry, near-wall behaviour, subgrid activity
  where there should be none. `PASS` / `RECORDED` / `CONCERN` / `FAIL` / `N/A`. Subsumes
  v1's `TOPOLOGY`.

| Run                                                                                              | UTC start         | Case                                                      | Cells       | Commit          | Dirty | Primary metric                                                                     | EXEC  | NUM | CONV  | TARGET              | STRUCT   | Status   |
| ------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------- | ----------- | --------------- | ----- | ---------------------------------------------------------------------------------- | ----- | --- | ----- | ------------------- | -------- | -------- |
| [2026-08-15-1620-v12-fetch-rows-control](runs/2026-08-15-1620-v12-fetch-rows-control.md)         | 2026-08-15T18:30Z | V12 ABL fetch — per-row control, 16 cells/b               | 8,473,344   | `9591433`       | yes   | fetch deviation = 66.19% (band ≤ 5%); 6 of 32 rows over gate, max set by y=2 alone | GREEN | N/A | GREEN | PHYSICS_TARGET_MISS | CONCERN  | RECORDED |
| [2026-08-15-2100-v14-caseC-stall-reproduced](runs/2026-08-15-2100-v14-caseC-stall-reproduced.md) | 2026-08-15T21:00Z | V14 AIJ Case C 270°, strict grid — stalled at step 21,090 | 190,000,000 | `9dc2ea9`+dirty | yes   | no result — D1 Wall-3 hang reproduced, detector fired at 6 min                     | RED   | N/A | N/A   | N/A                 | N/A      | STALLED  |
| [2026-08-15-2130-v13-caseA-b24-verdict](runs/2026-08-15-2130-v13-caseA-b24-verdict.md)           | 2026-08-15T21:30Z | V13 AIJ Case A, 24 cells/b — first verdict                | 28,595,232  | `9dc2ea9`+dirty | yes   | q = 0.65873 (83/126, gate ≥0.66 needs 84 — one point short); r = 0.85156 passes    | GREEN | N/A | GREEN | PHYSICS_TARGET_MISS | CONCERN  | RECORDED |
| [2026-08-16-0116-v14-caseC-strict-grid](runs/2026-08-16-0116-v14-caseC-strict-grid.md)           | 2026-08-15T22:16Z | V14 AIJ Case C 270°, strict third-node grid — completed   | 187,543,449 | `2c31f81`       | yes   | q = 0.45833 (55/120, gate ≥0.66); r = 0.80324; 365,560 steps in 5.997 h            | GREEN | N/A | GREEN | PHYSICS_TARGET_MISS | RECORDED | RECORDED |
| [2026-08-17-1832-near-floor-factorial](runs/2026-08-17-1832-near-floor-factorial.md)             | 2026-08-17T15:32Z | Near-floor mechanism factorial, CPU empty tunnel, tau0=0.5000005 | 560 / 5,376 | `227afc0`+dirty | yes   | reg=on spec diverges @3346 (reproduces 3000–3500); omega- inert under regularization; freestream nu_t/nu_mol p50 ~5.2e3 where analytic answer is 0 | GREEN | AMBER | N/A | N/A | CONCERN | RECORDED |
| [2026-08-17-1824-near-floor-timeout-idle2](runs/2026-08-17-1824-near-floor-timeout-idle2.md)     | 2026-08-17T18:24Z | Near-floor factorial timeout calibration, idle sample 2          | 560 / 5,376 | `644a750`+dirty | yes   | 5 tests passed; factorial test 706.264 s; command exit 1 from one onTaskUpdate transport timeout | AMBER | AMBER | N/A | N/A | CONCERN | RECORDED |
| [2026-08-17-1848-near-floor-timeout-idle3](runs/2026-08-17-1848-near-floor-timeout-idle3.md)     | 2026-08-17T18:48Z | Near-floor factorial timeout calibration, idle sample 3          | 560 / 5,376 | `ca961f9`+dirty | yes   | 5 tests passed; factorial test 704.595 s; command exit 1 from one onTaskUpdate transport timeout | AMBER | AMBER | N/A | N/A | CONCERN | RECORDED |
