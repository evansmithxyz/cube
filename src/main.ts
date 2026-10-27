import './style.css';
import * as THREE from 'three';
import { methodById, type MethodId } from './analysis/methods';
import { StageTracker, analyzeSolve, type StageSplit } from './analysis/splits';
import { SOLVED, applyMove } from './cube/facelets';
import { PRESET_ALGS, type DrillAlg } from './drill/catalog';
import { AlgorithmDrill } from './drill/drill';
import { DrillStore, type DrillRep } from './drill/store';
import { formatMove, formatMoves, simplify, type Move } from './cube/moves';
import { formatMac, parseMac } from './gan/crypto';
import { connectGanCube, isBluetoothAvailable } from './gan/connection';
import { nameSuffixBytes, type Quaternion } from './gan/protocol';
import type { SmartCube, SmartCubeEvent } from './smartcube';
import { INSPECTION_DNF_MS, INSPECTION_MS, SolveTimer } from './timer/solveTimer';
import {
  effectiveTime,
  formatResult,
  formatTime,
  rollingAverages,
  sessionStats,
  type AverageStat,
  type Penalty,
} from './timer/stats';
import { SolveStore, decodeMoves, startState, type Solve } from './timer/store';
import { renderCaseStats, renderSplitChips, renderSplitRows, renderStageStats } from './ui/analysisView';
import { $, el } from './ui/dom';
import { CubeView } from './view/cubeView';
import { connectVirtualCube } from './virtualCube';

// --- settings ---

const SETTINGS_KEY = 'cube-timer:settings:v1';
type Mode = 'solve' | 'drill';
const DEFAULT_SETTINGS = { inspection: true, method: 'cfop' as MethodId, mode: 'solve' as Mode, drillAlg: 'pll-T' };

function loadSettings(): typeof DEFAULT_SETTINGS {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const settings = loadSettings();

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // not persisted; still applies for this visit
  }
}

// --- app state ---

const store = new SolveStore();
const timer = new SolveTimer({ inspection: settings.inspection });
const view = new CubeView($<HTMLCanvasElement>('cube-canvas'));

let cube: SmartCube | null = null;
let isVirtual = false;
let connecting = false;
/** Facelet string we track by applying each reported turn. */
let state = SOLVED;
/** Serial of the last turn applied; null until the cube's first state snapshot. */
let lastSerial: number | null = null;
let battery: number | null = null;
let gyroBasis: THREE.Quaternion | null = null;
/** Whether the user has lined the 3D view up with the real cube since connecting. */
let viewLinedUp = false;
let method = methodById(settings.method);
/** Stage splits of the solve in progress. */
let liveSplits: StageTracker | null = null;

// --- drill mode ---

const drillStore = new DrillStore();
let drillAlg: DrillAlg = PRESET_ALGS[0];
let drill = new AlgorithmDrill(drillAlg.alg);
/** Set when the last rep went off track, until the next one starts. */
let drillOffTrack = false;

const allAlgs = () => [...PRESET_ALGS, ...drillStore.custom];

function selectAlg(id: string): void {
  const chosen = allAlgs().find((a) => a.id === id) ?? PRESET_ALGS.find((a) => a.id === 'pll-T')!;
  try {
    drill = new AlgorithmDrill(chosen.alg);
    drillAlg = chosen;
  } catch (error) {
    showNotice(`Can't drill ${chosen.name}: ${error instanceof Error ? error.message : error}`);
  }
  settings.drillAlg = drillAlg.id;
  saveSettings();
  drillOffTrack = false;
  $<HTMLSelectElement>('drill-select').value = drillAlg.id;
  renderDrill();
  render();
}

function onDrillTurn(move: Move, now: number): void {
  const outcome = drill.turn(move, state, now);
  if (outcome?.kind === 'rep') {
    drillStore.addRep({ alg: drillAlg.id, timeMs: Math.round(outcome.timeMs), turns: outcome.turns, date: Date.now() });
    renderDrill();
  }
  drillOffTrack = outcome?.kind === 'off-track' || (drillOffTrack && !drill.running);
}

