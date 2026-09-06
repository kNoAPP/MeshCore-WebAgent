// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// The payload arrives with its delimiter and length stripped.
type FrameCallback = (frame: Uint8Array) => void;
type State = 'idle' | 'lenLow' | 'lenHigh' | 'data';

/**
 * Reassembles the USB/WiFi inbound (radio→host) framing — `0x3E` (`>`) + uint16
 * LE length + payload — from an arbitrarily chunked byte stream, emitting one
 * {@link FrameCallback} per complete frame. The radio tags its replies with
 * `0x3E`; host→radio frames use `0x3C` instead (see {@link encodeUSBFrame}).
 *
 * @remarks
 * Stateful: bytes arrive in transport-sized chunks that may split or merge
 * frames, so it walks a small state machine across `feed` calls. Frames with a
 * zero or `> 512` length are treated as desync and dropped (resyncs on the next
 * `0x3E`). BLE does not use this — each GATT notification is already one frame.
 */
export class USBFrameParser {
  /**
   * Current frame sink; may be swapped (e.g. on reconnect) without restarting
   * the read loop.
   */
  onFrame: FrameCallback;
  private state: State = 'idle';
  private buf: Uint8Array | null = null;
  private len = 0;
  private pos = 0;
  private lenLow = 0;

  constructor(onFrame: FrameCallback) {
    this.onFrame = onFrame;
  }

  /**
   * Feeds a chunk of received bytes, emitting `onFrame` for each frame it
   * completes.
   */
  feed(bytes: Uint8Array): void {
    for (const b of bytes) {
      switch (this.state) {
        case 'idle':
          if (b === 0x3e) this.state = 'lenLow';
          break;
        case 'lenLow':
          this.lenLow = b;
          this.state = 'lenHigh';
          break;
        case 'lenHigh':
          this.len = this.lenLow | (b << 8);
          if (this.len === 0 || this.len > 512) {
            this.reset();
            break;
          }
          this.buf = new Uint8Array(this.len);
          this.pos = 0;
          this.state = 'data';
          break;
        case 'data':
          this.buf![this.pos++] = b;
          if (this.pos >= this.len) {
            try {
              this.onFrame(this.buf!.slice());
            } catch {}
            this.reset();
          }
          break;
      }
    }
  }

  private reset(): void {
    this.state = 'idle';
    this.buf = null;
    this.len = 0;
    this.pos = 0;
    this.lenLow = 0;
  }
}
