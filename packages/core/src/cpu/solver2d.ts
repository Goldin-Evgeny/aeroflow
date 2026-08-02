import { CellType, D2Q9 } from '../lattice.js';
import {
  collideCell,
  D2Q9_SPEC,
  equilibrium3,
  makeCollideContext,
  type CollideContext,
  type Collision,
  type Forcing,
} from './collide.js';

/**
 * CPU reference D2Q9 solver — the correctness oracle for the 2D GPU kernels.
 *
 * Pull streaming with halfway bounce-back, equilibrium inlet, zero-gradient outlet;
 * collision (BGK/TRT, optional Smagorinsky LES, Guo or legacy shifted forcing) is
 * delegated to the shared `collideCell` core (docs/handoff/H1-trt-les-forcing.md).
 * Momentum-exchange forces per docs/handoff/H2-momentum-exchange.md.
 *
 * Deliberately simple and unoptimized; Float64 throughout.
 */
export interface Solver2DOptions {
  nx: number;
  ny: number;
  /** Relaxation rate ω = 1/τ (of the base τ₀ when LES is on). */
  omega: number;
  /** Cell flags (CellType), length nx·ny, row-major (idx = y·nx + x). Default all fluid. */
  flags?: Uint8Array;
  /** Body force per unit mass (acceleration, lattice units). */
  gravity?: readonly [number, number];
  /** Inlet x-velocity (lattice units) applied at Inlet cells. */
  inletVelocity?: number;
  periodicX?: boolean;
  periodicY?: boolean;
  /** Collision operator. Default 'bgk'. */
  collision?: Collision;
  /** TRT magic parameter Λ. Default 3/16. */
  lambda?: number;
  /** Smagorinsky LES; off when undefined. */
  les?: { cs: number };
  /** Projected (Latt–Chopard) regularization of the collision — H10. */
  regularize?: boolean;
  /** Restore the incoming zeroth moment after collision roundoff — H13. */
  conserveMass?: boolean;
  /** Forcing scheme when gravity ≠ 0. Default 'guo'; 'shift' is legacy (BGK-only). */
  forcing?: Exclude<Forcing, 'none'>;
  /**
   * Outlet boundary treatment. Default 'zero-gradient' (legacy copy-upstream, and the
   * GPU kernel's default — keep them matched for the H6 duct parity). External-flow cases
   * (cylinder onward) opt into 'pressure': fixed-density (ρ=1) non-equilibrium
   * extrapolation (Guo-style), which suppresses outlet reflections.
   */
  outlet?: 'pressure' | 'zero-gradient';
  /** Optional per-cell mask (1 = measured obstacle) for the maskedForce accumulator. */
  forceMask?: Uint8Array;
  /**
   * Optional moving-wall velocities, length 2·n: [ux, uy] per solid cell (only nonzero
   * entries matter). Enables the lid-driven cavity (M3) via the moving-wall halfway
   * bounce-back correction f_i(x) = f*_opp(i)(x) + 6·w_i·ρ₀·(e_i·u_wall).
   */
  wallVelocity?: Float64Array;
}

export interface Macroscopics {
  rho: Float64Array;
  ux: Float64Array;
  uy: Float64Array;
}

const { q, ex, ey, opp, w } = D2Q9;

export class Solver2D {
  readonly nx: number;
  readonly ny: number;
  readonly n: number;
  readonly flags: Uint8Array;
  inletVelocity: number;
  private readonly forceMask: Uint8Array | undefined;
  private readonly wallVelocity: Float64Array | undefined;
  private readonly periodicX: boolean;
  private readonly periodicY: boolean;
  private readonly outlet: 'pressure' | 'zero-gradient';
  private readonly ctx: CollideContext;
  /** Distributions, SoA direction-major: f[i·n + idx]. Post-collision values. */
  private fSrc: Float64Array;
  private fDst: Float64Array;
  private readonly scratch: Float64Array;
  private stepCount = 0;
  /** Momentum-exchange force on ALL flag-Solid cells, from the most recent step. */
  private _force = { x: 0, y: 0 };
  /** Same, restricted to forceMask===1 solid cells. */
  private _maskedForce = { x: 0, y: 0 };

