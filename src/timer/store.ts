/** Solve history, kept in localStorage. */

import { SOLVED, applyMoves } from '../cube/facelets';
import { formatMove, formatMoves, parseMove, parseMoves } from '../cube/moves';
import type { Attempt, TimedMove } from './solveTimer';
import type { Penalty, Timed } from './stats';

export interface Solve extends Timed {
  id: string;
  /** epoch ms */
  date: number;
  /** '' when the user scrambled the cube themselves */
  scramble: string;
  /** Facelets when the solve started (missing on solves saved before splits existed) */
  start?: string;
  /** Turns with ms offsets, e.g. "R@0 U'@153" */
  moves: string;
}

/** The state a solve started from, if known. */
export function startState(solve: Solve): string | null {
  if (solve.start) return solve.start;
  return solve.scramble ? applyMoves(SOLVED, parseMoves(solve.scramble)) : null;
}

const STORAGE_KEY = 'cube-timer:solves:v1';

export function encodeMoves(moves: TimedMove[]): string {
  return moves.map(({ move, t }) => `${formatMove(move)}@${Math.round(t)}`).join(' ');
}

export function decodeMoves(text: string): TimedMove[] {
  return text
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const [move, t] = token.split('@');
      return { move: parseMove(move), t: Number(t) };
    });
}

export class SolveStore {
  solves: Solve[] = [];

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) this.solves = saved;
    } catch {
      // unreadable or unavailable storage: start empty
    }
  }

  add(attempt: Attempt, date = Date.now()): Solve {
    const solve: Solve = {
      id: crypto.randomUUID(),
      date,
      timeMs: Math.round(attempt.timeMs),
      penalty: attempt.penalty,
      scramble: attempt.scramble ? formatMoves(attempt.scramble) : '',
      start: attempt.start,
      moves: encodeMoves(attempt.moves),
    };
    this.solves.push(solve);
    this.save();
    return solve;
  }

  setPenalty(id: string, penalty: Penalty): void {
    const solve = this.solves.find((s) => s.id === id);
    if (!solve) return;
    solve.penalty = penalty;
    this.save();
  }

  remove(id: string): void {
    this.solves = this.solves.filter((s) => s.id !== id);
    this.save();
  }

  clear(): void {
    this.solves = [];
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.solves));
    } catch (error) {
      console.warn('Could not save solves', error);
    }
  }
}