function setMode(mode: Mode): void {
  if (mode === 'solve' && settings.mode === 'drill' && cube) timer.cancel(state); // the cube moved meanwhile
  if (mode === 'drill' && isAttempting()) timer.cancel(state);
  drill.cancel();
  settings.mode = mode;
  saveSettings();
  document.body.dataset.mode = mode;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.mode')) {
    button.setAttribute('aria-selected', String(button.dataset.mode === mode));
  }
  render();
}

timer.onSolve = (attempt) => {
  store.add(attempt);
  renderSolves();
};

// --- stage splits ---

const splitCache = new Map<string, StageSplit[] | null>();

/** A stored solve's stage splits for the current method (null if its start state is unknown). */
function splitsOf(solve: Solve): StageSplit[] | null {
  const key = `${solve.id}|${method.id}`;
  if (!splitCache.has(key)) {
    const start = startState(solve);
    splitCache.set(key, start ? analyzeSolve(method, start, decodeMoves(solve.moves)) : null);
  }
  return splitCache.get(key)!;
}

/** Follow the solve in progress turn by turn, for the splits under the clock. */
function trackSplits(move: Move, wasSolving: boolean, now: number): void {
  if (!wasSolving && timer.phase === 'solving') liveSplits = new StageTracker(method, timer.startState);
  if (liveSplits && (wasSolving || timer.phase === 'solving')) liveSplits.turn(move, now - timer.solveStart);
}

// --- cube events ---

function onCubeEvent(event: SmartCubeEvent): void {
  const now = performance.now();
  switch (event.type) {
    case 'move': {
      const move: Move = { face: event.face, amount: event.prime ? 3 : 1 };
      state = applyMove(state, move);
      lastSerial = event.serial;
      view.enqueue(move);
      if (settings.mode === 'drill') {
        onDrillTurn(move, now);
      } else {
        const wasSolving = timer.phase === 'solving';
        timer.turn(move, state, now);
        trackSplits(move, wasSolving, now);
      }
      break;
    }
    case 'facelets':
      // Trust a snapshot only once every turn it covers has been applied here.
      if (lastSerial === null) {
        lastSerial = event.serial;
        state = event.facelets;
        view.setState(state);
        timer.reset(state);
        drill.cancel();
      } else if (((event.serial - lastSerial) & 0xff) === 0 && event.facelets !== state) {
        state = event.facelets;
        view.setState(state);
        timer.replaceState(state, now);
        drill.cancel();
      }
      break;
    case 'gyro':
      onGyro(event.quat);
      return; // frequent, and nothing else on the page depends on it
    case 'battery':
      battery = event.level;
      break;
    case 'hardware':
      break;
    case 'disconnect':
      cube = null;
      lastSerial = null;
      battery = null;
      gyroBasis = null;
      viewLinedUp = false;
      $('align-hint').hidden = true;
      view.setHoldingView(false);
      view.setOrientation(new THREE.Quaternion());
      timer.disconnect();
      drill.cancel();
      break;
  }
  render();
}

function onGyro(q: Quaternion): void {
  // GAN IMU axes -> scene axes (x = R, y = U, z = F), as in afedotov/gan-cube-sample.
  const raw = new THREE.Quaternion(q.x, q.z, -q.y, q.w).normalize();
  // Orientation relative to the reading taken as "white up, green facing you": the first
  // one after connecting (wherever the cube happened to be) until the user resets it.
  if (!gyroBasis) {
    gyroBasis = raw.clone().invert();
    view.setHoldingView(true);
    $('align-hint').hidden = viewLinedUp;
  }
  view.setOrientation(gyroBasis.clone().multiply(raw));
}

// --- connecting ---

