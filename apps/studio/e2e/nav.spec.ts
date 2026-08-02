import { test, expect } from '@playwright/test';

/**
 * The page launcher (src/ui/nav.ts) must reach every route. Before 2026-07-25 the default
 * route was the M1 2D playground and every later page was reachable only by guessing its
 * query flag, so this guards discoverability, not physics.
 *
 * Runs on `?playground2d` — the cheapest route — so a discoverability check does not drag
 * Three.js onto its critical path. The nav is route-independent: it attaches to
 * `document.body`, not `#app`.
 */
test('page launcher links to every route', async ({ page }) => {
  await page.goto('/?playground2d');

  const launcher = page.locator('.nav-launcher');
  await expect(launcher).toBeAttached();

  // The current route is marked, and the summary names it.
  await expect(launcher.locator('summary')).toContainText('2D playground');
  await expect(launcher.locator('a[aria-current="page"]')).toHaveText('2D playground');

  // Every entry is present, and the 3D tunnel is the default route (bare './').
  const hrefs = await launcher
    .locator('a')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual([
    './',
    './?bench3d',
    './?import3d',
    './?spheredrag',
    './?cavity',
    './?aij',
    './?urban',
    './?playground2d',
  ]);
});

/** `?dev` must still land on the 2D playground with the H6 parity panel (CLAUDE.md rule 0). */
test('?dev still reaches the 2D playground parity panel', async ({ page }) => {
  await page.goto('/?dev');
  await expect(page.getByTestId('parity-run')).toBeAttached();
  await expect(page.locator('.nav-launcher a[aria-current="page"]')).toHaveText('2D playground');
});
