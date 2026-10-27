/**
 * The cube as cubies, in Kociemba's numbering: which corner and edge sits in each
 * slot, and how it's twisted (0-2) or flipped (0-1). The two-phase solver works on
 * this model. The face turns are read off the facelet model in facelets.ts, so both
 * share one definition of the moves.
 */

import { SOLVED, applyMove } from '../cube/facelets';
import { FACES, type Move } from '../cube/moves';

/** Slot i holds corner cp[i] with twist co[i], and edge ep[i] with flip eo[i]. */
export interface Cubie {
  cp: number[];
  co: number[];
  ep: number[];
  eo: number[];
}

// Facelet indices of the corner slots URF UFL ULB UBR DFR DLF DBL DRB and the edge slots
// UR UF UL UB DR DF DL DB FR FL BL BR: the U or D sticker first (F or B for the E-slice
// edges), then clockwise.
const CORNER_FACELETS = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
const EDGE_FACELETS = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];
const CORNER_COLORS = CORNER_FACELETS.map((slot) => slot.map((i) => SOLVED[i]));
const EDGE_COLORS = EDGE_FACELETS.map((slot) => slot.map((i) => SOLVED[i]));

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const SOLVED_CUBIE: Cubie = { cp: range(8), co: Array(8).fill(0), ep: range(12), eo: Array(12).fill(0) };

/** `a`, then `b` applied to it. */
export function multiply(a: Cubie, b: Cubie): Cubie {
  return {
    cp: b.cp.map((p) => a.cp[p]),
    co: b.cp.map((p, i) => (a.co[p] + b.co[i]) % 3),
    ep: b.ep.map((p) => a.ep[p]),
    eo: b.ep.map((p, i) => (a.eo[p] + b.eo[i]) % 2),
  };
}

export function fromFacelets(facelets: string): Cubie {
  const cube: Cubie = { cp: [], co: [], ep: [], eo: [] };
  CORNER_FACELETS.forEach((slot, i) => {
    const twist = slot.findIndex((f) => facelets[f] === 'U' || facelets[f] === 'D');
    const a = facelets[slot[(twist + 1) % 3]];
    const b = facelets[slot[(twist + 2) % 3]];
    cube.cp[i] = CORNER_COLORS.findIndex((colors) => colors[1] === a && colors[2] === b);
    cube.co[i] = twist;
  });
  EDGE_FACELETS.forEach((slot, i) => {
    const [a, b] = slot.map((f) => facelets[f]);
    const straight = EDGE_COLORS.findIndex((colors) => colors[0] === a && colors[1] === b);
    cube.ep[i] = straight >= 0 ? straight : EDGE_COLORS.findIndex((colors) => colors[0] === b && colors[1] === a);
    cube.eo[i] = straight >= 0 ? 0 : 1;
  });
  return cube;
}

/** The 18 face turns; turn `3 * face + amount - 1`, faces in URFDLB order. */
export const MOVE_CUBIES: Cubie[] = FACES.flatMap((face) =>
  ([1, 2, 3] as const).map((amount) => fromFacelets(applyMove(SOLVED, { face, amount }))),
);

export const moveIndex = (move: Move) => 3 * FACES.indexOf(move.face) + move.amount - 1;

export const indexMove = (m: number): Move => ({
  face: FACES[Math.floor(m / 3)],
  amount: ((m % 3) + 1) as Move['amount'],
});

// --- coordinates: small numbers the solver indexes its tables with ---

/** Corner twists as a base-3 number (the last corner's twist follows from the others). */
export function twist(co: number[]): number {
  return co.slice(0, 7).reduce((t, o) => 3 * t + o, 0);
}

/** Edge flips as a base-2 number (the last edge's flip follows from the others). */
export function flip(eo: number[]): number {
  return eo.slice(0, 11).reduce((t, o) => 2 * t + o, 0);
}

/** Inverse of twist (n = 8, mod = 3) and flip (n = 12, mod = 2). */
export function orientations(coord: number, n: number, mod: number): number[] {
  const out = Array<number>(n);
  let sum = 0;
  for (let i = n - 2; i >= 0; i--) {
    out[i] = coord % mod;
    sum += out[i];
    coord = Math.floor(coord / mod);
  }
  out[n - 1] = (mod - (sum % mod)) % mod;
  return out;
}

const CHOOSE = range(12).map((n) => range(5).map((k) => (k > n ? 0 : range(k).reduce((c, i) => (c * (n - i)) / (i + 1), 1))));

/** Which 4 slots hold the E-slice edges (FR FL BL BR), in any order; 0 when they're home. */
export function slice(ep: number[]): number {
  let coord = 0;
  let seen = 0;
  for (let j = 11; j >= 0; j--) if (ep[j] >= 8) coord += CHOOSE[11 - j][++seen];
  return coord;
}

/** Edges with the E-slice edges in the slots `coord` names and the others in order. */
export function sliceEdges(coord: number): number[] {
  const ep = Array<number>(12);
  let left = 4;
  for (let j = 0; j < 12; j++) {
    if (left > 0 && coord >= CHOOSE[11 - j][left]) {
      coord -= CHOOSE[11 - j][left];
      ep[j] = 12 - left--;
    }
  }
  let other = 0;
  for (let j = 0; j < 12; j++) if (ep[j] === undefined) ep[j] = other++;
  return ep;
}

/** Rank of a permutation of distinct numbers among all orderings of them (0 when sorted). */
export function permRank(p: number[]): number {
  let rank = 0;
  for (let i = 0; i < p.length; i++) {
    let smaller = 0;
    for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) smaller++;
    rank = rank * (p.length - i) + smaller;
  }
  return rank;
}

/** The permutation of 0..n-1 with this rank. */
export function permUnrank(rank: number, n: number): number[] {
  const digits = Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    digits[i] = rank % (n - i);
    rank = Math.floor(rank / (n - i));
  }
  const left = range(n);
  return digits.map((d) => left.splice(d, 1)[0]);
}

// --- random states ---

function shuffle(items: number[], random: () => number): number[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function parity(p: number[]): number {
  let inversions = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) inversions++;
  return inversions % 2;
}

/** A cube state picked uniformly from all 43 quintillion reachable ones. */
export function randomCubie(random: () => number = Math.random): Cubie {
  const cp = shuffle(range(8), random);
  const ep = shuffle(range(12), random);
  // Corners and edges always have the same permutation parity on a real cube.
  if (parity(cp) !== parity(ep)) [ep[10], ep[11]] = [ep[11], ep[10]];
  return {
    cp,
    co: orientations(Math.floor(random() * 2187), 8, 3),
    ep,
    eo: orientations(Math.floor(random() * 2048), 12, 2),
  };
}
