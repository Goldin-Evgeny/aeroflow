import { describe, expect, it } from 'vitest';
import { CellType } from '../src/lattice.js';
import { AHMED_FREESLIP_FACES, ahmedScene } from '../src/scenes/ahmed3d.js';
import { resolveFreeSlipPull, validateFreeSlip } from '../src/cpu/freeslip.js';
import { D3Q19 } from '../src/lattice3d.js';
import { EsotericPull3D } from '../src/cpu/esoteric.js';
import { AHMED } from '../src/geometry/ahmedBody.js';

/**
 * Ahmed scene builder (M9 step 2). Reduced cell budgets keep the tests fast; the fitted
 * constraints (≤5% blockage, 1L/2L fetch, τ from Re=4.29e6 through ν) are budget-
 * independent, which is exactly what the tests pin. The smallest tier is also fed into
 * the EsotericPull3D constructor, whose validate() enforces the H4 shell/outlet
 * invariants — an integration check that the flag field is actually runnable.
 */
describe('ahmedScene', () => {
  const scene = ahmedScene({ maxCells: 2_000_000 });

  it('respects the blockage cap and the fetch requirements', () => {
    expect(scene.blockage).toBeLessThan(0.055); // 5% cap + staircase margin
    expect(scene.blockage).toBeGreaterThan(0.03); // budget actually spent, not oversized
    expect(scene.noseX).toBeGreaterThanOrEqual(Math.floor(scene.lengthCells) - 1); // ≥1 L upstream
    const tailX = scene.noseX + scene.lengthCells;
    expect(scene.nx - tailX).toBeGreaterThanOrEqual(2 * scene.lengthCells - 2); // ≥2 L downstream
    expect(scene.nx * scene.ny * scene.nz).toBeLessThanOrEqual(2_000_000 * 1.02);
  });

  it('sets Re through τ (never guessed): τ = 0.5 + 3·u·L/Re, LES mandatory', () => {
    expect(scene.Re).toBe(4.29e6);
    expect(scene.nu).toBeCloseTo((0.05 * scene.lengthCells) / 4.29e6, 15);
    expect(scene.tau).toBeCloseTo(0.5 + 3 * scene.nu, 15);
    expect(scene.tau).toBeGreaterThan(0.5);
    expect(scene.tau).toBeLessThan(0.501); // microscopically above the floor ⇒ LES carries it
    expect(scene.les).toBe(true);
    expect(scene.convectiveTimeSteps).toBe(Math.round(scene.lengthCells / scene.uLattice));
  });

  it('voxelizes a plausible body: frontal area ≈ W·H, volume-filled interior', () => {
    const frontalAnalytic = (AHMED.width * AHMED.height * 1e-6) / (scene.dx * scene.dx);
    expect(scene.frontalCells).toBeGreaterThan(frontalAnalytic);
    expect(scene.frontalCells).toBeLessThan(frontalAnalytic * 1.25); // coarse-staircase band
    // Solid volume: ≥ loft volume (conservative), ≤ the full bbox volume.
    const bboxCells =
      (AHMED.length * AHMED.width * AHMED.height * 1e-9) / (scene.dx * scene.dx * scene.dx);
    expect(scene.bodyVoxels).toBeGreaterThan(0.8 * bboxCells);
    expect(scene.bodyVoxels).toBeLessThan(1.15 * bboxCells);
  });

  it('builds the published boundary layout: no-slip ground, freestream top/sides', () => {
    const { nx, ny, nz, flags } = scene;
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    for (let k = 1; k < 5; k++) {
      const x = Math.floor((k * nx) / 5);
      const z = Math.floor((k * nz) / 5);
      expect(flags[at(x, 0, z)]).toBe(CellType.Solid); // ground
      expect(flags[at(x, ny - 1, z)]).toBe(CellType.Inlet); // freestream top
      expect(flags[at(x, Math.floor(ny / 2), 0)]).toBe(CellType.Inlet); // sides
      expect(flags[at(0, Math.max(1, Math.floor((k * ny) / 5)), z)]).toBe(CellType.Inlet);
      expect(flags[at(nx - 1, Math.max(1, Math.floor((k * ny) / 5)), z)]).toBe(CellType.Outlet);
    }
    // Ground row must stay Solid across the outlet face (H4 §10.9: no Solid upstream of
    // an Outlet — which is also asserted for the whole field by the solver test below).
    expect(flags[at(nx - 1, 0, Math.floor(nz / 2))]).toBe(CellType.Solid);
  });

  it('produces a flag field EsotericPull3D accepts and can step', () => {
    const small = ahmedScene({ maxCells: 300_000 });
    const solver = new EsotericPull3D({
      nx: small.nx,
      ny: small.ny,
      nz: small.nz,
      omega: small.omega,
      flags: small.flags,
      inletVelocity: small.uLattice,
      collision: 'trt',
      regularize: true,
      les: { cs: 0.1 },
    });
    solver.step(2); // one even + one odd step through the full BC set
    expect(Number.isFinite(solver.totalMass())).toBe(true);
    expect(solver.force.x).not.toBe(0); // the body is in the flow and feels it
  });

  /**
   * `omitBody` is the M9 phase-2 empty-tunnel control. Its whole value is being the SAME
   * tunnel with the body removed — if the domain moved too, it would isolate nothing. So
   * this pins that the grid, the boundary shell and every lattice parameter are untouched
   * and ONLY the body is gone.
   */
  describe('omitBody (empty-tunnel control)', () => {
    const empty = ahmedScene({ maxCells: 300_000, omitBody: true });
    const withBody = ahmedScene({ maxCells: 300_000 });

    it('keeps the identical domain, grid and lattice parameters', () => {
      expect([empty.nx, empty.ny, empty.nz]).toEqual([withBody.nx, withBody.ny, withBody.nz]);
      expect(empty.dx).toBe(withBody.dx);
      expect(empty.omega).toBe(withBody.omega);
      expect(empty.uLattice).toBe(withBody.uLattice);
      expect(empty.nu).toBe(withBody.nu);
      expect(empty.lengthCells).toBe(withBody.lengthCells);
      expect(empty.convectiveTimeSteps).toBe(withBody.convectiveTimeSteps);
      expect(empty.noseX).toBe(withBody.noseX);
    });

    it('removes the body and only the body', () => {
      expect(empty.bodyVoxels).toBe(0);
      expect(empty.frontalCells).toBe(0);
      expect(empty.blockage).toBe(0);
      expect(empty.flags.indexOf(CellType.BodySolid)).toBe(-1);
      expect(withBody.bodyVoxels).toBeGreaterThan(0); // control: the option is doing the work

      // Every non-BodySolid flag is unchanged, cell for cell — the boundary shell, the
      // ground and the inlet/outlet faces are byte-identical to the acceptance tunnel.
      let differing = 0;
      for (let i = 0; i < empty.flags.length; i++) {
        if (withBody.flags[i] === CellType.BodySolid) continue;
        if (empty.flags[i] !== withBody.flags[i]) differing++;
      }
      expect(differing).toBe(0);
    });

    it('steps, and feels no body force because there is no body', () => {
      const solver = new EsotericPull3D({
        nx: empty.nx,
        ny: empty.ny,
        nz: empty.nz,
        omega: empty.omega,
        flags: empty.flags,
        inletVelocity: empty.uLattice,
        collision: 'trt',
        regularize: true,
        les: { cs: 0.1 },
      });
      solver.step(2);
      expect(Number.isFinite(solver.totalMass())).toBe(true);
      // The ground is still Solid, so the UNMASKED accumulator is non-zero — the tunnel has
      // walls. The MASKED one is what a Cd would use, and it must be exactly zero.
      expect(solver.maskedForce.x).toBe(0);
      expect(solver.maskedForce.y).toBe(0);
      expect(solver.maskedForce.z).toBe(0);
    });
  });

  /**
   * `lateralBC` — the M9 phase-3 far-field A/B (hard-Dirichlet vs H11 free-slip).
   *
   * The experiment being run is a controlled comparison, so what these tests pin is not
   * "free-slip works" (H11 §6/§7 already gate the boundary condition itself, CPU and WGSL)
   * but that the two ARMS differ in the far field and in nothing else — and that the existing
   * arm did not move when the option was added.
   */
  describe('lateralBC (phase-3 far-field A/B)', () => {
    const CELLS = 300_000;
    const freestream = ahmedScene({ maxCells: CELLS });
    const freeslip = ahmedScene({ maxCells: CELLS, lateralBC: 'freeslip' });

    /**
     * The regression lock. Rebuilds the PRE-OPTION shell literally — lateral Inlet faces,
     * Solid ground, then full-face inlet/outlet columns for y ≥ 1 — and requires the default
     * scene to reproduce it cell for cell.
     *
     * Written out rather than snapshotted against `ahmedScene` itself, because a builder
     * compared to its own output cannot detect that the builder changed. Every Ahmed Cd on
     * record was measured on this flag array; if it moves, those numbers stop being comparable
     * and the phase-3 A/B loses its control arm.
     */
    it("'freestream' is the default and reproduces the pre-option flag array exactly", () => {
      expect(freestream.lateralBC).toBe('freestream');
      expect(ahmedScene({ maxCells: CELLS, lateralBC: 'freestream' }).flags).toEqual(
        freestream.flags,
      );

      const { nx, ny, nz } = freestream;
      const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
      const ref = new Uint8Array(nx * ny * nz).fill(CellType.Fluid);
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          ref[at(x, y, 0)] = CellType.Inlet;
          ref[at(x, y, nz - 1)] = CellType.Inlet;
        }
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) ref[at(x, ny - 1, z)] = CellType.Inlet;
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) ref[at(x, 0, z)] = CellType.Solid;
      for (let z = 0; z < nz; z++)
        for (let y = 1; y < ny; y++) {
          ref[at(0, y, z)] = CellType.Inlet;
          ref[at(nx - 1, y, z)] = CellType.Outlet;
        }
      // Overlay the body from the scene itself: the voxelizer is not what this test locks.
      for (let i = 0; i < ref.length; i++) {
        if (freestream.flags[i] === CellType.BodySolid) ref[i] = CellType.BodySolid;
      }
      expect(freestream.flags).toEqual(ref);
    });

    it('changes the far field and NOTHING else — same grid, body and lattice parameters', () => {
      expect([freeslip.nx, freeslip.ny, freeslip.nz]).toEqual([
        freestream.nx,
        freestream.ny,
        freestream.nz,
      ]);
      expect(freeslip.dx).toBe(freestream.dx);
      expect(freeslip.omega).toBe(freestream.omega);
      expect(freeslip.tau).toBe(freestream.tau);
      expect(freeslip.nu).toBe(freestream.nu);
      expect(freeslip.uLattice).toBe(freestream.uLattice);
      expect(freeslip.Re).toBe(freestream.Re);
      expect(freeslip.lengthCells).toBe(freestream.lengthCells);
      expect(freeslip.convectiveTimeSteps).toBe(freestream.convectiveTimeSteps);
      expect(freeslip.noseX).toBe(freestream.noseX);
      // The Cd normalization must be identical or the two arms' coefficients are not comparable.
      expect(freeslip.bodyVoxels).toBe(freestream.bodyVoxels);
      expect(freeslip.frontalCells).toBe(freestream.frontalCells);
      expect(freeslip.blockage).toBe(freestream.blockage);
      expect(freeslip.mesh.positions).toEqual(freestream.mesh.positions);

      // Every differing cell is on a lateral face or in the outlet-face ring the H11 §3.2
      // constraint forces one row in. Nothing in the interior, on the ground, or at the inlet.
      const { nx, ny, nz } = freeslip;
      let differing = 0;
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++) {
            const i = x + nx * (y + ny * z);
            if (freeslip.flags[i] === freestream.flags[i]) continue;
            differing++;
            const onLateralFace = y === ny - 1 || z === 0 || z === nz - 1;
            expect(
              onLateralFace,
              `(${x},${y},${z}) differs but is not on a lateral face`,
            ).toBe(true);
          }
      expect(differing).toBeGreaterThan(0); // control: the option is doing work
    });

    it('builds the H11 shell: free-slip top/sides, no-slip ground, interior outlet', () => {
      const { nx, ny, nz, flags } = freeslip;
      const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
      expect(freeslip.lateralBC).toBe('freeslip');

      for (let k = 1; k < 5; k++) {
        const x = Math.floor((k * nx) / 5);
        const z = Math.floor((k * nz) / 5);
        const y = Math.max(1, Math.floor((k * ny) / 5));
        expect(flags[at(x, ny - 1, z)]).toBe(CellType.FreeSlip); // top
        expect(flags[at(x, y, 0)]).toBe(CellType.FreeSlip); // −z side
        expect(flags[at(x, y, nz - 1)]).toBe(CellType.FreeSlip); // +z side
        expect(flags[at(x, 0, z)]).toBe(CellType.Solid); // the ground is NOT free-slip
        expect(flags[at(0, y, z)]).toBe(CellType.Inlet); // inlet spans the whole x=0 face
      }
      // The ground wins the shared shell edges, including on both x faces (H4 §10.9).
      expect(flags[at(0, 0, Math.floor(nz / 2))]).toBe(CellType.Solid);
      expect(flags[at(nx - 1, 0, Math.floor(nz / 2))]).toBe(CellType.Solid);
      // The outlet-face ring stays FreeSlip so the outlet starts one row in (H11 §3.2).
      expect(flags[at(nx - 1, ny - 1, Math.floor(nz / 2))]).toBe(CellType.FreeSlip);
      expect(flags[at(nx - 1, Math.floor(ny / 2), 0)]).toBe(CellType.FreeSlip);
      expect(flags[at(nx - 1, Math.floor(ny / 2), nz - 1)]).toBe(CellType.FreeSlip);
      expect(flags[at(nx - 1, Math.floor(ny / 2), Math.floor(nz / 2))]).toBe(CellType.Outlet);

      // No Outlet may read a FreeSlip (H11 §3.2) or a Solid (H4 §10.9) upstream neighbour.
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++) {
          if (flags[at(nx - 1, y, z)] !== CellType.Outlet) continue;
          const up = flags[at(nx - 2, y, z)];
          expect(up, `outlet (${y},${z}) upstream neighbour`).not.toBe(CellType.FreeSlip);
          expect(up, `outlet (${y},${z}) upstream neighbour`).not.toBe(CellType.Solid);
          expect(up).not.toBe(CellType.BodySolid);
        }

      expect(() =>
        validateFreeSlip(flags, nx, ny, nz, AHMED_FREESLIP_FACES),
      ).not.toThrow();
    });

    /**
     * Every free-slip pull in the scene resolves.
     *
     * `resolveFreeSlipPull` THROWS when it lands on a FreeSlip cell that is not on a face the
     * config declares (freeslip.ts §3) — the exact failure a scene/config mismatch produces.
     * A two-step smoke run only exercises whatever links its cells happen to touch; this walks
     * the entire shell, every direction, so a bad corner cannot hide until a long GPU run.
     */
    it('resolves every free-slip pull in the domain (whole-shell, not just stepped paths)', () => {
      const { nx, ny, nz, flags } = freeslip;
      const { q, ex, ey, ez } = D3Q19;
      const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
      let resolved = 0;
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++) {
            if (flags[at(x, y, z)] !== CellType.Fluid) continue;
            for (let i = 1; i < q; i++) {
              const sx = x - ex[i];
              const sy = y - ey[i];
              const sz = z - ez[i];
              if (sx < 0 || sx >= nx || sy < 0 || sy >= ny || sz < 0 || sz >= nz) continue;
              if (flags[at(sx, sy, sz)] !== CellType.FreeSlip) continue;
              const r = resolveFreeSlipPull(flags, nx, ny, nz, AHMED_FREESLIP_FACES, sx, sy, sz, i);
              resolved++;
              if (r.fallback) continue; // slip∩solid edge → local bounce-back (H11 §3.1)
              // A resolved source must be an ACTIVE cell: passive cells emit no output to read.
              const dest = flags[at(r.sx, r.sy, r.sz)];
              expect(dest, `(${x},${y},${z}) dir ${i} resolved onto a passive cell`).not.toBe(
                CellType.FreeSlip,
              );
              expect(dest).not.toBe(CellType.Solid);
              expect(dest).not.toBe(CellType.BodySolid);
            }
          }
      expect(resolved).toBeGreaterThan(0); // control: the walk actually hit free-slip links
    });

    it('produces a flag field EsotericPull3D accepts and can step', () => {
      const solver = new EsotericPull3D({
        nx: freeslip.nx,
        ny: freeslip.ny,
        nz: freeslip.nz,
        omega: freeslip.omega,
        flags: freeslip.flags,
        inletVelocity: freeslip.uLattice,
        collision: 'trt',
        regularize: true,
        les: { cs: 0.1 },
        freeSlip: AHMED_FREESLIP_FACES,
      });
      solver.step(2); // one even + one odd step through the full BC set, both free-slip parities
      expect(Number.isFinite(solver.totalMass())).toBe(true);
      expect(solver.force.x).not.toBe(0); // the body is in the flow and feels it
    });

    /**
     * `lateralFlux` sums over the first FLUID layer inside each face, and the A/B compares that
     * sum between arms. If the two arms expose different cells there — because one face's
     * adjacent layer is Fluid in one arm and shell in the other — the two numbers are sums over
     * different sets and the comparison is meaningless, in a way that would look like a
     * physical difference rather than a bookkeeping one.
     */
    it('exposes the same measurement cells to lateralFlux in both arms', () => {
      const { nx, ny, nz } = freeslip;
      const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
      // Mirrors `hasMacroscopics`: only Fluid cells carry macroscopics after the macro pass.
      const countPlane = (
        flags: Uint8Array,
        axis: 'y' | 'z',
        index: number,
      ): number => {
        let n = 0;
        const outerMax = axis === 'y' ? nz : ny;
        for (let outer = 0; outer < outerMax; outer++)
          for (let x = 0; x < nx; x++) {
            const y = axis === 'y' ? index : outer;
            const z = axis === 'y' ? outer : index;
            if (flags[at(x, y, z)] === CellType.Fluid) n++;
          }
        return n;
      };
      for (const [axis, index] of [
        ['y', ny - 2],
        ['y', 1],
        ['z', nz - 2],
        ['z', 1],
      ] as const) {
        const a = countPlane(freestream.flags, axis, index);
        const b = countPlane(freeslip.flags, axis, index);
        expect(b, `${axis}=${index} measurement plane differs between arms`).toBe(a);
        expect(a, `${axis}=${index} measurement plane is empty`).toBeGreaterThan(0);
      }
    });

    /**
     * `inletBC` — the phase-3b inlet control. Stage A showed the two M9-spec deviations
     * compensating: the hard-Dirichlet laterals clamp u = u_in everywhere, which hides that
     * the plain equilibrium `Inlet` is not a velocity BC (H12 §1). Making the inlet selectable
     * is what lets the 2×2 separate them.
     */
    describe('inletBC (phase-3b inlet control)', () => {
      const equilibrium = ahmedScene({ maxCells: CELLS, lateralBC: 'freeslip' });
      const velocity = ahmedScene({
        maxCells: CELLS,
        lateralBC: 'freeslip',
        inletBC: 'velocity',
      });

      it("defaults to 'equilibrium' and leaves the historical flag array untouched", () => {
        expect(freestream.inletBC).toBe('equilibrium');
        expect(equilibrium.inletBC).toBe('equilibrium');
        expect(ahmedScene({ maxCells: CELLS, inletBC: 'equilibrium' }).flags).toEqual(
          freestream.flags,
        );
        expect(freestream.flags.indexOf(CellType.VelocityInlet)).toBe(-1);
      });

      it('changes the inlet face and nothing else', () => {
        const { nx, ny, nz } = velocity;
        expect(velocity.inletBC).toBe('velocity');
        expect(velocity.bodyVoxels).toBe(equilibrium.bodyVoxels);
        expect(velocity.frontalCells).toBe(equilibrium.frontalCells);
        expect(velocity.omega).toBe(equilibrium.omega);
        let differing = 0;
        for (let i = 0; i < velocity.flags.length; i++) {
          if (velocity.flags[i] === equilibrium.flags[i]) continue;
          differing++;
          expect(i % nx, `cell ${i} differs but is not on the x=0 face`).toBe(0);
        }
        expect(differing).toBeGreaterThan(0);
        void ny;
        void nz;
      });

      /**
       * H12 §2, the two constraints that make a VelocityInlet well-posed. `EsotericPull3D`
       * throws on either, but only for cells a run happens to touch — this walks the whole
       * face, and the +x-Fluid rule is the one a scene can violate silently by growing the
       * body or moving the shell.
       */
      it('places VelocityInlet only where H12 §2 allows, edges left as plain Inlet', () => {
        const { nx, ny, nz, flags } = velocity;
        const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
        let count = 0;
        for (let z = 0; z < nz; z++)
          for (let y = 0; y < ny; y++)
            for (let x = 0; x < nx; x++) {
              if (flags[at(x, y, z)] !== CellType.VelocityInlet) continue;
              count++;
              expect(x, 'VelocityInlet off the x=0 face').toBe(0);
              expect(flags[at(1, y, z)], `VelocityInlet (0,${y},${z}) needs a Fluid +x neighbour`)
                .toBe(CellType.Fluid);
            }
        expect(count).toBeGreaterThan(0);
        // The edge ring keeps a BC whose +x neighbour may be shell — never VelocityInlet.
        expect(flags[at(0, ny - 1, Math.floor(nz / 2))]).not.toBe(CellType.VelocityInlet);
        expect(flags[at(0, Math.floor(ny / 2), 0)]).not.toBe(CellType.VelocityInlet);
        expect(flags[at(0, Math.floor(ny / 2), nz - 1)]).not.toBe(CellType.VelocityInlet);
        expect(flags[at(0, 0, Math.floor(nz / 2))]).toBe(CellType.Solid); // ground still wins
      });

      it('steps under EsotericPull3D on all four arms of the 2×2', () => {
        for (const lateral of ['freestream', 'freeslip'] as const)
          for (const inlet of ['equilibrium', 'velocity'] as const) {
            const s = ahmedScene({
              maxCells: CELLS,
              lateralBC: lateral,
              inletBC: inlet,
              omitBody: true,
            });
            const solver = new EsotericPull3D({
              nx: s.nx,
              ny: s.ny,
              nz: s.nz,
              omega: s.omega,
              flags: s.flags,
              inletVelocity: s.uLattice,
              collision: 'trt',
              regularize: true,
              les: { cs: 0.1 },
              freeSlip: lateral === 'freeslip' ? AHMED_FREESLIP_FACES : undefined,
            });
            solver.step(2); // both parities — the H12 pre-pass differs between them
            expect(
              Number.isFinite(solver.totalMass()),
              `${lateral}/${inlet} went non-finite`,
            ).toBe(true);
          }
      });
    });

    it('composes with omitBody: the empty free-slip tunnel is the same tunnel, bodyless', () => {
      const empty = ahmedScene({ maxCells: CELLS, lateralBC: 'freeslip', omitBody: true });
      expect(empty.lateralBC).toBe('freeslip');
      expect(empty.bodyVoxels).toBe(0);
      expect(empty.frontalCells).toBe(0);
      expect([empty.nx, empty.ny, empty.nz]).toEqual([freeslip.nx, freeslip.ny, freeslip.nz]);
      let differing = 0;
      for (let i = 0; i < empty.flags.length; i++) {
        if (freeslip.flags[i] === CellType.BodySolid) continue;
        if (empty.flags[i] !== freeslip.flags[i]) differing++;
      }
      expect(differing).toBe(0);
    });
  });
});
