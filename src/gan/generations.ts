/**
 * The GAN protocol generations: BLE UUIDs, commands and packet decoders. A cube is
 * matched to a generation by the GATT service it offers (the same model, e.g. the
 * GAN i4, has shipped with more than one).
 */

import { Gen2Driver, SerialDriver } from './drivers';
import { decodeName, decodeQuaternion, type ProtocolDriver } from './protocol';

export interface GanProtocol {
  name: 'Gen2' | 'Gen3' | 'Gen4';
  service: string;
  commandChar: string; // write
  stateChar: string; // notify
  requestFacelets: Uint8Array;
  requestHardware: Uint8Array;
  requestBattery: Uint8Array;
  /** Tells the cube "your current physical state IS solved". */
  requestReset: Uint8Array;
  createDriver(): ProtocolDriver;
}

function command(length: number, ...bytes: number[]): Uint8Array {
  const buf = new Uint8Array(length);
  buf.set(bytes);
  return buf;
}

const RESET_PAYLOAD = [0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab];

export const GEN2: GanProtocol = {
  name: 'Gen2',
  service: '6e400001-b5a3-f393-e0a9-e50e24dc4179',
  commandChar: '28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4',
  stateChar: '28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4',
  requestFacelets: command(20, 0x04),
  requestHardware: command(20, 0x05),
  requestBattery: command(20, 0x09),
  requestReset: command(20, 0x0a, ...RESET_PAYLOAD),
  createDriver: () => new Gen2Driver(),
};

export const GEN3: GanProtocol = {
  name: 'Gen3',
  service: '8653000a-43e6-47b7-9cb0-5fc21d4ae340',
  commandChar: '8653000c-43e6-47b7-9cb0-5fc21d4ae340',
  stateChar: '8653000b-43e6-47b7-9cb0-5fc21d4ae340',
  requestFacelets: command(16, 0x68, 0x01),
  requestHardware: command(16, 0x68, 0x04),
  requestBattery: command(16, 0x68, 0x07),
  requestReset: command(16, 0x68, 0x05, ...RESET_PAYLOAD),
  createDriver: () =>
    new SerialDriver({
      magic: 0x55,
      shift: 8,
      types: { move: 0x01, history: 0x06, facelets: 0x02 },
      historyCommand: (serial, count) => command(16, 0x68, 0x03, serial, 0, count, 0),
      decodeOther(bits, type) {
        if (type === 0x10) return { type: 'battery', level: Math.min(bits.word(24, 8), 100) };
        if (type === 0x07) return { type: 'hardware', name: decodeName(bits, 32, 5) };
        return null;
      },
    }),
};

export const GEN4: GanProtocol = {
  name: 'Gen4',
  service: '00000010-0000-fff7-fff6-fff5fff4fff0',
  commandChar: '0000fff5-0000-1000-8000-00805f9b34fb',
  stateChar: '0000fff6-0000-1000-8000-00805f9b34fb',
  requestFacelets: command(20, 0xdd, 0x04, 0x00, 0xed, 0x00, 0x00),
  requestHardware: command(20, 0xdf, 0x03, 0x00, 0x00, 0x00),
  requestBattery: command(20, 0xdd, 0x04, 0x00, 0xef, 0x00, 0x00),
  requestReset: command(20, 0xd2, 0x0d, ...RESET_PAYLOAD),
  createDriver: () =>
    new SerialDriver({
      shift: 0,
      types: { move: 0x01, history: 0xd1, facelets: 0xed },
      historyCommand: (serial, count) => command(20, 0xd1, 0x04, serial, 0, count, 0),
      decodeOther(bits, type, dataLength) {
        if (type === 0xec) return { type: 'gyro', quat: decodeQuaternion(bits, 16) };
        if (type === 0xef) return { type: 'battery', level: Math.min(bits.word(8 + dataLength * 8, 8), 100) };
        if (type === 0xfc) return { type: 'hardware', name: decodeName(bits, 24, dataLength - 1) };
        return null;
      },
    }),
};

export const GAN_PROTOCOLS = [GEN2, GEN3, GEN4];

/** The generation whose service the cube offers, if any. */
export function findProtocol(serviceUuids: string[]): GanProtocol | undefined {
  const offered = new Set(serviceUuids.map((uuid) => uuid.toLowerCase()));
  return GAN_PROTOCOLS.find((protocol) => offered.has(protocol.service));
}
