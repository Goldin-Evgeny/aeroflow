import { describe, expect, it } from 'vitest';
import { CellType, D3Q19, EsotericPull3D, isSolid } from '@aeroflow/core';

/**
 * Faithful TypeScript emulation of stream_collide_3d.wgsl — same single-array layout,
 * parity rules, gather/scatter, and BGK/TRT collision, executed in PARALLEL-SAFE form
 * (every read sees the pre-step snapshot). If this matches EsotericPull3D the WGSL
 * ALGORITHM is correct and any GPU failure is plumbing (dispatch/binding/compile);
 * if it diverges, the bug is in the transcription. Isolates the ?parity3d FAIL.
 */

const { ex, ey, ez, w, q, opp, reflectY, reflectZ } = D3Q19;
const TAU = 0.8;
const INLET = 0.05;

interface EmuFreeSlip {
  yMin?: boolean;
  yMax?: boolean;
  zMin?: boolean;
  zMax?: boolean;
}

interface EmuOpts {
  freeSlip?: EmuFreeSlip;
  inletProfile?: { axis: 'y' | 'z'; ux: Float64Array };
}

function equilibrium(i: number, rho: number, ux: number, uy: number, uz: number): number {
  const eu = ex[i] * ux + ey[i] * uy + ez[i] * uz;
  const usq = ux * ux + uy * uy + uz * uz;
  return w[i] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * usq);
}

function collide(f: Float64Array, omp: number, omm: number): void {
  let rho = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < q; i++) {
    rho += f[i];
    mx += ex[i] * f[i];
    my += ey[i] * f[i];
    mz += ez[i] * f[i];
  }
  const ux = mx / rho;
  const uy = my / rho;
  const uz = mz / rho;
  const feq = new Float64Array(q);
  for (let i = 0; i < q; i++) feq[i] = equilibrium(i, rho, ux, uy, uz);
  f[0] = f[0] + omp * (feq[0] - f[0]);
  for (let a = 1; a < q; a += 2) {
    const b = a + 1;
    const fp = 0.5 * (f[a] + f[b]);
    const fm = 0.5 * (f[a] - f[b]);
    const ep = 0.5 * (feq[a] + feq[b]);
    const em = 0.5 * (feq[a] - feq[b]);
    const dSym = omp * (fp - ep);
    const dAnti = omm * (fm - em);
    f[a] = f[a] - dSym - dAnti;
    f[b] = f[b] - dSym + dAnti;
  }
}

