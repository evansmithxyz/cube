/**
 * The last-layer coach. Once F2L is done it shows the algorithm for the cube's OLL,
 * then its PLL, and follows the user doing it turn by turn: from any side and after any
 * AUF, half turns either way, and the two sides of a slice turn in either order. It
 * spots a wrong angle or a wrong turn and says how to get back on track.
 *
 * Following works by trying every way the algorithm could be done here (4 ways of
 * holding the cube x 4 AUFs) and, for each, every point part way through it: the
 * closest match says where the user is. A smart cube only sees face turns relative to
 * its centres, so "how the cube is held" is learnt from the first side turn.
 */

import { SOLVED, applyMove, applyMoves } from '../cube/facelets';
import { FACES, formatMoves, sameAxis, simplify, type Face, type Move } from '../cube/moves';
import { algToMoves, formatAlg, parseAlg } from '../cube/notation';
import { ROTATIONS, rotateState, type Rotation } from '../cube/rotations';
import { ollCase, pllCase } from '../analysis/cases';
import { BASE_DOWN, crossDone, f2lDone, ollDone } from '../analysis/methods';
import { caseFor, invertMoves, type CaseInfo, type CaseKind } from './algs';

export type CoachHint =
  /** Turns that get back on track. */
  | { kind: 'undo'; moves: string }
  /** The algorithm was started from the wrong side: turns that go back to the start. */
  | { kind: 'wrong-angle'; moves: string }
  /** What's left of a turn that went wrong (R' instead of R leaves R2). */
  | { kind: 'next'; moves: string }
  /** Turn the top first to line the case up (said once we know how the cube is held). */
  | { kind: 'auf'; moves: string }
  /** Only the top is left to turn. */
  | { kind: 'finish'; moves: string }
  | { kind: 'off-track' };

export interface CoachView {
  /** The case, or null for a PLL skip. */
  info: CaseInfo | null;
  alg: string;
  /** The algorithm's moves as written. */
  tokens: string[];
  /** How many tokens are done. */
  done: number;
  /** Tokens being done now, or the one to do next. */
  current: number[];
  hint: CoachHint | null;
}

export interface CoachOptions {
  teaches(kind: CaseKind): boolean;
  algFor(info: CaseInfo): string;
}

/** The longest way back on track worth spelling out. */
const MAX_FIX = 8;

interface Step {
  /** Index of the algorithm token, or -1 for the AUF before it. */
  token: number;
  moves: Move[];
}

/** One way of doing the algorithm: the cube held one way, after one AUF. */
interface Candidate {
  /** Which centre is in each position when the algorithm starts. */
  grip: Rotation;
  steps: Step[];
  /** frames[j]: how the cube is held after j steps. */
  frames: Rotation[];
  /** prefixes[j]: the turns of the first j steps. */
  prefixes: Move[][];
  /** Whether this solves the case (from the wrong side it doesn't). */
  solves: boolean;
}

/** Where the user is in a candidate. */
interface Fit {
  candidate: Candidate;
  /** Steps done: the point we measure from. */
  at: number;
  /** Turns from the cube's state to the state after `at` steps. */
  rest: Move[];
  /**
   * exact: right after `at` steps. partial: part way through steps `from`..`at` (half
   * of an R2, one side of an M). fix: `rest` undoes turns that aren't in the algorithm.
   */
  kind: 'exact' | 'partial' | 'fix';
  from: number;
}

const RANK = { exact: 0, partial: 1, fix: 2 };

/** Closer to where the user is: on the algorithm beats needing a fix, then fewer turns away, then further along. */
function better(a: Fit, b: Fit): boolean {
  if (a.kind !== b.kind) return RANK[a.kind] < RANK[b.kind];
  if (a.rest.length !== b.rest.length) return a.rest.length < b.rest.length;
  return a.at > b.at;
}

const pick = (fits: Fit[]) => fits.reduce((best, f) => (better(f, best) ? f : best));

