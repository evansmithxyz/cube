/** A keyboard-driven stand-in for a smart cube, for trying the app without one. */

import { SOLVED } from './cube/facelets';
import type { Face } from './cube/moves';
import type { SmartCube, SmartCubeEvent } from './smartcube';

// csTimer's virtual-cube layout: right hand turns R/U/F, left hand L/D/B.
export const VIRTUAL_KEYS: Record<string, [Face, boolean]> = {
  i: ['R', false], k: ['R', true],
  j: ['U', false], f: ['U', true],
  h: ['F', false], g: ['F', true],
  d: ['L', false], e: ['L', true],
  s: ['D', false], l: ['D', true],
  w: ['B', false], o: ['B', true],
};

export function connectVirtualCube(onEvent: (event: SmartCubeEvent) => void): SmartCube {
  let serial = 0;
  const reportSolved = () => onEvent({ type: 'facelets', serial, facelets: SOLVED });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
    const turn = VIRTUAL_KEYS[event.key.toLowerCase()];
    if (!turn) return;
    event.preventDefault();
    serial = (serial + 1) & 0xff;
    onEvent({ type: 'move', serial, face: turn[0], prime: turn[1] });
  };
  window.addEventListener('keydown', onKeyDown);
  queueMicrotask(reportSolved);

  return {
    name: 'Virtual cube',
    async markSolved() {
      reportSolved();
    },
    disconnect() {
      window.removeEventListener('keydown', onKeyDown);
      onEvent({ type: 'disconnect' });
    },
  };
}
