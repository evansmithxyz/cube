import { describe, expect, it } from 'vitest';
import { SOLVED, applyMove, applyMoves } from '../cube/facelets';
import type { Move } from '../cube/moves';
import { algToMoves, invertAlg, parseAlg } from '../cube/notation';
import { ROTATIONS, rotateState } from '../cube/rotations';
import { toFacelets } from '../gan/protocol';
import type { TimedMove } from '../timer/solveTimer';
import { PLL_ALGS, ollCase, pllCase, pllStates } from './cases';
import { methodById } from './methods';
import { analyzeSolve } from './splits';

const moves = (alg: string) => algToMoves(parseAlg(alg)).moves;
/** Split half turns into the two quarter turns a smart cube reports. */
const quarters = (list: Move[]): Move[] =>
  list.flatMap((m) => (m.amount === 2 ? [{ face: m.face, amount: 1 }, { face: m.face, amount: 1 }] : [m]) as Move[]);

/** A solve made of segments, each started after a pause, at 100 ms per turn. */
function solve(segments: { alg: string; pause: number }[]): { start: string; log: TimedMove[] } {
  const all = segments.flatMap((s) => moves(s.alg));
  const start = applyMoves(SOLVED, algToMoves(invertAlg(parseAlg(segments.map((s) => s.alg).join(' ')))).moves);
  expect(applyMoves(start, all)).toBe(SOLVED);
  const log: TimedMove[] = [];
  let t = 0;
  for (const [i, segment] of segments.entries()) {
    if (i > 0) t += segment.pause;
    for (const move of quarters(moves(segment.alg))) {
      log.push({ move, t });
      t += 100;
    }
    t -= 100;
  }
  return { start, log };
}

const auf = (state: string, slots: number[]) =>
  [0, 1, 2, 3].some((n) => {
    const turned = n ? applyMove(state, { face: 'U', amount: n as 1 | 2 | 3 }) : state;
    return slots.every((i) => turned[i] === SOLVED[i]);
  });
const LL_CORNERS = [8, 9, 20, 6, 18, 38, 0, 36, 47, 2, 45, 11];
const LL_EDGES = [5, 10, 7, 19, 3, 37, 1, 46];

describe('PLL recognition', () => {
  it('covers every last-layer permutation exactly once', () => {
    // 4! corner x 4! edge arrangements / 2 for parity = 288, split among 21 PLLs + skip
    const table = pllStates();
    expect(table.size).toBe(288);
    expect(new Set(table.values()).size).toBe(22);
    const cfop = methodById('cfop');
    for (const state of table.keys()) expect(cfop.stages[5].done(state)).toBe(true); // F2L + OLL done
  });

  it('names each algorithm’s own case, from any angle', () => {
    for (const [name, alg] of PLL_ALGS) {
      const state = applyMoves(SOLVED, algToMoves(invertAlg(parseAlg(alg))).moves);
      for (const view of [0, 1, 2, 3]) {
        const turned = view ? applyMove(state, { face: 'U', amount: view as 1 | 2 | 3 }) : state;
        expect(pllCase(turned).id).toBe(name);
      }
    }
  });

  it('puts edge-only and corner-only PLLs in the right families', () => {
    for (const [name, alg] of PLL_ALGS) {
      const state = applyMoves(SOLVED, algToMoves(invertAlg(parseAlg(alg))).moves);
      expect([name, auf(state, LL_CORNERS)]).toEqual([name, ['H', 'Z', 'Ua', 'Ub'].includes(name)]);
      // H swaps opposite edges, which a U2 also does, so it's in both families
      expect([name, auf(state, LL_EDGES)]).toEqual([name, ['Aa', 'Ab', 'E', 'H'].includes(name)]);
    }
  });
});

