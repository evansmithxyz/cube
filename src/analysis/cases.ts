/**
 * Last-layer case recognition for CFOP, from the state at the start of OLL or PLL
 * (seen with the cross face down). PLLs are named; OLLs are identified by which
 * last-layer stickers show the top colour, which the UI draws as the usual diagram.
 */

import { SOLVED, applyMoves } from '../cube/facelets';
import { algToMoves, invertAlg, parseAlg, turnTokens } from '../cube/notation';
import { IDENTITY, Y, power, rotateState } from '../cube/rotations';

export interface LastLayerCase {
  kind: 'oll' | 'pll';
  /** PLL name ("T", "Ua", …), OLL pattern key, or "skip". */
  id: string;
}

/** One algorithm per PLL; any algorithm for the case would do, it's only used to generate it. */
export const PLL_ALGS: [name: string, alg: string][] = [
  ['Aa', "x R' U R' D2 R U' R' D2 R2 x'"],
  ['Ab', "x R2 D2 R U R' D2 R U' R x'"],
  ['E', "x' R U' R' D R U R' D' R U R' D R U' R' D' x"],
  ['F', "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"],
  ['Ga', "R2 U R' U R' U' R U' R2 U' D R' U R D'"],
  ['Gb', "R' U' R U D' R2 U R' U R U' R U' R2 D"],
  ['Gc', "R2 U' R U' R U R' U R2 U D' R U' R' D"],
  ['Gd', "R U R' U' D R2 U' R U' R' U R' U R2 D'"],
  ['H', 'M2 U M2 U2 M2 U M2'],
  ['Ja', "L' U' L F L' U' L U L F' L2 U L"],
  ['Jb', "R U R' F' R U R' U' R' F R2 U' R'"],
  ['Na', "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"],
  ['Nb', "L' U' L U' L' U' L F L' U' L U L F' L2 U L U2 L' U L"],
  ['Ra', "R U' R' U' R U R D R' U' R D' R' U2 R'"],
  ['Rb', "R2 F R U R U' R' F' R U2 R' U2 R"],
  ['T', "R U R' U' R' F R2 U' R' U' R U R' F'"],
  ['Ua', "R U' R U R U R U' R' U' R2"],
  ['Ub', "R2 U R U R' U' R' U' R' U R'"],
  ['V', "R' U R' U' y R' F' R2 U' R' U R' F R F"],
  ['Y', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
  ['Z', "M' U M2 U M2 U M' U2 M2"],
];

let pllTable: Map<string, string> | null = null;

/**
 * Every state each PLL can show up as: any view around the cube (y), any turn of the
 * top before the algorithm and any turn after it (AUF).
 */
export function pllStates(): Map<string, string> {
  if (pllTable) return pllTable;
  pllTable = new Map();
  for (let q = 0; q < 4; q++) pllTable.set(applyMoves(SOLVED, algToMoves(turnTokens('U', q)).moves), 'skip');
  for (const [name, alg] of PLL_ALGS) {
    const inverse = invertAlg(parseAlg(alg));
    for (let a = 0; a < 4; a++) {
      for (let before = 0; before < 4; before++) {
        for (let after = 0; after < 4; after++) {
          const tokens = [
            ...turnTokens('U', -after),
            ...turnTokens('y', a),
            ...inverse,
            ...turnTokens('y', -a),
            ...turnTokens('U', -before),
          ];
          pllTable.set(applyMoves(SOLVED, algToMoves(tokens).moves), name);
        }
      }
    }
  }
  return pllTable;
}

export function pllCase(state: string): LastLayerCase {
  return { kind: 'pll', id: pllStates().get(state) ?? '?' };
}

// Last-layer stickers: the top face, then the top rows of F, R, B, L (clockwise from above).
export const LL_STICKERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 9, 10, 11, 45, 46, 47, 36, 37, 38];
const ORIENTED = '1'.repeat(9) + '0'.repeat(12);
const Y_TURNS = [0, 1, 2, 3].map((n) => (n ? power(Y, n) : IDENTITY));

/** Which last-layer stickers show the top colour, the same from whichever side you look. */
export function ollCase(state: string): LastLayerCase {
  const key = Y_TURNS.map((r) => {
    const view = rotateState(state, r);
    return LL_STICKERS.map((i) => (view[i] === 'U' ? '1' : '0')).join('');
  }).sort()[0];
  return { kind: 'oll', id: key === ORIENTED ? 'skip' : key };
}
