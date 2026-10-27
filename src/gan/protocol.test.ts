/**
 * Gen3/Gen4 driver tests are ported from cube-real2sim's tests/test_protocol.py and run
 * against both layouts; Gen2 and the shared decoders are checked against packet
 * layouts from afedotov/gan-web-bluetooth.
 */

import { describe, expect, it } from 'vitest';
import { SOLVED, applyMove } from '../cube/facelets';
import { FACES } from '../cube/moves';
import { alignHistoryRequest } from './drivers';
import { GEN2, GEN3, GEN4, findProtocol, type GanProtocol } from './generations';
import { BitReader, extractMac, type CubeEvent } from './protocol';

const MOVE_FACE_CODES = [2, 32, 8, 1, 16, 4];
const HISTORY_FACE_CODES = [1, 5, 3, 0, 4, 2];
// Kociemba R (first 7 corners / 11 edges; the last of each is inferred)
const R_STATE = { cp: [4, 1, 2, 0, 7, 5, 6], co: [2, 0, 0, 1, 1, 0, 0], ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10], eo: Array(11).fill(0) };
const SOLVED_STATE = { cp: [0, 1, 2, 3, 4, 5, 6], co: Array(7).fill(0), ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], eo: Array(11).fill(0) };
const R_FACELETS = applyMove(SOLVED, { face: 'R', amount: 1 });

/** Write a big-endian bit field (16/32-bit fields optionally little-endian by byte). */
function set(buf: Uint8Array, start: number, length: number, value: number, littleEndian = false) {
  if (littleEndian && (length === 16 || length === 32)) {
    for (let i = 0; i < length / 8; i++) set(buf, start + 8 * i, 8, Math.floor(value / 256 ** i) & 0xff);
    return;
  }
  for (let i = 0; i < length; i++) {
    const bit = Math.floor(value / 2 ** (length - 1 - i)) & 1;
    const pos = start + i;
    const mask = 1 << (7 - (pos % 8));
    if (bit) buf[pos >> 3] |= mask;
    else buf[pos >> 3] &= ~mask;
  }
}

function writeState(buf: Uint8Array, at: { cp: number; co: number; ep: number; eo: number }, state = SOLVED_STATE) {
  for (let i = 0; i < 7; i++) {
    set(buf, at.cp + i * 3, 3, state.cp[i]);
    set(buf, at.co + i * 2, 2, state.co[i]);
  }
  for (let i = 0; i < 11; i++) {
    set(buf, at.ep + i * 4, 4, state.ep[i]);
    set(buf, at.eo + i, 1, state.eo[i]);
  }
}

const notations = (events: CubeEvent[]) =>
  events.flatMap((e) => (e.type === 'move' ? [e.face + (e.prime ? "'" : '')] : []));

describe('BitReader', () => {
  it('reads big-endian fields and little-endian multi-byte fields', () => {
    const bits = new BitReader(Uint8Array.from([0b1010_1100, 0x34, 0x12]));
    expect(bits.word(0, 3)).toBe(0b101);
    expect(bits.word(3, 5)).toBe(0b01100);
    expect(bits.word(8, 16)).toBe(0x3412);
    expect(bits.word(8, 16, true)).toBe(0x1234);
  });
});

describe('findProtocol', () => {
  it('picks the generation from the offered services', () => {
    expect(findProtocol(['00001800-0000-1000-8000-00805f9b34fb', GEN3.service])).toBe(GEN3);
    expect(findProtocol([GEN4.service.toUpperCase()])).toBe(GEN4);
    expect(findProtocol([GEN2.service])).toBe(GEN2);
    expect(findProtocol(['00001800-0000-1000-8000-00805f9b34fb'])).toBeUndefined();
  });
});

// --- Gen3 / Gen4 ---

interface SerialFormat {
  protocol: GanProtocol;
  shift: number;
  magic?: number;
  types: { move: number; history: number; facelets: number };
  historyPrefix: number[];
}

const SERIAL_FORMATS: SerialFormat[] = [
  { protocol: GEN3, shift: 8, magic: 0x55, types: { move: 0x01, history: 0x06, facelets: 0x02 }, historyPrefix: [0x68, 0x03] },
  { protocol: GEN4, shift: 0, types: { move: 0x01, history: 0xd1, facelets: 0xed }, historyPrefix: [0xd1, 0x04] },
];

