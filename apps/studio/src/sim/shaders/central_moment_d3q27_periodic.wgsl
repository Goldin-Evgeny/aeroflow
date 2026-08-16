// Bounded D3Q27 central-moment f32 authority port.
// Source of truth: packages/core/src/cpu/centralMomentD3Q27.ts and
// packages/core/src/lattice3d.ts. Direction and moment order are both lexicographic:
//   direction = (cx + 1) * 9 + (cy + 1) * 3 + (cz + 1)
//   moment    = px * 9 + py * 3 + pz
// This kernel is deliberately periodic/ping-pong only. It has no Ahmed boundaries,
// force extraction, checkpoint layout, FP16 path, or Esoteric-Pull ownership rules.

const Q: u32 = 27u;
const REST: u32 = 13u;
const DIAGNOSTICS: u32 = 6u;

struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  cells: u32,
  tau0: f32,
  lesCs: f32,
  historyStep: u32,
  streamPeriodic: u32,
  // fix-confirmed-physics-defects, les-subgrid-closure: 1 = Frobenius norm ('spec',
  // matches centralMomentD3Q27.ts's default-off `lesNorm` option), 0 = legacy
  // √2-too-large norm. 1:1 with collide.ts's CollideContext.lesNorm.
  lesNormSpec: u32,
};