  constructor(opts: Solver2DOptions) {
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.n = opts.nx * opts.ny;
    this.inletVelocity = opts.inletVelocity ?? 0;
    this.periodicX = opts.periodicX ?? false;
    this.periodicY = opts.periodicY ?? false;
    this.outlet = opts.outlet ?? 'zero-gradient';
    this.flags = opts.flags ?? new Uint8Array(this.n);
    if (this.flags.length !== this.n) throw new Error('flags length must be nx·ny');
    this.forceMask = opts.forceMask;
    this.wallVelocity = opts.wallVelocity;
    if (this.wallVelocity && this.wallVelocity.length !== 2 * this.n) {
      throw new Error('wallVelocity length must be 2·nx·ny');
    }
    if (this.forceMask && this.forceMask.length !== this.n) {
      throw new Error('forceMask length must be nx·ny');
    }
    this.ctx = makeCollideContext(D2Q9_SPEC, {
      tau: 1 / opts.omega,
      collision: opts.collision,
      lambda: opts.lambda,
      lesCs: opts.les?.cs,
      regularize: opts.regularize,
      conserveMass: opts.conserveMass,
      forcing: opts.forcing,
      gravity: opts.gravity ? [opts.gravity[0], opts.gravity[1], 0] : undefined,
    });
    this.fSrc = new Float64Array(q * this.n);
    this.fDst = new Float64Array(q * this.n);
    this.scratch = new Float64Array(q);
    this.reset();
  }

  idx(x: number, y: number): number {
    return y * this.nx + x;
  }

  get steps(): number {
    return this.stepCount;
  }

  get omega(): number {
    return 1 / this.ctx.tau0;
  }

  set omega(v: number) {
    if (v <= 0 || v >= 2) throw new Error('omega must be in (0, 2)');
    this.ctx.tau0 = 1 / v;
  }

  get force(): { x: number; y: number } {
    return { ...this._force };
  }

  get maskedForce(): { x: number; y: number } {
    return { ...this._maskedForce };
  }

  /** Initialize every non-solid cell to equilibrium at (rho, ux, uy). */
  reset(rho = 1, ux = 0, uy = 0): void {
    for (let idx = 0; idx < this.n; idx++) {
      const solid = this.flags[idx] === CellType.Solid;
      for (let i = 0; i < q; i++) {
        this.fSrc[i * this.n + idx] = solid ? 0 : equilibrium3(D2Q9_SPEC, i, rho, ux, uy, 0);
        this.fDst[i * this.n + idx] = 0;
      }
    }
    this.stepCount = 0;
  }

  step(count = 1): void {
    for (let s = 0; s < count; s++) this.stepOnce();
  }

