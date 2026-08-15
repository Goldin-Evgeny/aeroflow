# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: aij.gpu.spec.ts >> acceptance 3: empty-domain fetch gate ≤ 5% on the real grid
- Location: apps\studio\e2e\aij.gpu.spec.ts:96:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
        - option "16 cells / b" [selected]
        - option "24 cells / b"
        - option "32 cells / b"
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
    - generic [ref=e25]: "mode fetch grid 496×96×178 = 8.5M cells dx 5.0 mm building b=16 H=32 cells wind 0° blockage 0.00% τ 0.500223 (LES+regularized) u_lat 0.08 T_conv 574 steps averaging: cumulative time-mean after a 3-flow-through transient discard (AIJ ≥10 flow-throughs) step 43,890 windows 4 driftScaled 0.96% (raw drift 4.32% @node 2) steady YES"
    - generic [ref=e26]: FAIL max deviation 66.19% (gate ≤ 5%, node 2 → H)
    - generic [ref=e28]: node y sim u inlet u rel 2 0.011909 0.035222 66.19% 3 0.025094 0.037144 32.44% 4 0.032354 0.038633 16.25% 5 0.037035 0.039780 6.90% 6 0.040814 0.040586 0.56% 7 0.043230 0.041392 4.44% 8 0.044514 0.042198 5.49% 9 0.045128 0.042899 5.20% 10 0.045611 0.043494 4.87% 11 0.046051 0.044090 4.45% 12 0.046454 0.044685 3.96% 13 0.046901 0.045288 3.56% 14 0.047390 0.045899 3.25% 15 0.047919 0.046510 3.03% 16 0.048490 0.047120 2.91% 17 0.049045 0.047731 2.75% 18 0.049550 0.048342 2.50% 19 0.050027 0.048953 2.20% 20 0.050506 0.049564 1.90% 21 0.050986 0.050162 1.64% 22 0.051478 0.050748 1.44% 23 0.052016 0.051334 1.33% 24 0.052610 0.051920 1.33% 25 0.053207 0.052449 1.45% 26 0.053742 0.052920 1.55% 27 0.054203 0.053391 1.52% 28 0.054625 0.053862 1.42% 29 0.055014 0.054298 1.32% 30 0.055335 0.054698 1.16% 31 0.055594 0.055098 0.90% 32 0.055851 0.055498 0.64% 33 0.056154 0.055766 0.70%
    - contentinfo [ref=e29]:
      - paragraph [ref=e30]: "Cite: Kikumoto, H., Okaze, T., Yoshie, R., Tachibana, T., Ishihara, T., Nonomura, Y., Kiyota, N., Kondo, H., Mochida, A. & Tominaga, Y. (2026), \"Comprehensive Experimental Database for Validating CFD Simulations in Urban Wind Environment: Benchmark Cases Curated by the Architectural Institute of Japan\", Japan Architectural Review 9(1), e70083. https://doi.org/10.1002/2475-8876.70083 | Meng, Y. & Hibi, K. (1998), \"Turbulent measurements of the flow field around a high-rise building\", Wind Engineers, JAWE 1998(76), 55-64. https://doi.org/10.5359/jawe.1998.76_55 | Tominaga, Y., Mochida, A., Yoshie, R., Kataoka, H., Nozu, T., Yoshikawa, M. & Shirasawa, T. (2008), \"AIJ guidelines for practical applications of CFD to pedestrian wind environment around buildings\", J. Wind Eng. Ind. Aerodyn. 96(10-11), 1749-1761. https://doi.org/10.1016/j.jweia.2008.02.058"
      - paragraph [ref=e31]: These derived files were created and processed independently for AeroFlow. The Architectural Institute of Japan (AIJ) does not guarantee their quality, accuracy, completeness, or suitability for any particular purpose.
  - group [ref=e32]:
    - generic "AeroFlow · AIJ Case A (validation)" [ref=e33] [cursor=pointer]