class KernelEmu {
  n: number;
  A: Float64Array;
  outletSnap: Float64Array;
  velInletRho: Float64Array;
  parity: 0 | 1 = 0;
  omp: number;
  omm: number;
  constructor(
    public nx: number,
    public ny: number,
    public nz: number,
    public flags: Uint8Array,
    public opts: EmuOpts = {},
  ) {
    this.n = nx * ny * nz;
    this.A = new Float64Array(q * this.n);
    this.outletSnap = new Float64Array(q * ny * nz);
    this.velInletRho = new Float64Array(ny * nz);
    for (let idx = 0; idx < this.n; idx++)
      for (let i = 0; i < q; i++) this.A[i * this.n + idx] = equilibrium(i, 1, 0, 0, 0);
    this.omp = 1 / TAU;
    this.omm = 1 / (0.5 + 3 / 16 / (TAU - 0.5));
  }
  idx(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }
  flag(i: number): number {
    return this.flags[i];
  }
  step(): void {
    const { nx, ny, nz, n, A } = this;
    const even = this.parity === 0;
    const R = A.slice(); // pre-step snapshot: emulate parallel reads
    // snapshot_outlets pass (reads R)
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++) {
        const x = nx - 1;
        const idx = this.idx(x, y, z);
        if (this.flag(idx) !== CellType.Outlet) continue;
        const up = idx - 1;
        const ux = x - 1;
        const base = q * (y + ny * z);
        if (even) {
          for (let i = 0; i < q; i++) this.outletSnap[base + i] = R[i * n + up];
        } else {
          this.outletSnap[base] = R[up];
          for (let a = 1; a < q; a += 2) {
            const b = a + 1;
            const pIdx = this.idx(ux + ex[a], y + ey[a], z + ez[a]);
            const mIdx = this.idx(ux - ex[a], y - ey[a], z - ez[a]);
            this.outletSnap[base + a] = R[b * n + pIdx];
            this.outletSnap[base + b] = R[a * n + mIdx];
          }
        }
      }
    // snapshot velocity-inlet ρ pass (H12 §4; mirrors the WGSL ABL block — reads R)
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++) {
        const idx0 = this.idx(0, y, z);
        if (this.flag(idx0) !== CellType.VelocityInlet) continue;
        const nb = idx0 + 1;
        const f = new Float64Array(q);
        if (even) {
          for (let i = 0; i < q; i++) f[i] = R[i * n + nb];
        } else {
          f[0] = R[nb];
          for (let a = 1; a < q; a += 2) {
            const b = a + 1;
            const pIdx = this.idx(1 + ex[a], y + ey[a], z + ez[a]);
            const mIdx = this.idx(1 - ex[a], y - ey[a], z - ez[a]);
            f[a] = R[b * n + pIdx];
            f[b] = R[a * n + mIdx];
          }
        }
        let rho = 0;
        for (let i = 0; i < q; i++) rho += f[i];
        this.velInletRho[y + ny * z] = rho;
      }
    // stream_collide pass (reads R + outletSnap, writes A)
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const idx = this.idx(x, y, z);
          const flag = this.flag(idx);
          if (isSolid(flag) || flag === CellType.FreeSlip) continue;
          const f = new Float64Array(q);
          if (flag === CellType.Inlet || flag === CellType.VelocityInlet) {
            const prof = this.opts.inletProfile;
            const uIn = prof ? prof.ux[prof.axis === 'y' ? y : z] : INLET;
            const rho = flag === CellType.VelocityInlet ? this.velInletRho[y + ny * z] : 1;
            for (let i = 0; i < q; i++) f[i] = equilibrium(i, rho, uIn, 0, 0);
            this.scatter(idx, x, y, z, even, f, A);
            continue;
          }
          if (flag === CellType.Outlet) {
            const base = q * (y + ny * z);
            for (let i = 0; i < q; i++) f[i] = this.outletSnap[base + i];
            this.scatter(idx, x, y, z, even, f, A);
            continue;
          }
          f[0] = R[idx];
          for (let a = 1; a < q; a += 2) {
            const b = a + 1;
            const naIdx = this.idx(x - ex[a], y - ey[a], z - ez[a]);
            const nbIdx = this.idx(x + ex[a], y + ey[a], z + ez[a]);
            const flagA = this.flag(naIdx);
            if (isSolid(flagA)) f[a] = even ? R[b * n + idx] : R[a * n + naIdx];
            else if (flagA === CellType.FreeSlip)
              f[a] = this.freeSlipRead(R, x, y, z, a, even, idx, naIdx);
            else f[a] = even ? R[a * n + naIdx] : R[b * n + idx];
            const flagB = this.flag(nbIdx);
            if (isSolid(flagB)) f[b] = even ? R[a * n + idx] : R[b * n + nbIdx];
            else if (flagB === CellType.FreeSlip)
              f[b] = this.freeSlipRead(R, x, y, z, b, even, idx, nbIdx);
            else f[b] = even ? R[b * n + nbIdx] : R[a * n + idx];
          }
          collide(f, this.omp, this.omm);
          this.scatter(idx, x, y, z, even, f, A);
        }
    this.parity = this.parity === 0 ? 1 : 0;
  }
  // Mirrors stream_collide_3d.wgsl freeSlipRead (H11): reflection resolution loop over
  // the configured faces, then the parity-mapped read; Solid final source → plain local
  // bounce-back of the original direction (§3.1).
  freeSlipRead(
    R: Float64Array,
    x: number,
    y: number,
    z: number,
    i: number,
    even: boolean,
    idx: number,
    nIdx: number,
  ): number {
    const { n, ny, nz } = this;
    const fs = this.opts.freeSlip ?? {};
    const sx = x - ex[i];
    let sy = y - ey[i];
    let sz = z - ez[i];
    let dir = i;
    let flag: number = CellType.FreeSlip;
    for (let pass = 0; pass < 3; pass++) {
      flag = this.flag(this.idx(sx, sy, sz));
      if (flag !== CellType.FreeSlip) break;
      if (((sy === 0 && fs.yMin) || (sy === ny - 1 && fs.yMax)) && ey[dir] !== 0) {
        sy += ey[dir];
        dir = reflectY[dir];
      }
      if (((sz === 0 && fs.zMin) || (sz === nz - 1 && fs.zMax)) && ez[dir] !== 0) {
        sz += ez[dir];
        dir = reflectZ[dir];
      }
    }
    if (isSolid(flag)) {
      return even ? R[opp[i] * n + idx] : R[i * n + nIdx];
    }
    const sIdx = this.idx(sx, sy, sz);
    if (even) return R[dir * n + sIdx];
    const tIdx = this.idx(sx + ex[dir], sy + ey[dir], sz + ez[dir]);
    return R[opp[dir] * n + tIdx];
  }

  scatter(
    idx: number,
    x: number,
    y: number,
    z: number,
    even: boolean,
    f: Float64Array,
    A: Float64Array,
  ): void {
    const { nx, ny, nz, n } = this;
    A[idx] = f[0];
    if (even) {
      for (let a = 1; a < q; a += 2) {
        const b = a + 1;
        const nax = x - ex[a];
        const nay = y - ey[a];
        const naz = z - ez[a];
        if (nax >= 0 && nax < nx && nay >= 0 && nay < ny && naz >= 0 && naz < nz)
          A[a * n + this.idx(nax, nay, naz)] = f[b];
        const nbx = x + ex[a];
        const nby = y + ey[a];
        const nbz = z + ez[a];
        if (nbx >= 0 && nbx < nx && nby >= 0 && nby < ny && nbz >= 0 && nbz < nz)
          A[b * n + this.idx(nbx, nby, nbz)] = f[a];
      }
    } else {
      for (let a = 1; a < q; a += 2) {
        const b = a + 1;
        A[a * n + idx] = f[a];
        A[b * n + idx] = f[b];
      }
    }
  }
  macro(): Float32Array {
    const { n, A, nx, ny, nz } = this;
    const out = new Float32Array(4 * n);
    const even = this.parity === 0;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const idx = this.idx(x, y, z);
          if (this.flag(idx) !== CellType.Fluid) continue;
          const f = new Float64Array(q);
          if (even) for (let i = 0; i < q; i++) f[i] = A[i * n + idx];
          else {
            f[0] = A[idx];
            for (let a = 1; a < q; a += 2) {
              const b = a + 1;
              f[a] = A[b * n + this.idx(x + ex[a], y + ey[a], z + ez[a])];
              f[b] = A[a * n + this.idx(x - ex[a], y - ey[a], z - ez[a])];
            }
          }
          let rho = 0;
          let mx = 0;
          let my = 0;
          let mz = 0;
          for (let i = 0; i < q; i++) {
            rho += f[i];
            mx += ex[i] * f[i];
            my += ey[i] * f[i];
            mz += ez[i] * f[i];
          }
          out[4 * idx] = rho;
          out[4 * idx + 1] = mx / rho;
          out[4 * idx + 2] = my / rho;
          out[4 * idx + 3] = mz / rho;
        }
    return out;
  }
}

