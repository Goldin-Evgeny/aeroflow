import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';

/**
 * M0 acceptance: with WebGPU disabled (`--disable-features=WebGPU`, see the `fallback`
 * project) the app must render the static fallback page, not a blank screen or a crash.
 */
test('renders the WebGPU-unsupported fallback page', async ({ page }) => {
  await page.goto('/');
  const fallback = page.getByTestId('fallback');
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText('WebGPU');
  expect((await readHooks(page)).bootError).toBeTruthy();
});
