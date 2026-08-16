import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  collideD3Q27Central,
  conservedD3Q27,
  D3Q27,
  equilibriumD3Q27Central,
  streamCollidePeriodicD3Q27,
} from '../src/index.js';

const AHMED_2M_TAU0 = 0.5000020740253772;

/**
 * CPU-authority gates for the exact D3Q27 CM formulation accepted by M9. The three golden
 * vectors were captured from the audited test-local operator before its extraction into
 * production. They make this an equivalence test, not a second implementation of the math.
 *
 * The golden vectors predate the `lesNorm` split (fix-confirmed-physics-defects,
 * les-subgrid-closure) — they were captured under what is now called `'legacy'`. The
 * comparison against them pins `lesNorm: 'legacy'` explicitly so it stays an equivalence
 * check against those frozen numbers regardless of which convention `collideD3Q27Central`
 * defaults to.
 */

const AUDITED_GOLDEN = [
  {
    id: 'equilibrium-cs0',
    lesCs: 0,
    input: [
      0.004116994630993472, 0.01686799072112415, 0.004319429953437929, 0.015885674545568614,
      0.06508616960930726, 0.01666678356734638, 0.003830990712326808, 0.015696186558457483,
      0.004019363034771252, 0.019132622279310823, 0.07838943792848942, 0.020073385847755268,
      0.07382438841293391, 0.30247042086657666, 0.0774543819427117, 0.01780349619664416,
      0.07294379409382286, 0.018678905765088596, 0.005557342606851258, 0.022769328582741957,
      0.005830600782629033, 0.021443344940519707, 0.08785684119273832, 0.022497728255630817,
      0.005171279008184597, 0.021187563780075244, 0.005425554183962369,
    ],
    output: [
      0.0041169946309934724, 0.016867990721124125, 0.0043194299534379185, 0.015885674545568607,
      0.06508616960930737, 0.016666783567346372, 0.0038309907123268124, 0.015696186558457455,
      0.004019363034771253, 0.019132622279310802, 0.07838943792848953, 0.020073385847755247,
      0.07382438841293391, 0.3024704208665764, 0.07745438194271166, 0.017803496196644147,
      0.07294379409382284, 0.018678905765088606, 0.005557342606851259, 0.022769328582741912,
      0.005830600782629034, 0.02144334494051968, 0.08785684119273829, 0.02249772825563081,
      0.0051712790081845945, 0.021187563780075264, 0.005425554183962372,
    ],
  },
  {
    id: 'perturbed-cs0',
    lesCs: 0,
    input: [
      0.004054171752929593, 0.015752643222493347, 0.0038447030302275345, 0.016461307356800865,
      0.06406434282404481, 0.015572901203514603, 0.004170514790330564, 0.016300887319695437,
      0.0039744080186002295, 0.01840565009964755, 0.07161485257616992, 0.017434326925200392,
      0.07488923145801087, 0.29156788965673763, 0.07093371811943641, 0.019047196935655757,
      0.07421642816591871, 0.018071460680337045, 0.005249490889095065, 0.020381392935118613,
      0.004962640384139732, 0.02129388946799351, 0.08291577663051243, 0.02016162740738631,
      0.005410632340960941, 0.021112539823268876, 0.005152061706178417,
    ],
    output: [
      0.004043234792773799, 0.015732582280593915, 0.003830092725682324, 0.01645685452783538,
      0.0640923961069485, 0.015591480883703757, 0.004186356293932507, 0.016311506233506766,
      0.00396731397992006, 0.01837520794235873, 0.07159472963219743, 0.017453260604238657,
      0.07490849949936768, 0.29158785262264186, 0.0709760545826667, 0.019075708414616935,
      0.07414705856518883, 0.018030506141317428, 0.00523238147718591, 0.02038415063101328,
      0.004958465414341223, 0.02130071545675194, 0.0829553190466725, 0.02018304402712208,
      0.0054196465814407785, 0.021088118245518893, 0.005134149010867344,
    ],
  },
  {
    id: 'perturbed-cs01',
    lesCs: 0.1,
    input: [
      0.004109238018932384, 0.016588569940369273, 0.004212205968827275, 0.016263485340728252,
      0.06552154131693314, 0.016544575497693222, 0.004016039849742744, 0.01616583103795687,
      0.004055239934400724, 0.01904373648920368, 0.07696556103483056, 0.019396425210194936,
      0.0753825647464505, 0.30431899744032276, 0.076773073657901, 0.018635940740383074,
      0.07518879041581905, 0.018981254404889614, 0.005561383017217439, 0.022387130867253257,
      0.005663113558496947, 0.021918334125332513, 0.08840479148451796, 0.022295848616057365,
      0.005392906247674838, 0.021805511466324277, 0.0054709941367717604,
    ],
    output: [
      0.004107867061076642, 0.016593085786787403, 0.0041829018459445515, 0.016237402537873806,
      0.06546818942839952, 0.01652122417914673, 0.00400931637150602, 0.01616496244090414,
      0.00408056553146369, 0.019105795528100003, 0.07707495812231663, 0.019408512548152006,
      0.07541469585888252, 0.3043488394786519, 0.07677241480829237, 0.018602604184519523,
      0.0752019471239985, 0.018978999932044247, 0.005542055886280193, 0.022349565895507805,
      0.005640806060955155, 0.021890806989191634, 0.08831758585063405, 0.02229568383527455,
      0.005406693728912415, 0.02184037173577224, 0.005505231814636928,
    ],
  },
] as const;

