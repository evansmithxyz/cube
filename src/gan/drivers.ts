/** Packet decoders for each GAN protocol generation. */

import {
  BitReader,
  FACE_ORDER,
  decodeQuaternion,
  decodeName,
  decodeState,
  type CubeEvent,
  type MoveEvent,
  type ProtocolDriver,
} from './protocol';

// --- Gen2 ---

/**
 * Gen2 (GAN356 i3, GAN12 ui, MoYu AI 2023, ...). Each MOVE packet repeats the last 7
 * turns, so turns lost in transit are recovered from the next packet that arrives.
 */
export class Gen2Driver implements ProtocolDriver {
  private lastSerial = -1;

  handle(plain: Uint8Array): { events: CubeEvent[]; commands: Uint8Array[] } {
    const bits = new BitReader(plain);
    const events: CubeEvent[] = [];
    switch (bits.word(0, 4)) {
      case 0x01: // GYRO
        events.push({ type: 'gyro', quat: decodeQuaternion(bits, 4) });
        break;
      case 0x02: {
        // MOVE: accepted only after the first FACELETS has set a baseline serial
        if (this.lastSerial === -1) break;
        const serial = bits.word(4, 8);
        const count = Math.min((serial - this.lastSerial) & 0xff, 7);
        this.lastSerial = serial;
        for (let i = count - 1; i >= 0; i--) {
          const face = FACE_ORDER[bits.word(12 + 5 * i, 4)];
          if (face) {
            events.push({ type: 'move', serial: (serial - i) & 0xff, face, prime: bits.word(16 + 5 * i, 1) === 1 });
          }
        }
        break;
      }
      case 0x04: {
        // FACELETS
        const serial = bits.word(4, 8);
        const facelets = decodeState(bits, { cp: 12, co: 33, ep: 47, eo: 91 });
        if (facelets) {
          if (this.lastSerial === -1) this.lastSerial = serial;
          events.push({ type: 'facelets', serial, facelets });
        }
        break;
      }
      case 0x05: // HARDWARE
        events.push({ type: 'hardware', name: decodeName(bits, 40, 8) });
        break;
      case 0x09: // BATTERY
        events.push({ type: 'battery', level: Math.min(bits.word(8, 8), 100) });
        break;
    }
    return { events, commands: [] };
  }
}

// --- Gen3 / Gen4 ---

// A live MOVE packet encodes the face as one of these codes; its index is the face.
const MOVE_FACE_CODES = [2, 32, 8, 1, 16, 4];
// A MOVE_HISTORY packet uses a different 3-bit code table for the same faces.
const HISTORY_FACE_CODES = [1, 5, 3, 0, 4, 2];
const FACELETS_MOVE_DEBOUNCE_MS = 500;
const MAX_BUFFER = 16; // stuck moves before giving up and resyncing via FACELETS

/**
 * Where Gen3/Gen4 packets keep things. Gen3 is Gen4's layout shifted by a one-byte
 * 0x55 header, with its own event codes and commands.
 */
export interface SerialLayout {
  /** Required first byte (Gen3's 0x55), if any. */
  magic?: number;
  /** Bits before the event-type byte. */
  shift: number;
  types: { move: number; history: number; facelets: number };
  /** MOVE_HISTORY request for an already aligned serial and count. */
  historyCommand(serial: number, count: number): Uint8Array;
  /** The generation's other events (gyro, battery, hardware). */
  decodeOther(bits: BitReader, type: number, dataLength: number): CubeEvent | null;
}

/**
 * History aligns to an odd serial with an even count, and must not cross the 255 -> 0
 * wrap (a firmware bug spoofs wrapped moves as zeros).
 */
export function alignHistoryRequest(serial: number, count: number): [number, number] {
  serial &= 0xff;
  if (serial % 2 === 0) serial = (serial - 1) & 0xff;
  if (count % 2 === 1) count += 1;
  return [serial, Math.min(count, serial + 1)];
}

function serialInRange(
  start: number,
  end: number,
  serial: number,
  closedStart = false,
  closedEnd = false,
): boolean {
  return (
    ((end - start) & 0xff) >= ((serial - start) & 0xff) &&
    (closedStart || ((start - serial) & 0xff) > 0) &&
    (closedEnd || ((end - serial) & 0xff) > 0)
  );
}

/**
 * Gen3/Gen4 move tracking. Moves carry an 8-bit serial that goes up by one per turn;
 * on a gap, the out-of-order move is held and a MOVE_HISTORY request is returned for
 * the transport to send. Moves are emitted in serial order.
 */
