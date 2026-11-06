import { describe, expect, it } from 'vitest';
import { SOLVED, applyMove, applyMoves } from '../cube/facelets';
import type { Move } from '../cube/moves';
import { algToMoves, parseAlg } from '../cube/notation';
import { IDENTITY, ROTATIONS, rotateState, type Rotation } from '../cube/rotations';
import { CASES, caseById, caseFor, invertMoves, setupState, type CaseInfo, type CaseKind } from './algs';
import { ollCase } from '../analysis/cases';
import { LastLayerCoach, type CoachView } from './coach';

const SUNE = caseById('oll-27')!;
const T = caseById('pll-T')!;
const UA = caseById('pll-Ua')!;

interface Report {
  frame?: Rotation;
  /** Report each slice turn's two faces the other way round (L' before R for M). */
  flipSlices?: boolean;
  /** Turn half turns counterclockwise (R' R' for R2). */
  backHalves?: boolean;
}

/** The quarter turns a smart cube reports for an algorithm. */
function reported(alg: string, { frame = IDENTITY, flipSlices = false, backHalves = false }: Report = {}): Move[] {
  const out: Move[] = [];
  let current = frame;
  for (const token of parseAlg(alg)) {
    const { moves, frame: next } = algToMoves([token], current);
    current = next;
    const quarters = moves.map((m): Move[] =>
      m.amount === 2 ? Array(2).fill({ face: m.face, amount: backHalves ? 3 : 1 }) : [m],
    );
    out.push(...(flipSlices ? quarters.reverse() : quarters).flat());
  }
  return out;
}

/** The state that `moves` solve. */
const before = (moves: Move[]) => applyMoves(SOLVED, invertMoves(moves));

function coachAt(state: string, options: { teaches?: (kind: CaseKind) => boolean; algFor?: (info: CaseInfo) => string } = {}) {
  const coach = new LastLayerCoach({ teaches: options.teaches ?? (() => true), algFor: options.algFor ?? ((info) => info.alg) });
  coach.start(state);
  return {
    coach,
    get state() {
      return state;
    },
    /** Turn each move, returning the view after each. */
    play(moves: Move[]): (CoachView | null)[] {
      return moves.map((move) => {
        state = applyMove(state, move);
        coach.turn(move, state);
        return coach.view;
      });
    },
  };
}

const progress = (view: CoachView | null) => view && [view.done, view.current];
const U = (amount: 1 | 2 | 3): Move => ({ face: 'U', amount });