async function connectGan(): Promise<void> {
  hideNotice();
  connecting = true;
  render();
  try {
    cube = await connectGanCube(onCubeEvent, askForMac);
    isVirtual = false;
  } catch (error) {
    lastSerial = null;
    timer.disconnect();
    // NotFoundError means the user closed the device chooser.
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      showNotice(error instanceof Error ? error.message : String(error));
    }
  } finally {
    connecting = false;
    render();
  }
}

function connectVirtual(): void {
  hideNotice();
  cube = connectVirtualCube(onCubeEvent);
  isVirtual = true;
  render();
}

let macDeviceName = '';

function askForMac(deviceName: string): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('mac-dialog');
  const input = $<HTMLInputElement>('mac-input');
  const suffix = nameSuffixBytes(deviceName);
  macDeviceName = deviceName;
  $('mac-device').textContent = deviceName;
  $('mac-error').textContent = '';
  input.value = '';
  input.placeholder = suffix ? `XX:XX:XX:XX:${formatMac(suffix)}` : 'AB:CD:EF:12:34:56';
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'ok' ? formatMac(parseMac(input.value)!) : null),
      { once: true },
    );
  });
}

$('mac-form').addEventListener('submit', (event) => {
  if ((event.submitter as HTMLButtonElement | null)?.value !== 'ok') return;
  const bytes = parseMac($<HTMLInputElement>('mac-input').value);
  const suffix = nameSuffixBytes(macDeviceName);
  let problem = '';
  if (!bytes) problem = "That doesn't look like a MAC address (six pairs of hex digits).";
  else if (suffix && (bytes[4] !== suffix[0] || bytes[5] !== suffix[1])) {
    problem = `It should end in ${formatMac(suffix)} to match ${macDeviceName}.`;
  }
  if (problem) {
    event.preventDefault();
    $('mac-error').textContent = problem;
  }
});

function showNotice(text: string): void {
  $('notice-text').textContent = text;
  $('notice').hidden = false;
}

function hideNotice(): void {
  $('notice').hidden = true;
}

// --- rendering ---

const isAttempting = () => ['inspection', 'ready', 'solving'].includes(timer.phase);
const canScramble = () => timer.phase === 'scrambling' || timer.phase === 'unsolved';

function render(): void {
  const status = $('cube-status');
  status.textContent = cube
    ? cube.name + (battery !== null ? ` · battery ${battery}%` : '')
    : connecting
      ? 'Connecting…'
      : 'No cube connected';
  status.classList.toggle('connected', !!cube);

  const gan = $<HTMLButtonElement>('connect-gan');
  gan.hidden = !!cube;
  gan.disabled = connecting || !isBluetoothAvailable();
  gan.title = isBluetoothAvailable() ? '' : 'Web Bluetooth needs Chrome or Edge';
  $('connect-virtual').hidden = !!cube;
  $<HTMLButtonElement>('connect-virtual').disabled = connecting;
  $('disconnect').hidden = !cube;
  $('key-help').hidden = !(cube && isVirtual);

  $<HTMLButtonElement>('new-scramble').disabled = !canScramble();
  $<HTMLButtonElement>('skip-scramble').disabled = !canScramble() || state === SOLVED;
  $('cancel-attempt').hidden = !isAttempting();
  $('restart-rep').hidden = !drill.running;
  $<HTMLButtonElement>('mark-solved').disabled = !cube || (settings.mode === 'solve' && timer.phase === 'solving');

  renderScramble();
  renderHint();
  renderLiveSplits();
}

/** Splits under the clock: the solve in progress, or else the last one saved. */
function renderLiveSplits(): void {
  const box = $('splits');
  box.hidden = method.stages.length === 0;
  const latest = store.solves.at(-1);
  let splits: StageSplit[] = [];
  if (timer.phase === 'solving') splits = liveSplits?.splits ?? [];
  else if (timer.phase !== 'inspection' && timer.phase !== 'ready' && latest) splits = splitsOf(latest) ?? [];
  renderSplitChips(box, splits);
}

