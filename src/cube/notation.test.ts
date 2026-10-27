import { describe, expect, it } from 'vitest';
import { SOLVED, applyMove, applyMoves } from './facelets';
import { formatMoves, parseMoves } from './moves';
import { algToMoves, formatAlg, invertAlg, parseAlg } from './notation';
import { IDENTITY, ROTATIONS, X, Y, Z, compose, findRotation, power, rotateState } from './rotations';

const run = (alg: string, state = SOLVED) => applyMoves(state, algToMoves(parseAlg(alg)).moves);

describe('rotations', () => {
  it('has 24 distinct orientations', () => {
    expect(new Set(ROTATIONS.map((r) => JSON.stringify(r))).size).toBe(24);
  });

  it('x, y and z have order 4', () => {
    for (const r of [X, Y, Z]) expect(power(r, 4)).toEqual(IDENTITY);
    expect(compose(X, power(X, -1))).toEqual(IDENTITY);
  });

  it('leaves a solved cube solved from every side', () => {
    for (const r of ROTATIONS) expect(rotateState(SOLVED, r)).toBe(SOLVED);
  });

  it('sees an R turn as an F turn after y', () => {
    expect(rotateState(applyMove(SOLVED, { face: 'R', amount: 1 }), Y)).toBe(
      applyMove(SOLVED, { face: 'F', amount: 1 }),
    );
  });

  it('commutes with turns, relabelling the face', () => {
    const state = run("R U F' L2 D B");
    for (const r of ROTATIONS) {
      const move = { face: 'R' as const, amount: 1 as const };
      expect(rotateState(applyMove(state, move), r)).toBe(
        applyMove(rotateState(state, r), { face: r[move.face], amount: 1 }),
      );
    }
  });

  it('finds the rotation taking faces where asked', () => {
    const r = findRotation(['F', 'L'], ['U', 'D']);
    expect([r.F, r.U]).toEqual(['L', 'D']);
  });
});

describe('notation', () => {
  it('parses wide, slice and rotation moves', () => {
    expect(formatAlg(parseAlg("(R U R' U') Rw2 r' M2 x' y2 E S'"))).toBe("R U R' U' r2 r' M2 x' y2 E S'");
    expect(() => parseAlg('Q')).toThrow();
  });

  it('inverts', () => {
    expect(formatAlg(invertAlg(parseAlg("R U2 x' M")))).toBe("M' x U2 R'");
  });

  it('turns the face that rotations bring into place', () => {
    expect(formatMoves(algToMoves(parseAlg("y R y'")).moves)).toBe('B');
    expect(formatMoves(algToMoves(parseAlg("x U x'")).moves)).toBe('F');
    expect(formatMoves(algToMoves(parseAlg("z U z'")).moves)).toBe('L');
  });

  it('treats wide and slice turns as the opposite face plus a rotation', () => {
    expect(algToMoves(parseAlg('r'))).toEqual({ moves: parseMoves('L'), frame: algToMoves(parseAlg('x')).frame });
    expect(run('M')).toBe(run("r' R"));
    expect(run('E')).toBe(run("u' U"));
    expect(run('S')).toBe(run("f F'"));
  });

  it('returns order-2 PLLs (with slices and rotations) to solved', () => {
    for (const alg of ['M2 U M2 U2 M2 U M2', "x' R U' R' D R U R' D' R U R' D R U' R' D' x", "R' U R' U' y R' F' R2 U' R' U R' F R F"]) {
      const once = run(alg);
      expect(once).not.toBe(SOLVED);
      expect([alg, run(alg, once)]).toEqual([alg, SOLVED]);
    }
  });

  it('keeps the first two layers through a wide-turn OLL', () => {
    const state = run("r U R' U R U2 r'");
    const f2lStickers = [9, 10, 11, 18, 19, 20, 36, 37, 38, 45, 46, 47, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    const rest = [...Array(54).keys()].filter((i) => !f2lStickers.includes(i));
    expect(rest.every((i) => state[i] === SOLVED[i])).toBe(true);
    expect(state).not.toBe(SOLVED);
  });
});
