// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { ActiveConvo } from '@/types/meshcore';
import { useMeshStore, openConvo } from '@/store/meshStore';

/**
 * Permission state of the OS notification channel, widened with `unsupported`
 * for the browsers and insecure contexts that expose no `Notification` at all.
 */
export type NotifyPermission = NotificationPermission | 'unsupported';

/** Reads the current OS notification permission without prompting. */
export function notifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Prompts for OS notification permission and resolves to the resulting state.
 * Only ever called from an explicit user click — browsers penalize a prompt
 * raised on load, and a denial is permanent for the origin.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return await Notification.requestPermission();
}

// One context for the app's lifetime: each tone allocates its own oscillator,
// but browsers cap how many AudioContexts a page may hold.
let toneCtx: AudioContext | null = null;

/**
 * Plays the built-in two-note notification chime, ~0.3s of synthesized sine so
 * the app ships no audio asset. Silent if the context cannot start — a tab that
 * has never been interacted with is not allowed to make noise.
 */
export function playNotifyTone(): void {
  toneCtx ??= new AudioContext();
  const ctx = toneCtx;
  void ctx.resume();
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t0);
  osc.frequency.setValueAtTime(1174, t0 + 0.09);
  // Ramped rather than stepped: a square-edged gain change clicks audibly.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.32);
}

/**
 * Raises one OS notification, coalescing on {@link tag} so a busy conversation
 * replaces its own banner instead of stacking a queue. Clicking it focuses this
 * tab and runs {@link onClick}. A no-op unless permission is already granted —
 * this never prompts.
 */
export function showNotification(
  title: string,
  body: string,
  tag: string,
  onClick?: () => void,
): void {
  if (notifyPermission() !== 'granted') return;
  const n = new Notification(title, { body, tag });
  n.onclick = () => {
    window.focus();
    onClick?.();
    n.close();
  };
}

/** An inbound message offered to the notification layer. */
export interface MessageNotice {
  /** Conversation the message landed in; opened when the banner is clicked. */
  convo: ActiveConvo;
  /** Banner title — the sender for a DM, the channel or room otherwise. */
  title: string;
  /** Message text, shown as the banner body. */
  body: string;
}

// Mirrors the composer's mention encoding: a mention is the device's own name
// in brackets, so a bare "@alden" in prose is not one.
function mentionsSelf(body: string, deviceName: string): boolean {
  if (deviceName.length === 0) return false;
  return body.toLowerCase().includes(`@[${deviceName.toLowerCase()}]`);
}

/**
 * Notifies for a message that landed out of sight, honoring the per-radio
 * {@link NotifyPref}.
 *
 * @remarks
 * Only fires while this tab is blurred or hidden: on screen, the toast and the
 * unread badge already cover it, and `windowFocused` is the same store fact
 * `isConvoVisible` reads, so the banner and the badge can never disagree.
 * Call it only for an arrival the caller has already found not visible.
 */
export function notifyMessage(notice: MessageNotice): void {
  const { notifyPref, windowFocused, deviceName } = useMeshStore.getState();
  if (notifyPref.mode === 'off' || windowFocused) return;
  if (
    notifyPref.mode === 'mentions' &&
    notice.convo.kind !== 'direct' &&
    !mentionsSelf(notice.body, deviceName)
  ) {
    return;
  }
  // The chime is not gated on notification permission: a user who declined the
  // OS prompt can still choose to be pinged audibly.
  if (notifyPref.sound) playNotifyTone();
  showNotification(notice.title, notice.body, notice.convo.id, () => {
    openConvo(notice.convo);
    useMeshStore.getState().setView('chat');
  });
}