function renderScramble(): void {
  const box = $('scramble');
  box.classList.toggle('dim', !['scrambling', 'unsolved'].includes(timer.phase));
  if (timer.custom) {
    box.replaceChildren(el('span', 'custom', 'Your own scramble'));
    return;
  }
  const { done, fix } =
    timer.phase === 'scrambling' ? timer.tracker.progress() : { done: 0, fix: [] };
  box.replaceChildren(
    ...timer.scramble.map((move, i) =>
      el('span', i < done ? 'done' : i === done && fix.length === 0 && timer.phase === 'scrambling' ? 'current' : '', formatMove(move)),
    ),
  );
}

const connectHint = () =>
  isBluetoothAvailable()
    ? 'Connect your GAN cube to start, or try the virtual cube.'
    : "This browser can't use Bluetooth. Open the app in Chrome or Edge to connect a cube, or try the virtual cube.";

function renderDrillHint(hint: HTMLElement): void {
  hint.classList.toggle('warn', drillOffTrack);
  let text = '';
  if (!cube) text = connectHint();
  else if (drillOffTrack) text = "That didn't match, so the rep wasn't counted. Start again whenever you're ready.";
  else if (!drill.running) {
    text = 'Do the algorithm from any angle. The timer starts on your first turn and stops when it’s done.';
  }
  hint.textContent = text;
}

function renderHint(): void {
  const hint = $('hint');
  if (settings.mode === 'drill') {
    renderDrillHint(hint);
    return;
  }
  let warn = false;
  let parts: (string | Node)[] = [];
  switch (timer.phase) {
    case 'idle':
      parts = [connectHint()];
      break;
    case 'unsolved':
      parts = ['Solve the cube to start the scramble, or use “I scrambled it myself”.'];
      break;
    case 'scrambling': {
      const { fix } = timer.tracker.progress();
      const next = timer.tracker.next();
      warn = fix.length > 0;
      if (fix.length > 6) parts = ['Off track. Solve the cube to start the scramble over.'];
      else if (fix.length > 0) parts = ['Undo: ', el('span', 'mono', formatMoves(fix))];
      else if (next) parts = ['Next: ', el('span', 'mono', formatMove(next))];
      break;
    }
    case 'inspection':
      parts = ['Inspect. The timer starts on your first turn.'];
      break;
    case 'ready':
      parts = ['Ready. The timer starts on your first turn.'];
      break;
    case 'solving':
      parts = [];
      break;
  }
  hint.classList.toggle('warn', warn);
  hint.replaceChildren(...parts);
}

function clockFace(now: number): [string, string] {
  if (settings.mode === 'drill') {
    if (drill.running) return [formatTime(now - drill.repStart), 'running'];
    const last = drillStore.repsFor(drillAlg.id).at(-1);
    return [last ? formatTime(last.timeMs) : '0.00', ''];
  }
  switch (timer.phase) {
    case 'solving':
      return [formatTime(now - timer.solveStart), 'running'];
    case 'inspection': {
      const elapsed = timer.inspectionElapsed(now);
      if (elapsed < INSPECTION_MS) return [String(Math.ceil((INSPECTION_MS - elapsed) / 1000)), 'inspection'];
      return [elapsed < INSPECTION_DNF_MS ? '+2' : 'DNF', 'inspection'];
    }
    case 'ready':
      return ['0.00', 'ready'];
    default: {
      const latest = store.solves.at(-1);
      return [latest ? formatResult(latest) : '0.00', ''];
    }
  }
}

const clock = $('clock');
function tick(): void {
  const [text, className] = clockFace(performance.now());
  if (clock.textContent !== text) clock.textContent = text;
  clock.className = `clock ${className}`;
  requestAnimationFrame(tick);
}

function statRow(label: string, stat: AverageStat): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.append(el('td', '', label), el('td', '', formatTime(stat.current)), el('td', '', formatTime(stat.best)));
  return row;
}

