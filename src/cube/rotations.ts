/**
 * Whole-cube rotations. The facelet model is relative to the centres (as a smart cube
 * reports it), so rotating the cube doesn't change its state; these re-express a state
 * as seen from another side (say, with the cross face down) and track x / y / z in
 * algorithms.
 */

import { FACE_NORMAL, STICKERS, stickerIndex, type Vec3 } from './facelets';
import { FACES, type Face } from './moves';

/** A rotation, as where each face ends up. */
export type Rotation = Readonly<Record<Face, Face>>;

export const IDENTITY: Rotation = { U: 'U', R: 'R', F: 'F', D: 'D', L: 'L', B: 'B' };
// x turns the cube like R, y like U, z like F.
export const X: Rotation = { U: 'B', R: 'R', F: 'U', D: 'F', L: 'L', B: 'D' };
export const Y: Rotation = { U: 'U', R: 'F', F: 'L', D: 'D', L: 'B', B: 'R' };
export const Z: Rotation = { U: 'R', R: 'D', F: 'F', D: 'L', L: 'U', B: 'B' };

const mapFaces = (fn: (face: Face) => Face) =>
  Object.fromEntries(FACES.map((face) => [face, fn(face)])) as Record<Face, Face>;

const keyOf = (r: Rotation) => FACES.map((face) => r[face]).join('');

/** `a`, then `b`. */
export function compose(a: Rotation, b: Rotation): Rotation {
  return mapFaces((face) => b[a[face]]);
}

/** `r` applied `times` times (negative for the inverse). */
export function power(r: Rotation, times: number): Rotation {
  let out = IDENTITY;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) out = compose(out, r);
  return out;
}

/** All 24 orientations of the cube. */
export const ROTATIONS: Rotation[] = (() => {
  const found = new Map([[keyOf(IDENTITY), IDENTITY]]);
  const queue = [IDENTITY];
  while (queue.length > 0) {
    const r = queue.shift()!;
    for (const step of [X, Y]) {
      const next = compose(r, step);
      if (!found.has(keyOf(next))) {
        found.set(keyOf(next), next);
        queue.push(next);
      }
    }
  }
  return [...found.values()];
})();

/** The rotation that takes each `from` face to its `to` face. */
export function findRotation(...pairs: [from: Face, to: Face][]): Rotation {
  return ROTATIONS.find((r) => pairs.every(([from, to]) => r[from] === to))!;
}

function mapVec(v: Vec3, r: Rotation): Vec3 {
  const out: Vec3 = [0, 0, 0];
  const axes: [number, Face][] = [[v[0], r.R], [v[1], r.U], [v[2], r.F]];
  for (const [amount, face] of axes) {
    for (let i = 0; i < 3; i++) out[i] += amount * FACE_NORMAL[face][i];
  }
  return out;
}

const destinations = new Map<string, number[]>();

/** The state as seen after rotating the whole cube (centres relabelled to match). */
export function rotateState(state: string, r: Rotation): string {
  const key = keyOf(r);
  let dest = destinations.get(key);
  if (!dest) {
    dest = STICKERS.map((s) => stickerIndex(mapVec(s.pos, r), mapVec(s.normal, r)));
    destinations.set(key, dest);
  }
  const out: string[] = new Array(54);
  for (let i = 0; i < 54; i++) out[dest[i]] = r[state[i] as Face];
  return out.join('');
}