/** The first of the steps just before `at` that turn layers on one axis (R and L', or U' and D). */
function groupStart(steps: Step[], at: number): number {
  const axis = steps[at - 1]?.moves[0]?.face;
  if (!axis) return at;
  let from = at;
  while (from > 0 && steps[from - 1].moves.length > 0 && steps[from - 1].moves.every((m) => sameAxis(m.face, axis))) {
    from--;
  }
  return from;
}

function fitOf(candidate: Candidate, undo: Move[]): Fit {
  const { steps, prefixes } = candidate;
  let best: Fit | null = null;
  for (let at = 0; at <= steps.length; at++) {
    if (at > 0 && steps[at - 1].moves.length === 0) continue; // after a rotation: same as before it
    const rest = simplify([...undo, ...prefixes[at]]);
    const from = groupStart(steps, at);
    const inGroup = steps.slice(from, at).flatMap((s) => s.moves.map((m) => m.face));
    const fit: Fit =
      rest.length === 0
        ? { candidate, at, rest, kind: 'exact', from: at }
        : from < at && rest.every((m) => inGroup.includes(m.face))
          ? { candidate, at, rest, kind: 'partial', from }
          : { candidate, at, rest, kind: 'fix', from: at };
    if (!best || better(fit, best)) best = fit;
  }
  return best!;
}

/** Some of the algorithm itself has been turned (not just an AUF). */
const started = (fit: Fit) => fit.candidate.steps.slice(0, fit.at).some((s) => s.token >= 0 && s.moves.length > 0);
/** Every turn of the algorithm is done (only rotations, if anything, are left). */
const finished = (fit: Fit) => fit.kind === 'exact' && fit.candidate.steps.slice(fit.at).every((s) => s.moves.length === 0);

/** A partial turn the user is simply in the middle of (one quarter of R2, one side of M). */
function natural(fit: Fit): boolean {
  const moves = fit.candidate.steps.slice(fit.from, fit.at).flatMap((s) => s.moves);
  return fit.rest.every((r) => moves.some((m) => m.face === r.face && (m.amount === r.amount || m.amount === 2)));
}

const positionOf = (frame: Rotation, centre: Face) => FACES.find((p) => frame[p] === centre)!;
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/** One case being taught: its algorithm and how far along the user is. */
class Lesson {
  readonly tokens: string[];
  private readonly candidates: Candidate[] = [];
  private readonly moves: Move[] = [];
  /** Turns that undo everything since the lesson started. */
  private undo: Move[] = [];
  private fits: Fit[];
  /** How the user holds the cube, once a side turn has shown it. */
  private grip: Rotation | null = null;

  constructor(
    readonly info: CaseInfo,
    readonly alg: string,
    start: string,
    private readonly top: Face,
    solves: (state: string) => boolean,
  ) {
    const tokens = parseAlg(alg);
    this.tokens = tokens.map((t) => formatAlg([t]));
    for (const grip of ROTATIONS.filter((r) => r.U === top)) {
      for (let auf = 0; auf < 4; auf++) {
        const steps: Step[] = auf ? [{ token: -1, moves: [{ face: top, amount: auf as Move['amount'] }] }] : [];
        const frames: Rotation[] = auf ? [grip, grip] : [grip];
        let frame = grip;
        tokens.forEach((token, i) => {
          const out = algToMoves([token], frame);
          steps.push({ token: i, moves: out.moves });
          frame = out.frame;
          frames.push(frame);
        });
        const prefixes: Move[][] = [[]];
        for (const step of steps) prefixes.push([...prefixes.at(-1)!, ...step.moves]);
        this.candidates.push({ grip, steps, frames, prefixes, solves: solves(applyMoves(start, prefixes.at(-1)!)) });
      }
    }
    this.fits = this.candidates.map((c) => fitOf(c, []));
  }

  turn(move: Move): void {
    this.moves.push(move);
    this.undo = simplify(invertMoves(this.moves));
    this.fits = this.candidates.map((c) => fitOf(c, this.undo));
    if (!sameAxis(move.face, this.top)) this.learnGrip();
  }

