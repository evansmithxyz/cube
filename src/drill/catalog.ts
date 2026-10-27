/** Algorithms to drill: built-in presets plus the user's own. */

import { PLL_ALGS } from '../analysis/cases';

export interface DrillAlg {
  id: string;
  name: string;
  alg: string;
  group: string;
}

export const PRESET_ALGS: DrillAlg[] = [
  ...PLL_ALGS.map(([name, alg]) => ({ id: `pll-${name}`, name: `${name} perm`, alg, group: 'PLL' })),
  { id: 'oll-sune', name: 'Sune', alg: "R U R' U R U2 R'", group: 'OLL' },
  { id: 'oll-antisune', name: 'Antisune', alg: "R U2 R' U' R U' R'", group: 'OLL' },
  { id: 'trigger-sexy', name: 'Sexy move', alg: "R U R' U'", group: 'Triggers' },
  { id: 'trigger-sledge', name: 'Sledgehammer', alg: "R' F R F'", group: 'Triggers' },
];
