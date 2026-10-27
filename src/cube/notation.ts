/**
 * Full algorithm notation (face turns, wide turns like r or Rw, slices M E S, and
 * rotations x y z) converted to the centre-relative face turns a smart cube reports:
 * the cube can't see rotations, and a slice or wide turn shows up as a turn of the
 * opposite face (r = L x, M = R L' x').
 */

import { FACES, type Face, type Move } from './moves';
import { IDENTITY, X, Y, Z, type Rotation } from './rotations';

export interface AlgToken {
  /** U R F D L B, wide u r f d l b, slices M E S, or rotations x y z. */
  letter: string;
  amount: 1 | 2 | 3;
}

const TOKEN = /^([URFDLB]w|[URFDLBurfdlbMESxyz])(2'|'2|2|'|)$/;

export function parseAlg(text: string): AlgToken[] {
  return text
    .replace(/[’′`]/g, "'")
    .replace(/[()[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = TOKEN.exec(token);
      if (!match) throw new Error(`Unknown move: ${token}`);
      const suffix = match[2];
      const letter = match[1].endsWith('w') ? match[1][0].toLowerCase() : match[1];
      return { letter, amount: suffix.includes('2') ? 2 : suffix === "'" ? 3 : 1 };
    });
}

/** `letter` turned `times` quarter turns (none for a multiple of 4), e.g. ("U", -1) -> U'. */
export function turnTokens(letter: string, times: number): AlgToken[] {
  const amount = ((times % 4) + 4) % 4;
  return amount ? [{ letter, amount: amount as AlgToken['amount'] }] : [];
}

export function invertAlg(tokens: AlgToken[]): AlgToken[] {
  return [...tokens].reverse().map((t) => ({ letter: t.letter, amount: (4 - t.amount) as AlgToken['amount'] }));
}

export function formatAlg(tokens: AlgToken[]): string {
  return tokens.map((t) => t.letter + (t.amount === 1 ? '' : t.amount === 2 ? '2' : "'")).join(' ');
}

const OPPOSITE: Record<Face, Face> = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
// The rotation that turns the whole cube like each face, and its direction.
const AXIS: Record<Face, [Rotation, number]> = {
  R: [X, 1], L: [X, -1], U: [Y, 1], D: [Y, -1], F: [Z, 1], B: [Z, -1],
};

/**
 * Face turns an algorithm makes, relative to the centres. `frame` says which face
 * (by centre) sits in each position when the algorithm starts.
 */
export function algToMoves(tokens: AlgToken[], frame: Rotation = IDENTITY): { moves: Move[]; frame: Rotation } {
  const moves: Move[] = [];
  let current: Record<Face, Face> = { ...frame };
  const turn = (position: Face, quarterTurns: number) => {
    const amount = ((quarterTurns % 4) + 4) % 4;
    if (amount) moves.push({ face: current[position], amount: amount as Move['amount'] });
  };
  const rotate = (rotation: Rotation, times: number) => {
    for (let i = 0; i < ((times % 4) + 4) % 4; i++) {
      const next = { ...current };
      // what was in each position moves to where the rotation takes that position
      for (const position of FACES) next[rotation[position]] = current[position];
      current = next;
    }
  };

  for (const { letter, amount } of tokens) {
    if ('URFDLB'.includes(letter)) {
      turn(letter as Face, amount);
    } else if ('urfdlb'.includes(letter)) {
      const face = letter.toUpperCase() as Face;
      const [rotation, direction] = AXIS[face];
      turn(OPPOSITE[face], amount);
      rotate(rotation, direction * amount);
    } else if (letter === 'M') {
      turn('R', amount);
      turn('L', -amount);
      rotate(X, -amount);
    } else if (letter === 'E') {
      turn('U', amount);
      turn('D', -amount);
      rotate(Y, -amount);
    } else if (letter === 'S') {
      turn('F', -amount);
      turn('B', amount);
      rotate(Z, amount);
    } else {
      rotate({ x: X, y: Y, z: Z }[letter as 'x' | 'y' | 'z'], amount);
    }
  }
  return { moves, frame: current };
}
