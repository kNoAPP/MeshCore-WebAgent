// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

type FrameCallback = (frame: Uint8Array) => void;
type State = 'idle' | 'lenLow' | 'lenHigh' | 'data';

/** Parses the USB/WiFi inbound framing: 0x3C + uint16_LE(len) + payload */
export class USBFrameParser {
  onFrame: FrameCallback;
  private state: State = 'idle';
  private buf: Uint8Array | null = null;
  private len = 0;
  private pos = 0;
  private lenLow = 0;

  constructor(onFrame: FrameCallback) {
    this.onFrame = onFrame;
  }

  feed(bytes: Uint8Array): void {
    for (const b of bytes) {
      switch (this.state) {
        case 'idle':
          if (b === 0x3c) this.state = 'lenLow';
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