function renderSolves(): void {
  const { solves } = store;
  const stats = sessionStats(solves);
  $('stats').replaceChildren(
    statRow('Single', stats.single),
    statRow('ao5', stats.averages[5]),
    statRow('ao12', stats.averages[12]),
    statRow('ao100', stats.averages[100]),
  );
  $('stats-summary').textContent = solves.length
    ? `${solves.length} solve${solves.length === 1 ? '' : 's'} · mean ${formatTime(stats.mean)}`
    : '';

  const ao5 = rollingAverages(solves, 5);
  const ao12 = rollingAverages(solves, 12);
  const rows = solves.map((solve, i) => {
    const row = document.createElement('tr');
    row.tabIndex = 0;
    row.dataset.id = solve.id;
    const isBest = effectiveTime(solve) === stats.single.best && Number.isFinite(effectiveTime(solve));
    row.append(
      el('td', '', String(i + 1)),
      el('td', isBest ? 'pb' : '', formatResult(solve)),
      el('td', '', formatTime(ao5[i])),
      el('td', '', formatTime(ao12[i])),
    );
    return row;
  });
  $('solve-list').replaceChildren(...rows.reverse());
  $('no-solves').hidden = solves.length > 0;

  const analyses = solves.map(splitsOf).filter((splits): splits is StageSplit[] => splits !== null);
  renderStageStats($('stage-stats'), method, analyses);
  renderCaseStats($('case-stats'), method, analyses);
}

// --- drill rendering ---

const asTimed = (reps: DrillRep[]) => reps.map((r) => ({ timeMs: r.timeMs, penalty: 'ok' as const }));

function renderDrillSelect(): void {
  const groups = new Map<string, DrillAlg[]>();
  for (const alg of allAlgs()) groups.set(alg.group, [...(groups.get(alg.group) ?? []), alg]);
  const select = $<HTMLSelectElement>('drill-select');
  select.replaceChildren(
    ...[...groups].map(([group, algs]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group;
      optgroup.append(...algs.map((alg) => new Option(alg.name, alg.id)));
      return optgroup;
    }),
  );
  select.value = drillAlg.id;
}

function renderDrill(): void {
  $('drill-alg').textContent = drillAlg.alg;
  const reps = drillStore.repsFor(drillAlg.id);
  const stats = sessionStats(asTimed(reps));
  const chip = (label: string, value: string) => {
    const node = el('span', 'split');
    node.append(el('span', 'split-name', label), value);
    return node;
  };
  $('drill-stats').replaceChildren(
    chip('Reps', String(reps.length)),
    chip('Best', formatTime(stats.single.best)),
    chip('ao5', formatTime(stats.averages[5].current)),
    chip('ao12', formatTime(stats.averages[12].current)),
    chip('Mean', formatTime(stats.mean)),
  );

  $('rep-title').textContent = `${drillAlg.name} reps`;
  const ao5 = rollingAverages(asTimed(reps), 5);
  const rows = reps.map((rep, i) => {
    const row = document.createElement('tr');
    row.append(
      el('td', '', String(i + 1)),
      el('td', rep.timeMs === stats.single.best ? 'pb' : '', formatTime(rep.timeMs)),
      el('td', '', rep.timeMs > 0 ? (rep.turns / (rep.timeMs / 1000)).toFixed(1) : '–'),
      el('td', '', formatTime(ao5[i])),
    );
    return row;
  });
  $('rep-list').replaceChildren(...rows.reverse());
  $('no-reps').hidden = reps.length > 0;
  $('delete-alg').hidden = !drillStore.custom.some((a) => a.id === drillAlg.id);

  // Every drilled algorithm, slowest first.
  const drilled = allAlgs()
    .map((alg) => ({ alg, stats: sessionStats(asTimed(drillStore.repsFor(alg.id))) }))
    .filter((d) => d.stats.count > 0)
    .sort((a, b) => (b.stats.mean ?? 0) - (a.stats.mean ?? 0));
  $('drill-overview').replaceChildren(
    ...drilled.map(({ alg, stats: algStats }) => {
      const row = document.createElement('tr');
      row.className = alg.id === drillAlg.id ? 'pick selected' : 'pick';
      row.tabIndex = 0;
      row.dataset.id = alg.id;
      row.append(
        el('td', '', alg.name),
        el('td', '', String(algStats.count)),
        el('td', '', formatTime(algStats.single.best)),
        el('td', '', formatTime(algStats.averages[5].current)),
        el('td', '', formatTime(algStats.mean)),
      );
      return row;
    }),
  );
  $('no-drills').textContent = drilled.length
    ? 'Slowest first. Click one to drill it.'
    : 'Algorithms you drill will show up here.';
}

