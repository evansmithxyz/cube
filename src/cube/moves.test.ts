import { describe, expect, it } from 'vitest';
import { formatMoves, parseMoves, randomScramble, sameAxis, simplify } from './moves';

describe('moves', () => {
  it('parses and formats WCA notation', () => {
    expect(formatMoves(parseMoves("R U2 F' L2' D'2  B"))).toBe("R U2 F' L2 D2 B");
    expect(() => parseMoves('M')).toThrow();
  });

  it('simplifies same-face and commuting turns', () => {
    expect(formatMoves(simplify(parseMoves("R R")))).toBe('R2');
    expect(formatMoves(simplify(parseMoves("R R'")))).toBe('');
    expect(formatMoves(simplify(parseMoves("R2 R")))).toBe("R'");
    expect(formatMoves(simplify(parseMoves("R L R")))).toBe('R2 L');
    expect(formatMoves(simplify(parseMoves("L' R2 L U")))).toBe('R2 U');
    expect(formatMoves(simplify(parseMoves("R U R")))).toBe('R U R');
  });

  it('makes scrambles that never cancel', () => {
    for (let n = 0; n < 200; n++) {
      const scramble = randomScramble(25);
      expect(scramble).toHaveLength(25);
      expect(simplify(scramble)).toEqual(scramble);
      for (let i = 2; i < scramble.length; i++) {
        const [a, b, c] = scramble.slice(i - 2, i + 1);
        expect(sameAxis(a.face, b.face) && sameAxis(b.face, c.face)).toBe(false);
      }
    }
  });
});
