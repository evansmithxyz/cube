/**
 * Pieces shared by GAN's smart-cube protocols. Every generation encrypts the same way
 * (crypto.ts); they differ in BLE UUIDs and packet layout (generations.ts, drivers.ts).
 * Ported from cube-real2sim's protocol.py and afedotov/gan-web-bluetooth.
 */

import type { Face } from '../cube/moves';
import { formatMac } from './crypto';

/** Face order GAN uses for face indices. */
export const FACE_ORDER: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

/** Read big-endian bit fields; multi-byte fields may be stored little-endian. */
export class BitReader {
  constructor(private readonly data: Uint8Array) {}

  word(start: number, length: number, littleEndian = false): number {
    if (length <= 8 || !littleEndian) return this.bits(start, length);
    let value = 0;
    for (let i = length / 8 - 1; i >= 0; i--) value = value * 256 + this.bits(start + 8 * i, 8);
    return value;
  }

  private bits(start: number, length: number): number {
    let value = 0;
    for (let i = start; i < start + length; i++) {
      value = value * 2 + ((this.data[i >> 3] >> (7 - (i & 7))) & 1);
    }
    return value;
  }
}

// --- events ---

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export type CubeEvent =
  | { type: 'move'; serial: number; face: Face; prime: boolean }
  | { type: 'facelets'; serial: number; facelets: string }
  | { type: 'gyro'; quat: Quaternion }
  | { type: 'battery'; level: number }
  | { type: 'hardware'; name: string };

export type MoveEvent = Extract<CubeEvent, { type: 'move' }>;

/** Turns decrypted packets into events, plus raw commands to send back (move-history requests). */
export interface ProtocolDriver {
  handle(plain: Uint8Array, nowMs: number): { events: CubeEvent[]; commands: Uint8Array[] };
}

// --- facelet (full-state) decoding ---

const CORNER_FACELETS = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
const EDGE_FACELETS = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];
const FACE_LETTERS = 'URFDLB';

/** Corner/edge permutation + orientation (Kociemba order) to a facelet string. */
export function toFacelets(cp: number[], co: number[], ep: number[], eo: number[]): string {
  const out = Array.from({ length: 54 }, (_, i) => FACE_LETTERS[Math.floor(i / 9)]);
  for (let i = 0; i < 8; i++) {
    for (let p = 0; p < 3; p++) {
      out[CORNER_FACELETS[i][(p + co[i]) % 3]] =
        FACE_LETTERS[Math.floor(CORNER_FACELETS[cp[i]][p] / 9)];
    }
  }
  for (let i = 0; i < 12; i++) {
    for (let p = 0; p < 2; p++) {
      out[EDGE_FACELETS[i][(p + eo[i]) % 2]] = FACE_LETTERS[Math.floor(EDGE_FACELETS[ep[i]][p] / 9)];
    }
  }
  return out.join('');
}

/** Bit offsets of the 7 corners and 11 edges in a state packet (the last of each is inferred). */
export interface StateOffsets {
  cp: number;
  co: number;
  ep: number;
  eo: number;
}

const isPermutation = (p: number[]) =>
  [...p].sort((a, b) => a - b).every((value, index) => value === index);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Decode a state packet, or null if it isn't a valid cube state (e.g. wrong key). */
export function decodeState(bits: BitReader, at: StateOffsets): string | null {
  const cp: number[] = [];
  const co: number[] = [];
  const ep: number[] = [];
  const eo: number[] = [];
  for (let i = 0; i < 7; i++) {
    cp.push(bits.word(at.cp + i * 3, 3));
    co.push(bits.word(at.co + i * 2, 2));
  }
  cp.push(28 - sum(cp));
  co.push((3 - (sum(co) % 3)) % 3);
  for (let i = 0; i < 11; i++) {
    ep.push(bits.word(at.ep + i * 4, 4));
    eo.push(bits.word(at.eo + i, 1));
  }
  ep.push(66 - sum(ep));
  eo.push((2 - (sum(eo) % 2)) % 2);
  if (!isPermutation(cp) || !isPermutation(ep) || co.some((c) => c > 2)) return null;
  return toFacelets(cp, co, ep, eo);
}

// Signed-magnitude 16-bit component -> [-1, 1]
const decodeQ = (raw: number) => (1 - (raw >> 15) * 2) * (raw & 0x7fff) / 0x7fff;

/** Four consecutive 16-bit components w, x, y, z. GAN's axes: +x red, +y blue, +z white. */
export function decodeQuaternion(bits: BitReader, start: number): Quaternion {
  return {
    w: decodeQ(bits.word(start, 16)),
    x: decodeQ(bits.word(start + 16, 16)),
    y: decodeQ(bits.word(start + 32, 16)),
    z: decodeQ(bits.word(start + 48, 16)),
  };
}

export function decodeName(bits: BitReader, start: number, length: number): string {
  let name = '';
  for (let i = 0; i < length; i++) name += String.fromCharCode(bits.word(start + i * 8, 8));
  return name.replace(/\0+$/, '');
}

// --- MAC recovery from advertisement data ---

/** GAN names end in the last two MAC bytes, e.g. "GANi4_AEC3" -> [0xAE, 0xC3]. */
export function nameSuffixBytes(name: string | undefined): [number, number] | null {
  const match = /_([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(name ?? '');
  return match ? [parseInt(match[1], 16), parseInt(match[2], 16)] : null;
}

/**
 * Recover the cube's MAC from manufacturer data (company ids ending in 0x01). The MAC
 * is stored little-endian; prefer the window whose last two bytes match the name
 * suffix, else fall back to the fixed offset of 3.
 */
export function extractMac(
  manufacturerData: ReadonlyMap<number, DataView>,
  name?: string,
): string | null {
  const suffix = nameSuffixBytes(name);
  for (const [companyId, view] of manufacturerData) {
    if ((companyId & 0xff) !== 0x01) continue;
    const payload = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    if (suffix) {
      for (let off = 0; off + 6 <= payload.length; off++) {
        if (payload[off] === suffix[1] && payload[off + 1] === suffix[0]) {
          return formatMac(payload.slice(off, off + 6).reverse());
        }
      }
    }
    if (payload.length >= 9) return formatMac(payload.slice(3, 9).reverse());
  }
  return null;
}
