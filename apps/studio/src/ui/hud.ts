export interface HudDefaults {
  uin: number;
  tau: number;
  brush: number;
  paused: boolean;
}

export interface HudCallbacks {
  onUin(v: number): void;
  onTau(v: number): void;
  onMode(mode: 'speed' | 'vorticity' | 'tau'): void;
  /** Smagorinsky LES: cs = 0 disables the subgrid model. */
  onLes(cs: number): void;
  onBrush(v: number): void;
  onPauseToggle(): boolean; // returns new paused state
  onResetFlow(): void;
  onClearObstacles(): void;
  onAddCylinder(): void;
}

export interface HudInfo {
  gridLabel: string;
  adapterDescription: string;
  limitsSummary: string;
}

export interface Hud {
  setStats(s: { stepsPerSec: number; mlups: number; totalSteps: number; re: number }): void;
  brush(): number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onInput: (v: number) => void,
): HTMLElement {
  const out = el('output', { text: format(value) });
  const input = el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onInput(v);
  });
  return el('div', { class: 'control' }, el('label', {}, label, out), input);
}

export function buildHud(root: HTMLElement, info: HudInfo, d: HudDefaults, cb: HudCallbacks): Hud {
  let brushSize = d.brush;

  const stats = el('div', { class: 'stats' });
  const setStats: Hud['setStats'] = (s) => {
    stats.innerHTML =
      `grid <b>${info.gridLabel}</b> · Re ≈ <b>${s.re.toFixed(0)}</b><br>` +
      `<b>${s.mlups.toFixed(0)}</b> MLUPs · <b>${s.stepsPerSec.toFixed(0)}</b> steps/s<br>` +
      `total steps <b>${s.totalSteps.toLocaleString()}</b>`;
  };

  const pauseBtn = el('button', { text: d.paused ? 'Run' : 'Pause' });
  pauseBtn.addEventListener('click', () => {
    pauseBtn.textContent = cb.onPauseToggle() ? 'Run' : 'Pause';
  });

  const btn = (text: string, onClick: () => void) => {
    const b = el('button', { text });
    b.addEventListener('click', onClick);
    return b;
  };

  const modeSelect = el('select', {});
  modeSelect.append(el('option', { value: 'speed', text: 'Speed' }));
  modeSelect.append(el('option', { value: 'vorticity', text: 'Vorticity' }));
  modeSelect.append(el('option', { value: 'tau', text: 'Eddy viscosity τ_t (LES)' }));
  modeSelect.addEventListener('change', () =>
    cb.onMode(modeSelect.value as 'speed' | 'vorticity' | 'tau'),
  );

  // Smagorinsky LES toggle (M5). Default Cs = 0.1 when enabled; 0 disables the model.
  const LES_CS = 0.1;
  const lesToggle = el('input', { type: 'checkbox' });
  lesToggle.addEventListener('change', () => cb.onLes(lesToggle.checked ? LES_CS : 0));
  const lesControl = el(
    'div',
    { class: 'control' },
    el('label', {}, lesToggle, ` LES subgrid (Cs=${LES_CS})`),
  );

  root.append(
    el('h1', {}, 'Aero', el('span', { text: 'Flow' })),
    el('p', {
      class: 'tagline',
      text: 'A wind tunnel in your browser — lattice-Boltzmann on your GPU.',
    }),
    stats,
    slider('Wind speed (lattice u)', 0.01, 0.12, 0.005, d.uin, (v) => v.toFixed(3), cb.onUin),
    // τ floor 0.501 (≈Re 14k at u=0.12) so LES can be stressed into the turbulent regime;
    // below ~0.51 the flow needs LES on to stay stable (turn LES off there to see it blow up).
    slider('Relaxation time τ', 0.501, 1.0, 0.001, d.tau, (v) => v.toFixed(3), cb.onTau),
    slider(
      'Brush size',
      2,
      24,
      1,
      d.brush,
      (v) => String(v),
      (v) => {
        brushSize = v;
        cb.onBrush(v);
      },
    ),
    el('div', { class: 'control' }, el('label', {}, 'Visualization'), modeSelect),
    lesControl,
    el(
      'div',
      { class: 'buttons' },
      pauseBtn,
      btn('Reset flow', cb.onResetFlow),
      btn('Clear obstacles', cb.onClearObstacles),
      btn('Add cylinder', cb.onAddCylinder),
    ),
    el('p', {
      class: 'hint',
      text: 'Draw obstacles with the mouse. Right-click (or Shift+drag) erases. Watch the vortex street form behind the cylinder.',
    }),
    el(
      'details',
      {},
      el('summary', { text: 'GPU details' }),
      el('pre', { text: `${info.adapterDescription}\n${info.limitsSummary}` }),
    ),
  );

  return { setStats, brush: () => brushSize };
}
