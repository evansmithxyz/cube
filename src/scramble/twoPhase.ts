/**
 * Kociemba's two-phase algorithm, the method WCA scramble programs use. Phase 1 brings
 * the cube into the group <U, D, R2, L2, F2, B2>: every piece oriented and the E-slice
 * edges in the E slice. Phase 2 solves it with those turns only. Each phase is an IDA*
 * search over small coordinates, using move tables and distance tables that are built
 * once (about 4 MB, under a second). The first solution comes quickly; the search then
 * keeps looking for shorter ones until one is short enough or time runs out.
 */

import { invert, type Move } from '../cube/moves';
import {
  MOVE_CUBIES,
  flip,
  indexMove,
  orientations,
  permRank,
  permUnrank,
  randomCubie,
  slice,
  sliceEdges,
  twist,
  type Cubie,
} from './cubie';

const N_SLICE = 495; // places for the 4 E-slice edges: 12 choose 4
const N_SLICE_PERM = 24; // orders of the E-slice edges in phase 2: 4!
const ALL_MOVES = Array.from({ length: 18 }, (_, m) => m);
/** Phase 2 turns (indexes into MOVE_CUBIES): U, D and half turns of the sides. */
const PHASE2_MOVES = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16];

interface Tables {
  // Phase 1: move tables (coordinate x move -> coordinate) and distances to the goal.
  twist: Uint16Array;
  flip: Uint16Array;
  slice: Uint16Array;
  twistSlice: Int8Array;
  flipSlice: Int8Array;
  // Phase 2, indexed by position in PHASE2_MOVES.
  corners: Uint16Array;
  edges: Uint16Array;
  slicePerm: Uint16Array;
  cornersSlice: Int8Array;
  edgesSlice: Int8Array;
}

function moveTable(size: number, moves: number[], turn: (coord: number, move: Cubie) => number): Uint16Array {
  const table = new Uint16Array(size * moves.length);
  for (let coord = 0; coord < size; coord++) {
    moves.forEach((m, i) => (table[coord * moves.length + i] = turn(coord, MOVE_CUBIES[m])));
  }
  return table;
}

/** Fewest turns from each (a, b) pair to (0, 0), found breadth first. */
function distanceTable(moveA: Uint16Array, moveB: Uint16Array, sizeB: number, moves: number): Int8Array {
  const size = (moveA.length / moves) * sizeB;
  const dist = new Int8Array(size).fill(-1);
  dist[0] = 0;
  for (let depth = 0, grew = true; grew; depth++) {
    grew = false;
    for (let i = 0; i < size; i++) {
      if (dist[i] !== depth) continue;
      const a = Math.floor(i / sizeB) * moves;
      const b = (i % sizeB) * moves;
      for (let m = 0; m < moves; m++) {
        const j = moveA[a + m] * sizeB + moveB[b + m];
        if (dist[j] === -1) {
          dist[j] = depth + 1;
          grew = true;
        }
      }
    }
  }
  return dist;
}

function buildTables(): Tables {
  const twistMove = moveTable(2187, ALL_MOVES, (coord, m) => {
    const co = orientations(coord, 8, 3);
    return twist(m.cp.map((p, i) => (co[p] + m.co[i]) % 3));
  });
  const flipMove = moveTable(2048, ALL_MOVES, (coord, m) => {
    const eo = orientations(coord, 12, 2);
    return flip(m.ep.map((p, i) => (eo[p] + m.eo[i]) % 2));
  });
  const sliceMove = moveTable(N_SLICE, ALL_MOVES, (coord, m) => {
    const ep = sliceEdges(coord);
    return slice(m.ep.map((p) => ep[p]));
  });
  const cornersMove = moveTable(40320, PHASE2_MOVES, (coord, m) => {
    const cp = permUnrank(coord, 8);
    return permRank(m.cp.map((p) => cp[p]));
  });
  // Phase 2 turns keep the U/D edges in slots 0-7 and the E-slice edges in slots 8-11.
  const edgesMove = moveTable(40320, PHASE2_MOVES, (coord, m) => {
    const ep = [...permUnrank(coord, 8), 8, 9, 10, 11];
    return permRank(m.ep.slice(0, 8).map((p) => ep[p]));
  });
  const slicePermMove = moveTable(N_SLICE_PERM, PHASE2_MOVES, (coord, m) => {
    const ep = [0, 1, 2, 3, 4, 5, 6, 7, ...permUnrank(coord, 4).map((e) => e + 8)];
    return permRank(m.ep.slice(8).map((p) => ep[p]));
  });
  const p2 = PHASE2_MOVES.length;
  return {
    twist: twistMove,
    flip: flipMove,
    slice: sliceMove,
    twistSlice: distanceTable(twistMove, sliceMove, N_SLICE, 18),
    flipSlice: distanceTable(flipMove, sliceMove, N_SLICE, 18),
    corners: cornersMove,
    edges: edgesMove,
    slicePerm: slicePermMove,
    cornersSlice: distanceTable(cornersMove, slicePermMove, N_SLICE_PERM, p2),
    edgesSlice: distanceTable(edgesMove, slicePermMove, N_SLICE_PERM, p2),
  };
}

