import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { D3Q19 } from '../src/lattice3d.js';
import { Solver3D } from '../src/cpu/solver3d.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import {
  makeBoundaryPopulationEvent,
  validateBoundaryPopulationEvent,
  validateBoundaryPopulationEvents,
  type BoundaryPopulationEvent,
} from '../src/cpu/boundaryDiagnostics.js';
import {
  OUTLET_LOCALIZATION_MANIFEST,
  classifyOutletLocalization,
  independentBoundaryPopulation,
  independentFreeSlipOwnership,
  outletLocalizationManifestFingerprint,
  validateOutletLocalizationArtifact,
  validateOutletLocalizationManifest,
  type OutletLocalizationArtifact,
  type OutletLocalizationEvidence,
} from '../src/validation/outletFeedbackLocalization.js';

const baseEvidence = (): OutletLocalizationEvidence => ({
  executionValid: true,
  numericalHealthValid: true,
  controlsRepeatable: true,
  executorsEquivalent: true,
  ownershipAmbiguous: false,
  oracleMismatchRepeated: false,
  oracleMatches: true,
  flatBounded: true,
  flatAbnormal: false,
  intersectionName: null,
  firstEventAtIntersection: false,
  neutralBounded: true,
  neutralAbnormal: false,
  collisionBounded: true,
  collisionAbnormal: false,
  lesOffAbnormal: false,
  lesAbnormal: false,
  boundedConfirmed: true,
  missingEvidence: [],
});

function shellFlags(nx = 6, ny = 5, nz = 5): Uint8Array {
  const flags = new Uint8Array(nx * ny * nz);
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1) {
          flags[at(x, y, z)] = CellType.Solid;
        }
      }
    }
  }
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      flags[at(0, y, z)] = CellType.VelocityInlet;
      flags[at(nx - 1, y, z)] = CellType.Outlet;
    }
  }
  return flags;
}

function expectFluidStateExact(
  actual: Float64Array,
  expected: Float64Array,
  flags: Uint8Array,
): void {
  const n = flags.length;
  for (let idx = 0; idx < n; idx++) {
    if (flags[idx] !== CellType.Fluid) continue;
    for (let direction = 0; direction < D3Q19.q; direction++) {
      expect(actual[direction * n + idx]).toBe(expected[direction * n + idx]);
    }
  }
}

describe('outlet localization manifest', () => {
  it('freezes unique hypotheses, arms, thresholds, stops, and classifier branches', () => {
    expect(() => validateOutletLocalizationManifest(OUTLET_LOCALIZATION_MANIFEST)).not.toThrow();
    expect(outletLocalizationManifestFingerprint()).toMatch(/^fnv1a32:[a-f0-9]{8}$/);
    expect(OUTLET_LOCALIZATION_MANIFEST.tolerances.float64PopulationAbs).toBe(128 * Number.EPSILON);
    expect(OUTLET_LOCALIZATION_MANIFEST.tolerances.repeatabilityAbs).toBe(0);
    expect(OUTLET_LOCALIZATION_MANIFEST.tolerances.massModeRetainedGainMin).toBe(0.5);
    expect(OUTLET_LOCALIZATION_MANIFEST.tolerances.massModeAnchoredGainMax).toBe(0.1);
  });

  it('rejects duplicate identities and missing branch evidence', () => {
    expect(() =>
      validateOutletLocalizationManifest({
        ...OUTLET_LOCALIZATION_MANIFEST,
        arms: [OUTLET_LOCALIZATION_MANIFEST.arms[0], OUTLET_LOCALIZATION_MANIFEST.arms[0]],
      }),
    ).toThrow(/duplicate arm/);
    expect(() =>
      validateOutletLocalizationManifest({
        ...OUTLET_LOCALIZATION_MANIFEST,
        hypotheses: [
          { ...OUTLET_LOCALIZATION_MANIFEST.hypotheses[0], requiredEvidence: [] },
          ...OUTLET_LOCALIZATION_MANIFEST.hypotheses.slice(1),
        ],
      }),
    ).toThrow(/missing prediction evidence/);
  });
});

