# End-to-end test setup

Two tiers, both running on the **real GPU** through a Playwright-launched browser.
Config: [apps/studio/playwright.config.ts](../apps/studio/playwright.config.ts).

| Suite                    | Command                        | What it is                                                                    |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------- |
| **Tier A** (`chromium`)  | `npm run test:e2e`             | Fast correctness specs. Boots every route, checks parity panels, exports, nav |
| **Tier B** (`gpu`)       | `npm run test:e2e:gpu`         | Acceptance runs — `*.gpu.spec.ts`. Benchmarks, drag ladders, AIJ scoring      |
| `fallback`               | (runs with Tier A)             | WebGPU disabled; asserts the graceful-degradation page                        |
| **SwiftShader** (opt-in) | `npm run test:e2e:swiftshader` | CPU-Vulkan fallback for a box with no usable GPU. Correctness only            |

Tier A is ~20 s. Tier B ranges from seconds (`caps`) to tens of minutes (drag ladders,
AIJ directions), hence its 30-minute per-test timeout.

## Which browser exposes the GPU

This is the one thing that is easy to get wrong, and it is not about headless vs headed.
Measured 2026-07-28 on the Windows dev box (RTX 3090), navigating to the built app and
calling `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })`:

| Launch configuration                           | Adapter                       |
| ---------------------------------------------- | ----------------------------- |
| Playwright default (`chromium-headless-shell`) | **`requestAdapter()` → null** |
| …same, plus `--enable-unsafe-webgpu`           | **null** (the flag is not it) |
| `channel: 'chromium'`, headless                | nvidia · ampere               |
| `channel: 'chrome'`, headless                  | nvidia · ampere               |
| `channel: 'chrome'`, headed                    | nvidia · ampere               |

All three working configurations report identical capabilities — `shader-f16` and
`timestamp-query` present, 2.000 GiB `maxStorageBufferBindingSize`, 16 storage buffers per
stage. So `channel: 'chromium'` is sufficient: **no `--enable-unsafe-webgpu`, no headed
mode, no CDP.** The null adapter is a property of Playwright's bundled _headless shell_,
which ships without the GPU stack — swapping the channel is the entire fix.

If a GPU-touching spec starts failing at `requestAdapter`, check the project's `channel`
before anything else. `webgpu-smoke.spec.ts` exists to make that failure loud and obvious.

## Attaching to an external browser (CDP)

Set `AEROFLOW_CDP_URL` and the Tier B fixture ([e2e/fixtures/gpu.ts](../apps/studio/e2e/fixtures/gpu.ts))
attaches to an already-running Chrome over CDP instead of using the launched browser:

```sh
AEROFLOW_CDP_URL=http://localhost:9222 npm run test:e2e:gpu
```

The target Chrome needs `--remote-debugging-port=9222` **and** a dedicated
`--user-data-dir` (Chrome 136+ ignores the debugging port on the default profile).

This is no longer needed for day-to-day work, but it is still the way to drive a browser
this process cannot launch itself — notably **a second and third physical GPU**, which is
what M6 acceptance #6 and the cross-GPU portability claim are waiting on
Note that Playwright's `baseURL` does not apply to
CDP-attached contexts, which is why specs compose URLs from `BASE_URL`
(`e2e/helpers/hooks.ts`) rather than using relative paths.

[scripts/e2e-gpu-chrome.sh](../scripts/e2e-gpu-chrome.sh) automates starting that Chrome
and bridging it out of WSL. It is a **WSL-era script** — it shells out to
`/mnt/c/.../chrome.exe` and deals with mirrored-vs-NAT networking. Kept for the remote-GPU
case; not used by the default path.

## How specs observe the app

Specs never scrape the DOM for physics. Pages mirror their state into
`window.__aeroflow` ([src/dev/testHooks.ts](../apps/studio/src/dev/testHooks.ts)), read via
`readHooks(page)`. Two hooks exist because of a specific, costly failure:

- `deviceLost` — `totalSteps` is a **CPU-side** counter that keeps incrementing after the
  GPU device dies, so "steps advanced" alone can be green against a dead device. It was,
  for days. `boot.spec.ts` asserts `deviceLost === undefined` for exactly this reason.
- `parityError` / `parityProgress` — a panel that swallows an exception into a DOM node
  leaves the spec to die on its timeout with "expected undefined to be truthy". Polling
  both makes it fail in under a second, naming the matrix cell that threw.

## History (why the old setup looked the way it did)

Development ran in WSL until 2026-07-28. Headless Chromium there had no GPU adapter, so
Tier A ran on **SwiftShader** (CPU Vulkan) and Tier B reached the host GPU by attaching
over CDP to a hand-started Windows Chrome. Moving to native Windows removed both
constraints at once.

The SwiftShader project is retained as an opt-in because it is the only way to run Tier A
on a machine without an adapter. One known fault reproduces under it: every route that
builds a 2D `Lbm2D` (`?dev`, `?playground2d`) loses its WebGPU device ~230 ms into boot,
with no interaction — so `parity.spec.ts` throws on its first matrix cell
(`mapAsync: A valid external Instance reference no longer exists`). It was **never
root-caused**; the suspected trigger is the D2Q9 kernel's pipeline creation under
SwiftShader. `?parity3d` builds `Lbm3D` and is unaffected. On the real adapter the device
survives and the spec passes in ~0.6 s.

## Durable GPU runs: fresh, resume, inspect, cleanup