let cache: Tables | null = null;
const tables = () => (cache ??= buildTables());

export interface SolveOptions {
  /** Stop at the first solution this short. */
  target?: number;
  /** Stop looking for a shorter solution after this many ms, keeping the best so far. */
  timeLimit?: number;
}

/** Turns that solve `cube`: rarely more than 21, often fewer. */
export function solve(cube: Cubie, { target = 21, timeLimit = 2000 }: SolveOptions = {}): Move[] {
  const t = tables();
  const deadline = performance.now() + timeLimit;
  const path: number[] = [];
  let best: number[] | null = null;
  let limit = 30; // longest solution still worth finding; shrinks with each one found
  let done = false;
  let nodes = 0;

  // Faces turn in a canonical order: never the same face twice, and of two opposite
  // faces (which commute) only U before D, R before L, F before B.
  const skip = (face: number, last: number) => face === last || face === last - 3;

  function phase1(tw: number, fl: number, sl: number, depth: number, togo: number, last: number): void {
    if (togo === 0) {
      // Ending on a phase 2 turn means a shorter phase 1 already reached this.
      const m = path[depth - 1];
      const endsOnSideQuarterTurn = m % 9 >= 3 && m % 3 !== 1;
      if (depth === 0 || endsOnSideQuarterTurn) phase2Start(depth);
      return;
    }
    if (best && (++nodes & 0xfff) === 0 && performance.now() > deadline) {
      done = true;
      return;
    }
    for (let face = 0; face < 6; face++) {
      if (skip(face, last)) continue;
      for (let m = 3 * face; m < 3 * face + 3; m++) {
        const tw2 = t.twist[tw * 18 + m];
        const fl2 = t.flip[fl * 18 + m];
        const sl2 = t.slice[sl * 18 + m];
        if (Math.max(t.twistSlice[tw2 * N_SLICE + sl2], t.flipSlice[fl2 * N_SLICE + sl2]) >= togo) continue;
        path[depth] = m;
        phase1(tw2, fl2, sl2, depth + 1, togo - 1, face);
        if (done) return;
      }
    }
  }

  function phase2Start(depth1: number): void {
    let corners = cube.cp;
    let edges = cube.ep;
    for (let i = 0; i < depth1; i++) {
      const m = MOVE_CUBIES[path[i]];
      corners = m.cp.map((p) => corners[p]);
      edges = m.ep.map((p) => edges[p]);
    }
    const co = permRank(corners);
    const ed = permRank(edges.slice(0, 8));
    const sp = permRank(edges.slice(8));
    const last = depth1 > 0 ? Math.floor(path[depth1 - 1] / 3) : -1;
    const from = Math.max(t.cornersSlice[co * N_SLICE_PERM + sp], t.edgesSlice[ed * N_SLICE_PERM + sp]);
    for (let depth2 = from; depth1 + depth2 <= limit; depth2++) {
      if (phase2(co, ed, sp, depth1, depth2, last)) {
        best = path.slice(0, depth1 + depth2);
        limit = best.length - 1;
        done = best.length <= target;
        return;
      }
    }
  }

  function phase2(co: number, ed: number, sp: number, depth: number, togo: number, last: number): boolean {
    if (togo === 0) return co === 0 && ed === 0 && sp === 0;
    for (let i = 0; i < PHASE2_MOVES.length; i++) {
      const face = Math.floor(PHASE2_MOVES[i] / 3);
      if (skip(face, last)) continue;
      const co2 = t.corners[co * 10 + i];
      const ed2 = t.edges[ed * 10 + i];
      const sp2 = t.slicePerm[sp * 10 + i];
      if (Math.max(t.cornersSlice[co2 * N_SLICE_PERM + sp2], t.edgesSlice[ed2 * N_SLICE_PERM + sp2]) >= togo) continue;
      path[depth] = PHASE2_MOVES[i];
      if (phase2(co2, ed2, sp2, depth + 1, togo - 1, face)) return true;
    }
    return false;
  }

  const tw = twist(cube.co);
  const fl = flip(cube.eo);
  const sl = slice(cube.ep);
  const from = Math.max(t.twistSlice[tw * N_SLICE + sl], t.flipSlice[fl * N_SLICE + sl]);
  for (let depth1 = from; depth1 <= limit && !done; depth1++) phase1(tw, fl, sl, 0, depth1, -1);
  return best!.map(indexMove);
}

/**
 * A WCA-style random-state scramble: a cube state picked uniformly at random, solved,
 * and the solution reversed. Every state is equally likely, unlike random turns.
 */
export function randomStateScramble(random: () => number = Math.random, options?: SolveOptions): Move[] {
  return solve(randomCubie(random), options).reverse().map(invert);
}
