/**
 * Keeps a few random-state scrambles ready, made in a worker so the solver never
 * blocks the page. If the worker fails, it falls back to random-turn scrambles.
 */

import { parseMoves, randomScramble, type Move } from '../cube/moves';

export class ScrambleQueue {
  /** Called whenever a scramble arrives. */
  onReady: () => void = () => {};
  private ready: Move[][] = [];
  private requested = 0;
  private failed = false;
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

  constructor(private readonly size = 3) {
    this.worker.addEventListener('message', (event: MessageEvent<string>) => {
      this.requested--;
      this.ready.push(parseMoves(event.data));
      this.onReady();
    });
    this.worker.addEventListener('error', (event) => {
      console.error('Scramble worker failed, using random-turn scrambles', event.message);
      this.failed = true;
      this.onReady();
    });
    this.fill();
  }

  /** The next scramble, or null while it's still being made (onReady fires when it is). */
  take(): Move[] | null {
    if (this.failed) return randomScramble();
    const next = this.ready.shift() ?? null;
    this.fill();
    return next;
  }

  private fill(): void {
    for (; this.ready.length + this.requested < this.size; this.requested++) this.worker.postMessage('next');
  }
}
