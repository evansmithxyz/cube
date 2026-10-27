/**
 * Follows the user scrambling a solved cube. `pending` is always the sequence that
 * takes the current state to the scrambled one, so a wrong turn just prepends its
 * inverse (and an accidental R instead of R2 leaves a single R to go).
 */

import { invert, simplify, type Move } from '../cube/moves';

export interface ScrambleProgress {
  /** Scramble moves fully applied. */
  done: number;
  /** What is left of scramble[done] when it's partly applied (e.g. R after one R of R2). */
  partial: Move | null;
  /** Turns that undo mistakes; needed before the scramble can continue. */
  fix: Move[];
}

const sameMove = (a: Move, b: Move) => a.face === b.face && a.amount === b.amount;

export class ScrambleTracker {
  private pending: Move[];

  constructor(readonly scramble: Move[]) {
    this.pending = [...scramble];
  }

  turn(move: Move): void {
    this.pending = simplify([invert(move), ...this.pending]);
  }

  restart(): void {
    this.pending = [...this.scramble];
  }

  /** The turn to make next. */
  next(): Move | null {
    return this.pending[0] ?? null;
  }

  progress(): ScrambleProgress {
    const { scramble, pending } = this;
    let i = scramble.length;
    let j = pending.length;
    while (i > 0 && j > 0 && sameMove(scramble[i - 1], pending[j - 1])) {
      i--;
      j--;
    }
    if (j === 0) return { done: i, partial: null, fix: [] };
    if (j === 1 && i > 0 && pending[0].face === scramble[i - 1].face) {
      return { done: i - 1, partial: pending[0], fix: [] };
    }
    return { done: i, partial: null, fix: pending.slice(0, j) };
  }
}
