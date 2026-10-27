/** The user's own algorithms and every drill rep, kept in localStorage. */

import type { DrillAlg } from './catalog';

export interface DrillRep {
  /** DrillAlg id */
  alg: string;
  timeMs: number;
  turns: number;
  /** epoch ms */
  date: number;
}

const ALGS_KEY = 'cube-timer:drill-algs:v1';
const REPS_KEY = 'cube-timer:drill-reps:v1';

function load<T>(key: string): T[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Could not save drill data', error);
  }
}

export class DrillStore {
  custom: DrillAlg[] = load<DrillAlg>(ALGS_KEY);
  reps: DrillRep[] = load<DrillRep>(REPS_KEY);

  addAlg(name: string, alg: string): DrillAlg {
    const added = { id: `custom-${crypto.randomUUID()}`, name, alg, group: 'My algorithms' };
    this.custom.push(added);
    save(ALGS_KEY, this.custom);
    return added;
  }

  removeAlg(id: string): void {
    this.custom = this.custom.filter((a) => a.id !== id);
    save(ALGS_KEY, this.custom);
    this.clearReps(id);
  }

  addRep(rep: DrillRep): void {
    this.reps.push(rep);
    save(REPS_KEY, this.reps);
  }

  clearReps(alg: string): void {
    this.reps = this.reps.filter((r) => r.alg !== alg);
    save(REPS_KEY, this.reps);
  }

  repsFor(alg: string): DrillRep[] {
    return this.reps.filter((r) => r.alg === alg);
  }
}
