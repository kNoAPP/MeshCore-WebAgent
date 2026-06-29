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

/**
 * Shared close-detection plumbing for the transports: a single `onClose`
 * listener fired at most once per open session, suppressed when the close was
 * caller-initiated (a planned {@link ITransport.close}), and re-armable so a
 * reopened transport can signal a fresh drop.
 */
abstract class BaseTransport {
  private closeListener: (() => void) | null = null;
  private fired = false;
  // Buffers a drop that fired before any onClose() listener was registered, so
  // an early close can be flushed to the listener instead of being lost.
  private pendingClose = false;
  // Set when the caller initiates teardown, so the resulting close isn't
  // mistaken for a dropped link.
  protected planned = false;

  onClose(cb: () => void): void {
    this.closeListener = cb;
    // Flush a close that fired before this listener existed so an early drop
    // (a transport dropping before init finishes wiring up) isn't missed.
    if (this.pendingClose) {
      this.pendingClose = false;
      cb();
    }
  }

  /** Notifies the listener of an unexpected drop, once per open session. */
  protected fireClose(): void {
    if (this.fired || this.planned) return;
    this.fired = true;
    if (this.closeListener) {
      this.closeListener();
    } else {
      // No listener yet — buffer it for the next onClose() registration.
      this.pendingClose = true;
    }
  }

  /** Re-arms drop detection for a reopened session. */
  protected armForReopen(): void {
    this.fired = false;
    this.planned = false;
    this.pendingClose = false;
  }

  // Serializes reopen() so concurrent calls join one in-flight attempt. A
  // reconnect attempt that times out at the caller leaves its reopen running;
  // without this, the next attempt would start a second reopen on the same
  // port/socket and race the first over shared reader/writer/handle state.
  private reopening: Promise<void> | null = null;

  reopen(): Promise<void> {
    this.reopening ??= this.performReopen().finally(() => {
      this.reopening = null;
    });
    return this.reopening;
  }

  /** Transport-specific reopen body; serialized by {@link reopen}. */
  protected abstract performReopen(): Promise<void>;
}

// ─── USB Serial ──────────────────────────────────────────────────────────────

// Web Serial requires a baud rate, but MeshCore companions enumerate as native
// USB where the rate is ignored. We always open at the conventional 115200
// rather than exposing a setting that can't affect anything.
const USB_BAUD_RATE = 115200;

/**
 * Web Serial transport. Reads run in a background loop that feeds a
 * {@link USBFrameParser}; writes are length-framed via {@link encodeUSBFrame}.
 */
export class USBTransport extends BaseTransport implements ITransport {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private parser: USBFrameParser | null = null;
  private started = false;
  // Tracks the running read loop so reopen() can await its full unwind (and
  // suppressed fireClose) before re-arming drop detection.
  private readTask: Promise<void> | null = null;
  // The device's USB identity, captured at construction. A reboot or cable
  // replug makes the radio re-enumerate; Chrome can invalidate the original
  // SerialPort handle and expose the returning device as a new object, so
  // reopen() re-acquires the live port by matching on this.
  private readonly info: SerialPortInfo;

  constructor(private port: SerialPort) {
    super();
    this.info = port.getInfo();
  }

  /** Opens `port` at {@link USB_BAUD_RATE}, adopts it, and takes the writer. */
  private async openPort(port: SerialPort): Promise<void> {
    await port.open({ baudRate: USB_BAUD_RATE });
    this.port = port;
    this.writer = port.writable!.getWriter();
  }

  /** Opens the serial port at {@link USB_BAUD_RATE} and acquires the writer. */
  async open(): Promise<void> {
    await this.openPort(this.port);
  }

  /**
   * Serial ports the device may now live behind after a reboot or replug. The
   * original handle comes first: it's still valid for a transient drop (or
   * when Chrome reuses the same object across re-enumeration) and uniquely
   * identifies the device, so trying it first won't rebind to a second radio.
   * Only when it no longer opens do we fall back to other ports matching the
   * captured USB vendor/product id — the returning device after a true
   * re-enumeration, which permission persists for (no new chooser prompt).
   */
  private async candidatePorts(): Promise<SerialPort[]> {
    let ports: SerialPort[] = [];
    try {
      ports = await navigator.serial.getPorts();
    } catch {}
    const { usbVendorId, usbProductId } = this.info;
    const matches =
      usbVendorId != null
        ? ports.filter((p) => {
            const i = p.getInfo();
            return (
              i.usbVendorId === usbVendorId && i.usbProductId === usbProductId
            );
          })
        : [];
    // Original handle first, then the VID/PID matches with it filtered out so
    // it isn't retried twice.
    return [this.port, ...matches.filter((p) => p !== this.port)];
  }