describe('OLL recognition', () => {
  it('finds 57 cases plus the skip', () => {
    const ids = new Set<string>();
    for (let c = 0; c < 27; c++) {
      for (let e = 0; e < 8; e++) {
        const co = [c % 3, Math.floor(c / 3) % 3, Math.floor(c / 9) % 3];
        co.push((3 - ((co[0] + co[1] + co[2]) % 3)) % 3);
        const eo = [e & 1, (e >> 1) & 1, (e >> 2) & 1];
        eo.push((eo[0] + eo[1] + eo[2]) % 2);
        const state = toFacelets([0, 1, 2, 3, 4, 5, 6, 7], [...co, 0, 0, 0, 0], [...Array(12).keys()], [...eo, ...Array(8).fill(0)]);
        ids.add(ollCase(state).id);
      }
    }
    expect(ids.size).toBe(58);
    expect(ids.has('skip')).toBe(true);
  });

  it('gives Sune the same case from every side', () => {
    const sune = applyMoves(SOLVED, moves("R U2 R' U' R U' R'"));
    const ids = [0, 1, 2, 3].map((n) => ollCase(n ? applyMove(sune, { face: 'U', amount: n as 1 | 2 | 3 }) : sune).id);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('stage splits', () => {
  // AUF, look 800 ms, Sune (OLL), look 600 ms, T perm
  const segments = [
    { alg: 'U', pause: 0 },
    { alg: "R U R' U R U2 R'", pause: 800 },
    { alg: "R U R' U' R' F R2 U' R' U' R U R' F'", pause: 600 },
  ];

  it('splits a CFOP last layer with recognition, execution and cases', () => {
    const { start, log } = solve(segments);
    const splits = analyzeSolve(methodById('cfop'), start, log);
    expect(splits.map((s) => s.stage)).toEqual(['Cross', 'F2L 1', 'F2L 2', 'F2L 3', 'F2L 4', 'OLL', 'PLL']);
    const [, , , , , oll, pll] = splits;
    expect(oll).toMatchObject({ recognition: 800, execution: 700, turns: 8 });
    expect(oll.case?.id).toBe(ollCase(applyMove(start, { face: 'U', amount: 1 })).id);
    expect(oll.case?.id).not.toBe('skip');
    expect(pll).toMatchObject({ recognition: 600, execution: 1400, turns: 15, case: { kind: 'pll', id: 'T' } }); // R2 = 2 quarter turns
    expect(pll.at).toBe(log.at(-1)!.t);
  });

  it('finds the same splits whichever face is down', () => {
    const { start, log } = solve(segments);
    const cfop = methodById('cfop');
    const expected = analyzeSolve(cfop, start, log);
    for (const r of ROTATIONS) {
      const turned = log.map(({ move, t }) => ({ move: { face: r[move.face], amount: move.amount }, t }));
      expect(analyzeSolve(cfop, rotateState(start, r), turned)).toEqual(expected);
    }
  });

  it('splits layer by layer', () => {
    const { start, log } = solve(segments);
    const splits = analyzeSolve(methodById('lbl'), start, log);
    expect(splits.map((s) => [s.stage, s.duration])).toEqual([
      ['Cross', 0], ['First layer', 0], ['Second layer', 0], ['Top cross', 0], ['Last layer', log.at(-1)!.t],
    ]);
  });

  it('follows Roux blocks while the M slice is off', () => {
    const { start, log } = solve([
      { alg: 'U', pause: 0 },
      { alg: "R U R' U R U2 R'", pause: 500 }, // CMLL
      { alg: "M' U2 M U2", pause: 300 }, // LSE
    ]);
    const splits = analyzeSolve(methodById('roux'), start, log);
    expect(splits.map((s) => s.stage)).toEqual(['First block', 'Second block', 'CMLL', 'LSE']);
    expect(splits[2]).toMatchObject({ recognition: 500, turns: 8 });
    expect(splits[3]).toMatchObject({ recognition: 300 });
  });

  it('records nothing with no method', () => {
    const { start, log } = solve(segments);
    expect(analyzeSolve(methodById('none'), start, log)).toEqual([]);
  });
});
