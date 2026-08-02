import { defineConfig, devices } from '@playwright/test';

/**
 * Two-tier e2e setup.
 *
 * Both tiers now run on the **real GPU** via a Playwright-launched browser. The move off
 * WSL to native Windows (2026-07-28) removed the two constraints that shaped the old
 * setup: WSL had no GPU adapter for headless Chromium (hence SwiftShader), and reaching
 * the host's GPU meant attaching over CDP to a hand-started Chrome.
 *
 * Measured 2026-07-28 on this box, adapter reported per launch configuration:
 *  - bundled `chromium-headless-shell` (Playwright's default): `requestAdapter()` → **null**.
 *    This is the whole reason SwiftShader existed; it is a property of the headless shell,
 *    not of headless mode.
 *  - `channel: 'chromium'` (full Chromium, new headless): **nvidia / ampere**, `shader-f16`
 *    and `timestamp-query` both present, 2.000 GiB per binding, 16 storage buffers/stage.
 *  - `channel: 'chrome'`, headless and headed: identical adapter and limits.
 * So `channel: 'chromium'` is enough — no `--enable-unsafe-webgpu`, no CDP, no headed mode.
 *
 * Projects:
 *  - `chromium`: Tier A correctness specs on the real GPU. The default suite.
 *  - `gpu`: Tier B acceptance runs (`*.gpu.spec.ts`), same browser, 30-min timeout.
 *  - `fallback`: WebGPU disabled, asserts the graceful-degradation path.
 *  - `swiftshader`: opt-in CPU-Vulkan fallback for a machine with no usable GPU (or a
 *    future GPU-less CI). Correctness only, tiny grids, never a performance claim. Flag
 *    set pinned by the Phase-0 spike (2026-07, Chromium 149). Kept because it is the only
 *    way to run Tier A somewhere without an adapter — not because anything here needs it.
 *    Note `parity.spec.ts` cannot pass under it (un-root-caused D2Q9 device loss at boot).
 */
const SWIFTSHADER_ARGS = [
  '--enable-unsafe-webgpu',
  '--use-webgpu-adapter=swiftshader',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
];

/** Tier A/B browser: full Chromium, which (unlike the headless shell) exposes the real GPU. */
const REAL_GPU = { ...devices['Desktop Chrome'], channel: 'chromium' } as const;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000, // SwiftShader is CPU-slow
  expect: { timeout: 30_000 },
  workers: 1, // GPU/CPU contention; deterministic ordering
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [/\.gpu\.spec\.ts$/, /fallback\.spec\.ts$/],
      use: REAL_GPU,
    },
    {
      name: 'fallback',
      testMatch: /fallback\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--disable-features=WebGPU'] },
      },
    },
    {
      // Real acceptance runs (parity matrices, benchmarks, drag ladders) take minutes.
      // The gpu fixture (e2e/fixtures/gpu.ts) uses this launched browser unless
      // AEROFLOW_CDP_URL points it at an external Chrome instead.
      name: 'gpu',
      testMatch: /\.gpu\.spec\.ts$/,
      timeout: 30 * 60_000,
      use: REAL_GPU,
    },
    {
      // Opt-in only: `npm run test:e2e:swiftshader`. For boxes with no usable GPU.
      name: 'swiftshader',
      testIgnore: [/\.gpu\.spec\.ts$/, /fallback\.spec\.ts$/],
      use: { ...devices['Desktop Chrome'], launchOptions: { args: SWIFTSHADER_ARGS } },
    },
  ],
});
