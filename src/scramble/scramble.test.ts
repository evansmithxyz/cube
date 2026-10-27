import { describe, expect, it } from 'vitest';
import { SOLVED, applyMoves } from '../cube/facelets';
import { formatMoves, parseMoves, randomScramble, simplify } from '../cube/moves';
import {
  MOVE_CUBIES,
  SOLVED_CUBIE,
  flip,
  fromFacelets,
  moveIndex,
  multiply,
  orientations,
  permRank,
  permUnrank,
  randomCubie,
  slice,
  sliceEdges,
  twist,
} from './cubie';
import { randomStateScramble, solve } from './twoPhase';

/** Small seeded generator (mulberry32) so failures are reproducible. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('cubie model', () => {
  it('reads the solved cube', () => {
    expect(fromFacelets(SOLVED)).toEqual(SOLVED_CUBIE);
  });

  it('agrees with the facelet model on turn sequences', () => {
    const random = seeded(1);
    for (let n = 0; n < 50; n++) {
      const moves = randomScramble(30, random);
      const cube = moves.reduce((c, m) => multiply(c, MOVE_CUBIES[moveIndex(m)]), SOLVED_CUBIE);
      expect(fromFacelets(applyMoves(SOLVED, moves))).toEqual(cube);
    }
  });

  it('matches Kociemba’s R turn', () => {
    // Corners URF<-DFR, UBR<-URF, DRB<-UBR, DFR<-DRB, twisted 2 1 1 2; edges UR<-FR, FR<-DR, DR<-BR, BR<-UR.
    expect(MOVE_CUBIES[moveIndex({ face: 'R', amount: 1 })]).toEqual({
      cp: [4, 1, 2, 0, 7, 5, 6, 3],
      co: [2, 0, 0, 1, 1, 0, 0, 2],
      ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
      eo: Array(12).fill(0),
    });
  });

  it('round-trips every coordinate', () => {
    for (let c = 0; c < 2187; c++) expect(twist(orientations(c, 8, 3))).toBe(c);
    for (let c = 0; c < 2048; c++) expect(flip(orientations(c, 12, 2))).toBe(c);
    for (let c = 0; c < 495; c++) expect(slice(sliceEdges(c))).toBe(c);
    for (let r = 0; r < 40320; r += 7) expect(permRank(permUnrank(r, 8))).toBe(r);
    expect(slice(SOLVED_CUBIE.ep)).toBe(0);
  });

  it('makes only reachable random states', () => {
    const random = seeded(2);
    for (let n = 0; n < 200; n++) {
      const cube = randomCubie(random);
      expect([...cube.cp].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(cube.co.reduce((a, b) => a + b) % 3).toBe(0);
      expect(cube.eo.reduce((a, b) => a + b) % 2).toBe(0);
    }
  });
});

describe('two-phase solver', () => {
  it('solves the solved cube with no turns', () => {
    expect(solve(SOLVED_CUBIE)).toEqual([]);
  });

  it('finds the shortest solution when searching to the end', () => {
    for (const text of ['R', "R U R' U'", "F2 D' L B2 U R'"]) {
      const solution = solve(fromFacelets(applyMoves(SOLVED, parseMoves(text))), { target: 0 });
      expect(applyMoves(applyMoves(SOLVED, parseMoves(text)), solution)).toBe(SOLVED);
      expect(solution.length).toBeLessThanOrEqual(parseMoves(text).length);
    }
  });

  it('makes random-state scrambles that reach the state', () => {
    const random = seeded(3);
    const lengths: number[] = [];
    const started = performance.now();
    for (let n = 0; n < 20; n++) {
      const state = randomCubie(random);
      const scramble = solve(state).reverse().map((m) => ({ ...m, amount: (4 - m.amount) as 1 | 2 | 3 }));
      expect(fromFacelets(applyMoves(SOLVED, scramble))).toEqual(state);
      expect(simplify(scramble)).toEqual(scramble);
      lengths.push(scramble.length);
    }
    console.log(`lengths ${lengths.join(' ')}, ${((performance.now() - started) / 20).toFixed(0)} ms each`);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(22);
  });

  it('formats scrambles in WCA notation', () => {
    const scramble = randomStateScramble(seeded(4));
    expect(parseMoves(formatMoves(scramble))).toEqual(scramble);
  });
});