// --- solve details ---

let openSolveId: string | null = null;

function openSolve(id: string): void {
  const index = store.solves.findIndex((s) => s.id === id);
  const solve = store.solves[index];
  if (!solve) return;
  openSolveId = id;
  const moves = decodeMoves(solve.moves).map((m) => m.move);
  $('solve-title').textContent = `Solve ${index + 1}`;
  $('solve-time').textContent = formatResult(solve);
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="penalty"]')) {
    radio.checked = radio.value === solve.penalty;
  }
  $('solve-scramble').textContent = solve.scramble || 'Scrambled by hand';
  $('solve-turns').textContent = moves.length
    ? `${moves.length} quarter turns · ${(moves.length / (solve.timeMs / 1000)).toFixed(2)} TPS`
    : '–';
  $('solve-solution').textContent = moves.length ? formatMoves(simplify(moves)) : '–';
  $('solve-date').textContent = new Date(solve.date).toLocaleString();

  const hasMethod = method.stages.length > 0;
  $('solve-splits-title').hidden = !hasMethod;
  $('solve-splits-box').hidden = !hasMethod;
  const splits = splitsOf(solve);
  if (splits?.length) {
    renderSplitRows($('solve-splits'), splits);
  } else {
    const cell = el('td', 'muted', splits ? 'No stages finished.' : "Not available: this solve's starting state wasn't saved.");
    (cell as HTMLTableCellElement).colSpan = 5;
    const row = document.createElement('tr');
    row.append(cell);
    $('solve-splits').replaceChildren(row);
  }
  $<HTMLDialogElement>('solve-dialog').showModal();
}

$('solve-list').addEventListener('click', (event) => {
  const row = (event.target as HTMLElement).closest('tr');
  if (row?.dataset.id) openSolve(row.dataset.id);
});
$('solve-list').addEventListener('keydown', (event) => {
  const row = (event.target as HTMLElement).closest('tr');
  if (event.key === 'Enter' && row?.dataset.id) openSolve(row.dataset.id);
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="penalty"]')) {
  radio.addEventListener('change', () => {
    if (!openSolveId) return;
    store.setPenalty(openSolveId, radio.value as Penalty);
    const solve = store.solves.find((s) => s.id === openSolveId);
    if (solve) $('solve-time').textContent = formatResult(solve);
    renderSolves();
  });
}

$('delete-solve').addEventListener('click', () => {
  if (!openSolveId || !confirm('Delete this solve?')) return;
  store.remove(openSolveId);
  $<HTMLDialogElement>('solve-dialog').close();
  renderSolves();
});

// --- controls ---

$('connect-gan').addEventListener('click', connectGan);
$('connect-virtual').addEventListener('click', connectVirtual);
$('disconnect').addEventListener('click', () => cube?.disconnect());
$('notice-close').addEventListener('click', hideNotice);

$('new-scramble').addEventListener('click', () => {
  timer.newScramble(state);
  render();
});

const methodSelect = $<HTMLSelectElement>('method-select');
methodSelect.value = method.id;
methodSelect.addEventListener('change', () => {
  settings.method = methodSelect.value as MethodId;
  method = methodById(settings.method);
  liveSplits = null;
  saveSettings();
  renderSolves();
  render();
  methodSelect.blur(); // so cube keys don't also pick a method by letter
});

