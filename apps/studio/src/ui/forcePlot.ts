/**
 * Live Cd/Cl strip-chart for the 2D cylinder benchmark (M4 step 8). Self-contained
 * canvas widget: `push(cd, cl)` appends a sample, `setReadouts` updates the numeric
 * panel (running mean Cd, Cl amplitude, St — St shown only once ≥10 periods exist). No
 * GPU, no framework; the caller feeds it samples off each force readback.
 */

export interface ForceReadouts {
  meanCd: number;
  clAmplitude: number;
  /** Strouhal number, or null until enough periods have accrued. */
  st: number | null;
  periods: number;
}

const CAPACITY = 1200; // rolling window of samples drawn

export class ForcePlot {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly readoutEl: HTMLDivElement;
  private readonly cd: Float32Array = new Float32Array(CAPACITY);
  private readonly cl: Float32Array = new Float32Array(CAPACITY);
  private count = 0;
  private head = 0;

  constructor(width = 480, height = 180) {
    this.element = document.createElement('div');
    this.element.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'background:#0b0e13;border:1px solid #2d333b;border-radius:4px';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('forcePlot: 2d context unavailable');
    this.ctx = ctx;

    this.readoutEl = document.createElement('div');
    this.readoutEl.style.cssText = 'font:12px/1.5 ui-monospace,monospace;color:#e6edf3';
    this.setReadouts({ meanCd: NaN, clAmplitude: NaN, st: null, periods: 0 });

    this.element.append(this.canvas, this.readoutEl);
  }

  push(cd: number, cl: number): void {
    this.cd[this.head] = cd;
    this.cl[this.head] = cl;
    this.head = (this.head + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
    this.draw();
  }

  setReadouts(r: ForceReadouts): void {
    const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
    const st = r.st !== null && r.periods >= 10 ? r.st.toFixed(4) : '—';
    this.readoutEl.innerHTML =
      `<span style="color:#58a6ff">Cd</span> ${f(r.meanCd)}` +
      `   <span style="color:#f0883e">Cl amp</span> ${f(r.clAmplitude)}` +
      `   <span style="color:#3fb950">St</span> ${st}` +
      `   <span style="color:#8b949e">(${r.periods.toFixed(1)} periods)</span>`;
  }

  /** Sample j (0 = oldest in window) in chronological order. */
  private at(buf: Float32Array, j: number): number {
    const start = this.count < CAPACITY ? 0 : this.head;
    return buf[(start + j) % CAPACITY];
  }

  private draw(): void {
    const { ctx, canvas, count } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (count < 2) return;

    // Shared vertical scale across both traces, symmetric about their combined mid.
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < count; j++) {
      lo = Math.min(lo, this.at(this.cd, j), this.at(this.cl, j));
      hi = Math.max(hi, this.at(this.cd, j), this.at(this.cl, j));
    }
    if (hi - lo < 1e-6) {
      hi += 0.5;
      lo -= 0.5;
    }
    const pad = 0.08 * (hi - lo);
    lo -= pad;
    hi += pad;
    const yOf = (v: number) => h - ((v - lo) / (hi - lo)) * h;
    const xOf = (j: number) => (j / (count - 1)) * w;

    // Zero line.
    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = '#30363d';
      ctx.beginPath();
      ctx.moveTo(0, yOf(0));
      ctx.lineTo(w, yOf(0));
      ctx.stroke();
    }

    const trace = (buf: Float32Array, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let j = 0; j < count; j++) {
        const x = xOf(j);
        const y = yOf(this.at(buf, j));
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    trace(this.cd, '#58a6ff'); // Cd
    trace(this.cl, '#f0883e'); // Cl
  }
}
