/** Stage splits, stage averages and per-algorithm (OLL/PLL case) stats. */

import type { LastLayerCase } from '../analysis/cases';
import type { Method } from '../analysis/methods';
import type { StageSplit } from '../analysis/splits';
import { formatTime } from '../timer/stats';
import { el } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Top-down OLL diagram from a case key: the top face, then the top rows of F, R, B
 * and L going round clockwise, '1' where the sticker shows the top colour.
 */
export function ollDiagram(key: string, size = 40): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 50 50');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'oll');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'OLL case');
  const cells: [x: number, y: number, w: number, h: number][] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push([11 + 10 * c, 11 + 10 * r, 9, 9]);
  for (let i = 0; i < 3; i++) cells.push([11 + 10 * i, 42, 9, 4]); // F, left to right
  for (let i = 0; i < 3; i++) cells.push([42, 11 + 10 * (2 - i), 4, 9]); // R, front to back
  for (let i = 0; i < 3; i++) cells.push([11 + 10 * (2 - i), 4, 9, 4]); // B, right to left
  for (let i = 0; i < 3; i++) cells.push([4, 11 + 10 * i, 4, 9]); // L, back to front
  cells.forEach(([x, y, w, h], i) => {
    const rect = document.createElementNS(SVG_NS, 'rect');
    for (const [name, value] of Object.entries({ x, y, width: w, height: h, rx: 1.5 })) {
      rect.setAttribute(name, String(value));
    }
    rect.setAttribute('class', key[i] === '1' ? 'oll-on' : 'oll-off');
    svg.append(rect);
  });
  return svg;
}

function caseLabel(found: LastLayerCase | undefined, diagramSize: number): Node | null {
  if (!found || found.id === '?') return null;
  if (found.id === 'skip') return el('span', 'case', 'skip');
  if (found.kind === 'pll') return el('span', 'case', found.id);
  return ollDiagram(found.id, diagramSize);
}

/** Compact chips under the clock: each finished stage and how long it took. */
export function renderSplitChips(container: HTMLElement, splits: StageSplit[]): void {
  container.replaceChildren(
    ...splits.map((split) => {
      const chip = el('span', 'split');
      const label = caseLabel(split.case, 16);
      const time = split.turns === 0 ? 'skip' : formatTime(split.duration);
      chip.append(el('span', 'split-name', split.stage), ...(label ? [label] : []), time);
      return chip;
    }),
  );
}

/** Rows for a solve's split table: stage, look, turning, total and turn count. */
export function renderSplitRows(tbody: HTMLElement, splits: StageSplit[]): void {
  tbody.replaceChildren(
    ...splits.map((split) => {
      const row = document.createElement('tr');
      const name = el('td', '');
      const inner = el('span', 'stage-cell', split.stage);
      const label = caseLabel(split.case, 22);
      if (label) inner.append(label);
      name.append(inner);
      const skipped = split.turns === 0;
      row.append(
        name,
        el('td', '', skipped ? '' : formatTime(split.recognition)),
        el('td', '', skipped ? '' : formatTime(split.execution)),
        el('td', '', skipped ? 'skip' : formatTime(split.duration)),
        el('td', '', skipped ? '' : String(split.turns)),
      );
      return row;
    }),
  );
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const best = (values: number[]) => (values.length ? Math.min(...values) : null);

/** Average look, turning and total time per stage over every analysed solve. */
export function renderStageStats(tbody: HTMLElement, method: Method, analyses: StageSplit[][]): void {
  tbody.replaceChildren(
    ...method.stages.map((stage) => {
      const splits = analyses.flatMap((a) => a.filter((s) => s.stage === stage.name && s.turns > 0));
      const row = document.createElement('tr');
      row.append(
        el('td', '', stage.name),
        el('td', '', formatTime(mean(splits.map((s) => s.recognition)))),
        el('td', '', formatTime(mean(splits.map((s) => s.execution)))),
        el('td', '', formatTime(mean(splits.map((s) => s.duration)))),
        el('td', '', formatTime(best(splits.map((s) => s.duration)))),
      );
      return row;
    }),
  );
}

/** Per-case tables for the method's algorithm stages (CFOP's OLL and PLL), slowest first. */
export function renderCaseStats(container: HTMLElement, method: Method, analyses: StageSplit[][]): void {
  const algStages = method.stages.filter((s) => s.caseKind);
  if (algStages.length === 0) {
    container.replaceChildren(
      el('p', 'muted', 'OLL and PLL cases are recognised with CFOP. Pick CFOP as your method to see per-algorithm times.'),
    );
    return;
  }

  const sections = [...algStages].reverse().map((stage) => {
    const byCase = new Map<string, StageSplit[]>();
    let skips = 0;
    for (const split of analyses.flat()) {
      if (split.stage !== stage.name || !split.case || split.case.id === '?') continue;
      if (split.case.id === 'skip' || split.turns === 0) {
        skips++;
        continue;
      }
      byCase.set(split.case.id, [...(byCase.get(split.case.id) ?? []), split]);
    }

    const section = el('section', 'case-section');
    section.append(el('h3', '', stage.name));
    if (byCase.size === 0) {
      section.append(el('p', 'muted', `No ${stage.name} cases yet.`));
    } else {
      const table = el('table', 'data-table case-table');
      const head = document.createElement('tr');
      for (const title of ['Case', 'n', 'Look', 'Turn', 'Best']) head.append(el('th', '', title));
      table.append(el('thead', ''), el('tbody', ''));
      table.firstElementChild!.append(head);
      const rows = [...byCase.entries()]
        .map(([id, splits]) => ({ id, splits, total: mean(splits.map((s) => s.duration))! }))
        .sort((a, b) => b.total - a.total);
      for (const { id, splits } of rows) {
        const row = document.createElement('tr');
        const label = el('td', '');
        label.append(caseLabel({ kind: stage.caseKind!, id }, 30)!);
        row.append(
          label,
          el('td', '', String(splits.length)),
          el('td', '', formatTime(mean(splits.map((s) => s.recognition)))),
          el('td', '', formatTime(mean(splits.map((s) => s.execution)))),
          el('td', '', formatTime(best(splits.map((s) => s.execution)))),
        );
        table.lastElementChild!.append(row);
      }
      section.append(table);
    }
    if (skips > 0) section.append(el('p', 'muted', `${skips} skip${skips === 1 ? '' : 's'}`));
    return section;
  });
  container.replaceChildren(...sections);
}
