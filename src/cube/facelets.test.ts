import { describe, expect, it } from 'vitest';
import { toFacelets } from '../gan/protocol';
import { SOLVED, STICKERS, applyMove, applyMoves } from './facelets';
import { FACES, parseMoves, type Face } from './moves';

// Kociemba's basic moves at the cubie level (hkociemba/RubiksCube-TwophaseSolver, cubie.py).
// Corners URF UFL ULB UBR DFR DLF DBL DRB; edges UR UF UL UB DR DF DL DB FR FL BL BR.
const CUBIE_MOVES: Record<Face, { cp: number[]; co: number[]; ep: number[]; eo: number[] }> = {
  U: {
    cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0),
  },
  R: {
    cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2],
    ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0], eo: Array(12).fill(0),
  },
  F: {
    cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0],
    ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11], eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0],
  },
  D: {
    cp: [0, 1, 2, 3, 5, 6, 7, 4], co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11], eo: Array(12).fill(0),
  },
  L: {
    cp: [0, 2, 6, 3, 4, 1, 5, 7], co: [0, 1, 2, 0, 0, 2, 1, 0],
    ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11], eo: Array(12).fill(0),
  },
  B: {
    cp: [0, 1, 3, 7, 4, 5, 2, 6], co: [0, 0, 1, 2, 0, 0, 2, 1],
    ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7], eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
  },
};

describe('facelet model', () => {
  it('has 54 distinct sticker slots', () => {
    const keys = new Set(STICKERS.map((s) => `${s.pos}|${s.normal}`));
    expect(keys.size).toBe(54);
  });

  it.each(FACES)('%s matches the Kociemba cubie-level definition', (face) => {
    const { cp, co, ep, eo } = CUBIE_MOVES[face];
    expect(applyMove(SOLVED, { face, amount: 1 })).toBe(toFacelets(cp, co, ep, eo));
  });

  it('matches the state a real GAN i4 reports after F R', () => {
    // Ground truth recorded from hardware in cube-real2sim's tests/test_state.py
    expect(applyMoves(SOLVED, parseMoves('F R'))).toBe(
      'UUFUUFLLFUUURRRRRRFFRFFDFFDRRBDDBDDBLLDLLDLLDLBBUBBUBB',
    );
  });

  it('R moves the front column up', () => {
    expect(applyMove(SOLVED, { face: 'R', amount: 1 })).toBe(
      'UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB',
    );
  });

  it.each(FACES)('%s4 and %s %s\' are identity', (face) => {
    let state = SOLVED;
    for (let i = 0; i < 4; i++) state = applyMove(state, { face, amount: 1 });
    expect(state).toBe(SOLVED);
    expect(applyMoves(SOLVED, [{ face, amount: 1 }, { face, amount: 3 }])).toBe(SOLVED);
    expect(applyMoves(SOLVED, [{ face, amount: 2 }, { face, amount: 2 }])).toBe(SOLVED);
  });

  it("(R U R' U') has order 6", () => {
    let state = SOLVED;
    for (let i = 1; i <= 6; i++) {
      state = applyMoves(state, parseMoves("R U R' U'"));
      expect(state === SOLVED).toBe(i === 6);
    }
  });

  it('keeps nine stickers of each color', () => {
    const state = applyMoves(SOLVED, parseMoves("R U2 F' L D2 B R' U F2 B'"));
    expect([...state].sort().join('')).toBe([...SOLVED].sort().join(''));
  });
});
