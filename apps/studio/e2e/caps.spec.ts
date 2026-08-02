import { test, expect } from '@playwright/test';
import { readHooks } from './helpers/hooks';
import {
  bindingCapForCells,
  deviceBindingCap,
  storageBindingsNeeded,
  MAX_DDF_BUFFERS,
} from '../src/gpu/ddfLayout';

/**
 * The negotiated-limits probe (src/main.ts `recordCaps`) must stay wired, because the
 * resolution-wall record (docs/decisions/D1-resolution-wall.md) makes a real reading of
 * `maxStorageBufferBindingSize` + `maxStorageBuffersPerShaderStage` the precondition for
 * changing the binding cap — and a silently-dropped hook would let that decision be taken
 * on stale arithmetic instead of hardware.
 *
 * Tier A asserts only invariants that hold on any device; the NUMBERS are recorded by
 * `caps.gpu.spec.ts`, which is the reading that D1 cites. Keep it that way even though
 * Tier A now runs on the real adapter too — a limits *number* asserted here would bind the
 * suite to one machine, and under `test:e2e:swiftshader` it would be a claim about nothing.
 */
test('boot records the negotiated device limits on every route', async ({ page }, testInfo) => {
  await page.goto('/?playground2d');
  await expect.poll(async () => (await readHooks(page)).caps, { timeout: 60_000 }).toBeTruthy();
  const caps = (await readHooks(page)).caps!;

  await testInfo.attach('caps', {
    body: JSON.stringify(caps, null, 2),
    contentType: 'application/json',
  });

  expect(caps.maxStorageBufferBindingSize).toBeGreaterThan(0);
  expect(caps.maxStorageBuffersPerShaderStage).toBeGreaterThan(0);
  // A buffer must satisfy BOTH the binding and the buffer limit, so the planner's cap is
  // the smaller of the two — never either one alone.
  expect(caps.bindingCap).toBe(deviceBindingCap(caps));
  // Four planar macro bindings cost 4 B/cell each, so DDF storage binds first in both
  // precisions. FP16 always addresses more — if this ever inverts, the model is wrong.
  expect(caps.addressableCells.fp16).toBeGreaterThan(caps.addressableCells.fp32);
  expect(caps.worstCaseStorageBindings).toBe(
    storageBindingsNeeded(MAX_DDF_BUFFERS, { forces: true, abl: true }),
  );
  // Case C fit is device-dependent; the hook's ceiling and direct requirement must agree.
  const caseCCells = 183_000_000;
  expect(caps.addressableCells.fp16 >= caseCCells).toBe(
    bindingCapForCells(caseCCells, 'fp16') <= caps.bindingCap,
  );
});
