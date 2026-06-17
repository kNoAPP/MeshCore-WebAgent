// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { ITransport } from '@/types/meshcore';
import { USBFrameParser } from './frameParser';
import { encodeUSBFrame } from './frames';
import {
  BLE_SERVICE_UUID,
  BLE_RX_CHAR_UUID,
  BLE_TX_CHAR_UUID,
} from './constants';

// ─── USB Serial ──────────────────────────────────────────────────────────────

/**
 * Web Serial transport. Reads run in a background loop that feeds a
 * {@link USBFrameParser}; writes are length-framed via {@link encodeUSBFrame}.
 */
export class USBTransport implements ITransport {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private parser: USBFrameParser | null = null;
  private started = false;

  constructor(private port: SerialPort) {}

  /** Opens the serial port at the given baud rate and acquires the writer. */
  async open(baud: number): Promise<void> {
    await this.port.open({ baudRate: baud });
    this.writer = this.port.writable!.getWriter();
  }

  async send(payload: Uint8Array): Promise<void> {
    await this.writer!.write(encodeUSBFrame(payload));
  }

  startReading(onFrame: (d: Uint8Array) => void): void {
    if (this.started) {
      this.parser!.onFrame = onFrame;
      return;
    }
    this.started = true;
    this.parser = new USBFrameParser(onFrame);
    this.readLoop();
  }

  private async readLoop(): Promise<void> {
    this.reader = this.port.readable!.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.parser!.feed(value);
      }
    } catch {
      /* port closed */
    }
    try {
      this.reader.releaseLock();
    } catch {}
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      this.writer?.releaseLock();
    } catch {}
    try {
      await this.port.close();
    } catch {}
  }
}

// ─── BLE (Nordic UART) ───────────────────────────────────────────────────────

/**
 * Bluetooth LE transport over the Nordic UART service. Unlike USB/WiFi there is
 * no frame delimiter: each inbound GATT notification is exactly one frame, and
 * outbound writes are chunked to the 512-byte characteristic limit.
 */
export class BLETransport implements ITransport {
  private onFrame: ((d: Uint8Array) => void) | null = null;
  private started = false;

  constructor(
    private device: BluetoothDevice,
    private rxChar: BluetoothRemoteGATTCharacteristic,
    private txChar: BluetoothRemoteGATTCharacteristic,
  ) {}

  /** Writes a payload to the RX characteristic, split into ≤512-byte chunks. */
  async send(payload: Uint8Array): Promise<void> {
    const chunkSize = 512;
    for (let i = 0; i < payload.length; i += chunkSize) {
      await this.rxChar.writeValueWithResponse(payload.slice(i, i + chunkSize));
    }
  }

  startReading(onFrame: (d: Uint8Array) => void): void {
    this.onFrame = onFrame;
    if (this.started) return;
    this.started = true;
    this.txChar.addEventListener('characteristicvaluechanged', (e) => {
      const target = e.target as BluetoothRemoteGATTCharacteristic;
      try {
        this.onFrame?.(new Uint8Array(target.value!.buffer));
      } catch {}
    });
    this.txChar.startNotifications();
  }

  async close(): Promise<void> {
    try {
      await this.txChar.stopNotifications();
    } catch {}
    try {
      this.device.gatt?.disconnect();
    } catch {}
  }
}

// ─── WiFi / WebSocket ────────────────────────────────────────────────────────

/**
 * WebSocket transport. Uses the same `0x3C`/length framing as USB (parsed by
 * {@link USBFrameParser}) over a binary WebSocket to the radio's WiFi bridge.
 */
export class WiFiTransport implements ITransport {
  private ws: WebSocket | null = null;
  private parser: USBFrameParser | null = null;

  constructor(private url: string) {}

  /**
   * Connects the WebSocket; resolves on open, rejects if the connection fails.
   */
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
  }

  async send(payload: Uint8Array): Promise<void> {
    this.ws!.send(encodeUSBFrame(payload) as Uint8Array<ArrayBuffer>);
  }

  startReading(onFrame: (d: Uint8Array) => void): void {
    this.parser = new USBFrameParser(onFrame);
    this.ws!.onmessage = (e) =>
      this.parser!.feed(new Uint8Array(e.data as ArrayBuffer));
  }

  async close(): Promise<void> {
    this.ws?.close();
  }
}

// ─── Factory helpers ─────────────────────────────────────────────────────────

/**
 * Prompts the user to pick a serial port and returns an opened transport.
 *
 * @param baud - serial baud rate.
 * @remarks Must be called from a user gesture (Web Serial permission
 * requirement).
 */
export async function createUSBTransport(baud: number): Promise<USBTransport> {
  const port = await navigator.serial.requestPort();
  const t = new USBTransport(port);
  await t.open(baud);
  return t;
}

/**
 * Prompts the user to pick a BLE companion (filtered to the Nordic UART
 * service) and returns a connected transport.
 *
 * @remarks Must be called from a user gesture (Web Bluetooth permission
 * requirement).
 */
export async function createBLETransport(): Promise<BLETransport> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [BLE_SERVICE_UUID] }],
    optionalServices: [BLE_SERVICE_UUID],
  });
  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(BLE_SERVICE_UUID);
  const rxChar = await service.getCharacteristic(BLE_RX_CHAR_UUID);
  const txChar = await service.getCharacteristic(BLE_TX_CHAR_UUID);
  return new BLETransport(device, rxChar, txChar);
}

/**
 * Connects to a radio's WiFi WebSocket bridge and returns an opened transport.
 *
 * @param url - WebSocket URL of the bridge (e.g. `ws://192.168.x.x/ws`).
 */
export async function createWiFiTransport(url: string): Promise<WiFiTransport> {
  const t = new WiFiTransport(url);
  await t.open();
  return t;
}
