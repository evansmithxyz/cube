/**
 * The last-layer cases the coach teaches, with J Perm's algorithms (jperm.net/algs/oll,
 * jperm.net/algs/pll) as defaults. A case is told apart by the state it leaves, so
 * recognising one never depends on which algorithm is used for it, and the user can
 * swap in any algorithm that solves it.
 */

import { SOLVED, applyMoves } from '../cube/facelets';
import { invert, type Move } from '../cube/moves';
import { algToMoves, parseAlg } from '../cube/notation';
import { LL_STICKERS, ollCase, pllCase, type LastLayerCase } from '../analysis/cases';
import { f2lDone, ollDone } from '../analysis/methods';

export type CaseKind = 'oll' | 'pll';

export interface CaseInfo {
  /** "oll-27", "pll-T" */
  id: string;
  kind: CaseKind;
  /** "OLL 27", "T perm" */
  name: string;
  /** J Perm's group, e.g. "Cross" or "Adjacent corner swap". */
  group: string;
  /** The default algorithm. */
  alg: string;
}

const OLL: [number: number, group: string, alg: string][] = [
  [1, 'Dot', "R U2 R2 F R F' U2 R' F R F'"],
  [2, 'Dot', "r U r' U2 r U2 R' U2 R U' r'"],
  [3, 'Dot', "r' R2 U R' U r U2 r' U M'"],
  [4, 'Dot', "M U' r U2 r' U' R U' R' M'"],
  [5, 'Square shape', "l' U2 L U L' U l"],
  [6, 'Square shape', "r U2 R' U' R U' r'"],
  [7, 'Small lightning bolt', "r U R' U R U2 r'"],
  [8, 'Small lightning bolt', "l' U' L U' L' U2 l"],
  [9, 'Fish shape', "R U R' U' R' F R2 U R' U' F'"],
  [10, 'Fish shape', "R U R' U R' F R F' R U2 R'"],
  [11, 'Small lightning bolt', "r U R' U R' F R F' R U2 r'"],
  [12, 'Small lightning bolt', "M' R' U' R U' R' U2 R U' R r'"],
  [13, 'Knight move shape', "F U R U' R2 F' R U R U' R'"],
  [14, 'Knight move shape', "R' F R U R' F' R F U' F'"],
  [15, 'Knight move shape', "l' U' l L' U' L U l' U l"],
  [16, 'Knight move shape', "r U r' R U R' U' r U' r'"],
  [17, 'Dot', "F R' F' R2 r' U R U' R' U' M'"],
  [18, 'Dot', "r U R' U R U2 r2 U' R U' R' U2 r"],
  [19, 'Dot', "r' R U R U R' U' M' R' F R F'"],
  [20, 'Dot', "r U R' U' M2 U R U' R' U' M'"],
  [21, 'Cross', "R U2 R' U' R U R' U' R U' R'"],
  [22, 'Cross', "R U2 R2 U' R2 U' R2 U2 R"],
  [23, 'Cross', "R2 D' R U2 R' D R U2 R"],
  [24, 'Cross', "r U R' U' r' F R F'"],
  [25, 'Cross', "F' r U R' U' r' F R"],
  [26, 'Cross', "R U2 R' U' R U' R'"],
  [27, 'Cross', "R U R' U R U2 R'"],
  [28, 'Corners oriented', "r U R' U' r' R U R U' R'"],
  [29, 'Awkward shape', "R U R' U' R U' R' F' U' F R U R'"],
  [30, 'Awkward shape', "F R' F R2 U' R' U' R U R' F2"],
  [31, 'P shape', "R' U' F U R U' R' F' R"],
  [32, 'P shape', "L U F' U' L' U L F L'"],
  [33, 'T shape', "R U R' U' R' F R F'"],
  [34, 'C shape', "R U R2 U' R' F R U R U' F'"],
  [35, 'Fish shape', "R U2 R2 F R F' R U2 R'"],
  [36, 'W shape', "L' U' L U' L' U L U L F' L' F"],
  [37, 'Fish shape', "F R' F' R U R U' R'"],
  [38, 'W shape', "R U R' U R U' R' U' R' F R F'"],
  [39, 'Big lightning bolt', "L F' L' U' L U F U' L'"],
  [40, 'Big lightning bolt', "R' F R U R' U' F' U R"],
  [41, 'Awkward shape', "R U R' U R U2 R' F R U R' U' F'"],
  [42, 'Awkward shape', "R' U' R U' R' U2 R F R U R' U' F'"],
  [43, 'P shape', "F' U' L' U L F"],
  [44, 'P shape', "F U R U' R' F'"],
  [45, 'T shape', "F R U R' U' F'"],
  [46, 'C shape', "R' U' R' F R F' U R"],
  [47, 'Small L shape', "R' U' R' F R F' R' F R F' U R"],
  [48, 'Small L shape', "F R U R' U' R U R' U' F'"],
  [49, 'Small L shape', "r U' r2 U r2 U r2 U' r"],
  [50, 'Small L shape', "r' U r2 U' r2 U' r2 U r'"],
  [51, 'I shape', "F U R U' R' U R U' R' F'"],
  [52, 'I shape', "R U R' U R U' B U' B' R'"],
  [53, 'Small L shape', "l' U2 L U L' U' L U L' U l"],
  [54, 'Small L shape', "r U2 R' U' R U R' U' R U' r'"],
  [55, 'I shape', "R' F R U R U' R2 F' R2 U' R' U R U R'"],
  [56, 'I shape', "r' U' r U' R' U R U' R' U R r' U r"],
  [57, 'Corners oriented', "R U R' U' M' U R U' r'"],
];

