/** The last-layer coach on screen: the case card above the clock, its hints, and case diagrams. */

import { SOLVED, applyMoves } from '../cube/facelets';
import type { Move } from '../cube/moves';
import { algToMoves, parseAlg } from '../cube/notation';
import { invertMoves, orientationKey, setupState, type CaseKind } from '../teach/algs';
import type { CoachHint, CoachView } from '../teach/coach';
import { ollDiagram } from './analysisView';
import { el } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Last-layer pieces, U sticker first: UBL UBR UFR UFL, then UB UR UF UL.
const LL_CORNERS = [[0, 36, 47], [2, 45, 11], [8, 9, 20], [6, 18, 38]];
const LL_EDGES = [[1, 46], [5, 10], [7, 19], [3, 37]];
// Side colours as you'd see them holding the cube yellow up, green in front.
const SIDE_COLOR: Record<string, string> = { F: '#0ba84f', R: '#ff6d00', B: '#1767e0', L: '#d4142d' };

const pieceKey = (state: string, stickers: number[]) => stickers.map((i) => state[i]).sort().join('');

/** For each slot, the slot its piece belongs in. */
function permutation(state: string, pieces: number[][]): number[] {
  const homes = pieces.map((p) => pieceKey(SOLVED, p));
  return pieces.map((p) => homes.indexOf(pieceKey(state, p)));
}

/** The PLL an algorithm solves, taking the AUF after it that leaves the fewest pieces moving. */
function pllState(alg: string): string {
  const { moves } = algToMoves(parseAlg(alg));
  let best = '';
  let fewest = Infinity;
  for (let q = 0; q < 4; q++) {
    const auf: Move[] = q ? [{ face: 'U', amount: q as Move['amount'] }] : [];
    const state = applyMoves(SOLVED, invertMoves([...moves, ...auf]));
    const moving = [...permutation(state, LL_CORNERS), ...permutation(state, LL_EDGES)].filter((to, i) => to !== i % 4).length;
    if (moving < fewest) [best, fewest] = [state, moving];
  }
  return best;
}

const centre = (sticker: number): [number, number] => [15.5 + 10 * (sticker % 3), 15.5 + 10 * Math.floor(sticker / 3)];

function svgEl(name: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function arrow(from: [number, number], to: [number, number], twoWay: boolean): SVGElement[] {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  const pad = 2;
  const head = 3.6;
  const half = 2;
  const tip = (x: number, y: number, dx: number, dy: number) =>
    svgEl('polygon', {
      points: [
        [x, y],
        [x - dx * head - dy * half, y - dy * head + dx * half],
        [x - dx * head + dy * half, y - dy * head - dx * half],
      ].join(' '),
      class: 'pll-arrow',
    });
  const start: [number, number] = [x1 + ux * pad, y1 + uy * pad];
  const end: [number, number] = [x2 - ux * pad, y2 - uy * pad];
  const lineStart = twoWay ? [start[0] + ux * head * 0.8, start[1] + uy * head * 0.8] : start;
  const line = svgEl('line', {
    x1: lineStart[0],
    y1: lineStart[1],
    x2: end[0] - ux * head * 0.8,
    y2: end[1] - uy * head * 0.8,
    class: 'pll-arrow',
  });
  return [line, tip(...end, ux, uy), ...(twoWay ? [tip(...start, -ux, -uy)] : [])];
}

/** Top-down PLL diagram: the top, the side colours, and an arrow for each piece that moves. */
export function pllDiagram(state: string, size = 40): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 50 50', width: size, height: size, class: 'oll pll', role: 'img' }) as SVGSVGElement;
  svg.setAttribute('aria-label', 'PLL case');
  // the same layout as the OLL diagram: top 3x3, then F, R, B and L strips
  const sides = [18, 19, 20, 9, 10, 11, 45, 46, 47, 36, 37, 38];
  ollDiagram('1'.repeat(9) + '0'.repeat(12), size)
    .querySelectorAll('rect')
    .forEach((rect, i) => {
      if (i >= 9) {
        rect.removeAttribute('class');
        rect.setAttribute('fill', SIDE_COLOR[state[sides[i - 9]]] ?? '#888');
      }
      svg.append(rect);
    });
  for (const pieces of [LL_CORNERS, LL_EDGES]) {
    const perm = permutation(state, pieces);
    const seen = new Set<number>();
    for (let i = 0; i < pieces.length; i++) {
      if (seen.has(i) || perm[i] === i) continue;
      const cycle = [i];
      for (let j = perm[i]; j !== i; j = perm[j]) cycle.push(j);
      cycle.forEach((j) => seen.add(j));
      const pos = (j: number) => centre(pieces[j][0]);
      if (cycle.length === 2) svg.append(...arrow(pos(cycle[0]), pos(cycle[1]), true));
      else cycle.forEach((j) => svg.append(...arrow(pos(j), pos(perm[j]), false)));
    }
  }
  return svg;
}

const diagrams = new Map<string, SVGSVGElement>();

/** The case an algorithm solves, drawn the way the algorithm expects to find it. */
export function caseDiagram(kind: CaseKind, alg: string, size: number): SVGSVGElement {
  const key = `${kind}|${alg}`;
  let svg = diagrams.get(key);
  if (!svg) {
    svg = kind === 'oll' ? ollDiagram(orientationKey(setupState(alg))) : pllDiagram(pllState(alg));
    diagrams.set(key, svg);
  }
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('width', String(size));
  copy.setAttribute('height', String(size));
  return copy;
}

const isRotation = (token: string) => /^[xyz]/.test(token);

/** The card above the clock: case name, diagram, and the algorithm with progress. */
export function renderCoach(box: HTMLElement, view: CoachView): void {
  // a PLL skip shows its last turn in place of an algorithm
  const tokens = view.info ? view.tokens : view.hint?.kind === 'finish' ? [view.hint.moves] : [];
  const key = `${view.info?.id ?? 'skip'}|${view.alg}|${tokens.join(' ')}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const title = el('div', 'coach-title');
    title.append(el('span', 'coach-name', view.info?.name ?? 'PLL skip'));
    if (view.info) title.append(el('span', 'coach-group', view.info.group));
    const alg = el('div', 'coach-alg');
    alg.append(...tokens.map((t) => el('span', isRotation(t) ? 'rotation' : '', t)));
    const text = el('div', 'coach-text');
    text.append(title, alg);
    box.replaceChildren(...(view.info ? [caseDiagram(view.info.kind, view.alg, 76)] : []), text);
  }
  box.querySelectorAll('.coach-alg > span').forEach((span, i) => {
    span.classList.toggle('done', i < view.done);
    span.classList.toggle('current', view.info ? view.current.includes(i) : true);
  });
}

/** What the coach has to say, for the hint line under the card. */
export function coachHint(hint: CoachHint): { parts: (string | Node)[]; warn: boolean } {
  const mono = (text: string) => el('span', 'mono', text);
  switch (hint.kind) {
    case 'undo':
      return { parts: ['Undo: ', mono(hint.moves)], warn: true };
    case 'wrong-angle':
      return { parts: ['Wrong angle. Do ', mono(hint.moves), ', then start again.'], warn: true };
    case 'next':
      return { parts: ['Next: ', mono(hint.moves)], warn: true };
    case 'auf':
      return { parts: ['AUF first: ', mono(hint.moves)], warn: false };
    case 'finish':
      return { parts: ['Finish with ', mono(hint.moves)], warn: false };
    case 'off-track':
      return { parts: ['Off track. Get F2L back and the coach will find your case again.'], warn: true };
  }
}
