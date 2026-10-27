/**
 * The attempt cycle, driven entirely by cube turns:
 *   unsolved -> (cube solved) -> scrambling -> (scrambled state reached)
 *   -> inspection | ready -> (first turn) -> solving -> (solved) -> scrambling ...
 * No DOM here; the UI reads `phase` and friends and calls the methods below.
 */

import { SOLVED, applyMove, applyMoves } from '../cube/facelets';
import { invert, randomScramble, type Move } from '../cube/moves';
import { ScrambleTracker } from './scrambleTracker';
import type { Penalty } from './stats';

export type Phase = 'idle' | 'unsolved' | 'scrambling' | 'inspection' | 'ready' | 'solving';

export const INSPECTION_MS = 15_000;
export const INSPECTION_DNF_MS = 17_000;

export interface TimedMove {
  move: Move;
  /** ms since the first turn of the solve */
  t: number;
}

export interface Attempt {
  timeMs: number;
  penalty: Penalty;
  /** null when the user scrambled the cube themselves */
  scramble: Move[] | null;
  /** Facelets when the solve started */
  start: string;
  moves: TimedMove[];
}

export interface TimerOptions {
  inspection: boolean;
  makeScramble?: () => Move[];
}

export class SolveTimer {
  phase: Phase = 'idle';
  scramble: Move[] = [];
  tracker!: ScrambleTracker;
  /** Whether the current attempt skipped the generated scramble. */
  custom = false;
  inspectionStart = 0;
  solveStart = 0;
  last: Attempt | null = null;
  onSolve: (attempt: Attempt) => void = () => {};

  /** Facelets when the current solve started */
  startState = SOLVED;
  private target = SOLVED;
  private moves: TimedMove[] = [];
  private penalty: Penalty = 'ok';

  constructor(readonly options: TimerOptions) {
    this.nextScramble();
  }

  /** Start over from a known cube state (connect, resync, cancel). */
  reset(state: string): void {
    this.custom = false;
    this.tracker.restart();
    this.phase = state === SOLVED ? 'scrambling' : 'unsolved';
  }

  disconnect(): void {
    this.phase = 'idle';
  }

  turn(move: Move, state: string, now: number): void {
    switch (this.phase) {
      case 'unsolved':
        if (state === SOLVED) this.reset(state);
        break;
      case 'scrambling':
        if (state === SOLVED) this.tracker.restart();
        else this.tracker.turn(move);
        if (state === this.target) this.startInspection(now);
        break;
      case 'inspection':
      case 'ready':
        this.penalty = this.inspectionPenalty(now);
        this.solveStart = now;
        this.startState = applyMove(state, invert(move));
        this.moves = [];
        this.phase = 'solving';
        this.record(move, state, now);
        break;
      case 'solving':
        this.record(move, state, now);
        break;
    }
  }

  /** The cube reported a different state than we tracked (dropped turns, or a reset). */
  replaceState(state: string, now: number): void {
    if (this.phase === 'solving') {
      if (state === SOLVED) this.finish(this.moves.at(-1)?.t ?? now - this.solveStart);
    } else if (this.phase !== 'inspection' && this.phase !== 'ready') {
      this.reset(state);
    }
  }

  /** Use whatever state the cube is in now as the scramble. */
  skipScramble(now: number): void {
    this.custom = true;
    this.startInspection(now);
  }

  newScramble(state: string): void {
    this.nextScramble();
    this.reset(state);
  }

  /** Abandon the current attempt without recording it. */
  cancel(state: string): void {
    this.reset(state);
  }

  inspectionElapsed(now: number): number {
    return now - this.inspectionStart;
  }

  private startInspection(now: number): void {
    this.inspectionStart = now;
    this.phase = this.options.inspection ? 'inspection' : 'ready';
  }

  private inspectionPenalty(now: number): Penalty {
    if (this.phase !== 'inspection') return 'ok';
    const elapsed = this.inspectionElapsed(now);
    return elapsed > INSPECTION_DNF_MS ? 'dnf' : elapsed > INSPECTION_MS ? '+2' : 'ok';
  }

  private record(move: Move, state: string, now: number): void {
    const t = now - this.solveStart;
    this.moves.push({ move, t });
    if (state === SOLVED) this.finish(t);
  }

  private finish(timeMs: number): void {
    const attempt: Attempt = {
      timeMs,
      penalty: this.penalty,
      scramble: this.custom ? null : this.scramble,
      start: this.startState,
      moves: this.moves,
    };
    this.last = attempt;
    this.nextScramble();
    this.reset(SOLVED);
    this.onSolve(attempt);
  }

  private nextScramble(): void {
    this.scramble = (this.options.makeScramble ?? randomScramble)();
    this.target = applyMoves(SOLVED, this.scramble);
    this.tracker = new ScrambleTracker(this.scramble);
  }
}
