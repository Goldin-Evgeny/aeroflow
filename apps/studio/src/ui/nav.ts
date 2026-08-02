/**
 * Page launcher for the routes `main.ts` dispatches.
 *
 * Every page below already existed but was reachable only by knowing its query flag, so
 * nine milestones of work were invisible to anyone opening the deployed site. This is a
 * pure navigation surface — it mounts no simulation and holds no state.
 *
 * It attaches to `document.body`, NOT to `#app`: every route clears `#app` when it mounts,
 * which would wipe a nav placed inside it.
 *
 * Labels stay plain about what each page is (CLAUDE.md rule 5 — honest claims only).
 * Validation harnesses are named as validation harnesses, not as product features, and
 * pages whose acceptance criteria do not currently pass are not described as if they do.
 */

export interface NavEntry {
  /** Query flag that selects this route; '' is the default route. */
  readonly param: string;
  readonly label: string;
  /** One-line plain description, shown as the link title. */
  readonly hint: string;
}

export const NAV_ENTRIES: readonly NavEntry[] = [
  {
    param: '',
    label: '3D wind tunnel',
    hint: 'Cube in a tunnel at Re≈200 — slice planes and GPU streamlines',
  },
  {
    param: 'bench3d',
    label: 'GPU benchmark',
    hint: 'D3Q19 throughput ladder (128³/192³/256³ × FP32/FP16) with MLUPs',
  },
  {
    param: 'import3d',
    label: 'Import a mesh',
    hint: 'Drag in an STL/glTF, voxelize on the GPU, read drag in newtons',
  },
  {
    param: 'spheredrag',
    label: 'Sphere drag (validation)',
    hint: 'Sphere Cd vs the standard drag curve — screening-grade; Re=1000 and 10⁴ are out of band',
  },
  {
    param: 'cavity',
    label: 'Lid-driven cavity (validation)',
    hint: 'Cavity centrelines vs the Ghia 1982 tables at Re=100 and Re=1000',
  },
  {
    param: 'aij',
    label: 'AIJ Case A (validation)',
    hint: 'Isolated building vs wind-tunnel data, with the ABL inlet editor',
  },
  {
    param: 'urban',
    label: 'AIJ Case C/E (validation)',
    hint: 'Urban block workbench — Case C blocked by the DDF binding cap, Case E deferred',
  },
  {
    param: 'playground2d',
    label: '2D playground',
    hint: 'The original interactive D2Q9 tunnel — draw obstacles with the mouse',
  },
];

/** Build the href for an entry, preserving nothing else — routes are mutually exclusive. */
function hrefFor(entry: NavEntry): string {
  return entry.param === '' ? './' : `./?${entry.param}`;
}

/**
 * Render the launcher. `activeParam` is the flag of the current route ('' for the default)
 * and gets `aria-current`. Collapsed by default so it never covers a HUD or canvas.
 */
export function mountNav(activeParam: string): void {
  const details = document.createElement('details');
  details.className = 'nav-launcher';

  const summary = document.createElement('summary');
  const active = NAV_ENTRIES.find((e) => e.param === activeParam);
  summary.textContent = active ? `AeroFlow · ${active.label}` : 'AeroFlow';
  summary.title = 'Show the other pages';
  details.append(summary);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'AeroFlow pages');
  for (const entry of NAV_ENTRIES) {
    const a = document.createElement('a');
    a.href = hrefFor(entry);
    a.textContent = entry.label;
    a.title = entry.hint;
    if (entry.param === activeParam) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  details.append(nav);
  document.body.append(details);
}