struct CollisionDiagnostics {
  rho: f32,
  ux: f32,
  uy: f32,
  uz: f32,
  tauEff: f32,
  piXy: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> destination: array<f32>;
@group(0) @binding(3) var<storage, read_write> history: array<f32>;
@group(0) @binding(4) var<storage, read_write> preCollisionHistory: array<f32>;
@group(0) @binding(5) var<storage, read_write> postCollisionHistory: array<f32>;

fn directionX(direction: u32) -> i32 {
  return i32(direction / 9u) - 1;
}

fn directionY(direction: u32) -> i32 {
  return i32((direction % 9u) / 3u) - 1;
}

fn directionZ(direction: u32) -> i32 {
  return i32(direction % 3u) - 1;
}

fn exponentX(moment: u32) -> u32 {
  return moment / 9u;
}

fn exponentY(moment: u32) -> u32 {
  return (moment % 9u) / 3u;
}

fn exponentZ(moment: u32) -> u32 {
  return moment % 3u;
}

fn power012(value: f32, exponent: u32) -> f32 {
  if (exponent == 0u) {
    return 1.0;
  }
  if (exponent == 1u) {
    return value;
  }
  return value * value;
}

fn centralBasis(moment: u32, direction: u32, ux: f32, uy: f32, uz: f32) -> f32 {
  return power012(f32(directionX(direction)) - ux, exponentX(moment)) *
    power012(f32(directionY(direction)) - uy, exponentY(moment)) *
    power012(f32(directionZ(direction)) - uz, exponentZ(moment));
}

fn attractor(moment: u32, rho: f32) -> f32 {
  let px = exponentX(moment);
  let py = exponentY(moment);
  let pz = exponentZ(moment);
  if (px == 1u || py == 1u || pz == 1u) {
    return 0.0;
  }
  var result = rho;
  if (px == 2u) {
    result *= 1.0 / 3.0;
  }
  if (py == 2u) {
    result *= 1.0 / 3.0;
  }
  if (pz == 2u) {
    result *= 1.0 / 3.0;
  }
  return result;
}

fn collide(populations: ptr<function, array<f32, 27>>) -> CollisionDiagnostics {
  var rho = 0.0;
  var mx = 0.0;
  var my = 0.0;
  var mz = 0.0;
  for (var direction = 0u; direction < Q; direction++) {
    let value = (*populations)[direction];
    rho += value;
    mx += f32(directionX(direction)) * value;
    my += f32(directionY(direction)) * value;
    mz += f32(directionZ(direction)) * value;
  }
  let ux = mx / rho;
  let uy = my / rho;
  let uz = mz / rho;

  var moments: array<f32, 27>;
  var equilibrium: array<f32, 27>;
  for (var moment = 0u; moment < Q; moment++) {
    var value = 0.0;
    for (var direction = 0u; direction < Q; direction++) {
      value += centralBasis(moment, direction, ux, uy, uz) * (*populations)[direction];
    }
    moments[moment] = value;
    equilibrium[moment] = attractor(moment, rho);
  }

  var piNeq: array<f32, 6>;
  piNeq[0] = moments[18] - equilibrium[18];
  piNeq[1] = moments[6] - equilibrium[6];
  piNeq[2] = moments[2] - equilibrium[2];
  piNeq[3] = moments[12];
  piNeq[4] = moments[10];
  piNeq[5] = moments[4];
  // Norm selected by params.lesNormSpec (fix-confirmed-physics-defects,
  // les-subgrid-closure): 1 = Frobenius, 0 = legacy √2-too-large norm. Legacy computes the
  // original single-sqrt expression, NOT sqrt(2)*sqrt(Frobenius) — see
  // stream_collide_3d.wgsl's identical comment for why that reordering matters.
  let piNorm = select(
    sqrt(2.0 * (
      piNeq[0] * piNeq[0] + piNeq[1] * piNeq[1] + piNeq[2] * piNeq[2] +
      2.0 * (piNeq[3] * piNeq[3] + piNeq[4] * piNeq[4] + piNeq[5] * piNeq[5])
    )),
    sqrt(
      piNeq[0] * piNeq[0] + piNeq[1] * piNeq[1] + piNeq[2] * piNeq[2] +
      2.0 * (piNeq[3] * piNeq[3] + piNeq[4] * piNeq[4] + piNeq[5] * piNeq[5])
    ),
    params.lesNormSpec == 1u,
  );
  let lesK = 18.0 * sqrt(2.0) * params.lesCs * params.lesCs;
  var tauEff = params.tau0;
  if (lesK != 0.0) {
    tauEff = params.tau0 +
      0.5 * (sqrt(params.tau0 * params.tau0 + lesK * piNorm / rho) - params.tau0);
  }

  var post: array<f32, 27>;
  for (var moment = 0u; moment < Q; moment++) {
    post[moment] = equilibrium[moment];
  }
  post[0] = moments[0];
  post[9] = moments[9];
  post[3] = moments[3];
  post[1] = moments[1];

  let trace = equilibrium[18] + equilibrium[6] + equilibrium[2];
  let omega = 1.0 / tauEff;
  let differenceXy = (1.0 - omega) * (moments[18] - moments[6]);
  let differenceYz = (1.0 - omega) * (moments[6] - moments[2]);
  post[18] = (trace + 2.0 * differenceXy + differenceYz) / 3.0;
  post[6] = (trace - differenceXy + differenceYz) / 3.0;
  post[2] = (trace - differenceXy - 2.0 * differenceYz) / 3.0;
  post[12] = moments[12] + omega * (equilibrium[12] - moments[12]);
  post[10] = moments[10] + omega * (equilibrium[10] - moments[10]);
  post[4] = moments[4] + omega * (equilibrium[4] - moments[4]);

  // f32 transliteration of the CPU authority's Gauss-Jordan inverse with partial pivoting.
  var augmented: array<array<f32, 28>, 27>;
  for (var row = 0u; row < Q; row++) {
    for (var column = 0u; column < Q; column++) {
      augmented[row][column] = centralBasis(row, column, ux, uy, uz);
    }
    augmented[row][Q] = post[row];
  }
  // CPU (centralMomentD3Q27.ts): `throw new Error('singular D3Q27 central-moment basis')`
  // at |pivot| < 1e-14. f32 conditioning is worse than f64, so the pivot the CPU authority
  // refuses is exactly the one f32 is most likely to hit — and WGSL cannot throw. Detect it
  // and surface a non-finite sentinel instead of dividing by a near-zero diagonal and
  // propagating an undiagnosed Inf/NaN (solver-failure-visibility).
  var singular = false;
  for (var pivot = 0u; pivot < Q; pivot++) {
    var best = pivot;
    for (var row = pivot + 1u; row < Q; row++) {
      if (abs(augmented[row][pivot]) > abs(augmented[best][pivot])) {
        best = row;
      }
    }
    if (abs(augmented[best][pivot]) < 1e-14) {
      singular = true;
      break;
    }
    for (var column = pivot; column <= Q; column++) {
      let temporary = augmented[pivot][column];
      augmented[pivot][column] = augmented[best][column];
      augmented[best][column] = temporary;
    }
    let diagonal = augmented[pivot][pivot];
    for (var column = pivot; column <= Q; column++) {
      augmented[pivot][column] /= diagonal;
    }
    for (var row = 0u; row < Q; row++) {
      if (row != pivot) {
        let factor = augmented[row][pivot];
        for (var column = pivot; column <= Q; column++) {
          augmented[row][column] -= factor * augmented[pivot][column];
        }
      }
    }
  }

  if (singular) {
    // fix-confirmed-physics-defects, task 2.3 finding: a fully-literal
    // `bitcast<f32>(0x7fc00000u)` is a WGSL const-expression regardless of `const` vs `let`,
    // and Dawn rejects any const-expression that evaluates to NaN at CreateShaderModule time
    // ("value nan cannot be represented as 'f32'") — confirmed on real hardware for the
    // identical pattern in stream_collide_3d.wgsl's free-slip sentinel, which silently broke
    // shader compilation for every scene using it. XOR with a genuinely runtime value that is
    // always numerically 0 — a bit read off the populations buffer already in scope, not a
    // loop variable that could compile-time-fold — keeps the bit pattern identical while
    // defeating constant-folding, so the NaN is produced at runtime instead.
    let sentinel = bitcast<f32>(0x7fc00000u ^ (bitcast<u32>((*populations)[0]) & 0u));
    for (var direction = 0u; direction < Q; direction++) {
      (*populations)[direction] = sentinel;
    }
    return CollisionDiagnostics(sentinel, sentinel, sentinel, sentinel, sentinel, sentinel);
  }

  var rhoOut = 0.0;
  for (var direction = 0u; direction < Q; direction++) {
    (*populations)[direction] = augmented[direction][Q];
    rhoOut += (*populations)[direction];
  }
  (*populations)[REST] += rho - rhoOut;
  return CollisionDiagnostics(rho, ux, uy, uz, tauEff, piNeq[3]);
}

@compute @workgroup_size(64)
fn streamCollidePeriodic(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x;
  if (cell >= params.cells) {
    return;
  }

  let x = cell % params.nx;
  let y = (cell / params.nx) % params.ny;
  let z = cell / (params.nx * params.ny);
  var populations: array<f32, 27>;
  for (var direction = 0u; direction < Q; direction++) {
    var sourceCell = cell;
    if (params.streamPeriodic != 0u) {
      let sx = (i32(x) - directionX(direction) + i32(params.nx)) % i32(params.nx);
      let sy = (i32(y) - directionY(direction) + i32(params.ny)) % i32(params.ny);
      let sz = (i32(z) - directionZ(direction) + i32(params.nz)) % i32(params.nz);
      sourceCell = u32(sx) + params.nx * (u32(sy) + params.ny * u32(sz));
    }
    populations[direction] = source[direction * params.cells + sourceCell];
    let populationHistoryBase = params.historyStep * Q * params.cells;
    preCollisionHistory[populationHistoryBase + direction * params.cells + cell] =
      populations[direction];
  }

  let collisionResult = collide(&populations);
  for (var direction = 0u; direction < Q; direction++) {
    destination[direction * params.cells + cell] = populations[direction];
    let populationHistoryBase = params.historyStep * Q * params.cells;
    postCollisionHistory[populationHistoryBase + direction * params.cells + cell] =
      populations[direction];
  }
  let base = params.historyStep * DIAGNOSTICS * params.cells;
  history[base + 0u * params.cells + cell] = collisionResult.rho;
  history[base + 1u * params.cells + cell] = collisionResult.ux;
  history[base + 2u * params.cells + cell] = collisionResult.uy;
  history[base + 3u * params.cells + cell] = collisionResult.uz;
  history[base + 4u * params.cells + cell] = collisionResult.tauEff;
  history[base + 5u * params.cells + cell] = collisionResult.piXy;
}
