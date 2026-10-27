import { describe, expect, it } from 'vitest';
import { SOLVED, applyMove, applyMoves } from '../cube/facelets';
import type { Move } from '../cube/moves';
import { algToMoves, invertAlg, parseAlg } from '../cube/notation';
import { ROTATIONS } from '../cube/rotations';
import { pllCase } from '../analysis/cases';
import { AlgorithmDrill, type DrillOutcome } from './drill';

const T_PERM = "R U R' U' R' F R2 U' R' U' R U R' F'";

/** The quarter turns a smart cube reports for an algorithm held in `frame`. */
const reported = (alg: string, frame = ROTATIONS[0]): Move[] =>
  algToMoves(parseAlg(alg), frame).moves.flatMap((m) =>
    (m.amount === 2 ? [{ face: m.face, amount: 1 }, { face: m.face, amount: 1 }] : [m]) as Move[],
  );

/** Feed turns 100 ms apart from `t0`; returns every outcome and the final state. */
function play(drill: AlgorithmDrill, state: string, turns: Move[], t0 = 0) {
  const outcomes: DrillOutcome[] = [];
  turns.forEach((move, i) => {
    state = applyMove(state, move);
    outcomes.push(drill.turn(move, state, t0 + i * 100));
  });
  return { outcomes, state };
}

describe('AlgorithmDrill', () => {
  it('times a rep from the first turn until the algorithm is done', () => {
    const drill = new AlgorithmDrill(T_PERM);
    const turns = reported(T_PERM);
    const { outcomes } = play(drill, SOLVED, turns, 1000);
    expect(outcomes.slice(0, -1).every((o) => o === null)).toBe(true);
    expect(outcomes.at(-1)).toEqual({ kind: 'rep', timeMs: (turns.length - 1) * 100, turns: 15 });
    expect(drill.running).toBe(false);
  });

  it('counts back-to-back reps, starting from any state', () => {
    const drill = new AlgorithmDrill(T_PERM);
    const scrambled = applyMoves(SOLVED, parseAlg("R U F' L2 D").map((t) => ({ face: t.letter as Move['face'], amount: t.amount })));
    const first = play(drill, scrambled, reported(T_PERM));
    const second = play(drill, first.state, reported(T_PERM), 5000);
    expect([first.outcomes.at(-1)?.kind, second.outcomes.at(-1)?.kind]).toEqual(['rep', 'rep']);
    expect(second.state).toBe(scrambled);
  });

  it('recognises the algorithm however the cube is held', () => {
    for (const frame of ROTATIONS) {
      const { outcomes } = play(new AlgorithmDrill(T_PERM), SOLVED, reported(T_PERM, frame));
      expect(outcomes.at(-1)?.kind).toBe('rep');
    }
  });

  it("doesn't count an AUF before the algorithm in the time", () => {
    const drill = new AlgorithmDrill(T_PERM);
    const turns = [...reported("U'"), ...reported(T_PERM), ...reported('U2')];
    const { outcomes } = play(drill, SOLVED, turns);
    const done = outcomes.findIndex((o) => o?.kind === 'rep');
    // ends as soon as the T is done (post-AUF not needed), timed from the R after the U'
    expect(done).toBe(15);
    expect(outcomes[done]).toEqual({ kind: 'rep', timeMs: 1400, turns: 15 });
  });

  it('accepts a different algorithm for the same case', () => {
    const slices = 'M2 U M U2 M\' U M2';
    const name = pllCase(applyMoves(SOLVED, algToMoves(invertAlg(parseAlg(slices))).moves)).id;
    const preset = { Ua: "R U' R U R U R U' R' U' R2", Ub: "R2 U R U R' U' R' U' R' U R'" }[name as 'Ua' | 'Ub'];
    expect(preset).toBeDefined();
    const { outcomes } = play(new AlgorithmDrill(preset!), SOLVED, reported(slices));
    expect(outcomes.at(-1)?.kind).toBe('rep');
  });

  it("doesn't end a trigger early when it finishes with a U turn", () => {
    const { outcomes } = play(new AlgorithmDrill("R U R' U'"), SOLVED, reported("R U R' U'"));
    expect(outcomes.map((o) => o?.kind ?? null)).toEqual([null, null, null, 'rep']);
  });

  it('drops a rep that is undone or goes off track', () => {
    const drill = new AlgorithmDrill(T_PERM);
    expect(play(drill, SOLVED, reported("R R'")).outcomes).toEqual([null, null]);
    expect(drill.running).toBe(false);

    const flail = Array.from({ length: 50 }, (_, i) => ({ face: (['R', 'U', 'F'] as const)[i % 3], amount: 1 }) as Move);
    const { outcomes } = play(drill, SOLVED, flail);
    expect(outcomes.filter((o) => o?.kind === 'off-track').length).toBeGreaterThan(0);
    expect(outcomes.some((o) => o?.kind === 'rep')).toBe(false);
  });

  it('rejects notation it cannot read and algorithms that do nothing', () => {
    expect(() => new AlgorithmDrill('R Q')).toThrow();
    expect(() => new AlgorithmDrill("R R'")).toThrow();
    expect(() => new AlgorithmDrill('U2')).toThrow();
  });
});
