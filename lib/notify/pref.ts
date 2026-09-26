// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

/** What an incoming message must be before it earns a notification. */
export const NOTIFY_MODES = ['off', 'mentions', 'all'] as const;

/**
 * Notification scope: `off` is silent, `mentions` covers direct messages and
 * any message that at-mentions this radio, `all` covers every inbound message.
 */
export type NotifyMode = (typeof NOTIFY_MODES)[number];

/**
 * Desktop notification preferences. Per-radio and persisted in the encrypted
 * preferences blob, never localStorage — the notification body carries message
 * content, so the choice belongs to the radio that received it.
 */
export interface NotifyPref {
  mode: NotifyMode;
  /** Play a short tone alongside the notification. */
  sound: boolean;
}

/** Notifications are opt-in: silent until the user asks for them. */
export const DEFAULT_NOTIFY_PREF: NotifyPref = { mode: 'off', sound: false };

/**
 * Normalizes an arbitrary (persisted or corrupt) value into a valid
 * {@link NotifyPref}. An unrecognized mode falls back to `off` rather than to
 * a noisier setting than the user chose.
 */
export function normalizeNotifyPref(raw: unknown): NotifyPref {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_NOTIFY_PREF;
  const parsed = raw as Partial<NotifyPref>;
  return {
    mode: NOTIFY_MODES.includes(parsed.mode as NotifyMode)
      ? (parsed.mode as NotifyMode)
      : DEFAULT_NOTIFY_PREF.mode,
    sound:
      typeof parsed.sound === 'boolean'
        ? parsed.sound
        : DEFAULT_NOTIFY_PREF.sound,
  };
}
