import { D3Q19 } from '../lattice3d.js';
import { D3Q19_SPEC, equilibrium3, type CollideContext } from './collide.js';

export type Outlet3D = 'pressure' | 'zero-gradient';

/** H14 fixed-density non-equilibrium extrapolation, applied in place to upstream DDFs. */
export function reconstructPressureOutlet3D(populations: Float64Array, ctx: CollideContext): void {
  let rho = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < D3Q19.q; i++) {
    const fi = populations[i];
    rho += fi;
    mx += D3Q19.ex[i] * fi;
    my += D3Q19.ey[i] * fi;
    mz += D3Q19.ez[i] * fi;
  }

  const shiftX = ctx.forcing === 'guo' ? 0.5 * ctx.gx : 0;
  const shiftY = ctx.forcing === 'guo' ? 0.5 * ctx.gy : 0;
  const shiftZ = ctx.forcing === 'guo' ? 0.5 * ctx.gz : 0;
  const ux = mx / rho - shiftX;
  const uy = my / rho - shiftY;
  const uz = mz / rho - shiftZ;
  for (let i = 0; i < D3Q19.q; i++) {
    const equilibriumOut = equilibrium3(D3Q19_SPEC, i, 1, ux, uy, uz);
    const equilibriumNeighbor = equilibrium3(D3Q19_SPEC, i, rho, ux, uy, uz);
    populations[i] = equilibriumOut + (populations[i] - equilibriumNeighbor);
  }
}
