import { describe, expect, it } from 'vitest';
import { SOLVED, applyMove, applyMoves } from '../cube/facelets';
import { formatMoves, invert, parseMoves, type Move } from '../cube/moves';
import { ScrambleTracker } from './scrambleTracker';
import { SolveTimer, type Attempt } from './solveTimer';
import { formatResult, formatTime, rollingAverages, sessionStats, type Timed } from './stats';
import { decodeMoves, encodeMoves } from './store';

describe('ScrambleTracker', () => {
  const scramble = parseMoves("R U2 F' L");

  it('advances through the scramble', () => {
    const tracker = new ScrambleTracker(scramble);
    expect(tracker.progress()).toEqual({ done: 0, partial: null, fix: [] });
    tracker.turn({ face: 'R', amount: 1 });
    expect(tracker.progress()).toEqual({ done: 1, partial: null, fix: [] });
  });

  it('tracks a half turn done as two quarter turns, either way round', () => {
    for (const amount of [1, 3] as const) {
      const tracker = new ScrambleTracker(scramble);
      tracker.turn({ face: 'R', amount: 1 });
      tracker.turn({ face: 'U', amount });
      expect(tracker.progress()).toEqual({ done: 1, partial: { face: 'U', amount }, fix: [] });
      tracker.turn({ face: 'U', amount });
      expect(tracker.progress().done).toBe(2);
    }
  });

  it('asks to undo a wrong turn, then resumes', () => {
    const tracker = new ScrambleTracker(scramble);
    tracker.turn({ face: 'R', amount: 1 });
    tracker.turn({ face: 'D', amount: 1 });
    expect(formatMoves(tracker.progress().fix)).toBe("D'");
    expect(tracker.progress().done).toBe(1);
    tracker.turn({ face: 'D', amount: 3 });
    expect(tracker.progress()).toEqual({ done: 1, partial: null, fix: [] });
  });

  it('treats an overshoot as a fix', () => {
    const tracker = new ScrambleTracker(scramble);
    tracker.turn({ face: 'R', amount: 3 }); // R' instead of R: need R2 now
    expect(tracker.next()).toEqual({ face: 'R', amount: 2 });
  });
});

describe('SolveTimer', () => {
  const scramble = parseMoves("R U F'");
  const turns = (timer: SolveTimer, state: string, moves: Move[], start: number, step = 100) => {
    moves.forEach((move, i) => {
      state = applyMove(state, move);
      timer.turn(move, state, start + i * step);
    });
    return state;
  };
  const quarterTurns = (moves: Move[]) =>
    moves.flatMap((m) => Array<Move>(m.amount === 2 ? 2 : 1).fill({ face: m.face, amount: m.amount === 3 ? 3 : 1 }));
  const solution = [...scramble].reverse().map(invert);

  function connected(inspection: boolean) {
    const timer = new SolveTimer({ inspection, makeScramble: () => scramble });
    const solves: Attempt[] = [];
    timer.onSolve = (a) => solves.push(a);
    timer.reset(SOLVED);
    return { timer, solves };
  }

  it('runs scramble -> inspection -> solve -> next scramble', () => {
    const { timer, solves } = connected(true);
    expect(timer.phase).toBe('scrambling');
    let state = turns(timer, SOLVED, quarterTurns(scramble), 0);
    expect(timer.phase).toBe('inspection');
    expect(timer.inspectionStart).toBe(200);

    state = turns(timer, state, quarterTurns(solution), 5000, 400);
    expect(state).toBe(SOLVED);
    expect(solves).toHaveLength(1);
    expect(solves[0]).toMatchObject({ timeMs: 800, penalty: 'ok', scramble, start: applyMoves(SOLVED, scramble) });
    expect(solves[0].moves.map((m) => m.t)).toEqual([0, 400, 800]);
    expect(timer.phase).toBe('scrambling');
  });

  it('gives +2 and DNF for slow inspection', () => {
    for (const [startAt, penalty] of [[15_500, '+2'], [17_500, 'dnf']] as const) {
      const { timer, solves } = connected(true);
      const state = turns(timer, SOLVED, quarterTurns(scramble), 0);
      turns(timer, state, quarterTurns(solution), 200 + startAt);
      expect(solves[0].penalty).toBe(penalty);
    }
  });

  it('starts straight away without inspection', () => {
    const { timer } = connected(false);
    turns(timer, SOLVED, quarterTurns(scramble), 0);
    expect(timer.phase).toBe('ready');
  });

  it('waits for a solved cube before scrambling', () => {
    const timer = new SolveTimer({ inspection: false, makeScramble: () => scramble });
    const scrambled = applyMove(SOLVED, { face: 'B', amount: 1 });
    timer.reset(scrambled);
    expect(timer.phase).toBe('unsolved');
    turns(timer, scrambled, [{ face: 'B', amount: 3 }], 0);
    expect(timer.phase).toBe('scrambling');
  });

  it('waits for a scramble that is still being made', () => {
    let ready: Move[] | null = null;
    const timer = new SolveTimer({ inspection: false, makeScramble: () => ready });
    timer.reset(SOLVED);
    expect(timer.waiting).toBe(true);
    // Turns while waiting aren't tracked; the scramble starts once the cube is solved again.
    let state = turns(timer, SOLVED, [{ face: 'L', amount: 1 }], 0);
    ready = scramble;
    timer.scrambleReady(state);
    expect(timer.waiting).toBe(false);
    expect(timer.phase).toBe('unsolved');
    state = turns(timer, state, [{ face: 'L', amount: 3 }], 100);
    turns(timer, state, quarterTurns(scramble), 200);
    expect(timer.phase).toBe('ready');
  });

  it('records a custom scramble when skipped', () => {
    const { timer, solves } = connected(false);
    const state = turns(timer, SOLVED, [{ face: 'L', amount: 1 }], 0);
    timer.skipScramble(100);
    turns(timer, state, [{ face: 'L', amount: 3 }], 1000);
    expect(solves[0]).toMatchObject({ scramble: null, timeMs: 0, start: state });
  });
});