function tunnelFlags(nx: number, ny: number, nz: number): Uint8Array {
  const flags = new Uint8Array(nx * ny * nz);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (y === 0 || y === ny - 1 || z === 0 || z === nz - 1)
          flags[idx(x, y, z)] = CellType.Solid;
        else if (x === 0) flags[idx(x, y, z)] = CellType.Inlet;
        else if (x === nx - 1) flags[idx(x, y, z)] = CellType.Outlet;
      }
  const c = Math.floor(nx / 3);
  for (let z = c; z < c + 4; z++)
    for (let y = c; y < c + 4; y++)
      for (let x = c; x < c + 4; x++) flags[idx(x, y, z)] = CellType.Solid;
  return flags;
}

/**
 * M10 ABL scene (H11+H12): no-slip ground (y=0), free-slip top + both z faces
 * (incl. slip∩slip edges and the slip∩solid ground ring), sheared VelocityInlet at
 * x=0, outlet at x=nx-1, interior solid cube. Exercises every new gather path.
 */
function ablFlags(nx: number, ny: number, nz: number): Uint8Array {
  const flags = new Uint8Array(nx * ny * nz);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (y === 0) flags[idx(x, y, z)] = CellType.Solid;
        else if (y === ny - 1 || z === 0 || z === nz - 1) flags[idx(x, y, z)] = CellType.FreeSlip;
        else if (x === 0) flags[idx(x, y, z)] = CellType.VelocityInlet;
        else if (x === nx - 1) flags[idx(x, y, z)] = CellType.Outlet;
      }
  const c = Math.floor(nx / 3);
  for (let z = c; z < c + 4; z++)
    for (let y = c; y < c + 4; y++)
      for (let x = c; x < c + 4; x++) flags[idx(x, y, z)] = CellType.Solid;
  return flags;
}

