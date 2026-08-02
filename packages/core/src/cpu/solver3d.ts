import { CellType } from '../lattice.js';
import { D3Q19 } from '../lattice3d.js';
import {
  collideCell,
  D3Q19_SPEC,
  equilibrium3,
  makeCollideContext,
  type CollideContext,
  type Collision,
  type Forcing,
} from './collide.js';
import { resolveFreeSlipPull, validateFreeSlip, type FreeSlipFaces } from './freeslip.js';

/**
 * CPU reference D3Q19 solver — naive two-array pull streaming, deliberately readable
 * and unoptimized (docs/handoff/H3-solver3d.md). This is the oracle the esoteric
 * in-place implementation must match BIT-FOR-BIT (docs/handoff/H4-esoteric-pull.md §8)
 * and the 3D WGSL kernels must match via the parity panel.
 *
 * Index convention (frozen): idx = x + nx·(y + ny·z).
 *
 * Precondition: every non-periodic domain face is a one-cell shell of non-Fluid cells
 * (validated in the constructor) — fluid cells therefore never have out-of-bounds
 * neighbors. Free-slip faces (M10) are shell cells of `CellType.FreeSlip` with the
 * specular pull redirection of docs/handoff/H11-free-slip.md.
 */
export interface Solver3DOptions {
  nx: number;
  ny: number;
  nz: number;
  /** Relaxation rate ω = 1/τ₀. */
  omega: number;
  flags?: Uint8Array;
  gravity?: readonly [number, number, number];
  inletVelocity?: number;
  periodicX?: boolean;
  periodicY?: boolean;
  periodicZ?: boolean;
  collision?: Collision;
  lambda?: number;
  les?: { cs: number };
  /** Projected (Latt–Chopard) regularization of the collision — H10. */
  regularize?: boolean;
  /** Restore the incoming zeroth moment after collision roundoff — H13. */
  conserveMass?: boolean;
  forcing?: Exclude<Forcing, 'none'>;
  forceMask?: Uint8Array;
  /**
   * Per-layer inlet velocity profile (M10 ABL): every Inlet cell prescribes equilibrium
   * at ux = ux[heightIndex] where heightIndex runs along `axis` (repo scenes are y-up;
   * M10's z-up prose maps to axis 'z'). Overrides the scalar `inletVelocity`. Length must
   * equal the axis extent. Applies to ALL Inlet cells — lateral freestream faces carry
   * the height profile too, which is the consistent far-field for a sheared inflow.
   */
  inletProfile?: { axis: 'y' | 'z'; ux: Float64Array };
  /**
   * Specular free-slip domain faces (H11). Cells flagged `CellType.FreeSlip` must lie
   * on these faces; gathers whose pull source is FreeSlip are redirected per H11 §3.
   */
  freeSlip?: FreeSlipFaces;
}

const { q, ex, ey, ez, opp } = D3Q19;

export class Solver3D {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly n: number;
  readonly flags: Uint8Array;
  inletVelocity: number;
  readonly ctx: CollideContext;
  private readonly inletProfile: { axis: 'y' | 'z'; ux: Float64Array } | undefined;
  private readonly freeSlip: FreeSlipFaces;
  private readonly forceMask: Uint8Array | undefined;
  private readonly periodicX: boolean;
  private readonly periodicY: boolean;
  private readonly periodicZ: boolean;
  /** SoA direction-major, POST-collision values: f[i·n + idx]. */
  private fSrc: Float64Array;
  private fDst: Float64Array;
  private readonly scratch: Float64Array;
  private stepCount = 0;
  private _force = { x: 0, y: 0, z: 0 };
  private _maskedForce = { x: 0, y: 0, z: 0 };

  constructor(opts: Solver3DOptions) {
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.nz = opts.nz;
    this.n = opts.nx * opts.ny * opts.nz;
    this.inletVelocity = opts.inletVelocity ?? 0;
    this.inletProfile = opts.inletProfile;
    if (this.inletProfile) {
      const expected = this.inletProfile.axis === 'y' ? opts.ny : opts.nz;
      if (this.inletProfile.ux.length !== expected) {
        throw new Error(
          `inletProfile.ux length ${this.inletProfile.ux.length} ≠ ${this.inletProfile.axis}-extent ${expected}`,
        );
      }
    }
    this.periodicX = opts.periodicX ?? false;
    this.periodicY = opts.periodicY ?? false;
    this.periodicZ = opts.periodicZ ?? false;
    this.freeSlip = opts.freeSlip ?? {};
    this.flags = opts.flags ?? new Uint8Array(this.n);
    if (this.flags.length !== this.n) throw new Error('flags length must be nx·ny·nz');
    validateFreeSlip(this.flags, this.nx, this.ny, this.nz, this.freeSlip);
    this.forceMask = opts.forceMask;
    this.ctx = makeCollideContext(D3Q19_SPEC, {
      tau: 1 / opts.omega,
      collision: opts.collision,
      lambda: opts.lambda,
      lesCs: opts.les?.cs,
      regularize: opts.regularize,
      conserveMass: opts.conserveMass,
      forcing: opts.forcing,
      gravity: opts.gravity,
    });
    this.validateShell();
    this.fSrc = new Float64Array(q * this.n);
    this.fDst = new Float64Array(q * this.n);
    this.scratch = new Float64Array(q);
    this.reset();
  }

