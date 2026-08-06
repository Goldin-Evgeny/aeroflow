import { CellType, isSolid } from '../lattice.js';
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
 * Esoteric-Pull in-place streaming, D3Q19 — the CPU reference for the M6 GPU kernel.
 *
 * SINGLE distribution array; reads and writes follow parity-dependent rules
 * (docs/handoff/H4-esoteric-pull.md — the normative derivation; concept: Lehmann 2022,
 * Computation 10(6):92, CC-BY, implemented clean-room from the handoff spec).
 *
 * Correctness is defined by bit-identity with the naive Solver3D
 * (test/esoteric.test.ts): both share collideCell, identical cell iteration order,
 * identical gather values ⇒ identical Float64 results, step for step.
 *
 * Constraints (validated): no periodic axes; a full one-cell non-Fluid shell on all
 * six faces; Outlet cells only on the +x face. Index convention idx = x + nx·(y+ny·z).
 */
export interface EsotericPull3DOptions {
  nx: number;
  ny: number;
  nz: number;
  omega: number;
  flags: Uint8Array;
  inletVelocity?: number;
  collision?: Collision;
  lambda?: number;
  les?: { cs: number };
  /** Projected (Latt–Chopard) regularization — H10. */
  regularize?: boolean;
  /** Restore the incoming zeroth moment after collision roundoff — H13. */
  conserveMass?: boolean;
  forcing?: Exclude<Forcing, 'none'>;
  gravity?: readonly [number, number, number];
  forceMask?: Uint8Array;
  /**
   * Per-layer inlet velocity profile (M10 ABL) — must match Solver3D's semantics EXACTLY
   * (same lookup, same equilibrium call) or the bit-identity test fails: every Inlet cell
   * prescribes equilibrium at ux = ux[y] (axis 'y') or ux[z] (axis 'z'). Overrides the
   * scalar inletVelocity.
   */
  inletProfile?: { axis: 'y' | 'z'; ux: Float64Array };
  /** Specular free-slip domain faces (H11 §5 — the parity-aware redirected reads). */
  freeSlip?: FreeSlipFaces;
}

const { q, ex, ey, ez, opp } = D3Q19;
const pairs = D3Q19_SPEC.pairs;

export class EsotericPull3D {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly n: number;
  readonly flags: Uint8Array;
  inletVelocity: number;
  readonly ctx: CollideContext;
  /**
   * Opt-in per-cell τ_eff capture (M9 step 6). Assign a `Float64Array(n)` and every
   * subsequent `step()` writes the effective relaxation time each Fluid cell collided with;
   * leave undefined and the solver is unchanged. This is the *solver's own* τ_eff, not a
   * re-derivation, which is what makes it usable as an oracle for the GPU reconstruction.
   * Non-Fluid cells are never written — mask with the flags before reducing.
   */
  tauEffRecord: Float64Array | undefined;
  private readonly inletProfile: { axis: 'y' | 'z'; ux: Float64Array } | undefined;
  private readonly freeSlip: FreeSlipFaces;
  private readonly forceMask: Uint8Array | undefined;
  /** THE single DDF array (the point of the scheme). */
  private readonly A: Float64Array;
  private readonly scratch: Float64Array;
  private readonly outletCells: number[];
  private readonly outletSnap: Float64Array;
  /** VelocityInlet cells (idx order = sweep order) and their pre-pass ρ_up (H12 §4). */
  private readonly velocityInletCells: number[];
  private readonly velocityInletRho: Float64Array;
  private stepCount = 0;
  private _force = { x: 0, y: 0, z: 0 };
  private _maskedForce = { x: 0, y: 0, z: 0 };

  constructor(opts: EsotericPull3DOptions) {
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.nz = opts.nz;
    this.n = opts.nx * opts.ny * opts.nz;
    this.flags = opts.flags;
    if (this.flags.length !== this.n) throw new Error('flags length must be nx·ny·nz');
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
    this.freeSlip = opts.freeSlip ?? {};
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
    this.validate();
    this.A = new Float64Array(q * this.n);
    this.scratch = new Float64Array(q);
    this.outletCells = [];
    this.velocityInletCells = [];
    for (let idx = 0; idx < this.n; idx++) {
      if (this.flags[idx] === CellType.Outlet) this.outletCells.push(idx);
      if (this.flags[idx] === CellType.VelocityInlet) this.velocityInletCells.push(idx);
    }
    this.outletSnap = new Float64Array(q * this.outletCells.length);
    this.velocityInletRho = new Float64Array(this.velocityInletCells.length);
    this.reset();
  }

