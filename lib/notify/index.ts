// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Permission to show desktop notifications, plus the `unsupported` state for
 * browsers (and insecure origins) with no `Notification` constructor at all.
 */
export type NotifyPermission = NotificationPermission | 'unsupported';

/** Shown on the notification; the app's own favicon rather than a message. */
const NOTIFY_ICON = '/favicon.ico';

/** Whether this browser exposes the Notifications API. */
export function notifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Current permission, without prompting. */
export function notifyPermission(): NotifyPermission {
  return notifySupported() ? Notification.permission : 'unsupported';
}

const permissionListeners = new Set<() => void>();
let permissionStatus: PermissionStatus | null = null;

function emitPermissionChange(): void {
  for (const listener of permissionListeners) listener();
}

/**
 * Subscribes to permission changes, for a `useSyncExternalStore` read of
 * {@link notifyPermission}. The Notification API announces nothing on its own,
 * so this covers both the in-app prompt and a change the user makes in the
 * browser's own site settings (via the Permissions API, where it exists).
 *
 * @returns The unsubscribe function.
 */
export function subscribeNotifyPermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  if (!permissionStatus && typeof navigator !== 'undefined') {
    void navigator.permissions
      ?.query({ name: 'notifications' })
      .then((status) => {
        permissionStatus = status;
        status.onchange = emitPermissionChange;
      })
      // Firefox rejects this query name; the in-app prompt still reports back.
      .catch(() => {});
  }
  return () => {
    permissionListeners.delete(listener);
  };
}

/**
 * Prompts for notification permission and resolves to the resulting state.
 * Only ever call this from an explicit user gesture — an unprompted request on
 * load is what makes browsers permanently deny the origin.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  const result = await Notification.requestPermission();
  emitPermissionChange();
  return result;
}

/**
 * Shows a desktop notification, or does nothing when the API is missing or
 * permission was never granted — the title-bar unread count stays as the
 * fallback in that case.
 *
 * @param tag - Coalescing key (the conversation id): a second notification
 * with the same tag replaces the first, so a busy channel leaves one entry
 * rather than a queue.
 * @param onClick - Runs after the tab is focused, to open the conversation.
 * @returns Whether a notification was actually shown.
 */
export function showNotification({
  title,
  body,
  tag,
  onClick,
}: {
  title: string;
  body: string;
  tag: string;
  onClick?: () => void;
}): boolean {
  if (notifyPermission() !== 'granted') return false;
  const notification = new Notification(title, {
    body,
    tag,
    icon: NOTIFY_ICON,
    // The tone is ours to play (and its own preference), so the platform's
    // default sound must not fire on top of it for a replacing notification.
    silent: true,
  });
  notification.onclick = () => {
    window.focus();
    onClick?.();
    notification.close();
  };
  return true;
}

// One context for the tab: browsers cap how many can exist, and a new one per
// tone would leak them. Created on first use because constructing it before a
// user gesture starts it suspended.
let audioCtx: AudioContext | null = null;

/** Beep pitches in Hz, played as a short rising two-note chirp. */
const TONE_STEPS = [880, 1174.7];
/** Length of each note, in seconds. */
const TONE_STEP_SECS = 0.09;
/** Peak gain — audible over other audio without being startling. */
const TONE_GAIN = 0.12;

/**
 * Plays the built-in notification tone. Synthesized rather than shipped as an
 * audio file so it adds nothing to the static export. Silently does nothing
 * where Web Audio is unavailable or the context is blocked.
 */
export function playNotifyTone(): void {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return;
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    // Autoplay policy can leave the context suspended until a gesture; the
    // resume is fire-and-forget because this tone is not worth waiting on.
    if (ctx.state === 'suspended') void ctx.resume();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const start = ctx.currentTime;
    const end = start + TONE_STEPS.length * TONE_STEP_SECS;
    gain.gain.setValueAtTime(TONE_GAIN, start);
    // Ramp to silence rather than stopping at full amplitude, which clicks.
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    TONE_STEPS.forEach((hz, i) => {
      osc.frequency.setValueAtTime(hz, start + i * TONE_STEP_SECS);
    });
    osc.connect(gain);
    osc.start(start);
    osc.stop(end);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  } catch {
    // A browser that refuses to build the graph just gets no tone.
  }
}