describe('independent boundary oracle', () => {
  const populations = Array.from({ length: 19 }, (_, i) => 0.01 + i * 0.0001);

  it('executes H4 copy, H12 equilibrium, no-slip bounce, and H14 reconstruction', () => {
    expect(
      independentBoundaryPopulation({ rule: 'zero-gradient-outlet', direction: 7, populations }),
    ).toBe(populations[7]);
    expect(
      independentBoundaryPopulation({
        rule: 'no-slip-bounce',
        direction: 1,
        canonicalOutgoing: 0.123,
      }),
    ).toBe(0.123);
    const inlet = independentBoundaryPopulation({
      rule: 'velocity-inlet',
      direction: 1,
      inletDensity: 1.02,
      inletVelocity: 0.05,
    });
    expect(inlet).toBeCloseTo((1 / 18) * 1.02 * (1 + 0.15 + 0.01125 - 0.00375), 15);

    const pressure = Array.from({ length: 19 }, (_, direction) =>
      independentBoundaryPopulation({
        rule: 'pressure-outlet',
        direction,
        populations,
      }),
    );
    expect(pressure.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 14);

    const link = makeBoundaryPopulationEvent({
      executor: 'naive',
      step: 1,
      parity: 0,
      destination: { x: 1, y: 2, z: 2, flag: CellType.Fluid },
      source: { x: 0, y: 2, z: 2, flag: CellType.Solid },
      owner: { x: 1, y: 2, z: 2, flag: CellType.Fluid },
      direction: 1,
      rule: 'no-slip-bounce',
      inputPopulation: 0.07,
      canonicalIncoming: 0.08,
      replacementPopulation: 0.11,
      nx: 5,
      ny: 5,
      nz: 5,
    });
    expect(link.oppositeDirection).toBe(2);
    expect(link.delta.mass).toBeCloseTo(0.03, 15);
    expect(link.delta.x).toBeCloseTo(0.03, 15);
    expect(link.delta.y).toBe(0);
    expect(link.delta.z).toBe(0);
  });

  it('resolves face and edge ownership independently and reports ambiguity', () => {
    const size = 5;
    const flags = new Uint8Array(size ** 3);
    const at = (x: number, y: number, z: number) => x + size * (y + size * z);
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) flags[at(x, 0, z)] = CellType.FreeSlip;
      for (let y = 0; y < size; y++) flags[at(x, y, 0)] = CellType.FreeSlip;
    }
    const resolved = independentFreeSlipOwnership({
      flags,
      nx: size,
      ny: size,
      nz: size,
      faces: { yMin: true, zMin: true },
      sx: 2,
      sy: 0,
      sz: 0,
      direction: 15,
    });
    expect(resolved.state).toBe('resolved');
    if (resolved.state === 'resolved') expect(resolved.intersection).toContain('&');

    expect(
      independentFreeSlipOwnership({
        flags,
        nx: size,
        ny: size,
        nz: size,
        faces: {},
        sx: 2,
        sy: 0,
        sz: 1,
        direction: 3,
      }).state,
    ).toBe('ambiguous');
  });

  it('makes ground and free-slip precedence explicit at inlet/outlet intersections', () => {
    const nx = 6;
    const ny = 5;
    const nz = 5;
    const groundFlags = shellFlags(nx, ny, nz);
    const ground = new Solver3D({ nx, ny, nz, omega: 1.25, flags: groundFlags });
    const groundEvents: BoundaryPopulationEvent[] = [];
    ground.boundaryEventSink = (event) => groundEvents.push(event);
    ground.step();
    for (const intersection of ['x-min&y-min', 'x-max&y-min']) {
      expect(
        groundEvents.some(
          (event) => event.intersection === intersection && event.rule === 'no-slip-bounce',
        ),
      ).toBe(true);
    }

    const slipFlags = shellFlags(nx, ny, nz);
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    for (let x = 0; x < nx; x++) {
      for (let z = 0; z < nz; z++) {
        slipFlags[at(x, 0, z)] = CellType.FreeSlip;
        slipFlags[at(x, ny - 1, z)] = CellType.FreeSlip;
      }
    }
    const slip = new Solver3D({
      nx,
      ny,
      nz,
      omega: 1.25,
      flags: slipFlags,
      freeSlip: { yMin: true, yMax: true },
    });
    const slipEvents: BoundaryPopulationEvent[] = [];
    slip.boundaryEventSink = (event) => slipEvents.push(event);
    slip.step();
    for (const intersection of ['x-min&y-min', 'x-max&y-min']) {
      expect(
        slipEvents.some(
          (event) => event.intersection === intersection && event.rule === 'free-slip-redirect',
        ),
      ).toBe(true);
    }
  });
});

