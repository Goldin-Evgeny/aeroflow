# Validation run index

Append-only. Newest row at the bottom. Rows are never rewritten — a result that is later
invalidated keeps its row and its numbers, and gets its status flagged `WITHDRAWN` with the
reason recorded in a `## WITHDRAWN` section appended to its run file.

One row per executed validation/acceptance run of any duration, including runs that failed,
diverged, or crashed.

Verdict columns are reported separately and never collapsed:

- **INFRA** — harness health: non-finite cells, mass drift, ledger closure,
  checkpoint/recovery, convergence achieved, block spread. `GREEN` / `AMBER` / `RED`.
- **PHYSICS** — did the measured quantity land in its acceptance band.
  `IN_BAND` / `PHYSICS_TARGET_MISS` / `N/A`. A miss is a research outcome, not a bug.
- **TOPOLOGY** — `PASS` / `RECORDED` / `FAIL` / `N/A`.

| Run                                                                            | UTC start            | Case                                                 | Cells      | Commit    | Dirty | Primary metric                    | INFRA | PHYSICS             | TOPOLOGY | Status   |
| ------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------- | ---------- | --------- | ----- | --------------------------------- | ----- | ------------------- | -------- | -------- |
| [2026-08-14-1121-m9-closure-target](runs/2026-08-14-1121-m9-closure-target.md) | 2026-08-14T11:21:25Z | M9 closure — Ahmed 25°, target tier + 4 h resilience | 15,731,936 | `a033193` | yes   | Cd = 0.8956 (band [0.242, 0.328]) | AMBER | PHYSICS_TARGET_MISS | RECORDED | RECORDED |