describe.each(SERIAL_FORMATS)('$protocol.name driver', (format) => {
  const { shift, types } = format;

  function packet(type: number, dataLength = 1): Uint8Array {
    const buf = new Uint8Array(20);
    if (format.magic !== undefined) set(buf, 0, 8, format.magic);
    set(buf, shift, 8, type);
    set(buf, shift + 8, 8, dataLength);
    return buf;
  }

  function faceletsPacket(serial: number, state = SOLVED_STATE): Uint8Array {
    const buf = packet(types.facelets);
    set(buf, shift + 16, 16, serial, true);
    writeState(buf, { cp: shift + 32, co: shift + 53, ep: shift + 69, eo: shift + 113 }, state);
    return buf;
  }

  function movePacket(serial: number, faceIndex: number, prime: boolean): Uint8Array {
    const buf = packet(types.move);
    set(buf, shift + 48, 16, serial, true);
    set(buf, shift + 64, 2, Number(prime));
    set(buf, shift + 66, 6, MOVE_FACE_CODES[faceIndex]);
    return buf;
  }

  /** Moves newest-first; the real cube always sends an even count. */
  function historyPacket(startSerial: number, moves: [number, boolean][]): Uint8Array {
    const buf = packet(types.history, moves.length / 2 + 1);
    set(buf, shift + 16, 8, startSerial);
    moves.forEach(([faceIndex, prime], i) => {
      set(buf, shift + 24 + 4 * i, 3, HISTORY_FACE_CODES[faceIndex]);
      set(buf, shift + 27 + 4 * i, 1, Number(prime));
    });
    return buf;
  }

  const historyCommand = (serial: number, count: number) => [...format.historyPrefix, serial, 0, count, 0];

  it('decodes a move after the FACELETS baseline', () => {
    const d = format.protocol.createDriver();
    expect(d.handle(movePacket(5, 0, false), 0).events).toEqual([]);
    d.handle(faceletsPacket(5), 10);
    expect(d.handle(movePacket(6, 2, true), 20).events).toEqual([
      { type: 'move', serial: 6, face: 'F', prime: true },
    ]);
  });

  it('maps every face code', () => {
    const d = format.protocol.createDriver();
    d.handle(faceletsPacket(0), 0);
    const seen = FACES.map((_, i) => notations(d.handle(movePacket(i + 1, i, false), 10).events)[0]);
    expect(seen).toEqual([...FACES]);
  });

  it('decodes solved and R states', () => {
    const d = format.protocol.createDriver();
    expect(d.handle(faceletsPacket(7), 0).events).toEqual([{ type: 'facelets', serial: 7, facelets: SOLVED }]);
    expect(d.handle(faceletsPacket(8, R_STATE), 0).events).toEqual([
      { type: 'facelets', serial: 8, facelets: R_FACELETS },
    ]);
  });

  it('rejects a state that is not a permutation (e.g. decrypted with the wrong key)', () => {
    const broken = { ...SOLVED_STATE, cp: [1, 1, 2, 3, 4, 5, 6] };
    expect(format.protocol.createDriver().handle(faceletsPacket(3, broken), 0).events).toEqual([]);
  });

  it('requests history on a gap and delivers recovered moves in order', () => {
    const d = format.protocol.createDriver();
    d.handle(faceletsPacket(10), 0);
    const { events, commands } = d.handle(movePacket(13, 2, false), 10); // 11, 12 dropped
    expect(events).toEqual([]);
    expect(commands.map((c) => Array.from(c.slice(0, 6)))).toEqual([historyCommand(13, 4)]);

    // newest-first: 13=F, 12=U, 11=R, 10=D (10 was already emitted, so rejected)
    const hist = historyPacket(13, [[2, false], [0, false], [1, false], [3, false]]);
    expect(notations(d.handle(hist, 20).events)).toEqual(['R', 'U', 'F']);
  });

  it('checks for missed moves when a late FACELETS shows a newer serial', () => {
    const d = format.protocol.createDriver();
    d.handle(faceletsPacket(10), 0);
    d.handle(movePacket(11, 0, false), 10);
    const { commands } = d.handle(faceletsPacket(12), 900); // move 12 never arrived
    expect(commands.map((c) => Array.from(c.slice(0, 6)))).toEqual([historyCommand(13, 2)]);
    expect(notations(d.handle(historyPacket(13, [[1, false], [4, true]]), 910).events)).toEqual(["L'"]);
  });
});

describe('Gen4 extras', () => {
  const handle = (packet: Uint8Array) => GEN4.createDriver().handle(packet, 0).events;

  it('decodes gyro, battery and hardware name', () => {
    const gyro = new Uint8Array(20);
    set(gyro, 0, 8, 0xec);
    set(gyro, 16, 16, 0x7fff);
    set(gyro, 32, 16, 0x8000 | 0x3fff); // negative half
    const [event] = handle(gyro);
    expect(event.type === 'gyro' && [event.quat.w, event.quat.x].map((v) => +v.toFixed(3))).toEqual([1, -0.5]);

    const battery = new Uint8Array(20);
    set(battery, 0, 8, 0xef);
    set(battery, 8, 8, 1);
    set(battery, 16, 8, 87);
    expect(handle(battery)).toEqual([{ type: 'battery', level: 87 }]);

    const hardware = new Uint8Array(20);
    set(hardware, 0, 8, 0xfc);
    set(hardware, 8, 8, 6);
    [...'GANi4'].forEach((ch, i) => set(hardware, 24 + 8 * i, 8, ch.charCodeAt(0)));
    expect(handle(hardware)).toEqual([{ type: 'hardware', name: 'GANi4' }]);
  });
});

