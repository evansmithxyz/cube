import { describe, expect, it } from 'vitest';
import { ollCase, pllCase } from '../analysis/cases';
import { f2lDone, ollDone } from '../analysis/methods';
import { toFacelets } from '../gan/protocol';
import { CASES, caseById, caseFor, checkAlg, setupState } from './algs';

const OLLS = CASES.filter((c) => c.kind === 'oll');
const PLLS = CASES.filter((c) => c.kind === 'pll');

/** Every OLL pattern, from all corner and edge twists of the last layer. */
function allOllPatterns(): Set<string> {
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
  ids.delete('skip');
  return ids;
}

describe('last-layer algorithms', () => {
  it('has all 57 OLLs and 21 PLLs', () => {
    expect(OLLS.map((c) => c.name)).toEqual(Array.from({ length: 57 }, (_, i) => `OLL ${i + 1}`));
    expect(PLLS.length).toBe(21);
  });

  it('keeps F2L solved with every default algorithm', () => {
    for (const info of CASES) expect([info.id, f2lDone(setupState(info.alg))]).toEqual([info.id, true]);
  });

  it('gives each OLL algorithm its own pattern, covering every pattern', () => {
    const patterns = OLLS.map((c) => ollCase(setupState(c.alg)).id);
    expect(new Set(patterns).size).toBe(57);
    expect(new Set(patterns)).toEqual(allOllPatterns());
    for (const info of OLLS) expect(caseFor(ollCase(setupState(info.alg)))).toBe(info);
  });

  it('names each PLL algorithm the way the recogniser does', () => {
    for (const info of PLLS) {
      const state = setupState(info.alg);
      expect([info.id, ollDone(state)]).toEqual([info.id, true]);
      expect([info.id, caseFor(pllCase(state))?.id]).toEqual([info.id, info.id]);
    }
  });

  it('accepts any algorithm for the case and explains the ones it rejects', () => {
    const t = caseById('pll-T')!;
    const ua = caseById('pll-Ua')!;
    const sune = caseById('oll-27')!;
    expect(checkAlg(ua, "R U' R U R U R U' R' U' R2")).toBeNull(); // a different Ua
    expect(checkAlg(sune, "L U L' U L U2 L'")).toBeNull(); // Sune from the back
    expect(checkAlg(sune, "y' R' U' R U' R' U2 R")).toMatch(/OLL 26/); // its mirror is the other case
    expect(checkAlg(t, "R U R' U' R' F R2 U' R' U' R U R' F' U2")).toBeNull(); // with an AUF
    expect(checkAlg(t, "R U R' F' R U R' U' R' F R2 U' R'")).toMatch(/Jb perm, not T perm/);
    expect(checkAlg(sune, "R U2 R' U' R U' R'")).toMatch(/OLL 26, not OLL 27/);
    expect(checkAlg(t, "R U R' U R U2 R'")).toMatch(/isn’t a PLL/);
    expect(checkAlg(sune, "R U R'")).toMatch(/first two layers/);
    expect(checkAlg(sune, "U2")).toMatch(/turn any top pieces/);
    expect(checkAlg(t, "U2")).toMatch(/only turns the top/);
    expect(checkAlg(t, 'R Q')).toMatch(/Unknown move/);
  });
});
