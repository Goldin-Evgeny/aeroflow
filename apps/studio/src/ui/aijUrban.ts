import {
  AIJ_DATA_PAPER,
  AIJ_DISCLAIMER,
  type AijAttribution,
  type AijUrbanCaseId,
  type AijUrbanReport,
} from '@aeroflow/core';
import type { GpuCapabilities } from '../gpu/context';
import { hooks } from '../dev/testHooks';
import { AijUrbanRun, type AijUrbanRunSnapshot } from '../sim/cases/aijUrban';

const NOMINAL_CELLS = 384 * 384 * 128;
const DIRECTIONS: Record<AijUrbanCaseId, number[]> = {
  C: [270, 247.5, 225],
  E: Array.from({ length: 16 }, (_, index) => index * 22.5),
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatCells(value: number): string {
  return value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value.toLocaleString();
}

function formatMetric(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'pending'
    : value.toFixed(digits);
}

function downloadReport(report: AijUrbanReport): void {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `aeroflow-aij-case-${report.caseId}-${report.windFromDegrees}deg.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function drawScatter(canvas: HTMLCanvasElement, report: AijUrbanReport | null): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const margin = { left: 62, right: 24, top: 24, bottom: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  context.fillStyle = '#10161b';
  context.fillRect(0, 0, width, height);

  const rows = report?.rows ?? [];
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.measured, row.simulated]));
  const limit = Math.ceil(maxValue * 5) / 5;
  const x = (value: number): number => margin.left + (value / limit) * plotWidth;
  const y = (value: number): number => height - margin.bottom - (value / limit) * plotHeight;

  context.font = '12px ui-monospace, monospace';
  context.lineWidth = 1;
  for (let index = 0; index <= 5; index++) {
    const value = (limit * index) / 5;
    context.strokeStyle = '#27343b';
    context.beginPath();
    context.moveTo(x(value), margin.top);
    context.lineTo(x(value), height - margin.bottom);
    context.moveTo(margin.left, y(value));
    context.lineTo(width - margin.right, y(value));
    context.stroke();
    context.fillStyle = '#84939a';
    context.textAlign = 'center';
    context.fillText(value.toFixed(1), x(value), height - margin.bottom + 20);
    context.textAlign = 'right';
    context.fillText(value.toFixed(1), margin.left - 10, y(value) + 4);
  }

  context.fillStyle = 'rgba(50, 196, 141, 0.09)';
  context.beginPath();
  context.moveTo(x(0), y(0.25));
  context.lineTo(x(Math.max(0, limit - 0.25)), y(limit));
  context.lineTo(x(limit), y(Math.max(0, limit - 0.25)));
  context.lineTo(x(0.25), y(0));
  context.closePath();
  context.fill();
  context.strokeStyle = '#cad8dc';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x(0), y(0));
  context.lineTo(x(limit), y(limit));
  context.stroke();

  for (const row of rows) {
    context.fillStyle = row.hit ? '#32c48d' : '#f06f52';
    context.beginPath();
    context.arc(x(row.measured), y(row.simulated), 3.5, 0, 2 * Math.PI);
    context.fill();
  }
  context.fillStyle = '#aebbc0';
  context.textAlign = 'center';
  context.fillText('MEASURED U / Uref', margin.left + plotWidth / 2, height - 14);
  context.save();
  context.translate(16, margin.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText('SIMULATED U / Uref', 0, 0);
  context.restore();
  if (rows.length === 0) {
    context.fillStyle = '#84939a';
    context.font = '14px ui-monospace, monospace';
    context.fillText(
      'Awaiting time-averaged probe evidence',
      margin.left + plotWidth / 2,
      height / 2,
    );
  }
}

/** Mount the M11 Case C/E validation workbench. */
export function mountAijUrban(
  device: GPUDevice,
  caps: GpuCapabilities,
  adapterDescription: string,
  root: HTMLElement,
): void {
  root.innerHTML = '';
  root.classList.add('urban-host');
  const page = element('main', 'urban-workbench');

  const header = element('header', 'urban-header');
  const titleGroup = element('div');
  titleGroup.append(
    element('div', 'urban-eyebrow', 'AEROFLOW / VALIDATION M11'),
    element('h1', undefined, 'AIJ Urban Wind Bench'),
    element(
      'p',
      undefined,
      'Official Case C city blocks and Case E Niigata data. Screening-grade LES evidence.',
    ),
  );
  const officialBadge = element('div', 'urban-badge', 'OFFICIAL SOURCE DATA');
  header.append(titleGroup, officialBadge);

  const query = new URLSearchParams(location.search);
  let caseId: AijUrbanCaseId = query.get('case') === 'C' ? 'C' : 'E';
  const controls = element('section', 'urban-controls');
  const caseField = element('div', 'urban-field');
  caseField.append(element('span', 'urban-label', 'Preset'));
  const caseSegment = element('div', 'urban-segment');
  caseSegment.setAttribute('role', 'group');
  caseSegment.setAttribute('aria-label', 'AIJ case');
  const caseButtons = (['C', 'E'] as const).map((id) => {
    const button = element('button', undefined, `Case ${id}`);
    button.type = 'button';
    button.dataset.testid = `urban-case-${id.toLowerCase()}`;
    button.setAttribute('aria-pressed', String(id === caseId));
    caseSegment.append(button);
    return { id, button };
  });
  caseField.append(caseSegment);

  const directionField = element('label', 'urban-field');
  directionField.append(element('span', 'urban-label', 'Wind from'));
  const directionSelect = element('select');
  directionSelect.dataset.testid = 'urban-direction';
  directionField.append(directionSelect);

  const budgetField = element('label', 'urban-field');
  budgetField.append(element('span', 'urban-label', 'Cell budget'));
  const budgetSelect = element('select');
  budgetSelect.dataset.testid = 'urban-budget';
  for (const cells of [2_000_000, 5_000_000, 10_000_000, NOMINAL_CELLS]) {
    budgetSelect.append(new Option(`${formatCells(cells)} cells`, String(cells)));
  }
  budgetSelect.value = String(NOMINAL_CELLS);
  const cellOverride = Number(query.get('cells'));
  if (Number.isFinite(cellOverride) && cellOverride >= 512) {
    budgetSelect.append(
      new Option(`${formatCells(cellOverride)} cells (smoke override)`, String(cellOverride)),
    );
    budgetSelect.value = String(cellOverride);
  }
  budgetField.append(budgetSelect);

  const precisionField = element('label', 'urban-field');
  precisionField.append(element('span', 'urban-label', 'Storage'));
  const precisionSelect = element('select');
  precisionSelect.dataset.testid = 'urban-precision';
  if (caps.hasF16) precisionSelect.append(new Option('FP16 native', 'fp16'));
  precisionSelect.append(new Option('FP32', 'fp32'));
  precisionSelect.value = caps.hasF16 ? 'fp16' : 'fp32';
  precisionField.append(precisionSelect);

  const actions = element('div', 'urban-actions');
  const action = (label: string, testId: string, primary = false): HTMLButtonElement => {
    const button = element('button', primary ? 'urban-primary' : undefined, label);
    button.type = 'button';
    button.dataset.testid = testId;
    actions.append(button);
    return button;
  };
  const runButton = action('Run preset', 'urban-run', true);
  const resumeButton = action('Resume saved', 'urban-resume');
  const stopButton = action('Stop', 'urban-stop');
  const checkpointButton = action('Save checkpoint', 'urban-checkpoint');
  const exportButton = action('Export JSON', 'urban-export');
  stopButton.disabled = true;
  checkpointButton.disabled = true;
  exportButton.disabled = true;
  controls.append(caseField, directionField, budgetField, precisionField, actions);

  const statusBand = element('section', 'urban-status-band');
  const statusCopy = element('div', 'urban-status-copy');
  const statusText = element('strong', undefined, 'Ready');
  statusText.dataset.testid = 'urban-status';
  const statusDetail = element('span', undefined, adapterDescription || 'WebGPU adapter');
  statusCopy.append(statusText, statusDetail);
  const progress = element('div', 'urban-progress');
  const progressBar = element('span');
  progress.append(progressBar);
  statusBand.append(statusCopy, progress);

  const metricBand = element('dl', 'urban-metrics');
  const metric = (label: string): HTMLElement => {
    const box = element('div');
    box.append(element('dt', undefined, label));
    const value = element('dd', undefined, 'pending');
    box.append(value);
    metricBand.append(box);
    return value;
  };
  const gridMetric = metric('Grid');
  const dxMetric = metric('Spacing');
  const averageMetric = metric('Averaging');
  const qMetric = metric('Hit rate q');
  const rMetric = metric('Pearson r');
  const verdictMetric = metric('Verdict');
  verdictMetric.dataset.testid = 'urban-verdict';

  const resolution = element('section', 'urban-resolution');
  resolution.dataset.testid = 'urban-resolution';
  resolution.hidden = true;
  const resolutionTitle = element('strong');
  const resolutionDetail = element('span');
  const resolutionChecks = element('ul');
  resolution.append(resolutionTitle, resolutionDetail, resolutionChecks);

  const evidence = element('section', 'urban-evidence');
  const scatterPanel = element('figure', 'urban-scatter');
  const scatterCaption = element('figcaption');
  scatterCaption.append(
    element('h2', undefined, 'Simulated vs measured'),
    element('span', undefined, 'VDI allowed deviation: 0.25 U/Uref'),
  );
  const scatter = element('canvas');
  scatter.width = 640;
  scatter.height = 440;
  scatter.dataset.testid = 'urban-scatter';
  scatterPanel.append(scatterCaption, scatter);
  const tablePanel = element('section', 'urban-table-panel');
  const tableHeading = element('div', 'urban-table-heading');
  tableHeading.append(element('h2', undefined, 'Probe evidence'));
  const rowCount = element('span', undefined, '0 points');
  tableHeading.append(rowCount);
  const tableScroll = element('div', 'urban-table-scroll');
  const table = element('table');
  table.dataset.testid = 'urban-table';
  table.innerHTML =
    '<thead><tr><th>Probe</th><th>Measured</th><th>Simulated</th><th>Delta</th><th>VDI</th></tr></thead><tbody></tbody>';
  tableScroll.append(table);
  tablePanel.append(tableHeading, tableScroll);
  evidence.append(scatterPanel, tablePanel);

  // AIJ agreed to redistribution of the derived benchmark files on condition that users
  // are told what to cite and that AIJ does not warrant them (see NOTICE). The citation
  // and the disclaimer therefore render next to every score, not only in the export.
  const provenanceLines = element('div', 'urban-provenance-lines');
  const runProvenance = element('span', undefined, 'Preset not loaded');
  runProvenance.dataset.testid = 'urban-provenance-run';
  const citation = element('span', 'urban-citation', `Cite: ${AIJ_DATA_PAPER}`);
  citation.dataset.testid = 'urban-citation';
  const disclaimer = element('span', 'urban-disclaimer', AIJ_DISCLAIMER);
  disclaimer.dataset.testid = 'urban-disclaimer';
  provenanceLines.append(runProvenance, citation, disclaimer);
  const provenance = element('footer', 'urban-provenance');
  provenance.append(element('strong', undefined, 'Evidence provenance'), provenanceLines);

  const showCitation = (attribution: AijAttribution): void => {
    citation.textContent = `Cite: ${[AIJ_DATA_PAPER, ...attribution.caseSources].join(' | ')}`;
    disclaimer.textContent = attribution.disclaimer;
  };
  page.append(header, controls, statusBand, metricBand, resolution, evidence, provenance);
  root.append(page);
  drawScatter(scatter, null);

  let current: AijUrbanRun | null = null;
  let latest: AijUrbanRunSnapshot | null = null;
  let currentSelection = '';
  let running = false;
  let building = false;
  let stopping = false;
  let loopPromise: Promise<void> | null = null;
  let generation = 0;
  let checkpointRequested = false;
  let lastCheckpointAt = 0;
  let checkpointCount = 0;
  let checkpointTotalMs = 0;
  let lastCheckpointBytes = 0;
  let runStartedAt = 0;

  const populateDirections = (): void => {
    const previous = Number(query.get('direction'));
    directionSelect.replaceChildren(
      ...DIRECTIONS[caseId].map(
        (degrees) =>
          new Option(`${degrees.toFixed(degrees % 1 === 0 ? 0 : 1)} deg`, String(degrees)),
      ),
    );
    if (DIRECTIONS[caseId].includes(previous)) directionSelect.value = String(previous);
  };
  populateDirections();

  const selection = (): string =>
    [caseId, directionSelect.value, budgetSelect.value, precisionSelect.value].join(':');

  const updateControls = (): void => {
    for (const { button } of caseButtons) button.disabled = building || running || stopping;
    directionSelect.disabled =
      budgetSelect.disabled =
      precisionSelect.disabled =
        building || running || stopping;
    runButton.disabled = building || running || stopping;
    resumeButton.disabled = building || running || stopping;
    stopButton.disabled = !running;
    checkpointButton.disabled = !current || building || stopping;
    exportButton.disabled = latest?.report === null || latest?.report === undefined;
  };

  const setStatus = (headline: string, detail?: string): void => {
    statusText.textContent = headline;
    if (detail !== undefined) statusDetail.textContent = detail;
  };

  const updateTable = (report: AijUrbanReport | null): void => {
    const body = table.tBodies[0];
    body.replaceChildren();
    const rows = report?.rows ?? [];
    for (const row of rows) {
      const tr = body.insertRow();
      const values = [
        row.id,
        row.measured.toFixed(3),
        row.simulated.toFixed(3),
        `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(3)}`,
        row.hit ? 'HIT' : 'MISS',
      ];
      for (const value of values) tr.insertCell().textContent = value;
      tr.className = row.hit ? 'urban-hit' : 'urban-miss';
    }
    rowCount.textContent = `${rows.length} points`;
  };

  const updateSnapshot = (snapshot: AijUrbanRunSnapshot): void => {
    if (!current) return;
    latest = snapshot;
    const report = snapshot.report;
    const plan = current.plan;
    const totalProgress = Math.min(1, snapshot.totalSteps / current.targetSteps);
    progressBar.style.width = `${(totalProgress * 100).toFixed(1)}%`;
    gridMetric.textContent = `${plan.grid.nx} x ${plan.grid.ny} x ${plan.grid.nz}`;
    dxMetric.textContent = `${plan.dx.toPrecision(3)} m`;
    averageMetric.textContent =
      `${snapshot.averagingFlowThroughs.toFixed(2)} / ` +
      `${snapshot.requiredAveragingFlowThroughs} flow-throughs`;
    qMetric.textContent = formatMetric(report?.metrics.q);
    rMetric.textContent =
      current.data.caseId === 'C' ? 'not gated' : formatMetric(report?.metrics.r);
    verdictMetric.textContent = report?.verdict.toUpperCase() ?? 'PENDING';
    verdictMetric.className = report ? `urban-${report.verdict}` : '';
    resolution.hidden = plan.acceptanceReady;
    resolutionTitle.textContent = plan.acceptanceReady
      ? 'Acceptance grid ready'
      : 'VERDICT SUPPRESSED: uniform grid is under-resolved';
    resolutionDetail.textContent =
      `This domain requires ${formatCells(plan.requiredCells)} cells at dx <= ` +
      `${plan.requiredDx.toFixed(3)} m.`;
    resolutionChecks.replaceChildren(
      ...plan.checks.map((check) => {
        const item = element('li', check.pass ? 'urban-check-pass' : 'urban-check-fail');
        item.textContent = `${check.pass ? 'PASS' : 'FAIL'}: ${check.message}`;
        return item;
      }),
    );
    drawScatter(scatter, report);
    updateTable(report);
    runProvenance.textContent =
      `Case ${current.data.caseId}, ${current.direction.windFromDegrees} deg from | ` +
      `measurements ${current.data.source.sha256.slice(0, 12)}... | ` +
      `geometry ${current.data.geometry.sha256.slice(0, 12)}... | ` +
      `${current.geometryVoxels.toLocaleString()} solid voxels`;
    showCitation(current.data.attribution);
    hooks().urban = {
      ready: true,
      caseId: current.data.caseId,
      direction: current.direction.windFromDegrees,
      resumed: current.resumed,
      underResolved: !plan.acceptanceReady,
      grid: plan.grid,
      dx: plan.dx,
      requiredCells: plan.requiredCells,
      totalSteps: snapshot.totalSteps,
      averagingFlowThroughs: snapshot.averagingFlowThroughs,
      q: report?.metrics.q,
      r: report?.metrics.r,
      verdict: report?.verdict,
      reportRows: report?.rows.length ?? 0,
      complete: snapshot.complete,
      elapsedMs: report?.simulation.elapsedMs ?? snapshot.elapsedMs,
      voxelizationMs: current.voxelizationMs,
      wallMs: runStartedAt > 0 ? performance.now() - runStartedAt : 0,
      checkpointCount,
      checkpointTotalMs,
      lastCheckpointBytes,
    };
    updateControls();
  };

  const saveCurrent = async (): Promise<void> => {
    if (!current) return;
    setStatus('Saving checkpoint', 'DDFs and time-average state are written together');
    const saved = await current.checkpoint();
    lastCheckpointAt = performance.now();
    checkpointRequested = false;
    // Accumulated so a long run can report where its wall time actually went. The whole
    // DDF set is streamed every save, so this scales with the grid while the 5-minute
    // trigger does not — the asymmetry Wall 3 is about.
    checkpointCount += 1;
    checkpointTotalMs += saved.ms;
    lastCheckpointBytes = saved.bytes;
    setStatus(
      'Checkpoint saved',
      `${(saved.bytes / 1024 / 1024).toFixed(1)} MiB in ${(saved.ms / 1000).toFixed(1)} s`,
    );
  };

  const runLoop = async (token: number): Promise<void> => {
    while (running && current && token === generation && !latest?.complete) {
      const snapshot = await current.advance();
      if (token !== generation) return;
      updateSnapshot(snapshot);
      setStatus(
        snapshot.complete ? 'Run complete' : 'Running',
        `${snapshot.totalSteps.toLocaleString()} steps | ` +
          `${snapshot.elapsedMs > 0 ? (snapshot.elapsedMs / 1000).toFixed(1) : '0.0'} s compute`,
      );
      if (checkpointRequested || performance.now() - lastCheckpointAt >= 5 * 60_000) {
        await saveCurrent();
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (token !== generation) return;
    running = false;
    stopping = false;
    if (latest?.complete) setStatus('Run complete', 'Report is ready for export');
    else setStatus('Stopped', 'The in-memory run can continue or be checkpointed');
    updateControls();
  };

  const stopAndJoin = async (): Promise<void> => {
    stopping = true;
    running = false;
    generation++;
    await loopPromise?.catch(() => {});
    loopPromise = null;
    stopping = false;
  };

  const start = async (resume: boolean): Promise<void> => {
    const selected = selection();
    if (runStartedAt === 0) runStartedAt = performance.now();
    if (!resume && current && currentSelection === selected && latest && !latest.complete) {
      running = true;
      generation++;
      updateControls();
      setStatus('Continuing', 'Resuming the in-memory solver state');
      loopPromise = runLoop(generation).catch(handleFailure);
      return;
    }
    building = true;
    updateControls();
    await stopAndJoin();
    current?.destroy();
    current = null;
    latest = null;
    currentSelection = selected;
    drawScatter(scatter, null);
    updateTable(null);
    progressBar.style.width = '0%';
    setStatus('Preparing preset', `Case ${caseId}, ${directionSelect.value} deg from`);
    try {
      current = await AijUrbanRun.create(device, {
        caseId,
        windFromDegrees: Number(directionSelect.value),
        maxCells: Number(budgetSelect.value),
        precision: precisionSelect.value as 'fp16' | 'fp32',
        caps,
        adapterDescription,
        resume,
        onStatus: (message) => setStatus('Preparing preset', message),
      });
      latest = current.snapshot();
      updateSnapshot(latest);
      lastCheckpointAt = performance.now();
      running = true;
      building = false;
      generation++;
      setStatus(
        current.resumed ? 'Checkpoint restored' : 'Scene ready',
        `${current.geometryVoxels.toLocaleString()} solid voxels | ` +
          `${current.voxelizationMs.toFixed(0)} ms voxelization`,
      );
      updateControls();
      loopPromise = runLoop(generation).catch(handleFailure);
    } catch (error) {
      building = false;
      handleFailure(error);
    }
  };

  const handleFailure = (error: unknown): void => {
    running = false;
    building = false;
    stopping = false;
    const message = error instanceof Error ? error.message : String(error);
    setStatus('Run failed', message);
    hooks().urban = { ...(hooks().urban ?? { ready: true }), error: message };
    updateControls();
  };

  for (const item of caseButtons) {
    item.button.addEventListener('click', () => {
      caseId = item.id;
      for (const entry of caseButtons) {
        entry.button.setAttribute('aria-pressed', String(entry.id === caseId));
      }
      query.delete('direction');
      populateDirections();
    });
  }
  runButton.addEventListener('click', () => void start(false));
  resumeButton.addEventListener('click', () => void start(true));
  stopButton.addEventListener('click', () => {
    stopping = true;
    running = false;
    setStatus('Stopping', 'Waiting for the current sample readback');
    updateControls();
  });
  checkpointButton.addEventListener('click', () => {
    if (running) {
      checkpointRequested = true;
      setStatus('Checkpoint queued', 'Saving after the current sample');
    } else {
      void saveCurrent().catch(handleFailure);
    }
  });
  exportButton.addEventListener('click', () => {
    if (latest?.report) downloadReport(latest.report);
  });
  hooks().urban = { ready: true };
  updateControls();
}