interface AuthorityArtifact {
  artifactSchema: 'aeroflow-d3q27-cpu-authority-v1';
  generatedAt: string;
  tau0: number;
  goldenCases: string[];
  productionVsAuditedPopulationMaxError: number;
  equilibriumFixedPointMaxError: number;
  cyclicPermutationMaxError: number;
  periodicMassDriftRelativeMax: number;
  periodicMomentumDriftMax: number;
  finite: boolean;
  passed: boolean;
}

let artifact: AuthorityArtifact | undefined;

const maxPopulationError = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let result = 0;
  for (let i = 0; i < a.length; i++) result = Math.max(result, Math.abs(a[i] - b[i]));
  return result;
};

function fieldConserved(field: Float64Array, cells: number): [number, number, number, number] {
  const total: [number, number, number, number] = [0, 0, 0, 0];
  for (let direction = 0; direction < D3Q27.q; direction++) {
    for (let cell = 0; cell < cells; cell++) {
      const value = field[direction * cells + cell];
      total[0] += value;
      total[1] += D3Q27.ex[direction] * value;
      total[2] += D3Q27.ey[direction] * value;
      total[3] += D3Q27.ez[direction] * value;
    }
  }
  return total;
}

function cyclicPermutation(populations: ArrayLike<number>): Float64Array {
  const result = new Float64Array(D3Q27.q);
  for (let direction = 0; direction < D3Q27.q; direction++) {
    const [x, y, z] = D3Q27.velocities[direction];
    const mapped = D3Q27.velocities.findIndex(
      (velocity) => velocity[0] === z && velocity[1] === x && velocity[2] === y,
    );
    if (mapped < 0) throw new Error('missing cyclic D3Q27 direction');
    result[mapped] = populations[direction];
  }
  return result;
}

