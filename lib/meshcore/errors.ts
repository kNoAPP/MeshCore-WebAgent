// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/** Stable codes for connect/sync failures the UI maps to localized copy. */
export type MeshErrorCode = 'radioNoResponse';

/**
 * A connect/sync failure carrying a stable {@link code} the UI maps to a
 * localized message. Keeps user-facing copy out of the protocol layer so the
 * hook can surface a translated toast instead of a hardcoded English string.
 */
export class MeshConnectError extends Error {
  constructor(readonly code: MeshErrorCode) {
    super(code);
    this.name = 'MeshConnectError';
  }
}

/**
 * Thrown when the user dismisses the browser's USB/BLE device chooser without
 * picking a device — a deliberate action the UI treats as a silent no-op rather
 * than a connection failure. Raised at the picker boundary so it is never
 * confused with a genuine open/GATT failure that happens to share a
 * `DOMException` name.
 */
export class PickerDismissedError extends Error {
  constructor() {
    super('picker dismissed');
    this.name = 'PickerDismissedError';
  }
}

/**
 * True when `err` is the browser signalling that the user closed the device
 * chooser without a selection. Web Serial and Web Bluetooth both surface this
 * as a `DOMException` named `NotFoundError`.
 */
export function isPickerDismissal(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError';
}