Checkpointed urban acceptance runs use one harness-owned directory per run under
`.aeroflow/runs/` (override with `AEROFLOW_RUN_ROOT`). It contains the persistent Chromium
profile/IndexedDB checkpoint, `owner.json`, `lifecycle.json`, and the authoritative atomic
`validation-artifact.json`. The harness prints the run id and all resume paths at launch.
Do not use `AEROFLOW_CDP_URL` for these runs: a CDP-attached browser cannot provide an
isolated, harness-owned persistent profile.

PowerShell examples for V14 Case C:

```powershell
# Fresh: always allocates a new identity/profile and never discovers old state.
$env:AEROFLOW_M11_CELLS='190000000'
$env:AEROFLOW_RUN_OPERATION='fresh'
npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban.gpu.spec.ts -g 'V14 Case C'

# Resume after timeout, stall, device loss, browser closure, or operator interruption.
$env:AEROFLOW_RUN_OPERATION='resume'
$env:AEROFLOW_RUN_ID='<id printed by the fresh run>'
npx playwright test -c apps/studio/playwright.config.ts --project=gpu apps/studio/e2e/aij-urban.gpu.spec.ts -g 'V14 Case C'

# Inspect lifecycle, owner, configuration, latest progress/evidence, and termination.
node scripts/validation-runs.mjs inspect $env:AEROFLOW_RUN_ID

# Cleanup is path-validated and normally requires a committed terminal artifact.
node scripts/validation-runs.mjs cleanup $env:AEROFLOW_RUN_ID
```

An active owner rejects resume. A dead owner also rejects resume until the operator makes
the takeover explicit with `AEROFLOW_TAKE_OVER_STALE=1`; the prior pid/host is retained in
`lifecycle.json`. Cleanup never runs automatically after failure. `cleanup --force` exists
only for an explicit operator discard of an incomplete run.

A partial artifact has `complete: false` and a termination reason such as `timeout`,
`stalled`, `device-lost`, `aborted`, `browser-closed`, or `unexpected-error`. Its lifecycle
records the last step/phase heartbeat, latest complete checkpoint, last artifact update,
device-loss observation, and captured error. `stalled` means only that the observed progress
and phase activity stopped for the configured interval; it does not diagnose a GPU, CPU,
checkpoint, or scorer root cause. The profile is retained so `resume` can continue from the
latest verified complete checkpoint.

The recovery contract itself is exercised by the bounded 12,000-cell
`aij-urban-recovery.gpu.spec.ts`: it checkpoints, replaces the persistent context, verifies
the exact restored step and averaging-sample count, advances, checks incompatible/fresh
identity rejection, and corrupts the newest slot to prove fallback to the previous complete
checkpoint. It runs inside the ordinary ten-minute end-to-end budget. No production-duration
Case C/M9 run and no naturally occurring intermittent stall is required for this proof.

### Operation liveness, committed progress, and automatic retries

Validation artifact schema 2 records `submittedStep` and `completedStep` separately. Encoding
and queue submission advance the first value; only a successful `queue.onSubmittedWorkDone()`
boundary advances the second. Checkpoint, probe sampling, health evaluation, scoring, and normal
completion require equality. A failed attempt with `submittedStep > completedStep` is quarantined;
its parity and GPU resources are not reused.

The `lifecycle.operations` array is the ordered operation timeline. Each record names the logical
run, browser/device attempt, phase, deadline, direct observations, terminal outcome, submitted and
completed ranges, and measured wall/GPU duration when available. Queue work and staging-buffer
mapping are separate operations, so a successful queue boundary followed by a stuck map is
`readback-timeout`, not `queue-timeout`.

| Classification          | Direct boundary that failed                               | Automatic retry |
| ----------------------- | --------------------------------------------------------- | --------------- |
| `device-lost`           | `device.lost` settled during an owned operation           | yes             |
| `queue-timeout`         | submitted queue-completion promise missed its deadline    | yes             |
| `readback-timeout`      | probe or health staging map missed its deadline           | yes             |
| `checkpoint-io-timeout` | one bounded checkpoint transfer or IndexedDB write failed | no              |
| `scoring-timeout`       | CPU scoring phase missed its deadline                     | no              |
| `webgpu-error`          | owned error scope or uncaptured WebGPU error fired        | no              |
| `application-error`     | an ordinary application promise rejected                  | no              |

Automatic recovery requires a complete compatible checkpoint. The default permits two replacement
attempts across one logical run and one consecutive recovery from the same checkpoint. Completed
progress beyond the restored step resets only the same-checkpoint counter; it does not erase total
attempt history. `no-checkpoint`, `retry-exhausted`, and every non-recoverable classification remain
terminal and preserve the profile plus partial schema-2 artifact for inspection.

Inspect the last responsive boundary and in-flight range with PowerShell:

```powershell
$artifact = Get-Content -Raw .aeroflow/runs/<run-id>/validation-artifact.json | ConvertFrom-Json
$artifact.lifecycle.progress
$artifact.lifecycle.operations | Select-Object -Last 5
$artifact.lifecycle.attempts
$artifact.lifecycle.diagnosticConfidence
```

`diagnosticConfidence.directObservations` and `derivedClassifications` report what the harness saw.
TDR, driver reset, browser scheduling, silent device loss, and hardware failure remain in
`unconfirmedHypotheses` unless external or WebGPU evidence establishes one of them.