const ADJACENT = 'Adjacent corner swap';
const DIAGONAL = 'Diagonal corner swap';
const EDGES = 'Edges only';

const PLL: [name: string, group: string, alg: string][] = [
  ['Aa', ADJACENT, "x L2 D2 L' U' L D2 L' U L'"],
  ['Ab', ADJACENT, "x' L2 D2 L U L' D2 L U' L"],
  ['E', DIAGONAL, "x' L' U L D' L' U' L D L' U' L D' L' U L D"],
  ['F', ADJACENT, "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"],
  ['Ga', ADJACENT, "R2 U R' U R' U' R U' R2 U' D R' U R D'"],
  ['Gb', ADJACENT, "R' U' R U D' R2 U R' U R U' R U' R2 D"],
  ['Gc', ADJACENT, "R2 U' R U' R U R' U R2 U D' R U' R' D"],
  ['Gd', ADJACENT, "R U R' U' D R2 U' R U' R' U R' U R2 D'"],
  ['H', EDGES, 'M2 U M2 U2 M2 U M2'],
  ['Ja', ADJACENT, "x R2 F R F' R U2 r' U r U2"],
  ['Jb', ADJACENT, "R U R' F' R U R' U' R' F R2 U' R'"],
  ['Na', DIAGONAL, "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"],
  ['Nb', DIAGONAL, "R' U R U' R' F' U' F R U R' F R' F' R U' R"],
  ['Ra', ADJACENT, "R U' R' U' R U R D R' U' R D' R' U2 R'"],
  ['Rb', ADJACENT, "R2 F R U R U' R' F' R U2 R' U2 R"],
  ['T', ADJACENT, "R U R' U' R' F R2 U' R' U' R U R' F'"],
  ['Ua', EDGES, "M2 U M U2 M' U M2"],
  ['Ub', EDGES, "M2 U' M U2 M' U' M2"],
  ['V', DIAGONAL, "R' U R' U' y R' F' R2 U' R' U R' F R F"],
  ['Y', DIAGONAL, "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
  ['Z', EDGES, "M' U M2 U M2 U M' U2 M2"],
];

export const CASES: CaseInfo[] = [
  ...OLL.map(([n, group, alg]): CaseInfo => ({ id: `oll-${n}`, kind: 'oll', name: `OLL ${n}`, group, alg })),
  ...PLL.map(([name, group, alg]): CaseInfo => ({ id: `pll-${name}`, kind: 'pll', name: `${name} perm`, group, alg })),
];

const BY_ID = new Map(CASES.map((c) => [c.id, c]));

export const caseById = (id: string): CaseInfo | undefined => BY_ID.get(id);

/** Undo a list of turns: reversed, each one inverted. */
export const invertMoves = (moves: Move[]): Move[] => [...moves].reverse().map(invert);

/** The state an algorithm solves, held the way it's written: solved, with the algorithm undone. */
export function setupState(alg: string): string {
  return applyMoves(SOLVED, invertMoves(algToMoves(parseAlg(alg)).moves));
}

/** Which last-layer stickers show the top colour, in this exact orientation (for the OLL diagram). */
export function orientationKey(state: string): string {
  return LL_STICKERS.map((i) => (state[i] === 'U' ? '1' : '0')).join('');
}

let ollByPattern: Map<string, CaseInfo> | null = null;

/** The named case for a recognised last layer (undefined for a skip). */
export function caseFor(found: LastLayerCase): CaseInfo | undefined {
  if (found.kind === 'pll') return BY_ID.get(`pll-${found.id}`);
  ollByPattern ??= new Map(CASES.filter((c) => c.kind === 'oll').map((c) => [ollCase(setupState(c.alg)).id, c]));
  return ollByPattern.get(found.id);
}

/** Why `alg` can't be used for the case, or null if it solves it. */
export function checkAlg(info: CaseInfo, alg: string): string | null {
  let state: string;
  try {
    state = setupState(alg);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (!f2lDone(state)) return "That algorithm doesn't keep the first two layers solved.";
  if (info.kind === 'pll' && !ollDone(state)) {
    return 'That algorithm turns some top pieces over, so it isn’t a PLL.';
  }
  const found = info.kind === 'oll' ? ollCase(state) : pllCase(state);
  if (found.id === 'skip') {
    return info.kind === 'oll'
      ? "That algorithm doesn't turn any top pieces over."
      : 'That algorithm only turns the top layer.';
  }
  const actual = caseFor(found);
  return actual?.id === info.id ? null : `That's an algorithm for ${actual?.name ?? 'another case'}, not ${info.name}.`;
}