```

# Test source

```ts
  9   |  *  - Acceptance 4: Case A q/r against the real Meng & Hibi fixture (landed 2026-07-20),
  10  |  *    judged only once the windowed means are steady.
  11  |  *
  12  |  * Both gates are judged on TIME MEANS, so both wait for steadiness first. The
  13  |  * 2026-07-20 attempt at acceptance 3 timed out with the predicate still false: the gate
  14  |  * was never evaluated, and the run produced no information about how much longer it
  15  |  * needed. Every wait here therefore attaches the convergence trace (drift vs step count,
  16  |  * one entry per completed window) whether it converges or not, so a timeout is a
  17  |  * MEASUREMENT that sets the next budget. A timeout is reported as INCONCLUSIVE, never as
  18  |  * a physics failure — and the fix is the budget, never the gate (Hard rule 3).
  19  |  *
  20  |  * Record the printed numbers in the M10 status log after a green run.
  21  |  */
  22  | 
  23  | const POLL_TIMEOUT = 25 * 60_000;
  24  | 
  25  | type Aij = NonNullable<Awaited<ReturnType<typeof readHooks>>['aij']>;
  26  | 
  27  | /** Format the convergence trace as a readable table for the run artifact. */
  28  | function formatTrace(a: Aij | undefined): string {
  29  |   const t = a?.trace ?? [];
  30  |   if (t.length === 0) return 'no completed averaging windows — run never reached one.';
  31  |   const head = 'window   steps        drift        driftScaled  driftIdx  fetchMaxRel   q';
  32  |   const fmt = (x: number | undefined) =>
  33  |     x === undefined || !Number.isFinite(x) ? '—' : x.toExponential(3);
  34  |   const rows = t.map(
  35  |     (s) =>
  36  |       `${String(s.windows).padEnd(8)} ${String(s.steps).padEnd(12)} ` +
  37  |       `${fmt(s.drift)}`.padEnd(13) +
  38  |       `${fmt(s.driftScaled)}`.padEnd(13) +
  39  |       `${String(s.driftIndex ?? -1)}`.padEnd(10) +
  40  |       `${s.fetchMaxRel !== undefined ? (s.fetchMaxRel * 100).toFixed(2) + '%' : '—'}`.padEnd(14) +
  41  |       `${s.q !== undefined ? s.q.toFixed(3) : '—'}`,
  42  |   );
  43  |   return [head, ...rows].join('\n');
  44  | }
  45  | 
  46  | /**
  47  |  * Wait for steadiness, ALWAYS attaching the convergence trace. Returns the final
  48  |  * readout; throws with an explicit INCONCLUSIVE message on timeout.
  49  |  */
  50  | async function awaitSteady(
  51  |   page: Page,
  52  |   testInfo: TestInfo,
  53  |   name: string,
  54  |   ready: (a: Aij) => boolean,
  55  | ): Promise<Aij> {
  56  |   // Keep the newest readout seen DURING polling. The 2026-07-20 run died mid-poll (the
  57  |   // tab was closed) and the previous version re-read the page afterwards to build the
  58  |   // artifact — that read threw, so the trace was lost exactly when it was most needed.
  59  |   // Never re-read a page that may be gone; snapshot as you go.
  60  |   let latest: Aij | undefined;
  61  |   let failure: unknown;
  62  |   try {
  63  |     await expect
  64  |       .poll(
  65  |         async () => {
  66  |           const a = (await readHooks(page)).aij;
  67  |           if (a) latest = a;
  68  |           return a && a.steady && ready(a) ? a : null;
  69  |         },
  70  |         { timeout: POLL_TIMEOUT },
  71  |       )
  72  |       .not.toBeNull();
  73  |   } catch (e) {
  74  |     failure = e;
  75  |   }
  76  |   await testInfo.attach(`${name}-convergence`, {
  77  |     body: formatTrace(latest),
  78  |     contentType: 'text/plain',
  79  |   });
  80  |   if (failure) {
  81  |     const dead = String(failure).includes('has been closed');
  82  |     throw new Error(
  83  |       `INCONCLUSIVE: ${name} produced no verdict — ` +
  84  |         (dead
  85  |           ? 'the page was closed mid-run (browser gone, not a physics result). '
  86  |           : `no steadiness within ${POLL_TIMEOUT / 60_000} min. `) +
  87  |         `Last seen: drift ${latest?.drift}, driftScaled ${latest?.trace?.at(-1)?.driftScaled}, ` +
  88  |         `${latest?.windows ?? 0} windows, ${latest?.totalSteps ?? 0} steps. ` +
  89  |         `The gate was NOT evaluated — read the attached trace. Fix the budget or the ` +
  90  |         `steadiness predicate; never the gate.`,
  91  |     );
  92  |   }
  93  |   return latest!;
  94  | }
  95  | 
  96  | test('acceptance 3: empty-domain fetch gate ≤ 5% on the real grid', async ({
  97  |   gpuPage: page,
  98  | }, testInfo) => {
  99  |   test.setTimeout(30 * 60_000);
  100 |   await page.goto(`${BASE_URL}/?aij`);
  101 |   await page.getByTestId('aij-fetch').click();
  102 |   const a = await awaitSteady(page, testInfo, 'aij-fetch', (x) => x.fetchMaxRel !== undefined);
  103 |   await testInfo.attach('aij-fetch', {
  104 |     body:
  105 |       `steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); ` +
  106 |       `max profile deviation ${((a.fetchMaxRel ?? NaN) * 100).toFixed(2)}% (gate 5%)`,
  107 |     contentType: 'text/plain',
  108 |   });
> 109 |   expect(a.fetchPass).toBe(true);
      |                       ^ Error: expect(received).toBe(expected) // Object.is equality
  110 | });
  111 | 
  112 | test('acceptance 4: Case A hit rate q ≥ 0.66 and Pearson r ≥ 0.70 on the real grid', async ({
  113 |   gpuPage: page,
  114 | }, testInfo) => {
  115 |   test.setTimeout(30 * 60_000);
  116 |   // 24 cells/b, not the page default of 16. The criterion is defined at the resolution
  117 |   // that resolves the probe plane: at 16 cells/b the 2 m measurement plane falls below
  118 |   // the 3rd fluid node, which is why that grid scores q 0.532 (the acceptance ledger, M10
  119 |   // resolution-convergence story). Navigating to the bare `?aij` ran the gate at a
  120 |   // resolution the criterion was never written for. This pins the acceptance
  121 |   // configuration; it does not touch the q/r bars below (Hard rule 3).
  122 |   await page.goto(`${BASE_URL}/?aij&b=24`);
  123 |   await page.getByTestId('aij-score').click();
  124 |   const a = await awaitSteady(page, testInfo, 'aij-score', (x) => x.q !== undefined);
  125 |   await testInfo.attach('aij-score', {
  126 |     body: `q ${a.q} (gate ≥ 0.66); r ${a.r} (gate ≥ 0.70); steady driftScaled ${a.trace?.at(-1)?.driftScaled} (raw drift ${a.drift}); synthetic ${a.synthetic}; underResolved ${a.underResolved}`,
  127 |     contentType: 'text/plain',
  128 |   });
  129 |   // Guard the guards: a verdict is only meaningful on real data at full resolution.
  130 |   expect(a.synthetic).toBe(false);
  131 |   expect(a.underResolved).toBe(false);
  132 |   expect(a.q!).toBeGreaterThanOrEqual(0.66);
  133 |   expect(a.r!).toBeGreaterThanOrEqual(0.7);
  134 | });
  135 | 
```