import type { CubeEvent } from './gan/protocol';

export type SmartCubeEvent = CubeEvent | { type: 'disconnect' };

/** A connected cube (real or virtual) that reports turns through an event callback. */
export interface SmartCube {
  readonly name: string;
  /** Tell the cube its current physical state is solved (hold it solved first). */
  markSolved(): Promise<void>;
  disconnect(): void;
}
