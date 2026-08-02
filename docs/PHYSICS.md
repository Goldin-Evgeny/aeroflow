# AeroFlow physics specification

This document is the complete mathematical specification of the AeroFlow solver. It is
written so that an implementer (human or model) can produce a correct solver from this
file alone, without reading any external code. Every equation states its source. The CPU
reference solver in `packages/core/src/cpu/solver2d.ts` implements Sections 2–3, 6 and 7
exactly as written here; GPU kernels must match it (see `CLAUDE.md`, CPU/GPU parity
rule). Numerical acceptance criteria for everything below live in `docs/VALIDATION.md`.

Notation: lattice units unless stated otherwise ($\Delta x = \Delta t = 1$, reference
density $\rho_0 = 1$). $f_i$ are the discrete distribution functions ("DDFs"),
$\mathbf{e}_i$ the discrete velocities, $w_i$ the weights, $\bar{i}$ = `opp[i]` the
direction opposite to $i$. Indices $\alpha,\beta$ range over spatial components.

---

## 1. Lattice-Boltzmann overview

The lattice-Boltzmann method (LBM) does not discretize the Navier–Stokes equations
directly. Instead it evolves a small set of particle distribution functions
$f_i(\mathbf{x}, t)$ on a uniform grid, where each $f_i$ represents the density of
fictitious particles moving with one of $q$ fixed discrete velocities $\mathbf{e}_i$
(9 in 2D, 19 in 3D here). One timestep consists of two local operations: **streaming**
(each $f_i$ moves to the neighboring cell in direction $\mathbf{e}_i$) and **collision**
(at each cell, the $f_i$ relax toward a local equilibrium determined by the cell's
density and velocity). Macroscopic fields are simple moments: density
$\rho = \sum_i f_i$ and momentum $\rho\mathbf{u} = \sum_i \mathbf{e}_i f_i$. Via a
Chapman–Enskog expansion this system reproduces the weakly compressible Navier–Stokes
equations to second order in space and time, with kinematic viscosity set by the
relaxation rate (Section 3). Standard reference: Krüger et al., _The Lattice Boltzmann
Method: Principles and Practice_, Springer 2017.