  private stepOnce(): void {
    const { nx, ny, n, flags, fSrc, fDst, ctx, scratch: f, wallVelocity: wallVel } = this;
    let fx = 0;
    let fy = 0;
    let mfx = 0;
    let mfy = 0;

    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = y * nx + x;
        const flag = flags[idx];
        if (flag === CellType.Solid) continue;

        if (flag === CellType.Inlet) {
          for (let i = 0; i < q; i++) {
            fDst[i * n + idx] = equilibrium3(D2Q9_SPEC, i, 1, this.inletVelocity, 0, 0);
          }
          continue;
        }

        if (flag === CellType.Outlet) {
          const src = idx - 1;
          if (this.outlet === 'zero-gradient') {
            for (let i = 0; i < q; i++) fDst[i * n + idx] = fSrc[i * n + src];
            continue;
          }
          // Fixed-density (ρ=1) non-equilibrium extrapolation (Guo-style):
          //   f_i(out) = f_i^eq(1, u_n) + (f_i(xn) − f_i^eq(ρ_n, u_n))
          // with ρ_n, u_n the upstream neighbour's post-collision macroscopics.
          let rn = 0;
          let mx = 0;
          let my = 0;
          for (let i = 0; i < q; i++) {
            const fi = fSrc[i * n + src];
            rn += fi;
            mx += ex[i] * fi;
            my += ey[i] * fi;
          }
          const shx = ctx.forcing === 'guo' ? 0.5 * ctx.gx : 0;
          const shy = ctx.forcing === 'guo' ? 0.5 * ctx.gy : 0;
          const un = mx / rn - shx;
          const vn = my / rn - shy;
          for (let i = 0; i < q; i++) {
            const feqOut = equilibrium3(D2Q9_SPEC, i, 1, un, vn, 0);
            const feqN = equilibrium3(D2Q9_SPEC, i, rn, un, vn, 0);
            fDst[i * n + idx] = feqOut + (fSrc[i * n + src] - feqN);
          }
          continue;
        }

        // Pull streaming with halfway bounce-back + momentum-exchange accumulation.
        for (let i = 0; i < q; i++) {
          let sx = x - ex[i];
          let sy = y - ey[i];
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
          if (!bounce) {
            const s = sy * nx + sx;
            if (flags[s] === CellType.Solid) {
              bounce = true;
              solidIdx = s;
            }
          }
          if (bounce) {
            const ib = opp[i];
            const base = fSrc[ib * n + idx];
            let streamed = base;
            if (solidIdx >= 0 && wallVel) {
              const wux = wallVel[2 * solidIdx];
              const wuy = wallVel[2 * solidIdx + 1];
              if (wux !== 0 || wuy !== 0) {
                // Moving-wall halfway bounce-back (Ladd): + 6·w_i·ρ₀·(e_i·u_wall).
                streamed += 6 * w[i] * (ex[i] * wux + ey[i] * wuy);
              }
            }
            f[i] = streamed;
            if (solidIdx >= 0) {
              // Link direction ī = opp(i) points into the solid; F_link = 2·e_ī·f*_ī.
              const cx = 2 * ex[ib] * base;
              const cy = 2 * ey[ib] * base;
              fx += cx;
              fy += cy;
              if (this.forceMask && this.forceMask[solidIdx] === 1) {
                mfx += cx;
                mfy += cy;
              }
            }
          } else {
            f[i] = fSrc[i * n + (sy * nx + sx)];
          }
        }

        collideCell(f, ctx);
        for (let i = 0; i < q; i++) fDst[i * n + idx] = f[i];
      }
    }

    this._force = { x: fx, y: fy };
    this._maskedForce = { x: mfx, y: mfy };
    const tmp = this.fSrc;
    this.fSrc = this.fDst;
    this.fDst = tmp;
    this.stepCount++;
  }

  /**
   * Macroscopic fields from the current (post-collision) state. Under Guo forcing the
   * physical velocity is moment/ρ − g/2 (post-collision moments carry +g relative to
   * the pre-collision raw moment; see docs/handoff/H1-trt-les-forcing.md §4). The
   * legacy 'shift' scheme keeps its historical raw-moment reporting.
   */
  macroscopics(): Macroscopics {
    const { n, fSrc, flags, ctx } = this;
    const rho = new Float64Array(n);
    const ux = new Float64Array(n);
    const uy = new Float64Array(n);
    const cx = ctx.forcing === 'guo' ? 0.5 * ctx.gx : 0;
    const cy = ctx.forcing === 'guo' ? 0.5 * ctx.gy : 0;
    for (let idx = 0; idx < n; idx++) {
      if (flags[idx] === CellType.Solid) continue;
      let r = 0;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < q; i++) {
        const fi = fSrc[i * n + idx];
        r += fi;
        mx += ex[i] * fi;
        my += ey[i] * fi;
      }
      rho[idx] = r;
      ux[idx] = mx / r - cx;
      uy[idx] = my / r - cy;
    }
    return { rho, ux, uy };
  }

  /**
   * Current post-collision distributions, SoA direction-major (f[i·n + idx]).
   * Read-only oracle for the GPU parity panel (docs/handoff/H6-parity-panel.md).
   * Solid-cell slots are stale/unused — compare only non-solid cells.
   */
  distributions(): Float64Array {
    return this.fSrc;
  }

  /** Total mass over non-solid cells. */
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