  /**
   * Opens the first candidate port that accepts a connection, adopting it as
   * the live port. Throws if none open (device not back yet), so the caller's
   * backoff loop retries until the radio re-enumerates.
   */
  private async reopenPort(): Promise<void> {
    let lastErr: unknown = new Error('No serial port available');
    for (const port of await this.candidatePorts()) {
      try {
        await this.openPort(port);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
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
    this.readTask = this.readLoop();
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
      /* port closed — an unplug or read error reaches here */
    }
    try {
      this.reader.releaseLock();
    } catch {}
    // The loop only ends when the port is gone; tell the client unless we got
    // here from a planned close().
    this.fireClose();
  }

  /**
   * Reopens the radio's serial port after a drop and re-attaches the read loop
   * on the next {@link startReading}. A reboot or replug can re-enumerate the
   * device under a fresh `SerialPort` object, so {@link reopenPort} re-acquires
   * the live port rather than reusing the (possibly invalidated) original
   * handle — permission persists, so no new chooser prompt is needed.
   */
  protected async performReopen(): Promise<void> {
    // Suppress the old read loop's close signal and cancel its pending read so
    // it releases the stream's reader lock before we re-open the port —
    // otherwise the next startReading() can hit a still-locked readable.
    this.planned = true;
    try {
      await this.reader?.cancel();
    } catch {}
    // Wait for the previous read loop to fully unwind before clearing planned:
    // its trailing fireClose() is suppressed while planned is set, so a late
    // unwind can't report a spurious drop against the new session.
    try {
      await this.readTask;
    } catch {}
    this.readTask = null;
    try {
      this.writer?.releaseLock();
    } catch {}
    try {
      await this.port.close();
    } catch {}
    this.writer = null;
    this.reader = null;
    this.parser = null;
    this.started = false;
    this.armForReopen();
    await this.reopenPort();
  }

  async close(): Promise<void> {
    this.planned = true;
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
export class BLETransport extends BaseTransport implements ITransport {
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private onFrame: ((d: Uint8Array) => void) | null = null;
  private started = false;

  constructor(private device: BluetoothDevice) {
    super();
    // The GATT disconnect event is the only signal a BLE radio went out of
    // range or rebooted; the device object stays valid for the page session.
    // Kept as a stable reference so close() can detach it — the device may
    // outlive this transport, and a dangling listener would leak it.
    this.device.addEventListener(
      'gattserverdisconnected',
      this.onGattDisconnect,
    );
  }

  private onGattDisconnect = (): void => this.fireClose();

  /**
   * Connects the GATT server and acquires the Nordic UART characteristics. Run
   * again by {@link reopen} to recover the same device after a drop.
   */
  async open(): Promise<void> {
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    this.rxChar = await service.getCharacteristic(BLE_RX_CHAR_UUID);
    this.txChar = await service.getCharacteristic(BLE_TX_CHAR_UUID);
  }

  /** Writes a payload to the RX characteristic, split into ≤512-byte chunks. */
  async send(payload: Uint8Array): Promise<void> {
    const chunkSize = 512;
    for (let i = 0; i < payload.length; i += chunkSize) {
      await this.rxChar!.writeValueWithResponse(
        payload.slice(i, i + chunkSize),
      );
    }
  }

  async startReading(onFrame: (d: Uint8Array) => void): Promise<void> {
    this.onFrame = onFrame;
    if (this.started) return;
    // Detach first in case a reopen() reused the same characteristic object —
    // adding the same listener twice would deliver duplicate frames.
    this.txChar!.removeEventListener(
      'characteristicvaluechanged',
      this.handleNotification,
    );
    this.txChar!.addEventListener(
      'characteristicvaluechanged',
      this.handleNotification,
    );
    // Await the subscription before returning: init() sends APP_START right
    // after this, and the radio's SELF_INFO reply only arrives as a
    // notification — sending before the subscription is active would drop it.
    // Mark started only on success so a failed subscribe is retried on reopen.
    await this.txChar!.startNotifications();
    this.started = true;
  }

  private handleNotification = (e: Event): void => {
    const target = e.target as BluetoothRemoteGATTCharacteristic;
    try {
      this.onFrame?.(new Uint8Array(target.value!.buffer));
    } catch {}
  };

  /**
   * Reconnects GATT to the same device after a drop and re-attaches
   * notifications on the next {@link startReading}.
   */
  protected async performReopen(): Promise<void> {
    this.started = false;
    // Detach the old notification listener before reconnecting: open() can hand
    // back a fresh characteristic object, which would leave the previous one
    // bound and leaking stale frames into the new session.
    this.txChar?.removeEventListener(
      'characteristicvaluechanged',
      this.handleNotification,
    );
    // Re-arm only AFTER the GATT handshake settles, not before. The
    // device-level gattserverdisconnected listener stays attached across
    // reopen, so a transient disconnect during connect() would otherwise flip
    // `fired` for the freshly reopened session and permanently suppress its own
    // drop detection. Leaving the prior session's `fired` set during open()
    // swallows that in-handshake event; a real failure rejects open() and
    // drives the retry.
    await this.open();
    this.armForReopen();
  }

  async close(): Promise<void> {
    this.planned = true;
    // Terminal teardown — reopen() is only reached via the drop path, never
    // after close(), so detaching here can't suppress a future drop signal.
    this.device.removeEventListener(
      'gattserverdisconnected',
      this.onGattDisconnect,
    );
    // Detach the notification listener too: it's a stable method reference, so
    // leaving it bound to a characteristic keeps this transport reachable.
    this.txChar?.removeEventListener(
      'characteristicvaluechanged',
      this.handleNotification,
    );
    try {
      await this.txChar?.stopNotifications();
    } catch {}
    try {
      this.device.gatt?.disconnect();
    } catch {}
  }
}

// ─── WiFi / WebSocket ────────────────────────────────────────────────────────

/**
 * WebSocket transport. Uses the same length framing as USB (`0x3C` host→radio,
 * `0x3E` radio→host, parsed by {@link USBFrameParser}) over a binary WebSocket
 * to the radio's WiFi bridge.
 */
export class WiFiTransport extends BaseTransport implements ITransport {
  private ws: WebSocket | null = null;
  private parser: USBFrameParser | null = null;

  constructor(private url: string) {
    super();
  }

  /**
   * Connects the WebSocket; resolves on open, rejects if the connection fails.
   */
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        // Surface any drop from here on — even in the gap before startReading()
        // wires the message handler — so a close/error in that window enters
        // the reconnect loop instead of being missed.
        ws.onclose = () => this.fireClose();
        ws.onerror = () => this.fireClose();
        resolve();
      };
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
  }

  async send(payload: Uint8Array): Promise<void> {
    this.ws!.send(encodeUSBFrame(payload) as Uint8Array<ArrayBuffer>);
  }

  startReading(onFrame: (d: Uint8Array) => void): void {
    this.parser = new USBFrameParser(onFrame);
    // onclose/onerror are wired to fireClose() in open(); only the message sink
    // is set here.
    this.ws!.onmessage = (e) =>
      this.parser!.feed(new Uint8Array(e.data as ArrayBuffer));
  }

  /** Reopens the WebSocket to the same bridge URL after a drop. */
  protected async performReopen(): Promise<void> {
    // A reopen can follow a non-drop failure (a rebooting radio that accepted
    // the socket but never answered the handshake), where the prior socket is
    // still open. Detach its handlers and close it before opening a new one —
    // otherwise the abandoned socket leaks for the page session, its onclose
    // can later fire a spurious drop against the next session, and a late frame
    // on its onmessage would feed the new session's parser (onmessage closes
    // over the instance `this.parser`, which the next startReading() replaces).
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
    }
    this.armForReopen();
    await this.open();
  }

  async close(): Promise<void> {
    this.planned = true;
    this.ws?.close();
  }
}

// ─── Factory helpers ─────────────────────────────────────────────────────────

/**
 * Prompts the user to pick a serial port and returns an opened transport.
 *
 * @remarks Must be called from a user gesture (Web Serial permission
 * requirement). Opens at {@link USB_BAUD_RATE} — native USB ignores the rate.
 */
export async function createUSBTransport(): Promise<USBTransport> {
  const port = await navigator.serial.requestPort();
  const t = new USBTransport(port);
  await t.open();
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
  const t = new BLETransport(device);
  // open() can throw (GATT connect failure); detach the constructor's
  // gattserverdisconnected listener via close() so the abandoned transport
  // isn't kept reachable by the device for the page session.
  try {
    await t.open();
  } catch (err) {
    await t.close();
    throw err;
  }
  return t;
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
