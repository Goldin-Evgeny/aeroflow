import { describe, expect, it } from 'vitest';
import { lostWithin, makeLostSignal, stepOrLost } from '../src/sim/ahmedRun';

/**
 * Device-loss detection race (M10 chaos-path fix, 2026-07-20). The Ahmed run loop used to
 * detect a forced device loss only when `sampleForce` threw. On the 2026-07-20 Ampere
 * chaos run the destroyed device left the in-flight GPU call pending forever, so the loop
 * hung in `await` and never posted `device-lost` (acceptance-4 timed out with no event).
 * These prove the extracted `stepOrLost` returns as soon as the lost signal fires even
 * when the step promise NEVER settles — which is the whole point of the fix.
 */
describe('stepOrLost — loss detection cannot be starved by a hung step', () => {
  it('resolves { lost: true } when the signal fires and the step never settles', async () => {
    const lost = makeLostSignal();
    const neverSettles = new Promise<number>(() => {}); // models the hung readback
    const p = stepOrLost(neverSettles, lost.promise);
    lost.fire();
    await expect(p).resolves.toEqual({ lost: true });
  });

  it('returns the step value when the step wins the race', async () => {
    const lost = makeLostSignal();
    const r = await stepOrLost(Promise.resolve(42), lost.promise);
    expect(r).toEqual({ lost: false, value: 42 });
  });

  it('reports loss even if both are ready — loss takes precedence via re-check upstream', async () => {
    // When the signal has already fired, a subsequent call still surfaces the loss.
    const lost = makeLostSignal();
    lost.fire();
    const r = await stepOrLost(new Promise<number>(() => {}), lost.promise);
    expect(r).toEqual({ lost: true });
  });

  it('a step that rejects AFTER the race is decided does not throw (no unhandled rejection)', async () => {
    let rejectStep!: (e: unknown) => void;
    const step = new Promise<number>((_, rej) => {
      rejectStep = rej;
    });
    const r = await stepOrLost(step, Promise.resolve()); // lost wins immediately
    expect(r).toEqual({ lost: true });
    // The hung step later rejects (device destroyed) — must be swallowed, not crash.
    rejectStep(new Error('device destroyed'));
    await new Promise((res) => setTimeout(res, 0));
  });

  it('makeLostSignal fires its promise exactly once and stays resolved', async () => {
    const lost = makeLostSignal();
    let resolved = false;
    void lost.promise.then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    lost.fire();
    lost.fire(); // idempotent
    await lost.promise;
    expect(resolved).toBe(true);
  });
});

describe('lostWithin — disambiguates a reject-before-flag loss from a real error', () => {
  it('returns true when the loss fires shortly AFTER the step already rejected', async () => {
    // The 2026-07-21 Ampere symptom: mapAsync throws, THEN device.lost resolves a tick
    // later. The catch grace-wait must still classify this as a loss, not an error.
    const lost = makeLostSignal();
    const p = lostWithin(lost.promise, 250);
    setTimeout(() => lost.fire(), 5);
    await expect(p).resolves.toBe(true);
  });

  it('returns false for a genuine error — device.lost never resolves', async () => {
    const lost = makeLostSignal(); // never fired
    const start = Date.now();
    await expect(lostWithin(lost.promise, 30)).resolves.toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25); // waited out the grace window
  });

  it('returns true immediately when the loss already fired', async () => {
    const lost = makeLostSignal();
    lost.fire();
    await expect(lostWithin(lost.promise, 250)).resolves.toBe(true);
  });
});
