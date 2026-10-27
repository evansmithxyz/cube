/**
 * Web Bluetooth transport for GAN smart cubes (protocol Gen2, Gen3 or Gen4, detected
 * from the services the cube offers). Needs Chrome or Edge (desktop or Android) on
 * https or localhost.
 */

import type { SmartCube, SmartCubeEvent } from '../smartcube';
import { GAN_BASE_KEY, MOYU_AI_BASE_KEY, decrypt, deriveKey, encrypt } from './crypto';
import { GAN_PROTOCOLS, findProtocol, type GanProtocol } from './generations';
import { extractMac } from './protocol';

// GAN puts its MAC in manufacturer data under company ids (i << 8) | 0x01.
const GAN_COMPANY_IDS = Array.from({ length: 256 }, (_, i) => (i << 8) | 0x01);
const ADVERTISEMENT_WAIT_MS = 4000;
const FIRST_STATE_WAIT_MS = 5000;
const BATTERY_POLL_MS = 60_000;

/** Ask the user for the cube's MAC; resolves null if they cancel. */
export type MacPrompt = (deviceName: string) => Promise<string | null>;

export const isBluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

const macStorageKey = (deviceName: string) => `cube-timer:mac:${deviceName}`;

function savedMac(deviceName: string): string | null {
  try {
    return localStorage.getItem(macStorageKey(deviceName));
  } catch {
    return null;
  }
}

function storeMac(deviceName: string, mac: string | null): void {
  try {
    if (mac) localStorage.setItem(macStorageKey(deviceName), mac);
    else localStorage.removeItem(macStorageKey(deviceName));
  } catch {
    // storage unavailable: the user will be asked again next time
  }
}

/**
 * Read the MAC from the cube's advertisement. Chrome only exposes this with
 * chrome://flags/#enable-experimental-web-platform-features turned on.
 */
function macFromAdvertisement(device: BluetoothDevice): Promise<string | null> {
  if (typeof device.watchAdvertisements !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const abort = new AbortController();
    const finish = (mac: string | null) => {
      clearTimeout(timer);
      device.removeEventListener('advertisementreceived', onAdvertisement);
      abort.abort();
      resolve(mac);
    };
    const onAdvertisement = (event: Event) =>
      finish(extractMac((event as BluetoothAdvertisingEvent).manufacturerData, device.name));
    const timer = setTimeout(() => finish(null), ADVERTISEMENT_WAIT_MS);
    device.addEventListener('advertisementreceived', onAdvertisement);
    device.watchAdvertisements({ signal: abort.signal }).catch(() => finish(null));
  });
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Find which GAN protocol generation the cube offers. */
async function detectProtocol(
  server: BluetoothRemoteGATTServer,
  name: string,
): Promise<{ protocol: GanProtocol; service: BluetoothRemoteGATTService }> {
  let services: BluetoothRemoteGATTService[] = [];
  try {
    // Only services listed in requestDevice's optionalServices are visible here.
    services = await server.getPrimaryServices();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      throw new Error(`Couldn't read ${name}'s Bluetooth services (${errorText(error)}). Turn a face to wake it and try again.`);
    }
  }
  const protocol = findProtocol(services.map((s) => s.uuid));
  const service = services.find((s) => s.uuid.toLowerCase() === protocol?.service);
  if (!protocol || !service) {
    throw new Error(`${name} doesn't offer any GAN protocol this app knows (Gen2, Gen3 or Gen4).`);
  }
  return { protocol, service };
}

export async function connectGanCube(
  onEvent: (event: SmartCubeEvent) => void,
  promptMac: MacPrompt,
): Promise<SmartCube> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'GAN' }, { namePrefix: 'MG' }, { namePrefix: 'AiCube' }],
    optionalServices: GAN_PROTOCOLS.map((protocol) => protocol.service),
    optionalManufacturerData: GAN_COMPANY_IDS,
  });
  const name = device.name ?? 'GAN cube';

  const advertisedMac = await macFromAdvertisement(device);
  const mac = advertisedMac ?? savedMac(name) ?? (await promptMac(name));
  if (!mac) throw new Error("Connection cancelled: the cube's MAC address is needed to read its data.");
  const key = deriveKey(mac, name.startsWith('AiCube') ? MOYU_AI_BASE_KEY : GAN_BASE_KEY);

  const server = await device.gatt!.connect();
  let protocol: GanProtocol;
  let commandChar: BluetoothRemoteGATTCharacteristic;
  let stateChar: BluetoothRemoteGATTCharacteristic;
  try {
    let service: BluetoothRemoteGATTService;
    ({ protocol, service } = await detectProtocol(server, name));
    commandChar = await service.getCharacteristic(protocol.commandChar);
    stateChar = await service.getCharacteristic(protocol.stateChar);
  } catch (error) {
    server.disconnect();
    throw error;
  }

  // Web Bluetooth rejects overlapping GATT operations, so writes go through a queue.
  const write = commandChar.properties.writeWithoutResponse
    ? (data: BufferSource) => commandChar.writeValueWithoutResponse(data)
    : (data: BufferSource) => commandChar.writeValueWithResponse(data);
  let writes = Promise.resolve();
  const send = (message: Uint8Array) => {
    writes = writes
      .then(() => write(encrypt(message, key)))
      .catch((error) => console.warn('Cube command failed', error));
    return writes;
  };

  let sawState: () => void = () => {};
  const firstState = new Promise<boolean>((resolve) => {
    sawState = () => resolve(true);
    setTimeout(() => resolve(false), FIRST_STATE_WAIT_MS);
  });

  const driver = protocol.createDriver();
  const onNotification = () => {
    const value = stateChar.value;
    if (!value || value.byteLength < 16) return;
    const plain = decrypt(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), key);
    const { events, commands } = driver.handle(plain, performance.now());
    commands.forEach(send); // serial-gap recovery: ask the cube for dropped moves
    for (const event of events) {
      if (event.type === 'facelets') sawState();
      onEvent(event);
    }
  };
  stateChar.addEventListener('characteristicvaluechanged', onNotification);

  let batteryPoll: ReturnType<typeof setInterval> | undefined;
  device.addEventListener(
    'gattserverdisconnected',
    () => {
      clearInterval(batteryPoll);
      stateChar.removeEventListener('characteristicvaluechanged', onNotification);
      onEvent({ type: 'disconnect' });
    },
    { once: true },
  );

  await stateChar.startNotifications();
  send(protocol.requestHardware);
  send(protocol.requestFacelets);
  send(protocol.requestBattery);

  // A valid state proves the key (and so the MAC) is right; garbage never decodes as one.
  if (!(await firstState)) {
    storeMac(name, null);
    server.disconnect();
    throw new Error(
      advertisedMac
        ? `${name} connected but never reported its state. Turn a face to wake it and try again.`
        : `Couldn't read ${name}'s data. The MAC address ${mac} is probably wrong.`,
    );
  }
  storeMac(name, mac);
  batteryPoll = setInterval(() => send(protocol.requestBattery), BATTERY_POLL_MS);

  return {
    name: `${name} · ${protocol.name}`,
    async markSolved() {
      await send(protocol.requestReset);
      await send(protocol.requestFacelets);
    },
    disconnect() {
      server.disconnect();
    },
  };
}
