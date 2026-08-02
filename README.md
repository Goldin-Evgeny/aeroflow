# AeroFlow

**A real wind tunnel in your browser tab.** AeroFlow is a 3D aerodynamic simulation
platform that runs entirely client-side on your GPU via WebGPU — no cloud, no install, no
per-run fees. Upload a model or a city block, set the wind, and watch physically simulated
air move through it in real time.

- **Physics-true, not a surrogate:** a lattice-Boltzmann (LBM) solver with LES turbulence
  modeling — transient, 3D, validated against published benchmarks (see
  [docs/VALIDATION.md](docs/VALIDATION.md)).
- **Zero marginal cost:** your GPU does the work, so iteration is unlimited and free.
- **Aimed at early-design wind screening:** pedestrian wind comfort around buildings,
  drag/lift on any shape, and (as our flagship demo) small wind-turbine siting.
  AeroFlow is a screening and iteration tool — it does not replace compliance-grade
  consultant studies, and we say so plainly.

## Status

Active development. The 2D solver (D2Q9, TRT collision, Smagorinsky LES) and the 3D core
(D3Q19 with Esoteric Pull in-place streaming and FP16 storage) run in WGSL; mesh import and
GPU voxelization work end to end. The atmospheric-boundary-layer and urban validation cases
are in progress, and the cases that do **not** yet meet their acceptance bands are recorded
as failures rather than quietly dropped — see [docs/VALIDATION.md](docs/VALIDATION.md) and
[docs/decisions/](docs/decisions/).

## Quickstart

```bash
npm install
npm run dev        # interactive 2D wind tunnel at http://localhost:5173
npm test           # CPU reference solver physics tests
```

Requires a WebGPU-capable browser: Chrome/Edge 113+, Safari 26+, Firefox 141+.

## How it works

The solver core (`packages/core`, MIT) implements the lattice-Boltzmann method: D2Q9 now,
D3Q19 with Smagorinsky LES next, with a Float64 CPU reference solver as the correctness
oracle for every GPU kernel. The app (`apps/studio`) runs the same algorithm in WGSL
compute shaders. Full math spec: [docs/PHYSICS.md](docs/PHYSICS.md).

All algorithms are implemented from the open literature (BGK/TRT collision, halfway
bounce-back, momentum exchange, Esoteric Pull in-place streaming per Lehmann 2022 CC-BY).

## License

The **source code** in this repository is MIT-licensed (see [LICENSE](LICENSE)) — the solver
core, the WGSL kernels and the app. The solver core stays open-source permanently (open-core
model — a proprietary product layer may appear later, separately).

The MIT grant does not extend to the third-party benchmark and validation data used as
correctness targets (AIJ pedestrian-wind cases, Ghia et al. 1982 cavity tables). Those
remain their publishers' property and are attributed in [NOTICE](NOTICE), which also
records the SHA-256 of every source file so each derived fixture can be reproduced.