describe('last-layer coach', () => {
  it('shows the case once F2L is done and follows the algorithm turn by turn', () => {
    const run = coachAt(setupState(SUNE.alg));
    expect(run.coach.view).toEqual({ info: SUNE, alg: SUNE.alg, tokens: ['R', 'U', "R'", 'U', 'R', 'U2', "R'"], done: 0, current: [0], hint: null });
    const views = run.play(reported(SUNE.alg)); // R U R' U R U U R'
    expect(views.map(progress)).toEqual([[1, [1]], [2, [2]], [3, [3]], [4, [4]], [5, [5]], [5, [5]], [6, [6]], null]);
    expect(views.slice(0, -1).every((v) => v?.hint === null)).toBe(true);
    expect(run.state).toBe(SOLVED);
  });

  it('shows nothing before F2L is done', () => {
    const f2l = reported("R U R' F2 D L'");
    const run = coachAt(before([...f2l, ...reported(SUNE.alg)]));
    expect(run.coach.view).toBeNull();
    expect(run.play(f2l).map((v) => v?.info?.id)).toEqual([...Array(f2l.length - 1).fill(undefined), SUNE.id]);
  });

  it('follows the algorithm from any side, after any AUF', () => {
    for (const frame of ROTATIONS.filter((r) => r.U === 'U')) {
      for (const auf of [0, 1, 2, 3]) {
        const aufTurns = Array<Move>(auf).fill(U(1));
        const turns = [...aufTurns, ...reported(SUNE.alg, { frame })];
        const run = coachAt(before(turns));
        expect(run.coach.view?.info).toBe(SUNE);
        const views = run.play(turns);
        expect(views.at(-1)).toBeNull();
        expect(views.slice(0, -1).map((v) => v?.hint ?? null)).toEqual(Array(turns.length - 1).fill(null));
        expect(views[auf]?.done).toBe(1); // the first R
      }
    }
  });

  it('spots a wrong angle and says how to start over', () => {
    const run = coachAt(setupState(SUNE.alg)); // lined up already
    const [afterU, afterR] = run.play([U(1), { face: 'R', amount: 1 }]);
    expect(afterU?.hint).toBeNull(); // any AUF is fine until a side turn shows how it's held
    expect(afterR?.hint).toEqual({ kind: 'wrong-angle', moves: "R' U'" });
    const [undone] = run.play([{ face: 'R', amount: 3 }]);
    expect(undone?.hint).toEqual({ kind: 'auf', moves: "U'" }); // now it knows the grip
    const [lined] = run.play([U(3)]);
    expect(lined).toMatchObject({ done: 0, hint: null });
    expect(run.play(reported(SUNE.alg)).at(-1)).toBeNull();
  });

  it('includes the AUF in the way back from a wrong angle', () => {
    const backSune = "L U L' U L U2 L'"; // wants the case turned round compared to the usual Sune
    const run = coachAt(setupState(SUNE.alg), { algFor: () => backSune });
    expect(run.coach.view?.alg).toBe(backSune);
    expect(run.play([{ face: 'L', amount: 1 }])[0]?.hint).toEqual({ kind: 'wrong-angle', moves: "L' U2" });
    const views = run.play([{ face: 'L', amount: 3 }, U(2), ...reported(backSune)]);
    // after L', after U2, then the algorithm's 8 quarter turns: it solves OLL from here, leaving a U2
    expect(views.map((v) => v?.hint ?? null)).toEqual([{ kind: 'auf', moves: 'U2' }, null, ...Array(7).fill(null), { kind: 'finish', moves: 'U2' }]);
  });

  it('says what to undo after a wrong turn', () => {
    const run = coachAt(setupState(SUNE.alg));
    const views = run.play([...reported('R U'), { face: 'F', amount: 1 }]);
    expect(views.at(-1)).toMatchObject({ done: 2, current: [], hint: { kind: 'undo', moves: "F'" } });
    expect(run.play([{ face: 'F', amount: 3 }])[0]).toMatchObject({ done: 2, current: [2], hint: null });
  });

  it('tells the rest of a turn that went the wrong way', () => {
    const run = coachAt(setupState(SUNE.alg));
    const [view] = run.play([{ face: 'R', amount: 3 }]); // R' instead of R
    expect(view).toMatchObject({ done: 0, current: [0], hint: { kind: 'next', moves: 'R2' } });
  });

  it('takes half turns either way and slice turns face by face in either order', () => {
    for (const flipSlices of [false, true]) {
      for (const backHalves of [false, true]) {
        const turns = reported(UA.alg, { flipSlices, backHalves });
        const run = coachAt(before(turns));
        expect(run.coach.view?.info).toBe(UA);
        const views = run.play(turns);
        expect(views.at(-1)).toBeNull();
        expect(views.slice(0, -1).map((v) => v?.hint ?? null)).toEqual(Array(turns.length - 1).fill(null));
        expect(Math.max(...views.slice(0, -1).map((v) => v!.done))).toBe(6);
      }
    }
  });

  it('hands over from OLL to PLL and shows the last AUF', () => {
    const turns = [...reported(SUNE.alg), ...reported(T.alg), U(1)];
    const run = coachAt(before(turns));
    expect(run.coach.view?.info).toBe(SUNE);
    const views = run.play(turns);
    const oll = reported(SUNE.alg).length;
    expect(views[oll - 1]).toMatchObject({ info: T, done: 0, current: [0], hint: null });
    expect(views.at(-2)).toMatchObject({ info: T, done: 14, current: [], hint: { kind: 'finish', moves: 'U' } });
    expect(views.at(-1)).toBeNull();
  });

  it('shows the last turn after a PLL skip', () => {
    const run = coachAt(before([...reported(SUNE.alg), U(2)]));
    const views = run.play(reported(SUNE.alg));
    expect(views.at(-1)).toEqual({ info: null, alg: '', tokens: [], done: 0, current: [], hint: { kind: 'finish', moves: 'U2' } });
  });

  it('works whichever colour the cross is on', () => {
    const turns = [U(1), { face: 'R', amount: 1 } as Move, { face: 'R', amount: 3 } as Move, U(3), ...reported(SUNE.alg), ...reported(T.alg), U(1)];
    const start = before(turns.slice(4)); // the wrong-angle start and its undo cancel out
    const expected = coachAt(start).play(turns);
    for (const r of ROTATIONS) {
      const turned = turns.map((m) => ({ face: r[m.face], amount: m.amount }));
      expect(coachAt(rotateState(start, r)).play(turned)).toEqual(expected);
    }
  });

  it('keeps following an algorithm through a point where F2L is whole again', () => {
    const alg = "F R U R' U' F' f R U R' U' f'";
    const info = caseFor(ollCase(setupState(alg)))!;
    const run = coachAt(setupState(alg), { algFor: (c) => (c === info ? alg : c.alg) });
    const views = run.play(reported("F R U R' U' F'"));
    expect(views.at(-1)).toMatchObject({ info, done: 6, current: [6], hint: null });
    expect(run.play(reported("f R U R' U' f'")).at(-1)).toBeNull();
  });

  it('picks up the new case when an algorithm goes wrong but F2L survives', () => {
    const run = coachAt(setupState(SUNE.alg));
    const views = run.play(reported("U2 R U R' U R U2 R'")); // Sune from the wrong side
    const landed = views.at(-1)!;
    expect(landed.info?.kind).toBe('oll');
    expect(landed.info).not.toBe(SUNE);
    expect(landed).toMatchObject({ done: 0, current: [0], hint: null });
  });

  it('stops spelling out a fix that has grown too long', () => {
    const run = coachAt(setupState(SUNE.alg));
    const flail = Array.from({ length: 12 }, (_, i): Move => ({ face: i % 2 ? 'F' : 'R', amount: 1 }));
    expect(run.play(flail).at(-1)?.hint).toEqual({ kind: 'off-track' });
  });

  it('only teaches the kinds of case it is asked to', () => {
    const turns = [...reported(SUNE.alg), ...reported(T.alg)];
    const run = coachAt(before(turns), { teaches: (kind) => kind === 'pll' });
    expect(run.coach.view).toBeNull();
    expect(run.play(turns)[reported(SUNE.alg).length - 1]?.info).toBe(T);
  });

  it('teaches every case with its default algorithm, from a random side', () => {
    for (const info of CASES) {
      const frame = ROTATIONS.filter((r) => r.U === 'U')[info.alg.length % 4];
      const turns = [U(1), ...reported(info.alg, { frame })];
      const run = coachAt(before(turns));
      expect(run.coach.view?.info?.id).toBe(info.id);
      const views = run.play(turns);
      expect([info.id, views.slice(0, -1).filter((v) => v?.hint).map((v) => v!.hint)]).toEqual([info.id, []]);
      expect([info.id, views.at(-1)]).toEqual([info.id, null]);
    }
  });
});