describe('WGSL kernel emulation vs EsotericPull3D (isolates ?parity3d)', () => {
  it('matches CPU macroscopics on 16³ after 50 steps', () => {
    const N = 16;
    const flags = tunnelFlags(N, N, N);
    const cpu = new EsotericPull3D({
      nx: N,
      ny: N,
      nz: N,
      omega: 1 / TAU,
      flags,
      inletVelocity: INLET,
      collision: 'trt',
    });
    cpu.reset(1, 0, 0, 0);
    const emu = new KernelEmu(N, N, N, flags);
    for (let s = 0; s < 50; s++) {
      cpu.step(1);
      emu.step();
    }
    const snap = cpu.snapshotCanonical();
    let maxRho = 0;
    let maxU = 0;
    const emuMac = emu.macro();
    for (let idx = 0; idx < N * N * N; idx++) {
      if (flags[idx] !== CellType.Fluid) continue;
      let rho = 0;
      let mx = 0;
      for (let i = 0; i < q; i++) {
        rho += snap[i * emu.n + idx];
        mx += ex[i] * snap[i * emu.n + idx];
      }
      maxRho = Math.max(maxRho, Math.abs(emuMac[4 * idx] - rho));
      maxU = Math.max(maxU, Math.abs(emuMac[4 * idx + 1] - mx / rho));
    }
    // Not bit-identical: this inline collide differs from core's shared collideCell in
    // float-op order, so ~1e-7 round-off is expected. The point is that the STREAMING
    // algorithm (parity gather/scatter/outlet) reproduces the oracle — not 1.0 errors.
    expect(maxRho, `rho diff ${maxRho}`).toBeLessThan(1e-6);
    expect(maxU, `u diff ${maxU}`).toBeLessThan(1e-6);
  });

  it('matches CPU on the M10 ABL scene (free-slip H11 + VelocityInlet H12) on 16³ after 50 steps', () => {
    const N = 16;
    const flags = ablFlags(N, N, N);
    const freeSlip = { yMax: true, zMin: true, zMax: true };
    // Sheared profile with f32-representable values (Math.fround) so the future GPU
    // parity run feeds bit-equal inputs; y=0 is the solid ground (value unused).
    const ux = new Float64Array(N);
    for (let y = 0; y < N; y++) ux[y] = Math.fround(0.05 * (0.4 + (0.6 * y) / (N - 1)));
    const inletProfile = { axis: 'y' as const, ux };
    const cpu = new EsotericPull3D({
      nx: N,
      ny: N,
      nz: N,
      omega: 1 / TAU,
      flags,
      inletVelocity: INLET,
      inletProfile,
      freeSlip,
      collision: 'trt',
    });
    cpu.reset(1, 0, 0, 0);
    const emu = new KernelEmu(N, N, N, flags, { freeSlip, inletProfile });
    for (let s = 0; s < 50; s++) {
      cpu.step(1);
      emu.step();
    }
    const snap = cpu.snapshotCanonical();
    const emuMac = emu.macro();
    let maxRho = 0;
    let maxU = 0;
    for (let idx = 0; idx < N * N * N; idx++) {
      if (flags[idx] !== CellType.Fluid) continue;
      let rho = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let i = 0; i < q; i++) {
        const fi = snap[i * emu.n + idx];
        rho += fi;
        mx += ex[i] * fi;
        my += ey[i] * fi;
        mz += ez[i] * fi;
      }
      maxRho = Math.max(maxRho, Math.abs(emuMac[4 * idx] - rho));
      maxU = Math.max(
        maxU,
        Math.abs(emuMac[4 * idx + 1] - mx / rho),
        Math.abs(emuMac[4 * idx + 2] - my / rho),
        Math.abs(emuMac[4 * idx + 3] - mz / rho),
      );
    }
    expect(maxRho, `rho diff ${maxRho}`).toBeLessThan(1e-6);
    expect(maxU, `u diff ${maxU}`).toBeLessThan(1e-6);
  });
});