describe('stats', () => {
  const solves = (...times: (number | 'dnf')[]): Timed[] =>
    times.map((t) => (t === 'dnf' ? { timeMs: 1000, penalty: 'dnf' } : { timeMs: t, penalty: 'ok' }));

  it('computes ao5 dropping best and worst', () => {
    expect(rollingAverages(solves(10, 20, 30, 40, 1000), 5)).toEqual([null, null, null, null, 30]);
  });

  it('allows one DNF in an ao5 but not two', () => {
    expect(rollingAverages(solves(10, 20, 30, 40, 'dnf'), 5)[4]).toBe(30);
    expect(rollingAverages(solves(10, 20, 30, 'dnf', 'dnf'), 5)[4]).toBe(Infinity);
  });

  it('adds 2 s for +2', () => {
    expect(sessionStats([{ timeMs: 9000, penalty: '+2' }]).single.best).toBe(11000);
  });

  it('summarises a session', () => {
    const stats = sessionStats(solves(12_000, 'dnf', 10_000, 14_000, 11_000, 13_000));
    expect(stats.count).toBe(6);
    expect(stats.mean).toBe(12_000);
    expect(stats.single).toEqual({ current: 13_000, best: 10_000 });
    // ao5s: (12 DNF 10 14 11) -> mean(12 14 11); (DNF 10 14 11 13) -> mean(14 11 13)
    expect(stats.averages[5].best).toBeCloseTo(12_333.33, 1);
    expect(stats.averages[5].current).toBeCloseTo(12_666.67, 1);
    expect(stats.averages[12].current).toBeNull();
  });

  it('formats times like a stackmat', () => {
    expect(formatTime(9876)).toBe('9.87');
    expect(formatTime(75_430)).toBe('1:15.43');
    expect(formatTime(Infinity)).toBe('DNF');
    expect(formatResult({ timeMs: 9876, penalty: '+2' })).toBe('11.87+');
    expect(formatResult({ timeMs: 9876, penalty: 'dnf' })).toBe('DNF(9.87)');
  });
});

describe('move log encoding', () => {
  it('round-trips', () => {
    const moves = [{ move: { face: 'R', amount: 3 }, t: 0 }, { move: { face: 'U', amount: 1 }, t: 153 }] as const;
    expect(encodeMoves([...moves])).toBe("R'@0 U@153");
    expect(decodeMoves("R'@0 U@153")).toEqual(moves);
  });
});
