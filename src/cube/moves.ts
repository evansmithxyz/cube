/** Face turns in standard (WCA) notation. */

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];

/** A face turn; `amount` counts clockwise quarter turns (1 = R, 2 = R2, 3 = R'). */
export interface Move {
  face: Face;
  amount: 1 | 2 | 3;
}

const AXIS: Record<Face, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };

export function sameAxis(a: Face, b: Face): boolean {
  return AXIS[a] === AXIS[b];
}

export function invert(move: Move): Move {
  return { face: move.face, amount: (4 - move.amount) as Move['amount'] };
}

export function formatMove(move: Move): string {
  return move.face + (move.amount === 1 ? '' : move.amount === 2 ? '2' : "'");
}

export function formatMoves(moves: Move[]): string {
  return moves.map(formatMove).join(' ');
}

export function parseMove(token: string): Move {
  const match = /^([URFDLB])(2'?|'2?|)$/.exec(token);
  if (!match) throw new Error(`Not a face turn: ${token}`);
  const suffix = match[2];
  const amount = suffix === '' ? 1 : suffix.includes('2') ? 2 : 3;
  return { face: match[1] as Face, amount };
}

export function parseMoves(text: string): Move[] {
  return text.split(/\s+/).filter(Boolean).map(parseMove);
}

/**
 * Collapse redundant turns: adjacent turns of one face merge (R R -> R2, R R' -> nothing),
 * including across a turn of the opposite face, which commutes (R L R -> R2 L).
 */
export function simplify(moves: Move[]): Move[] {
  const out: Move[] = [];
  for (const move of moves) {
    let target = out.length - 1;
    if (target >= 0 && out[target].face !== move.face && sameAxis(out[target].face, move.face)) {
      target -= 1; // look past the commuting opposite-face turn
    }
    if (target >= 0 && out[target].face === move.face) {
      const amount = (out[target].amount + move.amount) % 4;
      if (amount === 0) out.splice(target, 1);
      else out[target] = { face: move.face, amount: amount as Move['amount'] };
    } else {
      out.push({ ...move });
    }
  }
  return out;
}

/**
 * Random-move scramble: no face repeats back to back, and never three turns in a
 * row on one axis (so nothing in the scramble cancels or merges).
 */
export function randomScramble(length = 25, random: () => number = Math.random): Move[] {
  const moves: Move[] = [];
  while (moves.length < length) {
    const face = FACES[Math.floor(random() * FACES.length)];
    const prev = moves[moves.length - 1];
    const prev2 = moves[moves.length - 2];
    if (prev && prev.face === face) continue;
    if (prev && prev2 && sameAxis(prev.face, face) && sameAxis(prev2.face, face)) continue;
    moves.push({ face, amount: (1 + Math.floor(random() * 3)) as Move['amount'] });
  }
  return moves;
}