describe('Gen3 extras', () => {
  const handle = (packet: Uint8Array) => GEN3.createDriver().handle(packet, 0).events;

  it('decodes battery and hardware name', () => {
    const battery = Uint8Array.from([0x55, 0x10, 0x01, 64, ...Array(12).fill(0)]);
    expect(handle(battery)).toEqual([{ type: 'battery', level: 64 }]);
    const hardware = Uint8Array.from([0x55, 0x07, 0x08, 0, ...[...'GANi4'].map((c) => c.charCodeAt(0)), ...Array(7).fill(0)]);
    expect(handle(hardware)).toEqual([{ type: 'hardware', name: 'GANi4' }]);
  });

  it('ignores packets without the 0x55 header', () => {
    expect(handle(Uint8Array.from([0x54, 0x10, 0x01, 64, ...Array(12).fill(0)]))).toEqual([]);
  });

  it('uses 16-byte commands', () => {
    expect(GEN3.requestFacelets).toHaveLength(16);
    expect(Array.from(GEN3.requestFacelets.slice(0, 2))).toEqual([0x68, 0x01]);
  });
});

describe('history request alignment', () => {
  it('rounds to an odd serial and even count without crossing the wrap', () => {
    expect(alignHistoryRequest(14, 3)).toEqual([13, 4]);
    expect(alignHistoryRequest(1, 5)).toEqual([1, 2]);
    expect(alignHistoryRequest(0, 2)).toEqual([255, 2]);
  });
});

// --- Gen2 ---

describe('Gen2 driver', () => {
  function faceletsPacket(serial: number, state = SOLVED_STATE): Uint8Array {
    const buf = new Uint8Array(20);
    set(buf, 0, 4, 0x04);
    set(buf, 4, 8, serial);
    writeState(buf, { cp: 12, co: 33, ep: 47, eo: 91 }, state);
    return buf;
  }

  /** Moves newest-first, up to 7. */
  function movePacket(serial: number, moves: [number, boolean][]): Uint8Array {
    const buf = new Uint8Array(20);
    set(buf, 0, 4, 0x02);
    set(buf, 4, 8, serial);
    moves.forEach(([faceIndex, prime], i) => {
      set(buf, 12 + 5 * i, 4, faceIndex);
      set(buf, 16 + 5 * i, 1, Number(prime));
    });
    return buf;
  }

  it('decodes solved and R states', () => {
    const d = GEN2.createDriver();
    expect(d.handle(faceletsPacket(3), 0).events).toEqual([{ type: 'facelets', serial: 3, facelets: SOLVED }]);
    expect(d.handle(faceletsPacket(4, R_STATE), 0).events).toEqual([
      { type: 'facelets', serial: 4, facelets: R_FACELETS },
    ]);
  });

  it('emits moves after the baseline, recovering missed ones from the same packet', () => {
    const d = GEN2.createDriver();
    expect(d.handle(movePacket(1, [[1, false]]), 0).events).toEqual([]);
    d.handle(faceletsPacket(1), 0);
    expect(notations(d.handle(movePacket(2, [[1, false], [0, true]]), 0).events)).toEqual(['R']);
    // serial 3 and 4 were lost; packet 5 still carries them
    const recent: [number, boolean][] = [[5, true], [4, false], [3, false], [1, false], [0, true]];
    expect(notations(d.handle(movePacket(5, recent), 0).events)).toEqual(['D', 'L', "B'"]);
  });

  it('decodes battery and gyro', () => {
    const battery = new Uint8Array(20);
    set(battery, 0, 4, 0x09);
    set(battery, 8, 8, 42);
    expect(GEN2.createDriver().handle(battery, 0).events).toEqual([{ type: 'battery', level: 42 }]);

    const gyro = new Uint8Array(20);
    set(gyro, 0, 4, 0x01);
    set(gyro, 4, 16, 0x7fff);
    const [event] = GEN2.createDriver().handle(gyro, 0).events;
    expect(event.type === 'gyro' && +event.quat.w.toFixed(3)).toBe(1);
  });
});

// --- MAC recovery ---

describe('extractMac', () => {
  const data = (payload: number[]) => new Map([[0x0001, new DataView(Uint8Array.from(payload).buffer)]]);

  it('reads the little-endian MAC after 3 reserved bytes', () => {
    const payload = [0, 0, 0, 0xc3, 0xae, 0xd7, 0xf5, 0x17, 0xc8, 0x99];
    expect(extractMac(data(payload), 'GANi4_AEC3')).toBe('C8:17:F5:D7:AE:C3');
    expect(extractMac(data(payload))).toBe('C8:17:F5:D7:AE:C3');
  });

  it('prefers the window that matches the name suffix', () => {
    const payload = [0, 0xc3, 0xae, 0xd7, 0xf5, 0x17, 0xc8, 0, 0, 0];
    expect(extractMac(data(payload), 'GANi4_AEC3')).toBe('C8:17:F5:D7:AE:C3');
  });

  it('ignores other company ids', () => {
    const other = new Map([[0x004c, new DataView(new Uint8Array(12).buffer)]]);
    expect(extractMac(other, 'GANi4_AEC3')).toBeNull();
  });
});
