import { CellType } from '@aeroflow/core';

/**
 * The FIXED parity test scene (docs/handoff/H6-parity-panel.md §2). Never change these
 * numbers — parity results must be comparable across months. 32×32; solid top/bottom
 * walls; inlet column x=0; outlet column x=31; an asymmetric solid block (off-center on
 * purpose, so a sign bug can't hide behind symmetry).
 */
export const PARITY_SCENE = {
  nx: 32,
  ny: 32,
  tau: 0.8,
  uin: 0.05,
  lesCs: 0.1,
  block: { x0: 10, x1: 13, y0: 14, y1: 21 },
} as const;

/** Build the cell flags (CellType values) for the parity scene. */
export function parityFlags(): Uint8Array {
  const { nx, ny, block } = PARITY_SCENE;
  const flags = new Uint8Array(nx * ny);
  const idx = (x: number, y: number) => y * nx + x;
  // Inlet / outlet columns first; walls override the corner cells.
  for (let y = 0; y < ny; y++) {
    flags[idx(0, y)] = CellType.Inlet;
    flags[idx(nx - 1, y)] = CellType.Outlet;
  }
  for (let x = 0; x < nx; x++) {
    flags[idx(x, 0)] = CellType.Solid;
    flags[idx(x, ny - 1)] = CellType.Solid;
  }
  for (let y = block.y0; y <= block.y1; y++) {
    for (let x = block.x0; x <= block.x1; x++) flags[idx(x, y)] = CellType.Solid;
  }
  return flags;
}

export interface ParityConfig {
  key: string;
  collision: 'bgk' | 'trt';
  lesCs: number; // 0 = off
  regularize: boolean;
  conserveMass: boolean;
}

const BASE_PARITY_CONFIGS: ParityConfig[] = [
  { key: 'bgk', collision: 'bgk', lesCs: 0, regularize: false, conserveMass: false },
  { key: 'trt', collision: 'trt', lesCs: 0, regularize: false, conserveMass: false },
  {
    key: 'bgk+les',
    collision: 'bgk',
    lesCs: PARITY_SCENE.lesCs,
    regularize: false,
    conserveMass: false,
  },
  {
    key: 'trt+les',
    collision: 'trt',
    lesCs: PARITY_SCENE.lesCs,
    regularize: false,
    conserveMass: false,
  },
  { key: 'bgk+reg', collision: 'bgk', lesCs: 0, regularize: true, conserveMass: false },
  { key: 'trt+reg', collision: 'trt', lesCs: 0, regularize: true, conserveMass: false },
  {
    key: 'bgk+les+reg',
    collision: 'bgk',
    lesCs: PARITY_SCENE.lesCs,
    regularize: true,
    conserveMass: false,
  },
  {
    key: 'trt+les+reg',
    collision: 'trt',
    lesCs: PARITY_SCENE.lesCs,
    regularize: true,
    conserveMass: false,
  },
];

/** H6 base + H10 compositions, followed by the same complete matrix with H13 enabled. */
export const PARITY_CONFIGS: ParityConfig[] = [
  ...BASE_PARITY_CONFIGS,
  ...BASE_PARITY_CONFIGS.map((config) => ({
    ...config,
    key: `${config.key}+cons`,
    conserveMass: true,
  })),
];

/** Step counts and their gates (H6 §3). */
export const PARITY_GATES = [
  { n: 10, gate: 1e-5 },
  { n: 200, gate: 1e-4 },
] as const;

/**
 * A fixed parity scene: geometry + flow parameters both CPU and GPU are handed
 * identically. `uin` is both the reset velocity (uniform ρ=1, u=(uin,0)) and the
 * prescribed inlet velocity (the latter irrelevant when a scene has no inlet cells).
 * `wallVel`, if present, is the per-cell moving-wall velocity array (length 2·n)
 * exercised by the cavity — for the duct it is undefined (all walls stationary).
 */
export interface ParityScene {
  key: string;
  nx: number;
  ny: number;
  tau: number;
  uin: number;
  flags: Uint8Array;
  wallVel?: Float64Array;
}

/** The M1/M2 duct: inlet/outlet with an asymmetric solid block. */
export function ductScene(): ParityScene {
  const { nx, ny, tau, uin } = PARITY_SCENE;
  return { key: '', nx, ny, tau, uin, flags: parityFlags() };
}

/**
 * M3 lid-driven cavity, small grid: a one-cell solid rim with the whole top row moving
 * at u=(uLid,0). Exercises the moving-wall bounce-back correction against the CPU oracle.
 * Fixed 32×32, τ=0.8, uLid=0.1, initialised at rest (initU=0) — never change these.
 */
export function cavityScene(): ParityScene {
  const nx = 32;
  const ny = 32;
  const uLid = 0.1;
  const flags = new Uint8Array(nx * ny);
  const wallVel = new Float64Array(2 * nx * ny);
  const idx = (x: number, y: number) => y * nx + x;
  for (let x = 0; x < nx; x++) {
    flags[idx(x, 0)] = CellType.Solid; // floor
    flags[idx(x, ny - 1)] = CellType.Solid; // moving lid (whole top row, incl. corners)
    wallVel[2 * idx(x, ny - 1)] = uLid;
  }
  for (let y = 0; y < ny; y++) {
    flags[idx(0, y)] = CellType.Solid; // left/right walls
    flags[idx(nx - 1, y)] = CellType.Solid;
  }
  return { key: 'cav:', nx, ny, tau: 0.8, uin: 0, flags, wallVel };
}
