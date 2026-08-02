import { test, expect, BASE_URL } from './fixtures/gpu';
import { readHooks } from './helpers/hooks';
import { bindingCapForCells, DEFAULT_BINDING_BYTES } from '../src/gpu/ddfLayout';

/** M11 Case C V14 at the strict 3rd-node grid (M11). */
const CASE_C_CELLS = 183_000_000;

const giB = (b: number) => (b / 1024 ** 3).toFixed(3);

/**
 * **The D1 precondition, executable.** docs/decisions/D1-resolution-wall.md §Decision 3
 * required "one browser run recording the 3090's actual `maxStorageBufferBindingSize` and
 * `maxStorageBuffersPerShaderStage`" before the binding cap was changed or hardware bought.
 * First run 2026-07-27; it falsified the record's original unblock plan. The four-way
 * macro split subsequently removed that binding wall, and this remains the standing
 * reading for whatever device runs Tier B.
 *
 * It asserts only what must be true for the shipped kernel to be legal here. The Case C
 * verdict is REPORTED, not gated — the point is to keep learning the number on new
 * hardware, not to turn a hardware fact into a red test.
 */
test('records the negotiated storage limits and prices M11 Case C against them', async ({
  gpuPage: page,
}, testInfo) => {
  await page.goto(`${BASE_URL}/?playground2d`);
  await expect.poll(async () => (await readHooks(page)).caps, { timeout: 120_000 }).toBeTruthy();
  const caps = (await readHooks(page)).caps!;

  const needed = bindingCapForCells(CASE_C_CELLS, 'fp16');
  const caseCFits = needed <= caps.bindingCap;

  const report = [
    `adapter                          ${caps.adapter}`,
    `maxBufferSize                    ${giB(caps.maxBufferSize)} GiB`,
    `maxStorageBufferBindingSize      ${giB(caps.maxStorageBufferBindingSize)} GiB`,
    `maxStorageBuffersPerShaderStage  ${caps.maxStorageBuffersPerShaderStage}`,
    `shader-f16 / timestamp-query     ${caps.hasF16} / ${caps.hasTimestamp}`,
    '',
    `binding cap used by the planner  ${giB(caps.bindingCap)} GiB` +
      ` (was clamped to ${giB(DEFAULT_BINDING_BYTES)} GiB before 2026-07-27)`,
    `addressable cells   fp16 ${caps.addressableCells.fp16.toLocaleString()}` +
      ` · fp32 ${caps.addressableCells.fp32.toLocaleString()}`,
    `storage bindings    ${caps.worstCaseStorageBindings} needed (worst case)` +
      ` vs ${caps.maxStorageBuffersPerShaderStage} granted`,
    '',
    `M11 Case C needs ${CASE_C_CELLS.toLocaleString()} cells fp16`,
    `  → per-binding cap of ${giB(needed)} GiB — set by 5 FP16 DDF planes at 10 B/cell`,
    `  → runnable on this device today: ${caseCFits ? 'YES' : 'NO'}`,
  ].join('\n');

  await testInfo.attach('d1-binding-cap-reading', { body: report, contentType: 'text/plain' });
  console.log(`\n${report}\n`); // this reading IS the deliverable of the spec

  // Hard assertions: only things that must hold for the shipped kernel to be legal here.
  expect(caps.maxStorageBufferBindingSize).toBeGreaterThanOrEqual(DEFAULT_BINDING_BYTES);
  expect(caps.maxStorageBuffersPerShaderStage).toBeGreaterThanOrEqual(
    caps.worstCaseStorageBindings,
  );
  expect(caps.hasF16).toBe(true);
});
