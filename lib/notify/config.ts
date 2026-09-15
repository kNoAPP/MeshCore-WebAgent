// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * How much inbound traffic raises an OS notification while the tab is in the
 * background. `off` is the authoritative default — notification bodies carry
 * message content, so nothing leaves the tab until the user opts in.
 */
export const NOTIFY_MODES = ['off', 'mentions', 'all'] as const;

/** A notification mode the app knows how to apply. */
export type NotifyMode = (typeof NOTIFY_MODES)[number];

/**
 * The per-radio notification preference, carried in the encrypted
 * `RadioPreferences` blob. `sound` is independent of {@link NotifyMode} only in
 * that it can be muted separately; it never fires on its own, because `off`
 * suppresses the whole feature.
 */
export interface NotifyPref {
  mode: NotifyMode;
  sound: boolean;
}

/** The notification preference before any choice is persisted. */
export const DEFAULT_NOTIFY_PREF: NotifyPref = { mode: 'off', sound: false };

/** Narrows an arbitrary string to a {@link NotifyMode}. */
export function isNotifyMode(value: string): value is NotifyMode {
  return (NOTIFY_MODES as readonly string[]).includes(value);
}

/**
 * Normalizes an arbitrary (persisted or corrupt) value into a valid
 * {@link NotifyPref}, falling back to {@link DEFAULT_NOTIFY_PREF} field by
 * field so an unrecognized mode can never reach the fire predicate.
 */
export function normalizeNotifyPref(raw: unknown): NotifyPref {
  const p = (
    typeof raw === 'object' && raw !== null ? raw : {}
  ) as Partial<NotifyPref>;
  return {
    mode:
      typeof p.mode === 'string' && isNotifyMode(p.mode)
        ? p.mode
        : DEFAULT_NOTIFY_PREF.mode,
    sound: typeof p.sound === 'boolean' ? p.sound : DEFAULT_NOTIFY_PREF.sound,
  };
}
