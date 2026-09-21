// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/** Stable codes for connect/sync failures the UI maps to localized copy. */
export type MeshErrorCode = 'radioNoResponse';

/**
 * A connect/sync failure carrying a stable {@link code} the UI maps to a
 * localized message. Keeps user-facing copy out of the protocol layer so the
 * hook can surface a translated notice instead of a hardcoded English string.
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

/**
 * Why a private-key export or import could not be performed — a stable code the
 * Settings UI maps to localized copy.
 *
 * `disabled` means the firmware recognized the command but was built without
 * it (`RESP.DISABLED`); `unsupported` means the firmware has no such command at
 * all (`ERR_CODE.UNSUPPORTED_CMD`); `rejected` means the radio refused the key
 * as invalid (`ERR_CODE.ILLEGAL_ARG`); `writeFailed` means the radio could not
 * persist the new identity (`ERR_CODE.FILE_IO_ERROR`).
 */
export type PrivateKeyErrorCode =
  'disabled' | 'unsupported' | 'rejected' | 'writeFailed';

/**
 * Thrown when {@link MeshCoreClient.exportPrivateKey} or
 * {@link MeshCoreClient.importPrivateKey} is refused by the radio. Carries a
 * stable {@link code} so the UI can explain *why* identity backup is
 * unavailable on this build instead of showing a bare device-error number.
 */
export class PrivateKeyError extends Error {
  constructor(readonly code: PrivateKeyErrorCode) {
    super(code);
    this.name = 'PrivateKeyError';
  }
}

/**
 * Thrown when a remote request's answering push never arrives — the node was
 * sent the request but said nothing back within the receipt-derived budget.
 *
 * @remarks
 * Typed rather than a bare `Error` so a caller can tell this transient shape
 * (a lost packet over a stale multi-hop route) from a rejection the radio
 * actually reported, and retry only the former. A wrong repeater password
 * produces no response either, so this never proves the route was at fault.
 */
export class PushTimeoutError extends Error {
  constructor(prefixHex: string) {
    super(`Timeout waiting for push from ${prefixHex}`);
    this.name = 'PushTimeoutError';
  }
}
