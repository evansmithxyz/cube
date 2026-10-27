import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, parseMac, type CubeKey } from './crypto';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Independent reference: WebCrypto AES-CBC on one block (dropping the padding block it appends). */
async function referenceBlock({ key, iv }: CubeKey, block: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key.slice(), 'AES-CBC', false, ['encrypt']);
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv.slice() }, cryptoKey, block.slice());
  return new Uint8Array(out).slice(0, 16);
}

describe('GAN crypto', () => {
  it('salts key and IV with the reversed MAC, mod 0xFF', () => {
    // Worked by hand: e.g. key[2] = (0x42 + 0xD7) % 0xFF = 0x1A (not 0x19 as mod 0x100 gives)
    const { key, iv } = deriveKey('C8:17:F5:D7:AE:C3');
    expect(hex(key)).toBe('c4b01a1e485a16072005185442111253');
    expect(hex(iv)).toBe('d4b10a1e38c976272095781432120243');
  });

  it('parses MACs in common formats', () => {
    expect(parseMac('c8-17-f5-d7-ae-c3')).toEqual(parseMac('C8:17:F5:D7:AE:C3'));
    expect(parseMac('C817F5D7AEC3')).toEqual(parseMac('C8:17:F5:D7:AE:C3'));
    expect(parseMac('C8:17:F5:D7:AE')).toBeNull();
  });

  it('encrypts the head block, then the overlapping tail block', async () => {
    const key = deriveKey('11:22:33:44:55:66');
    const plain = Uint8Array.from({ length: 20 }, (_, i) => i * 7);
    const expected = plain.slice();
    expected.set(await referenceBlock(key, expected.slice(0, 16)), 0);
    expected.set(await referenceBlock(key, expected.slice(4, 20)), 4);
    expect(hex(encrypt(plain, key))).toBe(hex(expected));
  });

  it('round-trips 16, 19 and 20 byte packets', () => {
    const key = deriveKey('AB:CD:EF:12:34:56');
    for (const n of [16, 19, 20]) {
      const msg = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 5) & 0xff);
      expect(hex(decrypt(encrypt(msg, key), key))).toBe(hex(msg));
    }
  });
});
