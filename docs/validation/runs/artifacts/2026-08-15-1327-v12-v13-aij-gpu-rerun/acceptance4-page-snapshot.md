# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: aij.gpu.spec.ts >> acceptance 4: Case A hit rate q ≥ 0.66 and Pearson r ≥ 0.70 on the real grid
- Location: apps\studio\e2e\aij.gpu.spec.ts:112:1

# Error details

```
Error: INCONCLUSIVE: aij-score produced no verdict — no steadiness within 25 min. Last seen: drift 0.5231470237282906, driftScaled 0.021891973281002088, 9 windows, 114724 steps. The gate was NOT evaluated — read the attached trace. Fix the budget or the steadiness predicate; never the gate.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - 'heading "M10 — ABL wind tunnel: AIJ Case A (1:1:2 building)" [level=2] [ref=e3]'
    - paragraph [ref=e4]: "VDI 3783/9 gates: hit rate q ≥ 0.66 (allowed 0.25), Pearson r ≥ 0.70 on time-averaged mean speeds; empty-domain fetch ≤ 5%. Screening-grade LES, never compliance-grade."
    - generic [ref=e5]:
      - button "Run Case A (score)" [disabled] [ref=e6] [cursor=pointer]
      - button "Empty-domain fetch check" [disabled] [ref=e7] [cursor=pointer]
      - button "Demo scene" [disabled] [ref=e8] [cursor=pointer]
      - button "Stop" [ref=e9] [cursor=pointer]
      - combobox [ref=e10] [cursor=pointer]:
        - option "16 cells / b"
        - option "24 cells / b" [selected]
        - option "32 cells / b"
        - option "24 cells / b (e2e override)"
    - generic [ref=e11]:
      - generic [ref=e12]:
        - text: wind
        - slider "wind 0°" [ref=e13]: "0"
        - text: 0°
      - generic [ref=e14]:
        - text: profile
        - combobox "profile" [ref=e15] [cursor=pointer]:
          - option "power law" [selected]
          - option "log law"
      - generic [ref=e16]:
        - text: α
        - spinbutton "α" [ref=e17]: "0.25"
      - generic [ref=e18]:
        - text: z0 (m)
        - spinbutton "z0 (m)" [ref=e19]: "0.5"
      - generic [ref=e20]:
        - text: uRef (m/s)
        - spinbutton "uRef (m/s)" [ref=e21]: "6"
      - generic [ref=e22]:
        - text: zRef (m)
        - spinbutton "zRef (m)" [ref=e23]: "10"
    - generic [ref=e25]: "mode score grid 744×144×267 = 28.6M cells dx 3.3 mm building b=24 H=48 cells wind 0° blockage 3.19% τ 0.500334 (LES+regularized) u_lat 0.08 T_conv 863 steps averaging: cumulative time-mean after a 3-flow-through transient discard (AIJ ≥10 flow-throughs) step 114,896 windows 9 driftScaled 2.19% (raw drift 52.31% @node 41) steady not yet"
    - generic [ref=e26]: q 0.659 r 0.850 (not steady yet — no verdict)
    - generic [ref=e28]: point (x, y, z m) measured sim hit (-0.06, 0.00, 0.010) 0.157 0.115 ✓ (-0.06, 0.00, 0.040) 0.314 0.292 ✓ (-0.06, 0.00, 0.080) 0.320 0.251 ✓ (-0.06, 0.00, 0.120) 0.386 0.323 ✓ (-0.06, 0.00, 0.140) 0.497 0.454 ✓ (-0.06, 0.00, 0.160) 0.741 0.672 ✓ (-0.06, 0.00, 0.170) 0.865 0.791 ✓ (-0.06, 0.00, 0.190) 1.031 0.983 ✓ (-0.06, 0.00, 0.220) 1.109 1.059 ✓ (-0.06, 0.00, 0.280) 1.192 1.184 ✓ (-0.04, 0.00, 0.170) 1.113 1.087 ✓ (-0.04, 0.00, 0.190) 1.126 1.053 ✓ (-0.04, 0.00, 0.220) 1.148 1.095 ✓ (-0.04, 0.00, 0.280) 1.203 1.195 ✓ (-0.02, 0.00, 0.170) 0.380 0.030 ✗ (-0.02, 0.00, 0.190) 1.254 1.111 ✓ (-0.02, 0.00, 0.220) 1.175 1.133 ✓ (-0.02, 0.00, 0.280) 1.206 1.208 ✓ (0.00, 0.00, 0.170) 0.283 0.066 ✓ (0.00, 0.00, 0.190) 1.217 1.185 ✓ (0.00, 0.00, 0.220) 1.182 1.165 ✓ (0.00, 0.00, 0.280) 1.203 1.221 ✓ (0.04, 0.00, 0.170) 0.615 0.021 ✗ (0.04, 0.00, 0.190) 1.078 0.522 ✗ (0.04, 0.00, 0.220) 1.161 1.200 ✓ (0.04, 0.00, 0.280) 1.226 1.243 ✓ (0.06, 0.00, 0.010) 0.160 0.061 ✓ (0.06, 0.00, 0.040) 0.154 0.190 ✓ (0.06, 0.00, 0.080) 0.169 0.195 ✓ (0.06, 0.00, 0.120) 0.160 0.240 ✓ (0.06, 0.00, 0.140) 0.122 0.239 ✓ (0.06, 0.00, 0.160) 0.512 0.221 ✗ (0.06, 0.00, 0.170) 0.785 0.177 ✗ (0.06, 0.00, 0.190) 1.050 0.429 ✗ (0.06, 0.00, 0.220) 1.162 1.210 ✓ (0.06, 0.00, 0.280) 1.217 1.250 ✓ (0.10, 0.00, 0.010) 0.180 0.172 ✓ (0.10, 0.00, 0.040) 0.185 0.353 ✓ (0.10, 0.00, 0.080) 0.147 0.305 ✓ (0.10, 0.00, 0.120) 0.041 0.170 ✓ (0.10, 0.00, 0.140) 0.175 0.062 ✓ (0.10, 0.00, 0.160) 0.694 0.091 ✗ (0.10, 0.00, 0.170) 0.856 0.185 ✗ (0.10, 0.00, 0.190) 1.037 0.558 ✗ (0.10, 0.00, 0.220) 1.140 1.215 ✓ (0.10, 0.00, 0.280) 1.196 1.256 ✓ (0.16, 0.00, 0.010) 0.067 0.329 ✗ (0.16, 0.00, 0.040) 0.107 0.417 ✗ (0.16, 0.00, 0.080) 0.172 0.335 ✓ (0.16, 0.00, 0.120) 0.332 0.189 ✓ (0.16, 0.00, 0.140) 0.512 0.109 ✗ (0.16, 0.00, 0.160) 0.743 0.191 ✗ (0.16, 0.00, 0.170) 0.859 0.321 ✗ (0.16, 0.00, 0.190) 1.019 0.713 ✗ (0.16, 0.00, 0.220) 1.099 1.179 ✓ (0.16, 0.00, 0.280) 1.202 1.247 ✓ (0.26, 0.00, 0.010) 0.312 0.125 ✓ (0.26, 0.00, 0.040) 0.410 0.077 ✗ (0.26, 0.00, 0.080) 0.529 0.059 ✗ (0.26, 0.00, 0.120) 0.647 0.235 ✗ (0.26, 0.00, 0.140) 0.748 0.366 ✗ (0.26, 0.00, 0.160) 0.861 0.521 ✗ (0.26, 0.00, 0.170) 0.913 0.613 ✗ (0.26, 0.00, 0.190) 1.017 0.828 ✓ (0.26, 0.00, 0.220) 1.087 1.112 ✓ (0.26, 0.00, 0.280) 1.190 1.216 ✓ (-0.06, 0.00, 0.010) 0.177 0.115 ✓ (-0.06, -0.02, 0.010) 0.239 0.249 ✓ (-0.06, -0.04, 0.010) 0.420 0.480 ✓ (-0.06, -0.05, 0.010) 0.498 0.548 ✓ (-0.06, -0.07, 0.010) 0.586 0.524 ✓ (-0.06, -0.09, 0.010) 0.669 0.519 ✓ (-0.06, -0.12, 0.010) 0.720 0.466 ✗ (-0.06, -0.16, 0.010) 0.744 0.417 ✗ (-0.04, -0.05, 0.010) 0.960 0.822 ✓ (-0.04, -0.07, 0.010) 0.759 0.719 ✓ (-0.04, -0.09, 0.010) 0.725 0.598 ✓ (-0.04, -0.12, 0.010) 0.747 0.509 ✓ (-0.04, -0.16, 0.010) 0.756 0.438 ✗ (-0.02, -0.05, 0.010) 0.171 0.192 ✓ (-0.02, -0.07, 0.010) 0.880 0.802 ✓ (-0.02, -0.09, 0.010) 0.799 0.666 ✓ (-0.02, -0.12, 0.010) 0.781 0.541 ✓ (-0.02, -0.16, 0.010) 0.784 0.451 ✗ (0.00, -0.05, 0.010) 0.194 0.050 ✓ (0.00, -0.07, 0.010) 0.764 0.816 ✓ (0.00, -0.09, 0.010) 0.828 0.717 ✓ (0.00, -0.12, 0.010) 0.802 0.542 ✗ (0.00, -0.16, 0.010) 0.801 0.456 ✗ (0.04, -0.05, 0.010) 0.330 0.027 ✗ (0.04, -0.07, 0.010) 0.668 0.570 ✓ (0.04, -0.09, 0.010) 0.803 0.745 ✓ (0.04, -0.12, 0.010) 0.829 0.558 ✗ (0.04, -0.16, 0.010) 0.812 0.449 ✗ (0.06, 0.00, 0.010) 0.152 0.061 ✓ (0.06, -0.02, 0.010) 0.137 0.119 ✓ (0.06, -0.04, 0.010) 0.132 0.141 ✓ (0.06, -0.05, 0.010) 0.399 0.133 ✗ (0.06, -0.07, 0.010) 0.657 0.496 ✓ (0.06, -0.09, 0.010) 0.777 0.780 ✓ (0.06, -0.12, 0.010) 0.823 0.566 ✗ (0.06, -0.16, 0.010) 0.814 0.446 ✗ (0.10, 0.00, 0.010) 0.153 0.172 ✓ (0.10, -0.02, 0.010) 0.061 0.151 ✓ (0.10, -0.04, 0.010) 0.260 0.043 ✓ (0.10, -0.05, 0.010) 0.399 0.084 ✗ (0.10, -0.07, 0.010) 0.633 0.397 ✓ (0.10, -0.09, 0.010) 0.727 0.709 ✓ (0.10, -0.12, 0.010) 0.800 0.561 ✓ (0.10, -0.16, 0.010) 0.811 0.431 ✗ (0.16, 0.00, 0.010) 0.057 0.329 ✗ (0.16, -0.02, 0.010) 0.130 0.295 ✓ (0.16, -0.04, 0.010) 0.289 0.150 ✓ (0.16, -0.05, 0.010) 0.357 0.102 ✗ (0.16, -0.07, 0.010) 0.519 0.337 ✓ (0.16, -0.09, 0.010) 0.626 0.536 ✓ (0.16, -0.12, 0.010) 0.729 0.487 ✓ (0.16, -0.16, 0.010) 0.790 0.382 ✗ (0.26, 0.00, 0.010) 0.308 0.125 ✓ (0.26, -0.02, 0.010) 0.329 0.103 ✓ (0.26, -0.04, 0.010) 0.377 0.066 ✗ (0.26, -0.05, 0.010) 0.404 0.092 ✗ (0.26, -0.07, 0.010) 0.472 0.186 ✗ (0.26, -0.09, 0.010) 0.550 0.304 ✓ (0.26, -0.12, 0.010) 0.640 0.368 ✗ (0.26, -0.16, 0.010) 0.723 0.310 ✗
    - contentinfo [ref=e29]:
      - paragraph [ref=e30]: "Cite: Kikumoto, H., Okaze, T., Yoshie, R., Tachibana, T., Ishihara, T., Nonomura, Y., Kiyota, N., Kondo, H., Mochida, A. & Tominaga, Y. (2026), \"Comprehensive Experimental Database for Validating CFD Simulations in Urban Wind Environment: Benchmark Cases Curated by the Architectural Institute of Japan\", Japan Architectural Review 9(1), e70083. https://doi.org/10.1002/2475-8876.70083 | Meng, Y. & Hibi, K. (1998), \"Turbulent measurements of the flow field around a high-rise building\", Wind Engineers, JAWE 1998(76), 55-64. https://doi.org/10.5359/jawe.1998.76_55 | Tominaga, Y., Mochida, A., Yoshie, R., Kataoka, H., Nozu, T., Yoshikawa, M. & Shirasawa, T. (2008), \"AIJ guidelines for practical applications of CFD to pedestrian wind environment around buildings\", J. Wind Eng. Ind. Aerodyn. 96(10-11), 1749-1761. https://doi.org/10.1016/j.jweia.2008.02.058"
      - paragraph [ref=e31]: These derived files were created and processed independently for AeroFlow. The Architectural Institute of Japan (AIJ) does not guarantee their quality, accuracy, completeness, or suitability for any particular purpose.
  - group [ref=e32]:
    - generic "AeroFlow · AIJ Case A (validation)" [ref=e33] [cursor=pointer]
```

