/** The user's own algorithm for any last-layer case, kept in localStorage. */

import { checkAlg, type CaseInfo } from './algs';

const STORAGE_KEY = 'cube-timer:ll-algs:v1';

export class LastLayerAlgStore {
  private custom: Record<string, string> = {};

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) this.custom = saved;
    } catch {
      // unreadable or unavailable storage: defaults only
    }
  }

  algFor(info: CaseInfo): string {
    return this.custom[info.id] ?? info.alg;
  }

  isCustom(info: CaseInfo): boolean {
    return info.id in this.custom;
  }

  /** Use `alg` for the case; returns why it can't be used, or null once saved. */
  set(info: CaseInfo, alg: string): string | null {
    const text = alg.trim().replace(/\s+/g, ' ');
    const problem = text ? checkAlg(info, text) : 'Type an algorithm.';
    if (problem) return problem;
    if (text === info.alg) delete this.custom[info.id];
    else this.custom[info.id] = text;
    this.save();
    return null;
  }

  reset(info: CaseInfo): void {
    delete this.custom[info.id];
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.custom));
    } catch (error) {
      console.warn('Could not save algorithms', error);
    }
  }
}