  idx(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }

  get steps(): number {
    return this.stepCount;
  }

  /** Parity AFTER the completed steps: 0 = canonical layout (H4 §2). */
  get parity(): 0 | 1 {
    return (this.stepCount % 2) as 0 | 1;
  }

  get force(): { x: number; y: number; z: number } {
    return { ...this._force };
  }

  get maskedForce(): { x: number; y: number; z: number } {
    return { ...this._maskedForce };
  }

  /**
   * Is this solid cell part of the measured body? Two equivalent encodings are accepted so
   * the 2D scenes' `forceMask` and the 3D scenes' `CellType.BodySolid` mean the same thing
   * to the accumulator — the GPU kernel only has the flag, since a per-cell mask buffer
   * would cost 4 B/cell against the binding budget D1 measures.
   */
  private isMeasured(idx: number): boolean {
    return this.flags[idx] === CellType.BodySolid || this.forceMask?.[idx] === 1;
  }

  private validate(): void {
    const { nx, ny, nz, flags } = this;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const f = flags[this.idx(x, y, z)];
          const onFace =
            x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1;
          if (onFace && f === CellType.Fluid) {
            throw new Error(`EsotericPull3D: fluid on the shell at (${x},${y},${z}) (H4 §2)`);
          }
          if (f === CellType.Outlet && x !== nx - 1) {
            throw new Error('EsotericPull3D: Outlet cells must sit on the +x face');
          }
          if (f === CellType.Outlet && isSolid(flags[this.idx(x - 1, y, z)])) {
            throw new Error(
              `EsotericPull3D: Outlet at (${x},${y},${z}) has a Solid upstream neighbor (H4 §10.9)`,
            );
          }
          // H12 §2: VelocityInlet only on the x=0 face, +x neighbor must be Fluid.
          if (f === CellType.VelocityInlet) {
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
        }
      }
    }
  }

  /** Canonical equilibrium init for ALL cells (solid slots are functional scratch — H4 §5). */
  reset(rho = 1, ux = 0, uy = 0, uz = 0): void {
    for (let idx = 0; idx < this.n; idx++) {
      for (let i = 0; i < q; i++) {
        this.A[i * this.n + idx] = equilibrium3(D3Q19_SPEC, i, rho, ux, uy, uz);
      }
    }
    this.stepCount = 0;
  }

  step(count = 1): void {
    for (let s = 0; s < count; s++) this.stepOnce();
  }

  private stepOnce(): void {
    const even = this.stepCount % 2 === 0;
    this.snapshotOutlets(even);
    this.snapshotVelocityInlets(even);
    const { nx, ny, nz, n, flags, A, ctx, scratch: f } = this;
    // Hoisted out of the cell loop: when nobody asked for τ_eff this is a single undefined
    // that the loop's branch predictor never misses.
    const tauRec = this.tauEffRecord;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    let mfx = 0;
    let mfy = 0;
    let mfz = 0;
    let outletCursor = 0;
    let velocityInletCursor = 0;

    // Same cell iteration order as Solver3D (x fastest) — required for bitwise-equal
    // force accumulation order in the identity test.
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + nx * (y + ny * z);
          const flag = flags[idx];
          // Solid and FreeSlip cells are passive; their slots are functional scratch
          // (H4 §5, H11 §5) — the EVEN crosswise writes into them are load-bearing.
          if (isSolid(flag) || flag === CellType.FreeSlip) continue;

          if (flag === CellType.Inlet || flag === CellType.VelocityInlet) {
            const uIn = this.inletProfile
              ? this.inletProfile.ux[this.inletProfile.axis === 'y' ? y : z]
              : this.inletVelocity;
            // H12: ρ from the pre-pass snapshot (cells encountered in idx order — the
            // same order the snapshot list was built in). Plain Inlet keeps ρ = 1.
            const rho =
              flag === CellType.VelocityInlet ? this.velocityInletRho[velocityInletCursor++] : 1;
            for (let i = 0; i < q; i++) f[i] = equilibrium3(D3Q19_SPEC, i, rho, uIn, 0, 0);
            this.scatter(idx, x, y, z, even, f);
            continue;
          }

          if (flag === CellType.Outlet) {
            const snap = this.outletSnap;
            const base = q * outletCursor++;
            for (let i = 0; i < q; i++) f[i] = snap[base + i];
            this.scatter(idx, x, y, z, even, f);
            continue;
          }

          // Fluid: gather per parity rules (H4 §3), accumulating bounce forces (H2 §1).
          f[0] = A[idx]; // slot (x, 0) both parities
          for (let p = 0; p < pairs.length; p++) {
            const a = pairs[p][0];
            const b = pairs[p][1];
            const nax = x - ex[a];
            const nay = y - ey[a];
            const naz = z - ez[a];
            const nIdxA = nax + nx * (nay + ny * naz); // in-bounds: shell invariant
            const nbx = x + ex[a];
            const nby = y + ey[a];
            const nbz = z + ez[a];
            const nIdxB = nbx + nx * (nby + ny * nbz);

            let va: number;
            if (isSolid(flags[nIdxA])) {
              va = even ? A[b * n + idx] : A[a * n + nIdxA];
              // Into-solid direction is b (= opp(a)): F_link = 2·e_b·v.
              const cxv = 2 * ex[b] * va;
              const cyv = 2 * ey[b] * va;
              const czv = 2 * ez[b] * va;
              fx += cxv;
              fy += cyv;
              fz += czv;
              if (this.isMeasured(nIdxA)) {
                mfx += cxv;
                mfy += cyv;
                mfz += czv;
              }
            } else if (flags[nIdxA] === CellType.FreeSlip) {
              va = this.freeSlipRead(x, y, z, a, even, idx, nIdxA);
            } else {
              va = even ? A[a * n + nIdxA] : A[b * n + idx];
            }
            f[a] = va;

            let vb: number;
            if (isSolid(flags[nIdxB])) {
              vb = even ? A[a * n + idx] : A[b * n + nIdxB];
              const cxv = 2 * ex[a] * vb;
              const cyv = 2 * ey[a] * vb;
              const czv = 2 * ez[a] * vb;
              fx += cxv;
              fy += cyv;
              fz += czv;
              if (this.isMeasured(nIdxB)) {
                mfx += cxv;
                mfy += cyv;
                mfz += czv;
              }
            } else if (flags[nIdxB] === CellType.FreeSlip) {
              vb = this.freeSlipRead(x, y, z, b, even, idx, nIdxB);
            } else {
              vb = even ? A[b * n + nIdxB] : A[a * n + idx];
            }
            f[b] = vb;
          }

          collideCell(f, ctx);
          // M9 step 6: capture the τ_eff this cell actually collided with. `collideCell`
          // already computes it (macro[4]) and the solver otherwise drops it, so recording
          // it costs one store and — crucially — cannot disagree with the solver, which a
          // separate diagnostic gather over the same slots eventually would.
          if (tauRec !== undefined) tauRec[idx] = ctx.macro[4];
          this.scatter(idx, x, y, z, even, f);
        }
      }
    }

    this._force = { x: fx, y: fy, z: fz };
    this._maskedForce = { x: mfx, y: mfy, z: mfz };
    this.stepCount++;
  }

  /**
   * VelocityInlet pre-pass (H12 §4): snapshot ρ of each cell's +x fluid neighbor from
   * the PREVIOUS step's post-collision state, before the sweep touches any slot (the
   * mid-sweep read would violate EVEN slot ownership — the outlet problem, same cure).
   * The 19 values are summed in direction order so the Float64 result is bit-identical
   * to the naive solver's `Σ fSrc[i][nb]` (H12 pitfall 2).
   */
  private snapshotVelocityInlets(even: boolean): void {
    const { nx, ny, n, A, velocityInletCells, velocityInletRho, scratch: f } = this;
    for (let c = 0; c < velocityInletCells.length; c++) {
      const nb = velocityInletCells[c] + 1; // +x neighbor; Fluid by construction (H12 §2)
      if (even) {
        // Previous step was ODD/init → canonical.
        for (let i = 0; i < q; i++) f[i] = A[i * n + nb];
      } else {
        // Previous step was EVEN → f_a(nb) at A[nb+e_a][b], f_b(nb) at A[nb−e_a][a].
        f[0] = A[nb];
        const bx = nb % nx;
        const by = Math.floor(nb / nx) % ny;
        const bz = Math.floor(nb / (nx * ny));
        for (let p = 0; p < pairs.length; p++) {
          const a = pairs[p][0];
          const b = pairs[p][1];
          const pIdx = bx + ex[a] + nx * (by + ey[a] + ny * (bz + ez[a]));
          const mIdx = bx - ex[a] + nx * (by - ey[a] + ny * (bz - ez[a]));
          f[a] = A[b * n + pIdx];
          f[b] = A[a * n + mIdx];
        }
      }
      let rho = 0;
      for (let i = 0; i < q; i++) rho += f[i];
      velocityInletRho[c] = rho;
    }
  }

  /**
   * Free-slip gather (H11 §5): resolve the specular redirection, then read
   * f_J^out(S, t−1) from where the previous step's layout put it:
   *   - EVEN step (previous ODD → canonical): A[S][J];
   *   - ODD step (previous EVEN): A[S + e_J][opp(J)] — the EVEN crosswise write of
   *     cell S, sitting in a passive shell cell's slot (ownership audit in H11 §5).
   * Slip∩solid fallback: plain local bounce-back of the original direction — the exact
   * Solid-neighbor reads of H4 §5, with no force contribution (far-field wall).
   */
  private freeSlipRead(
    x: number,
    y: number,
    z: number,
    i: number,
    even: boolean,
    idx: number,
    nIdx: number,
  ): number {
    const { nx, ny, nz, n, A } = this;
    // Source coords are in range (no periodic axes; shell precondition, H4 §2).
    const r = resolveFreeSlipPull(
      this.flags,
      nx,
      ny,
      nz,
      this.freeSlip,
      x - ex[i],
      y - ey[i],
      z - ez[i],
      i,
    );
    if (r.fallback) {
      return even ? A[opp[i] * n + idx] : A[i * n + nIdx];
    }
    if (even) {
      return A[r.dir * n + (r.sx + nx * (r.sy + ny * r.sz))];
    }
    const tx = r.sx + ex[r.dir];
    const ty = r.sy + ey[r.dir];
    const tz = r.sz + ez[r.dir];
    return A[opp[r.dir] * n + (tx + nx * (ty + ny * tz))];
  }

  /** Parity write rules (H4 §3): EVEN crosswise-to-neighbors, ODD local-canonical. */
  private scatter(
    idx: number,
    x: number,
    y: number,
    z: number,
    even: boolean,
    f: Float64Array,
  ): void {
    const { nx, ny, nz, n, A } = this;
    A[idx] = f[0];
    if (even) {
      for (let p = 0; p < pairs.length; p++) {
        const a = pairs[p][0];
        const b = pairs[p][1];
        const nax = x - ex[a];
        const nay = y - ey[a];
        const naz = z - ez[a];
        // Shell cells (inlet/outlet) can have out-of-domain "neighbors"; those slots
        // have no consumer (H4 ownership) — skip. Fluid targets are always in-bounds.
        if (nax >= 0 && nax < nx && nay >= 0 && nay < ny && naz >= 0 && naz < nz) {
          A[a * n + (nax + nx * (nay + ny * naz))] = f[b];
        }
        const nbx = x + ex[a];
        const nby = y + ey[a];
        const nbz = z + ez[a];
        if (nbx >= 0 && nbx < nx && nby >= 0 && nby < ny && nbz >= 0 && nbz < nz) {
          A[b * n + (nbx + nx * (nby + ny * nbz))] = f[a];
        }
      }
    } else {
      for (let p = 0; p < pairs.length; p++) {
        const a = pairs[p][0];
        const b = pairs[p][1];
        A[a * n + idx] = f[a];
        A[b * n + idx] = f[b];
      }
    }
  }

  /**
   * Outlet zero-gradient pre-pass (H4 §3.5): capture the upstream neighbor's previous
   * post-collision state BEFORE the sweep (its slots belong to other cells this step).
   */
  private snapshotOutlets(even: boolean): void {
    const { nx, ny, n, A, outletCells, outletSnap } = this;
    for (let c = 0; c < outletCells.length; c++) {
      const idx = outletCells[c];
      const z = idx - 1; // upstream in x
      const base = q * c;
      if (even) {
        // Previous step was ODD/init → canonical.
        for (let i = 0; i < q; i++) outletSnap[base + i] = A[i * n + z];
      } else {
        // Previous step was EVEN → f_a(z) at A[z+e_a][b], f_b(z) at A[z−e_a][a].
        outletSnap[base] = A[z];
        const zx = z % nx;
        const zy = Math.floor(z / nx) % ny;
        const zz = Math.floor(z / (nx * ny));
        for (let p = 0; p < pairs.length; p++) {
          const a = pairs[p][0];
          const b = pairs[p][1];
          const pIdx = zx + ex[a] + nx * (zy + ey[a] + ny * (zz + ez[a]));
          const mIdx = zx - ex[a] + nx * (zy - ey[a] + ny * (zz - ez[a]));
          outletSnap[base + a] = A[b * n + pIdx];
          outletSnap[base + b] = A[a * n + mIdx];
        }
      }
    }
  }

  /**
   * Reconstruct the canonical post-collision state for FLUID cells (zeros elsewhere) —
   * the esoteric side of the H4 §8 bit-identity comparison and the model for the
   * GPU parity-aware readback (H4 §7).
   */
  snapshotCanonical(): Float64Array {
    const { nx, ny, nz, n, A, flags } = this;
    const out = new Float64Array(q * n);
    const even = this.stepCount % 2 === 0; // layout is canonical when parity is 0
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + nx * (y + ny * z);
          if (flags[idx] !== CellType.Fluid) continue;
          if (even) {
            for (let i = 0; i < q; i++) out[i * n + idx] = A[i * n + idx];
          } else {
            out[idx] = A[idx];
            for (let p = 0; p < pairs.length; p++) {
              const a = pairs[p][0];
              const b = pairs[p][1];
              const pIdx = x + ex[a] + nx * (y + ey[a] + ny * (z + ez[a]));
              const mIdx = x - ex[a] + nx * (y - ey[a] + ny * (z - ez[a]));
              out[a * n + idx] = A[b * n + pIdx];
              out[b * n + idx] = A[a * n + mIdx];
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * Checkpoint snapshot (M9 step 7): the COMPLETE dynamic state is the raw single DDF
   * array plus the step counter — the counter carries the Esoteric-Pull even/odd parity,
   * and restoring with the wrong parity reads DDFs from the wrong slots and silently
   * drifts (the M9 pitfall this API exists to make untestable-by-accident). Static
   * configuration (grid, flags, ω, BCs) belongs to the constructor, not the checkpoint.
   */
  saveState(): { nx: number; ny: number; nz: number; steps: number; ddf: Float64Array } {
    return { nx: this.nx, ny: this.ny, nz: this.nz, steps: this.stepCount, ddf: this.A.slice() };
  }

  /** Restore a `saveState()` snapshot into a solver built with the same configuration. */
  loadState(state: { nx: number; ny: number; nz: number; steps: number; ddf: Float64Array }): void {
    if (state.nx !== this.nx || state.ny !== this.ny || state.nz !== this.nz) {
      throw new Error(
        `loadState: grid mismatch (${state.nx}×${state.ny}×${state.nz} vs ${this.nx}×${this.ny}×${this.nz})`,
      );
    }
    if (state.ddf.length !== this.A.length) {
      throw new Error(`loadState: ddf length ${state.ddf.length} ≠ ${this.A.length}`);
    }
    if (!Number.isInteger(state.steps) || state.steps < 0) {
      throw new Error('loadState: steps must be a non-negative integer (it carries parity)');
    }
    this.A.set(state.ddf);
    this.stepCount = state.steps;
  }

  /** Total mass over fluid cells (canonical reconstruction). */
  totalMass(): number {
    const snap = this.snapshotCanonical();
    let m = 0;
    for (let s = 0; s < snap.length; s++) m += snap[s];
    return m;
  }
}
