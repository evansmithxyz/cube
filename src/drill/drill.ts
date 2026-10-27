/**
 * Timing repetitions of one algorithm. A rep starts on the first turn and ends as soon
 * as the cube shows the algorithm's result, judged by the state rather than the moves:
 * from any angle, however it was fingertricked, so any algorithm for the same case
 * counts. A turn of the top layer before or after (AUF) is allowed too, unless the
 * algorithm itself starts or ends with one.
 */

import { applyMove, applyMoves } from '../cube/facelets';
import { invert, type Face, type Move } from '../cube/moves';
import { algToMoves, parseAlg, turnTokens, type AlgToken } from '../cube/notation';
import { ROTATIONS } from '../cube/rotations';

// 54 distinct characters: applying moves to this reveals where each sticker goes.
const LABELS = Array.from({ length: 54 }, (_, i) => String.fromCharCode(48 + i)).join('');

interface Effect {
  /** result[i] = start[perm[i]] */
  perm: number[];
  /** The face (by centre) that is the top layer for this way of holding the cube. */
  top: Face;
  /** AUF quarter turns made before the algorithm. */
  before: number;
}

const firstMove = (tokens: AlgToken[]) => tokens.find((t) => !'xyz'.includes(t.letter));
const isTopTurn = (token: AlgToken | undefined) => token?.letter === 'U' || token?.letter === 'u';

/**
 * Every way the algorithm can show up: 24 orientations x AUF before x AUF after.
 * Several can give the same result (an AUF before is the same as doing it from another
 * side with an AUF after), so the order of the turns decides which happened.
 */
function effects(tokens: AlgToken[]): Effect[] {
  const befores = isTopTurn(firstMove(tokens)) ? [0] : [0, 1, 2, 3];
  const afters = isTopTurn(firstMove([...tokens].reverse())) ? [0] : [0, 1, 2, 3];
  const found = new Map<string, Effect>();
  for (const before of befores) {
    for (const frame of ROTATIONS) {
      for (const after of afters) {
        const all = [...turnTokens('U', before), ...tokens, ...turnTokens('U', after)];
        const result = applyMoves(LABELS, algToMoves(all, frame).moves);
        const key = `${result}|${frame.U}|${before}`;
        if (!found.has(key)) {
          found.set(key, { perm: [...result].map((c) => c.charCodeAt(0) - 48), top: frame.U, before });
        }
      }
    }
  }
  return [...found.values()];
}

/** Whether the algorithm only turns the top layer (or nothing). */
function onlyTurnsTop(tokens: AlgToken[]): boolean {
  const result = applyMoves(LABELS, algToMoves(tokens).moves);
  return [0, 1, 2, 3].some((n) => result === applyMoves(LABELS, algToMoves(turnTokens('U', n)).moves));
}

export type DrillOutcome =
  | { kind: 'rep'; timeMs: number; turns: number }
  | { kind: 'off-track' }
  | null;

export class AlgorithmDrill {
  running = false;
  /** Time of the rep's first turn. */
  repStart = 0;
  /** Quarter turns the algorithm takes as written. */
  readonly length: number;
  private readonly effects: Effect[];
  private start = '';
  /** Each state that completes the rep, with the ways of getting there. */
  private targets = new Map<string, Effect[]>();
  private turns: { face: Face; amount: number; t: number }[] = [];

  /** Throws on bad notation, or an algorithm that does nothing beyond turning the top. */
  constructor(readonly alg: string) {
    const tokens = parseAlg(alg);
    if (onlyTurnsTop(tokens)) {
      throw new Error("That algorithm doesn't change the cube (beyond turning the top layer).");
    }
    this.effects = effects(tokens);
    this.length = algToMoves(tokens).moves.reduce((n, m) => n + (m.amount === 2 ? 2 : 1), 0);
  }

  /** A turn of the cube, with its state afterwards. */
  turn(move: Move, state: string, now: number): DrillOutcome {
    if (!this.running) {
      this.running = true;
      this.repStart = now;
      this.start = applyMove(state, invert(move));
      this.turns = [];
      this.targets = new Map();
      for (const effect of this.effects) {
        const target = effect.perm.map((i) => this.start[i]).join('');
        this.targets.set(target, [...(this.targets.get(target) ?? []), effect]);
      }
    }
    this.turns.push({ face: move.face, amount: move.amount, t: now });

    const matches = this.targets.get(state);
    if (matches) {
      this.running = false;
      const first = Math.max(0, ...matches.map((m) => this.firstAlgTurn(m)));
      return { kind: 'rep', timeMs: now - this.turns[first].t, turns: this.turns.length - first };
    }
    if (state === this.start) {
      this.running = false; // turned back to where it started
    } else if (this.turns.length > 2 * this.length + 10) {
      this.running = false;
      return { kind: 'off-track' };
    }
    return null;
  }

  cancel(): void {
    this.running = false;
  }

  /** Skip the AUF before the algorithm, so the time starts on its first real turn. */
  private firstAlgTurn(match: Effect): number {
    if (match.before === 0) return 0;
    let turned = 0;
    for (let i = 0; i < this.turns.length - 1 && this.turns[i].face === match.top; i++) {
      turned = (turned + this.turns[i].amount) % 4;
      if (turned === match.before) return i + 1;
    }
    return 0;
  }
}