describe('CPU boundary capture and exact replay', () => {
  it('is opt-in, validates ownership, and preserves naive/Esoteric identity', () => {
    const nx = 6;
    const ny = 5;
    const nz = 5;
    const flags = shellFlags(nx, ny, nz);
    const options = {
      nx,
      ny,
      nz,
      omega: 1 / 0.8,
      flags,
      inletVelocity: 0.05,
      collision: 'trt' as const,
      regularize: true,
      conserveMass: true,
      outlet: 'zero-gradient' as const,
    };
    const naive = new Solver3D(options);
    const esoteric = new EsotericPull3D(options);
    const naiveControl = new Solver3D(options);
    const esotericControl = new EsotericPull3D(options);
    const naiveEvents: BoundaryPopulationEvent[] = [];
    const esotericEvents: BoundaryPopulationEvent[] = [];
    naive.boundaryEventSink = (event) => naiveEvents.push(event);
    esoteric.boundaryEventSink = (event) => esotericEvents.push(event);
    for (let step = 0; step < 4; step++) {
      naive.step();
      esoteric.step();
      naiveControl.step();
      esotericControl.step();
      expectFluidStateExact(esoteric.snapshotCanonical(), naive.snapshotPostCollision(), flags);
      expect(naive.snapshotPostCollision()).toEqual(naiveControl.snapshotPostCollision());
      expect(esoteric.snapshotCanonical()).toEqual(esotericControl.snapshotCanonical());
    }
    expect(naiveEvents.length).toBeGreaterThan(0);
    expect(esotericEvents.length).toBeGreaterThan(0);
    for (const event of [...naiveEvents, ...esotericEvents]) {
      expect(() => validateBoundaryPopulationEvent(event)).not.toThrow();
    }
    expect(() => validateBoundaryPopulationEvents(naiveEvents)).not.toThrow();
    expect(() => validateBoundaryPopulationEvents(esotericEvents)).not.toThrow();
    expect(naiveEvents.some((event) => event.rule === 'zero-gradient-outlet')).toBe(true);
    expect(naiveEvents.some((event) => event.intersection === 'x-max')).toBe(true);
  });

  it('replays immutable naive and Esoteric checkpoints to identical state and events', () => {
    const flags = shellFlags();
    const options = {
      nx: 6,
      ny: 5,
      nz: 5,
      omega: 1 / 0.8,
      flags,
      inletVelocity: 0.05,
      collision: 'trt' as const,
      outlet: 'pressure' as const,
    };
    const replay = <T extends Solver3D | EsotericPull3D>(
      create: () => T,
      snapshot: (solver: T) => Float64Array,
    ): void => {
      const original = create();
      original.step(3);
      const state = original.saveState();
      const firstEvents: BoundaryPopulationEvent[] = [];
      original.boundaryEventSink = (event) => firstEvents.push(event);
      original.step();
      const first = snapshot(original);

      const restored = create();
      restored.loadState(state);
      const replayEvents: BoundaryPopulationEvent[] = [];
      restored.boundaryEventSink = (event) => replayEvents.push(event);
      restored.step();
      expect(snapshot(restored)).toEqual(first);
      expect(replayEvents).toEqual(firstEvents);
    };
    replay(
      () => new Solver3D(options),
      (solver) => solver.snapshotPostCollision(),
    );
    replay(
      () => new EsotericPull3D(options),
      (solver) => solver.snapshotCanonical(),
    );
  });

  it('rejects wrong neighbor, parity, opposite, duplicate ownership, and non-finite evidence', () => {
    const event = makeBoundaryPopulationEvent({
      executor: 'naive',
      step: 1,
      parity: 0,
      destination: { x: 0, y: 1, z: 1, flag: CellType.VelocityInlet },
      source: { x: 1, y: 1, z: 1, flag: CellType.Fluid },
      direction: 1,
      rule: 'velocity-inlet',
      inputPopulation: 0.1,
      canonicalIncoming: 0.09,
      replacementPopulation: 0.11,
      nx: 4,
      ny: 4,
      nz: 4,
    });
    expect(() => validateBoundaryPopulationEvent(event)).not.toThrow();
    expect(() =>
      validateBoundaryPopulationEvent({ ...event, oppositeDirection: D3Q19.opp[2] }),
    ).toThrow(/opposite/);
    expect(() =>
      validateBoundaryPopulationEvent({
        ...event,
        parity: 2,
      } as unknown as BoundaryPopulationEvent),
    ).toThrow(/parity/);
    expect(() =>
      validateBoundaryPopulationEvent({
        ...event,
        source: { ...event.source, x: 2 },
      }),
    ).toThrow(/neighbor/);
    expect(() => validateBoundaryPopulationEvent({ ...event, intersection: '' })).toThrow(
      /ownership/,
    );
    expect(() =>
      validateBoundaryPopulationEvent({ ...event, replacementPopulation: Number.NaN }),
    ).toThrow(/non-finite/);
    expect(() => validateBoundaryPopulationEvents([event, event])).toThrow(/duplicate/);
  });
});