describe.sequential('D3Q27 central-moment production CPU authority', () => {
  it('freezes the audited tensor-product lattice ordering, weights, and opposites', () => {
    expect(D3Q27.q).toBe(27);
    expect(D3Q27.rest).toBe(13);
    expect(D3Q27.velocities[0]).toEqual([-1, -1, -1]);
    expect(D3Q27.velocities[13]).toEqual([0, 0, 0]);
    expect(D3Q27.velocities[26]).toEqual([1, 1, 1]);
    expect(D3Q27.w[13]).toBe(8 / 27);
    let weightSum = 0;
    let isotropyMax = 0;
    for (let i = 0; i < D3Q27.q; i++) {
      weightSum += D3Q27.w[i];
      for (let axis = 0; axis < 3; axis++) {
        expect(D3Q27.velocities[D3Q27.opp[i]][axis] + D3Q27.velocities[i][axis]).toBe(0);
      }
    }
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let moment = 0;
        for (let i = 0; i < D3Q27.q; i++) {
          moment += D3Q27.w[i] * D3Q27.velocities[i][a] * D3Q27.velocities[i][b];
        }
        isotropyMax = Math.max(isotropyMax, Math.abs(moment - (a === b ? 1 / 3 : 0)));
      }
    }
    expect(Math.abs(weightSum - 1)).toBeLessThan(2e-16);
    expect(isotropyMax).toBeLessThan(2e-16);
  });

  it('matches the pre-extraction audited collision vectors at Float64 roundoff', () => {
    let productionVsAuditedPopulationMaxError = 0;
    let conservationMax = 0;
    let finite = true;
    for (const golden of AUDITED_GOLDEN) {
      const populations = Float64Array.from(golden.input);
      const before = conservedD3Q27(populations);
      const collision = collideD3Q27Central(populations, {
        tau0: AHMED_2M_TAU0,
        lesCs: golden.lesCs,
        lesNorm: 'legacy',
      });
      const after = conservedD3Q27(populations);
      productionVsAuditedPopulationMaxError = Math.max(
        productionVsAuditedPopulationMaxError,
        maxPopulationError(populations, golden.output),
      );
      conservationMax = Math.max(
        conservationMax,
        ...before.map((value, index) => Math.abs(value - after[index])),
      );
      finite &&= [...populations, collision.tauEff, ...collision.piNeq].every(Number.isFinite);
    }
    expect(productionVsAuditedPopulationMaxError).toBeLessThanOrEqual(5e-16);
    expect(conservationMax).toBeLessThan(2e-15);
    expect(finite).toBe(true);

    artifact = {
      artifactSchema: 'aeroflow-d3q27-cpu-authority-v1',
      generatedAt: new Date().toISOString(),
      tau0: AHMED_2M_TAU0,
      goldenCases: AUDITED_GOLDEN.map((entry) => entry.id),
      productionVsAuditedPopulationMaxError,
      equilibriumFixedPointMaxError: Number.NaN,
      cyclicPermutationMaxError: Number.NaN,
      periodicMassDriftRelativeMax: Number.NaN,
      periodicMomentumDriftMax: Number.NaN,
      finite,
      passed: false,
    };
  });

  it('preserves the equilibrium fixed point and cyclic axis symmetry', () => {
    const equilibrium = equilibriumD3Q27Central(1.025, 0.05, -0.012, 0.008);
    const collided = new Float64Array(equilibrium);
    const equilibriumResult = collideD3Q27Central(collided, {
      tau0: AHMED_2M_TAU0,
      lesCs: 0.1,
    });
    const equilibriumFixedPointMaxError = maxPopulationError(collided, equilibrium);

    const source = Float64Array.from(AUDITED_GOLDEN[2].input);
    const sourceRotated = cyclicPermutation(source);
    collideD3Q27Central(source, { tau0: AHMED_2M_TAU0, lesCs: 0.1 });
    collideD3Q27Central(sourceRotated, { tau0: AHMED_2M_TAU0, lesCs: 0.1 });
    const cyclicPermutationMaxError = maxPopulationError(sourceRotated, cyclicPermutation(source));

    expect(equilibriumFixedPointMaxError).toBeLessThan(5e-16);
    expect(equilibriumResult.tauEff).toBe(AHMED_2M_TAU0);
    expect(cyclicPermutationMaxError).toBeLessThan(2e-15);
    artifact!.equilibriumFixedPointMaxError = equilibriumFixedPointMaxError;
    artifact!.cyclicPermutationMaxError = cyclicPermutationMaxError;
  });

  it('conserves mass and momentum under finite fully-periodic streaming', () => {
    const grid = { nx: 4, ny: 3, nz: 2 };
    const cells = grid.nx * grid.ny * grid.nz;
    let source = new Float64Array(D3Q27.q * cells);
    let destination = new Float64Array(source.length);
    for (let cell = 0; cell < cells; cell++) {
      const equilibrium = equilibriumD3Q27Central(
        1 + 1e-3 * Math.sin(0.37 * (cell + 1)),
        0.025 + 1e-3 * Math.cos(0.29 * (cell + 1)),
        8e-4 * Math.sin(0.53 * (cell + 1)),
        -6e-4 * Math.cos(0.47 * (cell + 1)),
      );
      for (let direction = 0; direction < D3Q27.q; direction++) {
        source[direction * cells + cell] = equilibrium[direction];
      }
    }
    const initial = fieldConserved(source, cells);
    let periodicMassDriftRelativeMax = 0;
    let periodicMomentumDriftMax = 0;
    let finite = true;
    for (let step = 0; step < 12; step++) {
      streamCollidePeriodicD3Q27(source, destination, grid, {
        tau0: AHMED_2M_TAU0,
        lesCs: 0.1,
      });
      const current = fieldConserved(destination, cells);
      periodicMassDriftRelativeMax = Math.max(
        periodicMassDriftRelativeMax,
        Math.abs((current[0] - initial[0]) / initial[0]),
      );
      periodicMomentumDriftMax = Math.max(
        periodicMomentumDriftMax,
        Math.hypot(current[1] - initial[1], current[2] - initial[2], current[3] - initial[3]),
      );
      finite &&= destination.every(Number.isFinite);
      [source, destination] = [destination, source];
    }
    expect(periodicMassDriftRelativeMax).toBeLessThanOrEqual(1e-12);
    expect(periodicMomentumDriftMax).toBeLessThanOrEqual(1e-12);
    expect(finite).toBe(true);
    artifact!.periodicMassDriftRelativeMax = periodicMassDriftRelativeMax;
    artifact!.periodicMomentumDriftMax = periodicMomentumDriftMax;
    artifact!.finite &&= finite;
    artifact!.passed =
      artifact!.productionVsAuditedPopulationMaxError <= 5e-16 &&
      artifact!.equilibriumFixedPointMaxError < 5e-16 &&
      artifact!.cyclicPermutationMaxError < 2e-15 &&
      periodicMassDriftRelativeMax <= 1e-12 &&
      periodicMomentumDriftMax <= 1e-12 &&
      artifact!.finite;
    expect(artifact!.passed).toBe(true);
  });
});

afterAll(() => {
  if (!artifact) return;
  const directory = resolve('test-results', 'strain-calibration');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'central-moment-d3q27-cpu-authority.json'),
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  );
});