LBM is the right method for a browser GPU wind tunnel for three reasons. First, both
steps are local (streaming touches only nearest neighbors, collision touches only the
cell itself), so the algorithm maps onto one GPU thread per cell with no global solves,
no pressure Poisson equation, and no unstructured data — it is memory-bandwidth-bound
and saturates consumer GPUs (measured up to ~11,500 MLUPs/s D3Q19 on an RTX 4090
natively; see `docs/research/physics-validation.md`,
https://github.com/ProjectPhysX/FluidX3D README performance table — numbers only; the
clean-room rule in `CLAUDE.md` forbids reading that project's source). Second, LBM is
inherently transient, which is what large-eddy simulation (LES) of urban wind needs;
RANS-style steady solvers are a poor fit for gusty pedestrian-level flow. Third,
solid geometry enters as a per-cell boolean mask with bounce-back links (Section 7),
so voxelized buildings need no meshing.

---

## 2. Lattices

### 2.1 D2Q9 (2D, milestones M1–M5)

This ordering is **normative** and is defined in `packages/core/src/lattice.ts`; the CPU
reference solver and every WGSL kernel must use it identically.

Geometric layout of direction indices around a cell:

```
6 2 5
3 0 1
7 4 8
```

| $i$ | $\mathbf{e}_i = (e_x, e_y)$ | $w_i$ | $\bar{i}$ = opp[i] |
| --- | --------------------------- | ----- | ------------------ |
| 0   | ( 0, 0)                     | 4/9   | 0                  |
| 1   | ( 1, 0)                     | 1/9   | 3                  |
| 2   | ( 0, 1)                     | 1/9   | 4                  |
| 3   | (−1, 0)                     | 1/9   | 1                  |
| 4   | ( 0,−1)                     | 1/9   | 2                  |
| 5   | ( 1, 1)                     | 1/36  | 7                  |
| 6   | (−1, 1)                     | 1/36  | 8                  |
| 7   | (−1,−1)                     | 1/36  | 5                  |
| 8   | ( 1,−1)                     | 1/36  | 6                  |

Lattice speed of sound: $c_s^2 = 1/3$, i.e. $c_s = 1/\sqrt{3} \approx 0.577$.
(Lattice and weights: Qian, d'Humières & Lallemand, Europhys. Lett. 17:479, 1992.)

### 2.2 D3Q19 (3D, milestone M6+)

D3Q19 has one rest velocity, 6 axis velocities (weight 1/18) and 12 face-diagonal
velocities (weight 1/36); $c_s^2 = 1/3$ as in D2Q9 (Qian et al. 1992). The ordering
below is **normative for AeroFlow's 3D code**: opposite directions are stored as
adjacent pairs, $\mathrm{opp}(i) = i+1$ for odd $i$ and $i-1$ for even $i>0$, because
the Esoteric Pull streaming scheme (Section 11) operates on direction pairs. When
D3Q19 constants are added to `lattice.ts` they must match this table exactly.

| $i$ | $\mathbf{e}_i = (e_x, e_y, e_z)$ | $w_i$ | $\bar{i}$ |
| --- | -------------------------------- | ----- | --------- |
| 0   | ( 0, 0, 0)                       | 1/3   | 0         |
| 1   | ( 1, 0, 0)                       | 1/18  | 2         |
| 2   | (−1, 0, 0)                       | 1/18  | 1         |
| 3   | ( 0, 1, 0)                       | 1/18  | 4         |
| 4   | ( 0,−1, 0)                       | 1/18  | 3         |
| 5   | ( 0, 0, 1)                       | 1/18  | 6         |
| 6   | ( 0, 0,−1)                       | 1/18  | 5         |
| 7   | ( 1, 1, 0)                       | 1/36  | 8         |
| 8   | (−1,−1, 0)                       | 1/36  | 7         |
| 9   | ( 1,−1, 0)                       | 1/36  | 10        |
| 10  | (−1, 1, 0)                       | 1/36  | 9         |
| 11  | ( 1, 0, 1)                       | 1/36  | 12        |
| 12  | (−1, 0,−1)                       | 1/36  | 11        |
| 13  | ( 1, 0,−1)                       | 1/36  | 14        |
| 14  | (−1, 0, 1)                       | 1/36  | 13        |
| 15  | ( 0, 1, 1)                       | 1/36  | 16        |
| 16  | ( 0,−1,−1)                       | 1/36  | 15        |
| 17  | ( 0, 1,−1)                       | 1/36  | 18        |
| 18  | ( 0,−1, 1)                       | 1/36  | 17        |

Sanity checks an implementation must pass: $\sum_i w_i = 1$;
$\sum_i w_i e_{i\alpha} e_{i\beta} = c_s^2 \delta_{\alpha\beta}$;
$\mathbf{e}_{\bar{i}} = -\mathbf{e}_i$ for every $i$.

---

## 3. BGK collision and equilibrium

The equilibrium distribution, truncated to second order in velocity (Qian et al. 1992;
implemented in `equilibrium()` in `lattice.ts`):

$$f_i^{eq}(\rho, \mathbf{u}) = w_i\,\rho\left(1 + 3\,(\mathbf{e}_i\!\cdot\!\mathbf{u}) + 4.5\,(\mathbf{e}_i\!\cdot\!\mathbf{u})^2 - 1.5\,|\mathbf{u}|^2\right)$$

The coefficients 3, 4.5, 1.5 are $1/c_s^2$, $1/(2c_s^4)$, $1/(2c_s^2)$ with
$c_s^2 = 1/3$; the same formula holds for D2Q9 and D3Q19.

BGK (single-relaxation-time) collision, applied after streaming:

$$f_i \leftarrow f_i + \omega\left(f_i^{eq}(\rho, \mathbf{u}) - f_i\right), \qquad \omega = 1/\tau$$

with macroscopics computed from the post-streaming populations:
$\rho = \sum_i f_i$, $\mathbf{u} = \frac{1}{\rho}\sum_i \mathbf{e}_i f_i$
(plus the forcing shift of Section 6 when a body force is active).

Kinematic viscosity (Chapman–Enskog result; Krüger et al. 2017, ch. 4):

$$\nu = c_s^2\left(\tau - \tfrac{1}{2}\right) = \frac{1}{3}\left(\tau - \tfrac{1}{2}\right)$$

which requires $\tau > 1/2$ strictly (Section 10). BGK is the debug/reference collision
operator in AeroFlow; the default is TRT (next section) because BGK's halfway
bounce-back wall position is viscosity-dependent.

---

## 4. TRT collision (default operator)

The two-relaxation-time (TRT) operator (Ginzburg, Verhaeghe & d'Humières, Commun.
Comput. Phys. 3:427–478, 2008) splits every population into symmetric (even) and
antisymmetric (odd) parts with respect to direction reversal:

$$f_i^{\pm} = \frac{f_i \pm f_{\bar{i}}}{2}, \qquad f_i^{eq\pm} = \frac{f_i^{eq} \pm f_{\bar{i}}^{eq}}{2}$$

so $f_i = f_i^+ + f_i^-$, and the rest population $f_0$ is purely symmetric
($f_0^- = 0$). Collision relaxes the two parts at different rates:

$$f_i \leftarrow f_i - \omega^+\left(f_i^+ - f_i^{eq+}\right) - \omega^-\left(f_i^- - f_i^{eq-}\right)$$

- $\omega^+ \in (0,2)$ controls the viscosity exactly as BGK's $\omega$ does:
  $\nu = c_s^2\,(1/\omega^+ - \tfrac12)$. Set $\omega^+$ from the target viscosity
  (and from LES, Section 5).
- $\omega^- \in (0,2)$ is a free parameter fixed by the **magic parameter**

$$ \Lambda = \left(\frac{1}{\omega^+} - \frac{1}{2}\right)\left(\frac{1}{\omega^-} - \frac{1}{2}\right) = \frac{3}{16}
\quad\Longrightarrow\quad
\frac{1}{\omega^-} = \frac{1}{2} + \frac{\Lambda}{\,1/\omega^+ - 1/2\,}$$

Setting $\omega^- = \omega^+$ recovers BGK (then $\Lambda$ varies with $\tau$, which is
exactly the problem).

**Why $\Lambda = 3/16$:** for the halfway bounce-back rule (Section 7.1), the
leading-order closure error that determines where the effective no-slip wall sits
depends only on $\Lambda$, not on $\omega^+$ and $\omega^-$ separately. With
$\Lambda = 3/16$ the no-slip plane of a flat wall is located exactly halfway between
the solid and fluid lattice nodes for parabolic (Poiseuille-type) flow, independent of
viscosity, and the numerical slip vanishes: plane Poiseuille flow is then reproduced to
machine precision at any resolution. With BGK, the wall position drifts with $\tau$
(viscosity-dependent slip), which corrupts every wall-bounded benchmark. Sources:
Ginzburg et al. 2008; digest `docs/research/physics-validation.md` with
https://arxiv.org/pdf/2009.04604 and
https://www.sciencedirect.com/science/article/pii/S1877750317300583. The acceptance
test (M2, `docs/VALIDATION.md`): BGK Poiseuille error converges at order 2; TRT
($\Lambda = 3/16$) relative error ≤ 1e-4 (FP32 round-off), independent of
$\tau \in [0.51, 1.5]$.

Implementation note: TRT costs one extra load per direction pair ($f_{\bar i}$ is
needed to form $f_i^\pm$) and no extra storage. Conserved moments ($\rho$,
$\rho\mathbf u$) are computed exactly as in BGK.

---

## 5. Smagorinsky LES (subgrid turbulence)

At wind-engineering Reynolds numbers ($10^6$–$10^8$, see the worked example in
Section 9) the bare $\tau_0$ is indistinguishable from 0.5 and plain BGK/TRT is
unstable. AeroFlow uses the Smagorinsky subgrid model in the LBM formulation of Hou,
Sterling, Chen & Doolen (1996), *A lattice Boltzmann subgrid model for high Reynolds
number flows*, with $C_s \approx 0.1$ — chosen because the turbulent viscosity is
computable **per cell from local data only**: no velocity gradients, no finite
differences, no extra storage. Sources: Hou et al. 1996 via the digest
(https://www.academia.edu/98687966/A_lattice_Boltzmann_subgrid_model_for_high_Reynolds_number_flows)
and the Sailfish paper (https://arxiv.org/pdf/1311.2404).

After streaming, compute the non-equilibrium momentum flux tensor from the populations
already in registers:

$$\Pi^{neq}_{\alpha\beta} = \sum_i e_{i\alpha}\, e_{i\beta}\left(f_i - f_i^{eq}\right),
\qquad
\bar\Pi = \sqrt{\sum_{\alpha\beta} \left(\Pi^{neq}_{\alpha\beta}\right)^2}$$

(In 2D this is a symmetric 2×2 tensor — 3 independent entries; in 3D symmetric 3×3 —
6 entries.) The effective relaxation time is the positive root of the implicit
Smagorinsky closure (Hou et al. 1996):

$$\tau_{\mathrm{eff}} = \tau_0 + \tau_t, \qquad
\tau_t = \frac{1}{2}\left(\sqrt{\tau_0^2 + \frac{18\sqrt{2}\, C_s^2\, \bar\Pi}{\rho}} - \tau_0\right)$$

with $C_s \approx 0.1$ and the filter width equal to one lattice spacing. Then collide
with $\omega = 1/\tau_{\mathrm{eff}}$ (BGK), or set
$\omega^+ = 1/\tau_{\mathrm{eff}}$ and re-derive $\omega^-$ from $\Lambda = 3/16$
per cell (TRT). Properties an implementation must preserve:

- $\tau_t \ge 0$ always, so $\tau_{\mathrm{eff}} \ge \tau_0 > 0.5$: the model
  regularizes the $\tau \to 0.5$ stability limit (Section 10).
- Entirely local: one extra tensor contraction per cell inside the fused kernel.
- In resolved laminar flow $\bar\Pi \to 0$ and the model must not pollute results —
  the M5 gate requires ≤ 3 % shift on the laminar cylinder benchmarks with LES on
  (`docs/VALIDATION.md`).

---

## 6. Body force: velocity-shifted equilibrium

A constant body force per unit mass $\mathbf{g}$ (lattice units) drives channel flows
(Poiseuille, M2) and can model pressure gradients. AeroFlow uses the shifted-velocity
(Shan–Chen-style) forcing **exactly as implemented in
`packages/core/src/cpu/solver2d.ts`**: compute the bare moment velocity, then evaluate
the equilibrium at a shifted velocity,

$$\mathbf{u}_{eq} = \frac{1}{\rho}\sum_i \mathbf{e}_i f_i + \frac{\tau\,\mathbf{g}}{\rho}$$

$$f_i \leftarrow f_i + \omega\left(f_i^{eq}(\rho, \mathbf{u}_{eq}) - f_i\right)$$

(Shan & Chen, Phys. Rev. E 47:1815, 1993; classified against other forcing schemes in
Krüger et al. 2017, ch. 6.)

**Limits of this scheme — state them honestly:**

- It is adequate for a **constant, uniform** force; for spatially or temporally varying
  forces it introduces discrete-lattice errors of order $g^2$ and $g\,\partial u$ that
  the Guo forcing scheme (Guo, Zheng & Shi, Phys. Rev. E 65:046308, 2002) removes. If
  varying forces are ever needed (e.g. actuator-line turbines), switch to Guo forcing
  and re-run the validation ladder.
- The true fluid velocity in this scheme is $\mathbf{u} = \frac{1}{\rho}\sum_i
  \mathbf{e}_i f_i + \frac{\mathbf{g}}{2\rho}$ (half-force correction, Krüger et al.
  2017 ch. 6). `Solver2D.macroscopics()` reports the bare moment velocity; for the
  tiny driving forces used in validation ($g \sim 10^{-6}$) the difference is far below
  test tolerances, but any measurement that compares absolute velocities under strong
  forcing must apply the $+\mathbf{g}/2\rho$ correction.
- With TRT, the $\tau$ in the shift is $1/\omega^+$.

---

## 7. Boundary conditions

The CPU reference implements 7.1–7.3 exactly as specified here (see the algorithm
comment in `solver2d.ts`); 7.4–7.5 are additions for 3D/urban milestones and must be
added to the CPU reference first, per the parity rule.

### 7.1 Halfway bounce-back solids (no-slip)

Solid geometry is a per-cell flag mask. The effective wall sits **halfway between** a
solid node and its fluid neighbor (hence the name; Ladd, J. Fluid Mech. 271:285, 1994;
Krüger et al. 2017 ch. 5). With TRT at $\Lambda = 3/16$ this halfway position is exact
and viscosity-independent (Section 4).

**Pull-scheme implementation rule** (normative; this is what `solver2d.ts` does): when
fluid cell $\mathbf{x}$ pulls direction $i$ from source cell
$\mathbf{x} - \mathbf{e}_i$ and that source is a solid cell — or lies outside a
non-periodic domain edge — the cell instead takes its **own opposite post-collision
population from the previous step**:

$$f_i(\mathbf{x}, t) = f_{\bar{i}}^{pc}(\mathbf{x}, t-1)$$

where superscript $pc$ means post-collision. Solid cells' storage is never read or
written. No special wall-normal logic is needed; corners and staircased (voxelized)
geometry are handled link by link.

### 7.2 Equilibrium inlet (prescribed velocity)

Cells flagged `Inlet` are overwritten every step with the equilibrium at unit density
and the prescribed inlet velocity:

$$f_i(\mathbf{x}_{in}, t) = f_i^{eq}(\rho = 1, \mathbf{u}_{in})$$

This is the simplest velocity inlet; it weakly reflects pressure waves but is robust
and matches the reference solver. $\mathbf{u}_{in}$ may vary with height (Section 7.5).
(Krüger et al. 2017 ch. 5, "equilibrium schemes".)

### 7.3 Zero-gradient outlet

Cells flagged `Outlet` copy the **previous post-collision state** of their upstream
neighbor (for a right-edge outlet with flow in $+x$: the cell at $x-1$):

$$f_i(\mathbf{x}_{out}, t) = f_i^{pc}(\mathbf{x}_{out} - \hat{\mathbf{x}}, t-1)\quad \forall i$$

This first-order extrapolation lets vortices leave with weak reflections; it is the
scheme in `solver2d.ts` and is acceptable for screening-grade work. Place the outlet
far downstream (cylinder benchmark: blockage ≤ 5 %, see `docs/VALIDATION.md`).

### 7.4 Free-slip (domain top and lateral sides in 3D)

For flat, axis-aligned domain faces, specular reflection: a pull whose source lies
outside the face takes the population whose velocity is mirrored in the face normal
$\mathbf{n}$:

$$f_i(\mathbf{x}, t) = f_{i^*}^{pc}(\mathbf{x}, t-1), \qquad
\mathbf{e}_{i^*} = \mathbf{e}_i - 2(\mathbf{e}_i\!\cdot\!\mathbf{n})\,\mathbf{n}$$

i.e. the wall-normal velocity component flips, tangential components are preserved, so
no tangential momentum is absorbed (Krüger et al. 2017 ch. 5). Valid only for flat
axis-aligned boundaries — which is exactly what the wind-tunnel domain box needs. The
mirrored index $i^*$ is a compile-time table per face.

### 7.5 Atmospheric boundary layer (ABL) inlet profiles

Urban runs (M10+) replace the uniform inlet velocity with a height-dependent profile
applied through the Section 7.2 inlet, $\mathbf{u}_{in}(z)$ horizontal, where $z$ is
height above ground in physical units:

- **Power law** (default; AIJ benchmark inflow, exponent $\alpha = 0.25$ for the
  Niigata Case E wind-tunnel data — digest:
  https://help.sim-flow.com/validation/wind-analysis-buildings):

$$u(z) = u_{ref}\left(\frac{z}{z_{ref}}\right)^{\alpha}, \qquad \alpha = 0.25 \text{ default, configurable}$$

- **Log law** (neutral surface layer, roughness length $z_0$, von Kármán constant
  $\kappa = 0.41$):

$$u(z) = \frac{u_*}{\kappa}\,\ln\!\left(\frac{z + z_0}{z_0}\right)
\quad\text{with } u_* \text{ set so that } u(z_{ref}) = u_{ref},
\text{ i.e. } u(z) = u_{ref}\,\frac{\ln\!\left((z+z_0)/z_0\right)}{\ln\!\left((z_{ref}+z_0)/z_0\right)}$$

Both are standard wind-engineering inflow forms (e.g. AIJ guideline, Tominaga et al.
2008, J. Wind Eng. Ind. Aerodyn. 96:1749–1761,
https://www.sciencedirect.com/science/article/abs/pii/S0167610508000445). The M10 fetch
test requires the profile to survive an empty domain within 5 % at the building station.
Evaluate the profile at the cell-center height
of each inlet cell and clamp $u(z) \le u_{max,lattice} = 0.1$ via the unit mapping
(Section 9).

### 7.6 Boundary condition summary vs. cell flags

| `CellType` (lattice.ts) | Rule | Section |
|---|---|---|
| `Fluid = 0` | pull-stream + collide | 3–6 |
| `Solid = 1` | neighbors bounce back; storage unused | 7.1 |
| `Inlet = 2` | equilibrium at $\rho=1$, $\mathbf{u}_{in}(z)$ | 7.2, 7.5 |
| `Outlet = 3` | copy upstream neighbor's previous state | 7.3 |

Free-slip applies to domain faces, not cell flags.

---

## 8. Forces on bodies: momentum exchange

Aerodynamic force on a solid body is evaluated by the **momentum-exchange method**
(MEM) on bounce-back links — the accepted, cheap, 3D-friendly approach; stress
integration is explicitly discouraged by the key reference. Source: Mei, Yu, Shyy &
Luo, Phys. Rev. E 65:041203 (2002), https://doi.org/10.1103/PhysRevE.65.041203
(original idea Ladd 1994).

**Per-link formula.** For every boundary link — a fluid cell $\mathbf{x}_f$ with a
solid neighbor at $\mathbf{x}_f + \mathbf{e}_j$ — the momentum transferred to the body
during one timestep is the momentum carried in by the outgoing population minus the
momentum carried back by the bounced one:

$$\Delta\mathbf{P}_{link} = \mathbf{e}_j\left[\tilde{f}_j(\mathbf{x}_f, t) + f_{\bar{j}}(\mathbf{x}_f, t+1)\right]$$

where $\tilde{f}_j$ is the post-collision value leaving $\mathbf{x}_f$ toward the solid
and $f_{\bar j}(t+1)$ is the value that arrives back after bounce-back. For a
**stationary** wall the bounce-back rule gives
$f_{\bar j}(\mathbf{x}_f, t+1) = \tilde f_j(\mathbf{x}_f, t)$, so the formula reduces to

$$\Delta\mathbf{P}_{link} = 2\,\mathbf{e}_j\,\tilde{f}_j(\mathbf{x}_f, t)$$

and the total instantaneous force on the body (lattice units, force = momentum per
timestep since $\Delta t = 1$) is

$$\mathbf{F} = \sum_{\text{boundary links}} 2\,\mathbf{e}_j\,\tilde{f}_j(\mathbf{x}_f, t)$$

In the pull scheme this is evaluated without extra passes: when cell $\mathbf{x}$
pulls direction $i$ and the bounce branch triggers (Section 7.1), the pulled value *is*
$\tilde f_{\bar i}(\mathbf{x}, t-1)$, so the kernel accumulates
$2\,\mathbf{e}_{\bar i} \cdot (\text{bounced value})$ — the force series is delayed by
one step, which is irrelevant for the time-averaged and spectral quantities we report
(mean $C_d$, Strouhal number). Moving bodies require Galilean-invariant corrections
(Wen et al., reviewed in Entropy 17:7876, 2015,
https://www.mdpi.com/1099-4300/17/12/7876) — out of scope until moving geometry exists.

**Reduction strategy (GPU).** WebGPU has no floating-point atomics, so per-link
contributions are reduced hierarchically: each workgroup accumulates its threads'
$(F_x, F_y, F_z)$ partial sums in workgroup-shared memory (tree reduction after a
`workgroupBarrier`), writes one partial vector per workgroup to a small buffer, and a
second tiny dispatch (or the CPU, for the handful of partials) sums them. This is the
per-workgroup partial-sum design. The CPU reference computes
the same sum in a plain loop for parity checks.

**Conversion to physical units** (Section 9 mapping, lattice $\rho_{lat} \approx 1$):

$$\mathbf{F}_{phys} = \mathbf{F}_{lat}\;\rho_{phys}\,\frac{\Delta x^4}{\Delta t^2}\ \ [\mathrm{N}]\ \text{(3D)};\qquad
\mathbf{F}_{phys} = \mathbf{F}_{lat}\;\rho_{phys}\,\frac{\Delta x^3}{\Delta t^2}\ \ [\mathrm{N/m}]\ \text{(2D, per unit span)}$$

Drag coefficient: $C_d = \dfrac{2 F_x}{\rho\, U^2 A}$ evaluated consistently in either
unit system ($A$ = frontal area; in 2D, frontal length, giving $C_d$ per unit span).

---

## 9. Unit mapping (physical ↔ lattice)

This section mirrors `packages/core/src/units.ts` (`latticeUnits()`), which is the
single conversion authority — user-facing code is SI, solvers are lattice units. Choose
a characteristic physical length $L$ (m) resolved by $N$ cells, a characteristic
physical velocity $U$ (m/s), a target lattice velocity $u_{lat}$ (default 0.05,
must be ≤ 0.1 — Section 10), and the physical kinematic viscosity $\nu_{phys}$
(air: $1.5\times10^{-5}\ \mathrm{m^2/s}$ at ~20 °C, `AIR_KINEMATIC_VISCOSITY`). Then:

$$\Delta x = \frac{L}{N} \quad [\mathrm{m}], \qquad
\Delta t = \frac{u_{lat}\,\Delta x}{U} \quad [\mathrm{s}], \qquad
\nu_{lat} = \nu_{phys}\,\frac{\Delta t}{\Delta x^2}, \qquad
\tau = 3\,\nu_{lat} + \frac{1}{2}$$

$$Re = \frac{U L}{\nu_{phys}} = \frac{u_{lat}\, N}{\nu_{lat}} \quad \text{(identical in both systems — this is the invariant to verify)}$$

Any lattice velocity converts back as
$\mathbf{u}_{phys} = \mathbf{u}_{lat}\,\Delta x / \Delta t$; forces per Section 8.

**Worked example — 10 m/s wind over a 20 m building.** Take $L = H = 20$ m resolved by
$N = 40$ cells (0.5 m cells, pedestrian-resolving), $U = 10$ m/s, $u_{lat} = 0.05$,
air viscosity:

| Quantity | Value |
|---|---|
| $\Delta x$ | $20/40 = 0.5$ m |
| $\Delta t$ | $0.05 \times 0.5 / 10 = 1.25\times10^{-3}$ s... **no:** $= 2.5\times10^{-3}$ s |
| velocity scale $\Delta x/\Delta t$ | $200$ m/s → check: $0.05 \times 200 = 10$ m/s ✓ |
| $\nu_{lat}$ | $1.5\times10^{-5} \times 2.5\times10^{-3} / 0.5^2 = 1.5\times10^{-7}$ |
| $\tau$ | $3 \times 1.5\times10^{-7} + 0.5 = 0.50000045$ |
| $Re$ | $10 \times 20 / 1.5\times10^{-5} \approx 1.3\times10^{7}$ |

$\tau$ is numerically indistinguishable from the 0.5 stability limit: **plain BGK/TRT
cannot run this case; the LES model (Section 5) supplies the effective viscosity that
makes it computable.** This is not a workaround — resolving $Re \sim 10^7$ directly is
impossible for any CFD method on any computer; LES-with-wall-modeling is how the entire
wind-engineering field operates (AIJ guidelines, Tominaga et al. 2008). One physical
second of wind is $1/\Delta t = 400$ timesteps; a 60-second averaging window is 24,000
steps.

---

## 10. Stability envelope

All limits below are enforced or surfaced by `latticeUnits()` (`stable` flag) and the
solver UIs. Sources: digest `docs/research/physics-validation.md`
(https://arxiv.org/abs/2002.05265) and Krüger et al. 2017.

- **$\tau > 0.5$ strictly.** $\nu = c_s^2(\tau - \tfrac12)$ must be positive;
  `latticeUnits()` flags `stable` only for $\tau > 0.505$ as a practical BGK margin.
- **Lattice velocity $u \le 0.1$** (hard ceiling 0.2). LBM is weakly compressible:
  errors grow as $O(Ma^2)$ with $Ma = u/c_s$. Beyond $u \approx 0.2$, spurious density
  oscillations appear well before the theoretical limit.
- **Mach ceiling.** Linear-stability analysis of athermal D2Q9-BGK gives a critical
  Mach number of ≈ 0.73 ($u \approx 0.42$) — an upper bound, not an operating point
  (https://arxiv.org/abs/2002.05265).
- **What LES regularizes — and what it does not.** Smagorinsky adds
  $\tau_t \ge 0$ wherever the non-equilibrium stress is large, keeping
  $\tau_{\mathrm{eff}}$ away from 0.5 in under-resolved turbulent regions; this is what
  makes $Re \gtrsim 10^4$ runs stable (Section 5). It does **not** fix excessive
  lattice velocity ($Ma$ errors), inlet/outlet reflections, or too-coarse geometry;
  those must be controlled by the unit mapping and domain layout. TRT additionally
  extends the stable envelope relative to BGK at low $\tau$.
- Practical operating box for AeroFlow: $\tau_0 \in (0.5, 1.0]$, $u_{lat} \in
  [0.02, 0.1]$, LES on for any case with $Re > \sim 10^3$ per resolved obstacle.

---

## 11. 3D memory and performance plan

What makes a 256³ lattice fit and run interactively in a browser. All decisions here
are architecture-frozen; performance targets are the M6 go/no-go gates.

### 11.1 Esoteric Pull in-place streaming

**Clean-room constraint (CLAUDE.md hard rule): implement only from the open-access
paper — Lehmann, "Esoteric Pull and Esoteric Push: Two Simple In-Place Streaming
Schemes for the Lattice Boltzmann Method on GPUs", *Computation* 10(6):92, MDPI 2022,
CC-BY, https://doi.org/10.3390/computation10060092. NEVER read or reference FluidX3D
source code.** The paper's indexing figures are the authoritative reference for the
scheme; this section summarizes it.

Classic two-copy streaming needs two full DDF arrays (read one, write the other).
Esoteric Pull needs **one** array by exploiting direction pairs $(i, \bar i)$: after a
cell has consumed a pair's values, their two storage slots can immediately receive the
post-collision outputs in swapped roles, and the addressing pattern alternates between
even and odd timesteps (selected by a uniform). Per fused stream-collide step at cell
$\mathbf{x}$, for each pair $(i, \bar i)$ with $i$ odd (the rest population $f_0$ is
always read and written in place):

- **Even step:** read $f_i$ from (cell $\mathbf{x}-\mathbf{e}_i$, slot $i$) and
  $f_{\bar i}$ from (cell $\mathbf{x}$, slot $\bar i$); after collision write
  $f_i'$ to (cell $\mathbf{x}$, slot $\bar i$) and $f_{\bar i}'$ to
  (cell $\mathbf{x}-\mathbf{e}_i$, slot $i$) — i.e. each value is written back to
  exactly the location it was read from, with the pair's roles swapped.
- **Odd step:** the mirror addressing — read $f_i$ from
  (cell $\mathbf{x}-\mathbf{e}_i$, slot $\bar i$) and $f_{\bar i}$ from
  (cell $\mathbf{x}$, slot $i$); write $f_i'$ to (cell $\mathbf{x}$, slot $i$) and
  $f_{\bar i}'$ to (cell $\mathbf{x}-\mathbf{e}_i$, slot $\bar i$).

Each step reads exactly what the previous step wrote (this invariant is checkable by
hand from the two bullets), no cell reads another cell's *output* of the same step, so
one thread per cell needs no synchronization. Halfway bounce-back integrates naturally:
when the pull neighbor is solid, the kernel skips the neighbor access and loads/stores
the pair locally, which reproduces the Section 7.1 rule (Lehmann 2022, §3). Because
in-place streaming with even/odd semantics is notoriously easy to get subtly wrong,
the M6 acceptance test requires the GPU kernel to be **bit-identical to the two-copy
CPU reference on a 32³ grid for 100 steps**, re-checked on every kernel change


### 11.2 FP16 storage, FP32 arithmetic, shifted DDFs

DDFs are stored as 16-bit floats but all arithmetic is FP32 (load → convert → compute →
convert → store). To preserve mantissa precision, DDFs are stored **shifted by their
lattice weight**: the stored quantity is $f_i - w_i$, which is centered near 0 (where
FP16 has dense exponent coverage) instead of near $w_i$. Equilibrium in shifted form is
computed as $f_i^{eq} - w_i = w_i\rho(\ldots) - w_i$ using a numerically careful
grouping. Source: Lehmann, Krause, Amati, Sega, Harting & Gekle, "Accuracy and
performance of the lattice Boltzmann method with 64-bit, 32-bit, and customized 16-bit
number formats", Phys. Rev. E 106:015308 (2022),
https://doi.org/10.1103/PhysRevE.106.015308 (open preprint:
https://arxiv.org/abs/2112.08926). WGSL path: `shader-f16` where available;
`pack2x16float`/`unpack2x16float` on `u32` arrays as the universal fallback. An
FP32-storage build is maintained permanently; every validation rung gets an
FP16-vs-FP32 A/B (M7 gate: ≤ 2 % difference on sphere $C_d$).

### 11.3 Bytes per cell

D3Q19 with Esoteric Pull (single DDF copy); ρ and u are stored for
visualization/probes and written only every N steps:

| Component | FP32 storage | FP16 storage |
|---|---|---|
| 19 DDFs (single copy) | 76 B | 38 B |
| density ρ | 4 B | 4 B |
| velocity u (3 × f32) | 12 B | 12 B |
| flags (u8) | 1 B | 1 B |
| **Total per cell** | **93 B** | **55 B** |

(vs. 169 B/cell for FP32 two-copy streaming.) At 55 B/cell, 8 GB of VRAM holds ~145M
cells (~525³); a 256³ domain (16.8M cells) needs ~0.92 GB. Sources: Lehmann 2022
(Computation 10:92) and digest `docs/research/physics-validation.md`. Derived browser
throughput estimates (256³ at ~60–85 steps/s FP32, ~120–165 FP16 on an RTX
4060-laptop-class GPU) are **calculated, not measured** — they assume 60–85 % of native
bandwidth and are gated by measurement at M6 (honest-claims
rule).

### 11.4 Multi-buffer splitting for WebGPU limits

WebGPU spec defaults are small (`maxBufferSize` 256 MiB, `maxStorageBufferBindingSize`
128 MiB) and must be renegotiated at device request; practical caps are ~2 GB per
buffer on desktop and ~1 GB on iOS (digest `docs/research/webgpu-tech.md`).
The DDF storage is therefore structure-of-arrays — each direction a contiguous array
indexed `i = x + Nx*(y + Ny*z)` — grouped into 4–8 `GPUBuffer`s so every binding stays
≤ 1 GB while total memory may exceed the single-buffer cap. Device-tier grid ladder:
spec-default devices → 128³; iOS (~1 GB) → 160³–192³; 8 GB desktop → 256³ to
512×512×128. Dispatch: fused kernel, one thread per cell, `@workgroup_size(64)` 1D;
100–200 timesteps batched per command-buffer submit; timestamp-query MLUPs HUD always
on (M1/M6 gates).

---

## Appendix: implementation checklist for a new kernel

1. Direction constants match Section 2 tables exactly (copy from `lattice.ts`; note the
   D2Q9/D3Q19 tables in this file are normative).
2. Pull streaming with the Section 7.1 bounce rule; inlet/outlet per 7.2–7.3.
3. Macroscopics before collision; forcing shift (Section 6) if $\mathbf{g} \ne 0$.
4. TRT with $\Lambda = 3/16$ by default; BGK behind a debug toggle.
5. LES per Section 5 when enabled; applies to $\omega^+$ only.
6. Match the CPU reference bit-for-bit (FP32) or to ≤ 1e-6 relative (mixed precision)
   on a small grid before running any validation case.
$$
