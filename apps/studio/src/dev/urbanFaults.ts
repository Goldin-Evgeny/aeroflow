import type { AijUrbanFaultInjection, AijUrbanLivenessPolicy } from '../sim/cases/aijUrban';

export type UrbanTestFault =
  | 'queue-timeout'
  | 'map-timeout'
  | 'device-loss'
  | 'healthy-delay'
  | 'checkpoint-timeout'
  | 'scoring-timeout';

export interface UrbanTestFaultControl {
  kind: UrbanTestFault;
  deadlineMs?: number;
  delayMs?: number;
}

const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** Consume a webdriver-only fault command; production controls never expose this seam. */
export function consumeUrbanTestFault(): {
  faultInjection?: AijUrbanFaultInjection;
  liveness?: Partial<AijUrbanLivenessPolicy>;
} {
  if (!navigator.webdriver) return {};
  const control = window.__aeroflowTestFaults?.urban;
  if (!control) return {};
  delete window.__aeroflowTestFaults?.urban;
  const deadlineMs = control.deadlineMs ?? 100;
  const liveness: Partial<AijUrbanLivenessPolicy> = {
    queueMs: deadlineMs,
    readbackMs: deadlineMs,
    checkpointChunkMs: deadlineMs,
    scoringMs: deadlineMs,
    maximumMs: Math.max(deadlineMs, 1_000),
  };
  let loss!: (info: { reason?: string; message?: string }) => void;
  const deviceLost = new Promise<{ reason?: string; message?: string }>((resolve) => {
    loss = resolve;
  });
  if (control.kind === 'device-loss') {
    setTimeout(() => loss({ reason: 'unknown', message: 'injected device loss' }), 5);
  }
  const consumeReal = <T>(real: Promise<T>): void => {
    void real.then(
      () => {},
      () => {},
    );
  };
  const faultInjection: AijUrbanFaultInjection = {};
  switch (control.kind) {
    case 'queue-timeout':
      faultInjection.queueCompletion = (real) => {
        consumeReal(real);
        return never();
      };
      break;
    case 'map-timeout':
      faultInjection.probeMap = (real) => {
        consumeReal(real);
        return never();
      };
      break;
    case 'device-loss':
      faultInjection.deviceLost = deviceLost;
      faultInjection.queueCompletion = (real) => {
        consumeReal(real);
        return never();
      };
      break;
    case 'healthy-delay':
      faultInjection.queueCompletion = async (real) => {
        await real;
        await new Promise<void>((resolve) => setTimeout(resolve, control.delayMs ?? 25));
      };
      break;
    case 'checkpoint-timeout':
      faultInjection.checkpointPersistence = (real) => {
        consumeReal(real);
        return never();
      };
      break;
    case 'scoring-timeout':
      faultInjection.scoring = (real) => {
        consumeReal(real);
        return never();
      };
      break;
  }
  return { faultInjection, liveness };
}
