/**
 * Solving methods as ordered stages. Each stage's test looks at the state from the
 * method's point of view (e.g. cross face down) and includes every earlier stage, so
 * progress is "the first stage whose test fails".
 */

import { SOLVED, applyMove } from '../cube/facelets';
import { FACES, sameAxis, type Face } from '../cube/moves';
import { findRotation, type Rotation } from '../cube/rotations';

export type MethodId = 'cfop' | 'lbl' | 'roux' | 'none';

export interface Stage {
  name: string;
  done(state: string): boolean;
  /** Last-layer case to recognise when this stage starts. */
  caseKind?: 'oll' | 'pll';
}

export interface Method {
  id: MethodId;
  name: string;
  /** Points of view to look for progress from; the first one that shows any is kept. */
  frames: Rotation[];
  stages: Stage[];
}

// Facelet indices of pieces, seen with the base face down (and, for Roux, blocks left/right).
const CROSS = [28, 25, 32, 16, 30, 43, 34, 52]; // DF DR DL DB
const D_CORNERS = [29, 26, 15, 27, 44, 24, 33, 53, 42, 35, 17, 51];
const MIDDLE_EDGES = [23, 12, 21, 41, 50, 39, 48, 14]; // FR FL BL BR
const PAIRS = [
  [29, 26, 15, 23, 12], // DFR + FR
  [27, 44, 24, 21, 41], // DLF + FL
  [33, 53, 42, 50, 39], // DBL + BL
  [35, 17, 51, 48, 14], // DRB + BR
];
const TOP_FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const TOP_EDGES = [1, 3, 5, 7];
const TOP_CORNERS = [8, 9, 20, 6, 18, 38, 0, 36, 47, 2, 45, 11];
const LEFT_BLOCK = [30, 43, 21, 41, 50, 39, 27, 44, 24, 33, 53, 42]; // DL FL BL DLF DBL
const BLOCKS = [...LEFT_BLOCK, 32, 16, 23, 12, 48, 14, 29, 26, 15, 35, 17, 51]; // + DR FR BR DFR DRB

const solved = (state: string, slots: number[]) => slots.every((i) => state[i] === SOLVED[i]);
const allTop = (state: string, slots: number[]) => slots.every((i) => state[i] === 'U');
const pairsSolved = (state: string) => PAIRS.filter((pair) => solved(state, pair)).length;

function turned(state: string, face: Face, quarterTurns: number): string {
  const amount = ((quarterTurns % 4) + 4) % 4;
  return amount ? applyMove(state, { face, amount: amount as 1 | 2 | 3 }) : state;
}

const OFFSETS = [0, 1, 2, 3];

/**
 * Roux leaves the M slice free, which a smart cube sees as its L and R layers being
 * turned opposite ways; undo that before checking the blocks.
 */
const alignBlocks = (state: string, k: number) => turned(turned(state, 'L', k), 'R', -k);

// Every face as the base (down), for cross-based methods.
const BASE_DOWN = FACES.map((face) => findRotation([face, 'D']));
// Every block side (left) with every adjacent base (down), for Roux.
const BLOCK_LEFT = FACES.flatMap((side) =>
  FACES.filter((base) => !sameAxis(side, base)).map((base) => findRotation([side, 'L'], [base, 'D'])),
);

const cross: Stage = { name: 'Cross', done: (s) => solved(s, CROSS) };

const cfop: Method = {
  id: 'cfop',
  name: 'CFOP',
  frames: BASE_DOWN,
  stages: [
    cross,
    ...[1, 2, 3, 4].map((n) => ({
      name: `F2L ${n}`,
      done: (s: string) => solved(s, CROSS) && pairsSolved(s) >= n,
    })),
    {
      name: 'OLL',
      caseKind: 'oll',
      done: (s) => solved(s, CROSS) && pairsSolved(s) === 4 && allTop(s, TOP_FACE),
    },
    { name: 'PLL', caseKind: 'pll', done: (s) => s === SOLVED },
  ],
};

const lbl: Method = {
  id: 'lbl',
  name: 'Layer by layer',
  frames: BASE_DOWN,
  stages: [
    cross,
    { name: 'First layer', done: (s) => solved(s, CROSS) && solved(s, D_CORNERS) },
    { name: 'Second layer', done: (s) => solved(s, CROSS) && solved(s, D_CORNERS) && solved(s, MIDDLE_EDGES) },
    {
      name: 'Top cross',
      done: (s) => solved(s, CROSS) && solved(s, D_CORNERS) && solved(s, MIDDLE_EDGES) && allTop(s, TOP_EDGES),
    },
    { name: 'Last layer', done: (s) => s === SOLVED },
  ],
};

const roux: Method = {
  id: 'roux',
  name: 'Roux',
  frames: BLOCK_LEFT,
  stages: [
    { name: 'First block', done: (s) => OFFSETS.some((k) => solved(turned(s, 'L', k), LEFT_BLOCK)) },
    { name: 'Second block', done: (s) => OFFSETS.some((k) => solved(alignBlocks(s, k), BLOCKS)) },
    {
      name: 'CMLL',
      done: (s) =>
        OFFSETS.some((k) => {
          const aligned = alignBlocks(s, k);
          return solved(aligned, BLOCKS) && OFFSETS.some((u) => solved(turned(aligned, 'U', u), TOP_CORNERS));
        }),
    },
    { name: 'LSE', done: (s) => s === SOLVED },
  ],
};

const none: Method = { id: 'none', name: 'No splits', frames: [], stages: [] };

export const METHODS: Method[] = [cfop, lbl, roux, none];

export const methodById = (id: string): Method => METHODS.find((m) => m.id === id) ?? cfop;