# Test source

```ts
  1   | import { test, expect, BASE_URL } from './fixtures/gpu';
  2   | import { readHooks } from './helpers/hooks';
  3   | import type { Page, TestInfo } from '@playwright/test';
  4   | 
  5   | /**
  6   |  * Real-GPU M10 acceptance runs on the ?aij page (Tier B, Ampere over CDP).
  7   |  *  - Acceptance 3: empty-domain fetch ≤ 5% at the building station, full 16-cells/b
  8   |  *    grid, judged only once the steadiness criterion holds.
  9   |  *  - Acceptance 4: Case A q/r against the real Meng & Hibi fixture (landed 2026-07-20),
  10  |  *    judged only once the windowed means are steady.
  11  |  *  - Case A at 16 cells/b: RECORDING ONLY, no verdict. The low-resolution half of the
  12  |  *    resolution-convergence pair (fix-confirmed-physics-defects task 7.6). See its own
  13  |  *    comment for why it asserts no band.
  14  |  *
  15  |  * Both gates are judged on TIME MEANS, so both wait for steadiness first. The
  16  |  * 2026-07-20 attempt at acceptance 3 timed out with the predicate still false: the gate
  17  |  * was never evaluated, and the run produced no information about how much longer it
  18  |  * needed. Every wait here therefore attaches the convergence trace (drift vs step count,
  19  |  * one entry per completed window) whether it converges or not, so a timeout is a
  20  |  * MEASUREMENT that sets the next budget. A timeout is reported as INCONCLUSIVE, never as
  21  |  * a physics failure — and the fix is the budget, never the gate (Hard rule 3).
  22  |  *
  23  |  * Record the printed numbers in the M10 status log after a green run.
  24  |  */
  25  | 
  26  | const POLL_TIMEOUT = 25 * 60_000;
  27  | 
  28  | type Aij = NonNullable<Awaited<ReturnType<typeof readHooks>>['aij']>;
  29  | 
  30  | /** Format the convergence trace as a readable table for the run artifact. */
  31  | function formatTrace(a: Aij | undefined): string {
  32  |   const t = a?.trace ?? [];
  33  |   if (t.length === 0) return 'no completed averaging windows — run never reached one.';
  34  |   const head = 'window   steps        drift        driftScaled  driftIdx  fetchMaxRel   q';
  35  |   const fmt = (x: number | undefined) =>
  36  |     x === undefined || !Number.isFinite(x) ? '—' : x.toExponential(3);
  37  |   const rows = t.map(
  38  |     (s) =>
  39  |       `${String(s.windows).padEnd(8)} ${String(s.steps).padEnd(12)} ` +
  40  |       `${fmt(s.drift)}`.padEnd(13) +
  41  |       `${fmt(s.driftScaled)}`.padEnd(13) +
  42  |       `${String(s.driftIndex ?? -1)}`.padEnd(10) +
  43  |       `${s.fetchMaxRel !== undefined ? (s.fetchMaxRel * 100).toFixed(2) + '%' : '—'}`.padEnd(14) +
  44  |       `${s.q !== undefined ? s.q.toFixed(3) : '—'}`,
  45  |   );
  46  |   return [head, ...rows].join('\n');
  47  | }
  48  | 
  49  | /**
  50  |  * Wait for steadiness, ALWAYS attaching the convergence trace. Returns the final
  51  |  * readout; throws with an explicit INCONCLUSIVE message on timeout.
  52  |  */
  53  | async function awaitSteady(
  54  |   page: Page,
  55  |   testInfo: TestInfo,
  56  |   name: string,
  57  |   ready: (a: Aij) => boolean,
  58  | ): Promise<Aij> {
  59  |   // Keep the newest readout seen DURING polling. The 2026-07-20 run died mid-poll (the
  60  |   // tab was closed) and the previous version re-read the page afterwards to build the
  61  |   // artifact — that read threw, so the trace was lost exactly when it was most needed.
  62  |   // Never re-read a page that may be gone; snapshot as you go.
  63  |   let latest: Aij | undefined;
  64  |   let failure: unknown;
  65  |   try {
  66  |     await expect
  67  |       .poll(
  68  |         async () => {
  69  |           const a = (await readHooks(page)).aij;
  70  |           if (a) latest = a;
  71  |           return a && a.steady && ready(a) ? a : null;
  72  |         },
  73  |         { timeout: POLL_TIMEOUT },
  74  |       )
  75  |       .not.toBeNull();
  76  |   } catch (e) {
  77  |     failure = e;
  78  |   }
  79  |   await testInfo.attach(`${name}-convergence`, {
  80  |     body: formatTrace(latest),
  81  |     contentType: 'text/plain',
> 82  |   });
      |           ^ Error: INCONCLUSIVE: aij-score produced no verdict — no steadiness within 25 min. Last seen: drift 0.5231470237282906, driftScaled 0.021891973281002088, 9 windows, 114724 steps. The gate was NOT evaluated — read the attached trace. Fix the budget or the steadiness predicate; never the gate.
  83  |   if (failure) {
  84  |     const dead = String(failure).includes('has been closed');
  85  |     throw new Error(
  86  |       `INCONCLUSIVE: ${name} produced no verdict — ` +
  87  |         (dead
  88  |           ? 'the page was closed mid-run (browser gone, not a physics result). '
  89  |           : `no steadiness within ${POLL_TIMEOUT / 60_000} min. `) +
  90  |         `Last seen: drift ${latest?.drift}, driftScaled ${latest?.trace?.at(-1)?.driftScaled}, ` +
  91  |         `${latest?.windows ?? 0} windows, ${latest?.totalSteps ?? 0} steps. ` +
  92  |         `The gate was NOT evaluated — read the attached trace. Fix the budget or the ` +
  93  |         `steadiness predicate; never the gate.`,
  94  |     );
  95  |   }
  96  |   return latest!;
  97  | }
  98  | 
  99  | test('acceptance 3: empty-domain fetch gate ≤ 5% on the real grid', async ({
  100 |   gpuPage: page,
  101 | }, testInfo) => {
  102 |   test.setTimeout(30 * 60_000);
  103 |   await page.goto(`${BASE_URL}/?aij`);
  104 |   await page.getByTestId('aij-fetch').click();
  105 |   const a = await awaitSteady(page, testInfo, 'aij-fetch', (x) => x.fetchMaxRel !== undefined);
  106 |   await testInfo.attach('aij-fetch', {
  107 |     body:
  108 |       `steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); ` +
  109 |       `max profile deviation ${((a.fetchMaxRel ?? NaN) * 100).toFixed(2)}% (gate 5%)`,
  110 |     contentType: 'text/plain',
  111 |   });
  112 |   expect(a.fetchPass).toBe(true);
  113 | });
  114 | 
  115 | test('acceptance 4: Case A hit rate q ≥ 0.66 and Pearson r ≥ 0.70 on the real grid', async ({
  116 |   gpuPage: page,
  117 | }, testInfo) => {
  118 |   test.setTimeout(30 * 60_000);
  119 |   // 24 cells/b, not the page default of 16. The criterion is defined at the resolution
  120 |   // that resolves the probe plane: at 16 cells/b the 2 m measurement plane falls below
  121 |   // the 3rd fluid node, which is why that grid scores q 0.532 (the acceptance ledger, M10
  122 |   // resolution-convergence story). Navigating to the bare `?aij` ran the gate at a
  123 |   // resolution the criterion was never written for. This pins the acceptance
  124 |   // configuration; it does not touch the q/r bars below (Hard rule 3).
  125 |   await page.goto(`${BASE_URL}/?aij&b=24`);
  126 |   await page.getByTestId('aij-score').click();
  127 |   const a = await awaitSteady(page, testInfo, 'aij-score', (x) => x.q !== undefined);
  128 |   await testInfo.attach('aij-score', {
  129 |     body: `q ${a.q} (gate ≥ 0.66); r ${a.r} (gate ≥ 0.70); steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); synthetic ${a.synthetic}; underResolved ${a.underResolved}`,
  130 |     contentType: 'text/plain',
  131 |   });
  132 |   // Guard the guards: a verdict is only meaningful on real data at full resolution.
  133 |   expect(a.synthetic).toBe(false);
  134 |   expect(a.underResolved).toBe(false);
  135 |   expect(a.q!).toBeGreaterThanOrEqual(0.66);
  136 |   expect(a.r!).toBeGreaterThanOrEqual(0.7);
  137 | });
  138 | 
  139 | /**
  140 |  * Case A at 16 cells/b — RECORDING ONLY, deliberately asserting no acceptance band.
  141 |  *
  142 |  * This is the low-resolution half of the pair task 7.6 asks for ("rescore V13 Case A at 16
  143 |  * and 24 cells/b with the corrected mapping"). It exists to answer one question: did the
  144 |  * height-mapping fix move the resolution-convergence story, or only the acceptance point?
  145 |  *
  146 |  * **Why no band is asserted here, and why that is not a weakened gate (Hard rule 3).**
  147 |  * V13's `q ≥ 0.66` / `r ≥ 0.70` is defined at the resolution that resolves the probe plane.
  148 |  * At 16 cells/b the 2 m measurement plane sits below the third fluid node, so the grid
  149 |  * scores ≈ 0.532 by construction — that number is the *evidence for* the acceptance
  150 |  * resolution being 24, not a failure of the physics. Asserting the band here would gate a
  151 |  * configuration the criterion was never written for. The acceptance gate is the test above,
  152 |  * at b=24, and it is untouched.
  153 |  *
  154 |  * Note `underResolved` is false at exactly 16 (`MIN_CELLS_PER_B = 16`), so the page does
  155 |  * produce q/r rather than suppressing the verdict — the plane is under-resolved, the *grid*
  156 |  * is not. Both are still asserted below, because a recording is only worth keeping if it
  157 |  * came from real fixture data on the grid it claims.
  158 |  */
  159 | test('V13 Case A at 16 cells/b — recorded, not gated (resolution-convergence point)', async ({
  160 |   gpuPage: page,
  161 | }, testInfo) => {
  162 |   test.setTimeout(30 * 60_000);
  163 |   await page.goto(`${BASE_URL}/?aij&b=16`);
  164 |   await page.getByTestId('aij-score').click();
  165 |   const a = await awaitSteady(page, testInfo, 'aij-score-b16', (x) => x.q !== undefined);
  166 |   await testInfo.attach('aij-score-b16', {
  167 |     body:
  168 |       `RECORDED, NOT GATED — 16 cells/b, below the resolution the V13 band is defined at.\n` +
  169 |       `q ${a.q}; r ${a.r}; steady driftScaled ${a.trace?.at(-1)?.driftScaled} ` +
  170 |       `(raw drift ${a.drift}); synthetic ${a.synthetic}; underResolved ${a.underResolved}; ` +
  171 |       `windows ${a.windows}; totalSteps ${a.totalSteps}\n` +
  172 |       `Compare against the pre-fix reference q ≈ 0.532 at this resolution, and against the ` +
  173 |       `b=24 acceptance run in the same session.`,
  174 |     contentType: 'text/plain',
  175 |   });
  176 |   // Real data, real grid — the two things that would make the recording meaningless.
  177 |   expect(a.synthetic).toBe(false);
  178 |   expect(a.underResolved).toBe(false);
  179 |   // No band assertion: see the comment above.
  180 |   expect(a.q).toBeDefined();
  181 |   expect(a.r).toBeDefined();
  182 | });
```