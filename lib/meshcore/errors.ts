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
