/**
 * GAN packet encryption: AES-128-CBC with a per-cube key salted by its MAC, applied
 * as two overlapping 16-byte blocks (head and tail) that each restart from the IV.
 * The same scheme is used by every protocol generation (Gen2, Gen3, Gen4).
 * See https://github.com/pthangeda/cube-real2sim/blob/main/src/cube_real2sim/gan/PROTOCOL.md
 */

import { cbc } from '@noble/ciphers/aes.js';

export interface BaseKey {
  key: number[];
  iv: number[];
}

export const GAN_BASE_KEY: BaseKey = {
  key: [0x01, 0x02, 0x42, 0x28, 0x31, 0x91, 0x16, 0x07, 0x20, 0x05, 0x18, 0x54, 0x42, 0x11, 0x12, 0x53],
  iv: [0x11, 0x03, 0x32, 0x28, 0x21, 0x01, 0x76, 0x27, 0x20, 0x95, 0x78, 0x14, 0x32, 0x12, 0x02, 0x43],
};

/** MoYu AI 2023 ("AiCube_…") speaks GAN Gen2 with its own base key. */
export const MOYU_AI_BASE_KEY: BaseKey = {
  key: [0x05, 0x12, 0x02, 0x45, 0x02, 0x01, 0x29, 0x56, 0x12, 0x78, 0x12, 0x76, 0x81, 0x01, 0x08, 0x03],
  iv: [0x01, 0x44, 0x28, 0x06, 0x86, 0x21, 0x22, 0x28, 0x51, 0x05, 0x08, 0x31, 0x82, 0x02, 0x21, 0x06],
};

export interface CubeKey {
  key: Uint8Array;
  iv: Uint8Array;
}

/** Parse "AB:CD:EF:12:34:56" (colons, dashes or nothing between bytes). */
export function parseMac(mac: string): Uint8Array | null {
  const hex = mac.trim().replace(/[:\-\s]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) return null;
  return Uint8Array.from({ length: 6 }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
}

export function formatMac(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

/** Add the reversed MAC bytes into the first 6 bytes of key and IV (mod 0xFF, as GAN does). */
export function deriveKey(mac: string, base: BaseKey = GAN_BASE_KEY): CubeKey {
  const bytes = parseMac(mac);
  if (!bytes) throw new Error(`Invalid MAC address: ${mac}`);
  const salt = bytes.slice().reverse();
  const key = Uint8Array.from(base.key);
  const iv = Uint8Array.from(base.iv);
  for (let i = 0; i < 6; i++) {
    key[i] = (base.key[i] + salt[i]) % 0xff;
    iv[i] = (base.iv[i] + salt[i]) % 0xff;
  }
  return { key, iv };
}

function crypt(data: Uint8Array, { key, iv }: CubeKey, encrypt: boolean): Uint8Array<ArrayBuffer> {
  if (data.length < 16) throw new Error(`GAN packets are at least 16 bytes, got ${data.length}`);
  const buf = data.slice();
  const block = (offset: number) => {
    const cipher = cbc(key, iv, { disablePadding: true });
    const chunk = buf.slice(offset, offset + 16);
    buf.set(encrypt ? cipher.encrypt(chunk) : cipher.decrypt(chunk), offset);
  };
  const tail = buf.length - 16;
  if (encrypt) {
    block(0);
    if (tail > 0) block(tail);
  } else {
    if (tail > 0) block(tail);
    block(0);
  }
  return buf;
}

export function encrypt(data: Uint8Array, key: CubeKey): Uint8Array<ArrayBuffer> {
  return crypt(data, key, true);
}

export function decrypt(data: Uint8Array, key: CubeKey): Uint8Array<ArrayBuffer> {
  return crypt(data, key, false);
}
