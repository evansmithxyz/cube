// Makes random-state scrambles off the page's thread: the solver's first call builds its
// tables, which takes about a second. Each message asks for one scramble.

import { formatMoves } from '../cube/moves';
import { randomStateScramble } from './twoPhase';

addEventListener('message', () => {
  postMessage(formatMoves(randomStateScramble()));
});