const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const other of tabs) other.setAttribute('aria-selected', String(other === tab));
    for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    }
  });
}
$('skip-scramble').addEventListener('click', () => {
  timer.skipScramble(performance.now());
  render();
});
$('cancel-attempt').addEventListener('click', () => {
  timer.cancel(state);
  render();
});
$('mark-solved').addEventListener('click', async () => {
  if (!cube || !confirm('Hold your cube solved, then press OK. The cube will treat its current state as solved.')) return;
  // Take the cube's next snapshot as-is, whatever its serial.
  lastSerial = null;
  await cube.markSolved();
});
$('reset-view').addEventListener('click', () => {
  if (gyroBasis) {
    viewLinedUp = true;
    $('align-hint').hidden = true;
  }
  gyroBasis = null;
  view.setOrientation(new THREE.Quaternion());
});

const inspectionToggle = $<HTMLInputElement>('inspection-toggle');
inspectionToggle.checked = settings.inspection;
inspectionToggle.addEventListener('change', () => {
  settings.inspection = inspectionToggle.checked;
  timer.options.inspection = settings.inspection;
  saveSettings();
});

$('clear-solves').addEventListener('click', () => {
  if (store.solves.length && confirm(`Delete all ${store.solves.length} solves?`)) {
    store.clear();
    renderSolves();
  }
});

// --- drill controls ---

for (const button of document.querySelectorAll<HTMLButtonElement>('.mode')) {
  button.addEventListener('click', () => setMode(button.dataset.mode as Mode));
}

const drillSelect = $<HTMLSelectElement>('drill-select');
drillSelect.addEventListener('change', () => {
  selectAlg(drillSelect.value);
  drillSelect.blur(); // so cube keys don't also pick algorithms by letter
});

$('drill-overview').addEventListener('click', (event) => {
  const row = (event.target as HTMLElement).closest('tr');
  if (row?.dataset.id) selectAlg(row.dataset.id);
});
$('drill-overview').addEventListener('keydown', (event) => {
  const row = (event.target as HTMLElement).closest('tr');
  if (event.key === 'Enter' && row?.dataset.id) selectAlg(row.dataset.id);
});

function restartRep(): void {
  drill.cancel();
  drillOffTrack = false;
  render();
}
$('restart-rep').addEventListener('click', restartRep);

$('clear-reps').addEventListener('click', () => {
  const count = drillStore.repsFor(drillAlg.id).length;
  if (count && confirm(`Delete all ${count} reps of ${drillAlg.name}?`)) {
    drillStore.clearReps(drillAlg.id);
    renderDrill();
  }
});

$('delete-alg').addEventListener('click', () => {
  if (!confirm(`Delete ${drillAlg.name} and its reps?`)) return;
  drillStore.removeAlg(drillAlg.id);
  renderDrillSelect();
  selectAlg('pll-T');
});

$('add-alg').addEventListener('click', () => {
  const dialog = $<HTMLDialogElement>('alg-dialog');
  $<HTMLInputElement>('alg-name').value = '';
  $<HTMLInputElement>('alg-text').value = '';
  $('alg-error').textContent = '';
  dialog.returnValue = '';
  dialog.showModal();
});

$('alg-form').addEventListener('submit', (event) => {
  if ((event.submitter as HTMLButtonElement | null)?.value !== 'ok') return;
  const text = $<HTMLInputElement>('alg-text').value.trim();
  const name = $<HTMLInputElement>('alg-name').value.trim() || text;
  try {
    if (!text) throw new Error("Type the algorithm, e.g. R U R' U'.");
    new AlgorithmDrill(text); // throws on notation it can't read
  } catch (error) {
    event.preventDefault();
    $('alg-error').textContent = error instanceof Error ? error.message : String(error);
    return;
  }
  const added = drillStore.addAlg(name, text);
  renderDrillSelect();
  selectAlg(added.id);
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (settings.mode === 'drill') {
    restartRep();
  } else if (isAttempting()) {
    timer.cancel(state);
    render();
  }
});

renderDrillSelect();
selectAlg(settings.drillAlg);
setMode(settings.mode);
renderSolves();
tick();