describe('outlet localization classifier and artifact', () => {
  it.each([
    ['implementation-discrepancy', { oracleMatches: false, oracleMismatchRepeated: true }],
    [
      'boundary-intersection-dependent',
      { intersectionName: 'x-max&y-min', firstEventAtIntersection: true },
    ],
    [
      'zero-gradient-formulation-feedback',
      {
        flatBounded: false,
        flatAbnormal: true,
        neutralBounded: false,
        neutralAbnormal: true,
        lesOffAbnormal: true,
      },
    ],
    ['collision-amplified', { collisionAbnormal: true }],
    ['les-amplified', { lesAbnormal: true }],
  ] as const)('classifies %s only from its complete evidence', (expected, override) => {
    expect(classifyOutletLocalization({ ...baseEvidence(), ...override }).branch).toBe(expected);
  });

  it('keeps invalid, ambiguous, missing, and simultaneous evidence inconclusive', () => {
    expect(classifyOutletLocalization({ ...baseEvidence(), executionValid: false }).branch).toBe(
      'inconclusive',
    );
    expect(classifyOutletLocalization({ ...baseEvidence(), ownershipAmbiguous: true }).branch).toBe(
      'inconclusive',
    );
    expect(
      classifyOutletLocalization({ ...baseEvidence(), missingEvidence: ['population-events'] })
        .branch,
    ).toBe('inconclusive');
    expect(
      classifyOutletLocalization({
        ...baseEvidence(),
        lesAbnormal: true,
        boundedConfirmed: false,
      }).reasons,
    ).toEqual(['bounded-confirmation-missing']);
    expect(
      classifyOutletLocalization({
        ...baseEvidence(),
        collisionAbnormal: true,
        lesAbnormal: true,
      }).branch,
    ).toBe('inconclusive');
  });

  it('rejects artifacts interpreted under a changed manifest and never authorizes repair', () => {
    const artifact: OutletLocalizationArtifact = {
      schemaVersion: 1,
      generatedAt: '2026-08-18T14:00:00Z',
      manifestId: OUTLET_LOCALIZATION_MANIFEST.id,
      manifestFingerprint: outletLocalizationManifestFingerprint(),
      source: { revision: 'test', dirty: true },
      arms: [
        {
          id: 'manufactured-boundaries',
          status: 'passed',
          configurationFingerprint: 'fixture',
          initialStateFingerprint: 'initial-fixture',
          finalStateFingerprint: 'final-fixture',
          metrics: { residual: 0 },
          events: [],
        },
      ],
      result: classifyOutletLocalization({ ...baseEvidence(), collisionAbnormal: true }),
      originalEvidence: { aggregateSeparationStep: 25, divergenceStep: 3346 },
      nonClaims: ['No production repair or benchmark verdict is authorized.'],
    };
    expect(validateOutletLocalizationArtifact(artifact)).toBe(artifact);
    expect(artifact.result.repairAuthorized).toBe(false);
    expect(() =>
      validateOutletLocalizationArtifact({ ...artifact, manifestFingerprint: 'changed' }),
    ).toThrow(/changed manifest/);
  });
});