  /** Part way through the algorithm and on track. */
  midway(): boolean {
    const fit = this.best();
    return fit.kind !== 'fix' && started(fit) && !finished(fit);
  }

  /** Off the algorithm by more than an AUF. */
  lost(): boolean {
    const fit = this.best();
    return fit.kind === 'fix' && !this.onlyAuf(fit);
  }

  view(finish: number): CoachView {
    const fit = this.best();
    const { steps, frames } = fit.candidate;
    const offset = steps.length - this.tokens.length; // 1 when an AUF comes first
    const tokenAt = (step: number) => Math.max(0, step - offset);
    // turns written the way the user holds the cube
    const sayIn = (frame: Rotation, moves: Move[]) =>
      formatMoves(moves.map((m) => ({ face: positionOf(frame, m.face), amount: m.amount })));
    const say = (moves: Move[]) => sayIn(frames[fit.at], moves);

    let done = tokenAt(fit.kind === 'partial' ? fit.from : fit.at);
    let current: number[] = [];
    if (finish || finished(fit)) done = this.tokens.length;
    else if (fit.kind === 'partial') current = range(done, tokenAt(fit.at));
    else if (fit.kind === 'exact') current = [done];

    let hint: CoachHint | null = null;
    if (finish) {
      hint = { kind: 'finish', moves: formatMoves([{ face: 'U', amount: finish as Move['amount'] }]) };
    } else if (fit.kind === 'fix') {
      const restart = this.wrongAngle() ? this.restart() : null;
      if ((restart?.moves ?? fit.rest).length > MAX_FIX) hint = { kind: 'off-track' };
      else if (restart) hint = { kind: 'wrong-angle', moves: sayIn(restart.grip, restart.moves) };
      else if (this.onlyAuf(fit)) hint = this.grip ? { kind: 'auf', moves: say(fit.rest) } : null;
      else hint = { kind: 'undo', moves: say(fit.rest) };
    } else if (fit.kind === 'partial') {
      if (fit.at <= offset) hint = this.grip ? { kind: 'auf', moves: say(fit.rest) } : null;
      else if (!natural(fit)) hint = { kind: 'next', moves: say(fit.rest) };
    } else if (fit.at < offset && this.grip) {
      hint = { kind: 'auf', moves: say(steps[0].moves) };
    }
    return { info: this.info, alg: this.alg, tokens: this.tokens, done, current, hint };
  }

  /** Where the user is, among the ways of doing it that solve the case (held as they hold it, if known). */
  private best(): Fit {
    const solving = this.fits.filter((f) => f.candidate.solves);
    const held = solving.filter((f) => f.candidate.grip === this.grip);
    return pick(held.length ? held : solving.length ? solving : this.fits);
  }

  /** The user is following the algorithm, but from a side it doesn't solve the case from. */
  private wrongAngle(): boolean {
    return this.fits.some((f) => !f.candidate.solves && f.kind !== 'fix' && started(f));
  }

  /** The way back to the start of the algorithm, lined up so that it works (AUF included). */
  private restart(): { grip: Rotation; moves: Move[] } {
    const ways = this.candidates
      .filter((c) => c.solves && (!this.grip || c.grip === this.grip))
      .map((c) => ({ grip: c.grip, moves: simplify([...this.undo, ...c.prefixes[c.steps.length - this.tokens.length]]) }));
    if (ways.length === 0) return { grip: this.grip ?? this.candidates[0].grip, moves: this.undo };
    return ways.reduce((best, way) => (way.moves.length < best.moves.length ? way : best));
  }

  /** Nothing to fix but which way the top is turned, before the algorithm starts. */
  private onlyAuf(fit: Fit): boolean {
    const offset = fit.candidate.steps.length - this.tokens.length;
    return fit.at <= offset && fit.rest.every((m) => m.face === this.top);
  }

  /** After a side turn: if one way of holding the cube explains the turns so far, that's the grip. */
  private learnGrip(): void {
    const best = pick(this.fits);
    if (best.kind === 'fix' || !started(best)) return;
    const tied = this.fits.some((f) => f.candidate.grip !== best.candidate.grip && !better(best, f));
    if (!tied) this.grip = best.candidate.grip;
  }
}