  idx(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }

  get steps(): number {
    return this.stepCount;
  }

  get force(): { x: number; y: number; z: number } {
    return { ...this._force };
  }

  get maskedForce(): { x: number; y: number; z: number } {
    return { ...this._maskedForce };
  }

  /** H3 §2: fluid cells must never see out-of-bounds neighbors. */
  private validateShell(): void {
    const { nx, ny, nz, flags } = this;
    const bad = (x: number, y: number, z: number) => flags[this.idx(x, y, z)] === CellType.Fluid;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const onX = !this.periodicX && (x === 0 || x === nx - 1);
          const onY = !this.periodicY && (y === 0 || y === ny - 1);
          const onZ = !this.periodicZ && (z === 0 || z === nz - 1);
          if ((onX || onY || onZ) && bad(x, y, z)) {
            throw new Error(
              `Solver3D: fluid cell on a non-periodic boundary at (${x},${y},${z}) — ` +
                'every non-periodic face must be a shell of Solid/Inlet/Outlet cells (H3 §2)',
            );
          }
          // H12 §2: VelocityInlet only on the x=0 face, +x neighbor must be Fluid.
          if (flags[this.idx(x, y, z)] === CellType.VelocityInlet) {
            if (x !== 0) {
              throw new Error(`VelocityInlet at (${x},${y},${z}) must sit on the x=0 face`);
            }
            if (flags[this.idx(1, y, z)] !== CellType.Fluid) {
              throw new Error(
                `VelocityInlet at (0,${y},${z}) needs a Fluid +x neighbor (H12 §2) — ` +
                  `keep edges/corners as plain Inlet or FreeSlip`,
              );
            }
          }
          // Zero-gradient outlets copy their upstream (−x) neighbor: that neighbor
          // being Solid is physically meaningless and implementation-dependent
          // (measured: naive copies zeros, esoteric copies scratch — H4 §10.9).
          if (flags[this.idx(x, y, z)] === CellType.Outlet && x > 0) {
            const up = flags[this.idx(x - 1, y, z)];
            if (up === CellType.Solid) {
              throw new Error(
                `Solver3D: Outlet at (${x},${y},${z}) has a Solid upstream neighbor — ` +
                  'keep at least one non-solid cell upstream of every outlet',
              );
            }
          }
        }
      }
    }
  }

  reset(rho = 1, ux = 0, uy = 0, uz = 0): void {
    for (let idx = 0; idx < this.n; idx++) {
      const solid = this.flags[idx] === CellType.Solid;
      for (let i = 0; i < q; i++) {
        this.fSrc[i * this.n + idx] = solid ? 0 : equilibrium3(D3Q19_SPEC, i, rho, ux, uy, uz);
        this.fDst[i * this.n + idx] = 0;
      }
    }
    this.stepCount = 0;
  }

  step(count = 1): void {
    for (let s = 0; s < count; s++) this.stepOnce();
  }

  private stepOnce(): void {
    const { nx, ny, nz, n, flags, fSrc, fDst, ctx, scratch: f } = this;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    let mfx = 0;
    let mfy = 0;
    let mfz = 0;

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + nx * (y + ny * z);
          const flag = flags[idx];
          // Solid and FreeSlip cells are passive — FreeSlip semantics live entirely in
          // the neighbors' redirected gathers (H11 §4).
          if (flag === CellType.Solid || flag === CellType.FreeSlip) continue;

          if (flag === CellType.Inlet || flag === CellType.VelocityInlet) {
            const uIn = this.inletProfile
              ? this.inletProfile.ux[this.inletProfile.axis === 'y' ? y : z]
              : this.inletVelocity;
            // H12: the flux-imposing variant prescribes u at the +x neighbor's PREVIOUS
            // density (zero-gradient ρ); fSrc is immutable during the sweep, and the
            // i-order sum matches the esoteric pre-pass bit for bit (H12 §3/§4).
            let rho = 1;
            if (flag === CellType.VelocityInlet) {
              rho = 0;
              for (let i = 0; i < q; i++) rho += fSrc[i * n + idx + 1];
            }
            for (let i = 0; i < q; i++) {
              fDst[i * n + idx] = equilibrium3(D3Q19_SPEC, i, rho, uIn, 0, 0);
            }
            continue;
          }

          if (flag === CellType.Outlet) {
            const src = idx - 1; // upstream in x (outlets live on the +x face)
            for (let i = 0; i < q; i++) fDst[i * n + idx] = fSrc[i * n + src];
            continue;
          }

          for (let i = 0; i < q; i++) {
            let sx = x - ex[i];
            let sy = y - ey[i];
            let sz = z - ez[i];
            let bounce = false;
            let solidIdx = -1;
            if (sx < 0 || sx >= nx) {
              if (this.periodicX) sx = (sx + nx) % nx;
              else bounce = true;
            }
            if (sy < 0 || sy >= ny) {
              if (this.periodicY) sy = (sy + ny) % ny;
              else bounce = true;
            }
            if (sz < 0 || sz >= nz) {
              if (this.periodicZ) sz = (sz + nz) % nz;
              else bounce = true;
            }
            if (!bounce) {
              const s = sx + nx * (sy + ny * sz);
              if (flags[s] === CellType.Solid) {
                bounce = true;
                solidIdx = s;
              } else if (flags[s] === CellType.FreeSlip) {
                // Specular redirection (H11 §3–4): read f_J^out(S, t) — exact timing,
                // no force contribution (slip walls exchange no tangential momentum).
                const r = resolveFreeSlipPull(flags, nx, ny, nz, this.freeSlip, sx, sy, sz, i);
                if (r.fallback) {
                  bounce = true; // slip∩solid edge: plain local bounce, forceless
                } else {
                  f[i] = fSrc[r.dir * n + (r.sx + nx * (r.sy + ny * r.sz))];
                }
              } else {
                f[i] = fSrc[i * n + s];
              }
            }
            if (bounce) {
              const ib = opp[i];
              const v = fSrc[ib * n + idx];
              f[i] = v;
              if (solidIdx >= 0) {
                const cx = 2 * ex[ib] * v;
                const cy = 2 * ey[ib] * v;
                const cz = 2 * ez[ib] * v;
                fx += cx;
                fy += cy;
                fz += cz;
                if (this.forceMask && this.forceMask[solidIdx] === 1) {
                  mfx += cx;
                  mfy += cy;
                  mfz += cz;
                }
              }
            }
          }

          collideCell(f, ctx);
          for (let i = 0; i < q; i++) fDst[i * n + idx] = f[i];
        }
      }
    }

    this._force = { x: fx, y: fy, z: fz };
    this._maskedForce = { x: mfx, y: mfy, z: mfz };
    const tmp = this.fSrc;
    this.fSrc = this.fDst;
    this.fDst = tmp;
    this.stepCount++;
  }

  /** Post-collision state copy — the naive side of the H4 §8 bit-identity comparison. */
  snapshotPostCollision(): Float64Array {
    return Float64Array.from(this.fSrc);
  }

  /** Physical macroscopics (Guo: moment/ρ − g/2; see solver2d for the derivation). */
  macroscopics(): { rho: Float64Array; ux: Float64Array; uy: Float64Array; uz: Float64Array } {
    const { n, fSrc, flags, ctx } = this;
    const rho = new Float64Array(n);
    const ux = new Float64Array(n);
    const uy = new Float64Array(n);
    const uz = new Float64Array(n);
    const cx = ctx.forcing === 'guo' ? 0.5 * ctx.gx : 0;
    const cy = ctx.forcing === 'guo' ? 0.5 * ctx.gy : 0;
    const cz = ctx.forcing === 'guo' ? 0.5 * ctx.gz : 0;
    for (let idx = 0; idx < n; idx++) {
      if (flags[idx] === CellType.Solid) continue;
      let r = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let i = 0; i < q; i++) {
        const fi = fSrc[i * n + idx];
        r += fi;
        mx += ex[i] * fi;
        my += ey[i] * fi;
        mz += ez[i] * fi;
      }
      rho[idx] = r;
      ux[idx] = mx / r - cx;
      uy[idx] = my / r - cy;
      uz[idx] = mz / r - cz;
    }
    return { rho, ux, uy, uz };
  }

  totalMass(): number {
    const { n, fSrc, flags } = this;
    let m = 0;
    for (let idx = 0; idx < n; idx++) {
      if (flags[idx] === CellType.Solid) continue;
      for (let i = 0; i < q; i++) m += fSrc[i * n + idx];
    }
    return m;
  }
}
