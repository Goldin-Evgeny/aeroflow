import { CellType } from '../lattice.js';
import { D3Q19 } from '../lattice3d.js';

export type BoundaryExecutor = 'naive' | 'esoteric';
export type BoundaryRule =
  | 'plain-inlet'
  | 'velocity-inlet'
  | 'zero-gradient-outlet'
  | 'pressure-outlet'
  | 'no-slip-bounce'
  | 'free-slip-redirect';

export interface BoundaryPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly flag: number;
}

/** Diagnostic-only record of one boundary population chosen by a CPU solver step. */
export interface BoundaryPopulationEvent {
  readonly schemaVersion: 1;
  readonly executor: BoundaryExecutor;
  /** One-based completed step identity for the transform being recorded. */
  readonly step: number;
  /** Esoteric layout before this step; the naive solver always reports zero. */
  readonly parity: 0 | 1;
  readonly destination: BoundaryPoint;
  /** Neighbor whose boundary flag selected the rule. */
  readonly source: BoundaryPoint;
  /** Logical population owner after any bounce or free-slip redirection. */
  readonly owner: BoundaryPoint;
  readonly direction: number;
  readonly oppositeDirection: number;
  readonly rule: BoundaryRule;
  /** Stable geometric ownership label, including every domain-face intersection. */
  readonly intersection: string;
  /** Value read before the boundary rule redirects or reconstructs it. */
  readonly inputPopulation: number;
  /** Canonical population for mass-exchange comparison. */
  readonly canonicalIncoming: number;
  /** Value actually selected by the production CPU path. */
  readonly replacementPopulation: number;
  readonly delta: {
    readonly mass: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
}

export type BoundaryEventSink = (event: BoundaryPopulationEvent) => void;

export function boundaryIntersectionLabel(
  point: Pick<BoundaryPoint, 'x' | 'y' | 'z'>,
  nx: number,
  ny: number,
  nz: number,
): string {
  const faces: string[] = [];
  if (point.x === 0) faces.push('x-min');
  if (point.x === nx - 1) faces.push('x-max');
  if (point.y === 0) faces.push('y-min');
  if (point.y === ny - 1) faces.push('y-max');
  if (point.z === 0) faces.push('z-min');
  if (point.z === nz - 1) faces.push('z-max');
  return faces.length === 0 ? 'interior-boundary' : faces.join('&');
}

export function boundaryRuleForFlag(
  flag: number,
  outlet: 'pressure' | 'zero-gradient',
): BoundaryRule {
  switch (flag) {
    case CellType.Inlet:
      return 'plain-inlet';
    case CellType.VelocityInlet:
      return 'velocity-inlet';
    case CellType.Outlet:
      return outlet === 'pressure' ? 'pressure-outlet' : 'zero-gradient-outlet';
    case CellType.FreeSlip:
      return 'free-slip-redirect';
    default:
      return 'no-slip-bounce';
  }
}

export function makeBoundaryPopulationEvent(input: {
  executor: BoundaryExecutor;
  step: number;
  parity: 0 | 1;
  destination: BoundaryPoint;
  source: BoundaryPoint;
  owner?: BoundaryPoint;
  direction: number;
  rule: BoundaryRule;
  inputPopulation: number;
  canonicalIncoming: number;
  replacementPopulation: number;
  nx: number;
  ny: number;
  nz: number;
}): BoundaryPopulationEvent {
  const delta = input.replacementPopulation - input.canonicalIncoming;
  return {
    schemaVersion: 1,
    executor: input.executor,
    step: input.step,
    parity: input.parity,
    destination: input.destination,
    source: input.source,
    owner: input.owner ?? input.source,
    direction: input.direction,
    oppositeDirection: D3Q19.opp[input.direction],
    rule: input.rule,
    intersection: boundaryIntersectionLabel(input.source, input.nx, input.ny, input.nz),
    inputPopulation: input.inputPopulation,
    canonicalIncoming: input.canonicalIncoming,
    replacementPopulation: input.replacementPopulation,
    delta: {
      mass: delta,
      x: D3Q19.ex[input.direction] * delta,
      y: D3Q19.ey[input.direction] * delta,
      z: D3Q19.ez[input.direction] * delta,
    },
  };
}

export function validateBoundaryPopulationEvent(event: BoundaryPopulationEvent): void {
  if (event.schemaVersion !== 1) throw new Error('boundary event schemaVersion must be 1');
  if (!Number.isInteger(event.step) || event.step < 1)
    throw new Error('boundary event step invalid');
  if (!Number.isInteger(event.direction) || event.direction < 0 || event.direction >= D3Q19.q) {
    throw new Error('boundary event direction invalid');
  }
  if (event.oppositeDirection !== D3Q19.opp[event.direction]) {
    throw new Error('boundary event opposite direction disagrees with D3Q19');
  }
  if (event.parity !== 0 && event.parity !== 1) throw new Error('boundary event parity invalid');
  for (const [label, point] of [
    ['destination', event.destination],
    ['source', event.source],
    ['owner', event.owner],
  ] as const) {
    if (![point.x, point.y, point.z].every((value) => Number.isInteger(value) && value >= 0)) {
      throw new Error(`boundary event ${label} coordinate invalid`);
    }
  }
  const expectedSource = (() => {
    if (event.rule === 'plain-inlet' && event.destination.flag === CellType.Inlet) {
      return event.destination;
    }
    if (event.rule === 'velocity-inlet' && event.destination.flag === CellType.VelocityInlet) {
      return { ...event.destination, x: event.destination.x + 1 };
    }
    if (
      (event.rule === 'zero-gradient-outlet' || event.rule === 'pressure-outlet') &&
      event.destination.flag === CellType.Outlet
    ) {
      return { ...event.destination, x: event.destination.x - 1 };
    }
    return {
      ...event.destination,
      x: event.destination.x - D3Q19.ex[event.direction],
      y: event.destination.y - D3Q19.ey[event.direction],
      z: event.destination.z - D3Q19.ez[event.direction],
    };
  })();
  if (
    event.source.x !== expectedSource.x ||
    event.source.y !== expectedSource.y ||
    event.source.z !== expectedSource.z
  ) {
    throw new Error(
      `boundary event source is not the rule-owned neighbor (${event.rule}: ` +
        `${event.source.x},${event.source.y},${event.source.z} != ` +
        `${expectedSource.x},${expectedSource.y},${expectedSource.z})`,
    );
  }
  for (const value of [
    event.inputPopulation,
    event.canonicalIncoming,
    event.replacementPopulation,
    event.delta.mass,
    event.delta.x,
    event.delta.y,
    event.delta.z,
  ]) {
    if (!Number.isFinite(value)) throw new Error('boundary event contains non-finite evidence');
  }
  if (!event.intersection) throw new Error('boundary event ownership is missing');
}

/** Validate an ordered stream and reject two rules claiming the same destination population. */
export function validateBoundaryPopulationEvents(events: readonly BoundaryPopulationEvent[]): void {
  const owners = new Set<string>();
  let previousStep = 0;
  for (const event of events) {
    validateBoundaryPopulationEvent(event);
    if (event.step < previousStep) throw new Error('boundary event stream is not step ordered');
    previousStep = event.step;
    const key = [
      event.executor,
      event.step,
      event.destination.x,
      event.destination.y,
      event.destination.z,
      event.direction,
    ].join(':');
    if (owners.has(key)) throw new Error('duplicate boundary population owner');
    owners.add(key);
  }
}