export class SerialDriver implements ProtocolDriver {
  private serial = -1; // latest serial seen (from MOVE or FACELETS)
  private lastSerial = -1; // serial of the last move actually emitted
  private lastMoveMs: number | null = null;
  private buffer: MoveEvent[] = [];
  private commands: Uint8Array[] = [];

  constructor(private readonly layout: SerialLayout) {}

  handle(plain: Uint8Array, nowMs: number): { events: CubeEvent[]; commands: Uint8Array[] } {
    this.commands = [];
    const { magic, shift, types } = this.layout;
    const bits = new BitReader(plain);
    const eventType = bits.word(shift, 8);
    const dataLength = bits.word(shift + 8, 8);
    if (magic !== undefined && (bits.word(0, 8) !== magic || dataLength === 0)) {
      return { events: [], commands: [] };
    }
    let events: CubeEvent[] = [];

    if (eventType === types.move) {
      if (this.lastSerial !== -1) {
        this.lastMoveMs = nowMs;
        this.serial = bits.word(shift + 48, 16, true);
        const face = FACE_ORDER[MOVE_FACE_CODES.indexOf(bits.word(shift + 66, 6))];
        if (face) {
          this.buffer.push({ type: 'move', serial: this.serial, face, prime: bits.word(shift + 64, 2) !== 0 });
        }
        events = this.evict(true);
      }
    } else if (eventType === types.history) {
      // recovered moves, newest first
      const startSerial = bits.word(shift + 16, 8);
      const count = (dataLength - 1) * 2;
      for (let i = 0; i < count; i++) {
        const face = FACE_ORDER[HISTORY_FACE_CODES.indexOf(bits.word(shift + 24 + 4 * i, 3))];
        if (face) {
          this.inject({
            type: 'move',
            serial: (startSerial - i) & 0xff,
            face,
            prime: bits.word(shift + 27 + 4 * i, 1) !== 0,
          });
        }
      }
      events = this.evict(false);
    } else if (eventType === types.facelets) {
      this.serial = bits.word(shift + 16, 16, true);
      if (
        this.lastSerial !== -1 &&
        this.lastMoveMs !== null &&
        nowMs - this.lastMoveMs > FACELETS_MOVE_DEBOUNCE_MS
      ) {
        this.checkIfMoveMissed();
      }
      const facelets = decodeState(bits, { cp: shift + 32, co: shift + 53, ep: shift + 69, eo: shift + 113 });
      if (facelets) {
        if (this.lastSerial === -1) this.lastSerial = this.serial;
        events = [{ type: 'facelets', serial: this.serial, facelets }];
      }
    } else {
      const event = this.layout.decodeOther(bits, eventType, dataLength);
      if (event) events = [event];
    }

    return { events, commands: this.commands };
  }

  private requestHistory(serial: number, count: number): void {
    this.commands.push(this.layout.historyCommand(...alignHistoryRequest(serial, count)));
  }

  /** Emit buffered moves in serial order; request history on a gap. */
  private evict(canRequest: boolean): MoveEvent[] {
    const evicted: MoveEvent[] = [];
    while (this.buffer.length > 0) {
      const head = this.buffer[0];
      const diff = this.lastSerial === -1 ? 1 : (head.serial - this.lastSerial) & 0xff;
      if (diff > 1) {
        if (canRequest) this.requestHistory(head.serial, diff);
        break;
      }
      evicted.push(this.buffer.shift()!);
      this.lastSerial = head.serial;
    }
    if (canRequest && this.buffer.length > MAX_BUFFER) {
      this.buffer = []; // recovery stalled; the next FACELETS resyncs absolute state
    }
    return evicted;
  }

  /** Insert a recovered move into the buffer at the right position. */
  private inject(move: MoveEvent): void {
    if (this.buffer.length > 0) {
      const head = this.buffer[0];
      if (this.buffer.some((m) => m.serial === move.serial)) return;
      if (!serialInRange(this.lastSerial, head.serial, move.serial)) return;
      if (move.serial === ((head.serial - 1) & 0xff)) this.buffer.unshift(move);
    } else if (serialInRange(this.lastSerial, this.serial, move.serial, false, true)) {
      this.buffer.unshift(move);
    }
  }

  private checkIfMoveMissed(): void {
    const diff = (this.serial - this.lastSerial) & 0xff;
    if (diff > 0 && this.serial !== 0) {
      // serial 0 hits a firmware edge case
      const start = this.buffer.length > 0 ? this.buffer[0].serial : (this.serial + 1) & 0xff;
      this.requestHistory(start, diff + 1);
    }
  }
}