export class LastLayerCoach {
  /** The rotation that puts the cross face down, found once F2L is done. */
  private base: Rotation | null = null;
  /** Where a cross was first seen, to break a tie between bases. */
  private crossBase: Rotation | null = null;
  /** The centre on top, with the cross down. */
  private top: Face = 'U';
  private lesson: Lesson | null = null;
  /** Quarter turns of the top that solve the cube, when that's all that's left. */
  private finish = 0;

  constructor(readonly options: CoachOptions) {}

  /** Watch a new attempt, starting from this state. */
  start(state: string): void {
    this.stop();
    this.look(state);
  }

  stop(): void {
    this.base = null;
    this.crossBase = null;
    this.lesson = null;
    this.finish = 0;
  }

  turn(move: Move, state: string): void {
    this.lesson?.turn(move);
    this.look(state);
  }

  /** The state jumped without reported turns (a resync): follow on from it. */
  resync(state: string): void {
    this.lesson = null;
    this.finish = 0;
    this.look(state);
  }

  get view(): CoachView | null {
    const { lesson, finish } = this;
    if (lesson) return this.options.teaches(lesson.info.kind) ? lesson.view(finish) : null;
    if (finish && this.options.teaches('pll')) {
      const hint: CoachHint = { kind: 'finish', moves: formatMoves([{ face: 'U', amount: finish as Move['amount'] }]) };
      return { info: null, alg: '', tokens: [], done: 0, current: [], hint };
    }
    return null;
  }

  private look(state: string): void {
    this.base ??= this.findBase(state);
    if (!this.base) return;
    const view = rotateState(state, this.base);
    if (!f2lDone(view)) return; // part way through an algorithm, or off track
    this.finish = 0;
    if (state === SOLVED) {
      this.lesson = null;
    } else if (!ollDone(view)) {
      this.teach(caseFor(ollCase(view)), state);
    } else {
      const found = pllCase(view);
      if (found.id !== 'skip') {
        this.teach(caseFor(found), state);
      } else {
        this.finish = [1, 2, 3].find((q) => applyMove(state, { face: this.top, amount: q as Move['amount'] }) === SOLVED)!;
        if (this.lesson?.info.kind !== 'pll') this.lesson = null;
      }
    }
  }

  /** At a point with F2L done: keep the current lesson if the user is still on it, else start this case's. */
  private teach(info: CaseInfo | undefined, state: string): void {
    const { lesson } = this;
    if (lesson) {
      const ollFinished = lesson.info.kind === 'oll' && info?.kind === 'pll';
      if (lesson.midway() && !ollFinished) return; // passing such a point part way through
      if (lesson.info === info && !lesson.lost()) return; // e.g. after an AUF
    }
    this.lesson = info ? new Lesson(info, this.options.algFor(info), state, this.top, this.solves(info.kind)) : null;
  }

  /** Whether a state counts as the case solved: OLL oriented with F2L kept, PLL solved up to an AUF. */
  private solves(kind: CaseKind): (state: string) => boolean {
    const base = this.base!;
    const top = this.top;
    if (kind === 'oll') return (state) => ollDone(rotateState(state, base));
    return (state) => [0, 1, 2, 3].some((q) => (q ? applyMove(state, { face: top, amount: q as Move['amount'] }) : state) === SOLVED);
  }

  private findBase(state: string): Rotation | null {
    const views = BASE_DOWN.map((frame) => ({ frame, view: rotateState(state, frame) }));
    this.crossBase ??= views.find((v) => crossDone(v.view))?.frame ?? null;
    const ready = views.filter((v) => f2lDone(v.view)).map((v) => v.frame);
    const base = ready.find((f) => f === this.crossBase) ?? ready[0];
    if (!base) return null;
    this.top = FACES.find((face) => base[face] === 'U')!;
    return base;
  }
}
