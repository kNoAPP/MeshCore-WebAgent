// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useMeshStore,
  openConvo,
  type Notification,
  type NotificationLevel,
} from '@/store/meshStore';
import { useClickOutside } from '@/hooks/useClickOutside';
import { formatRelative } from '@/lib/i18n/format';

const LEVEL_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const satisfies Record<NotificationLevel, typeof Info>;

const LEVEL_COLOR = {
  info: 'text-text2',
  success: 'text-green',
  warning: 'text-amber',
  error: 'text-red',
} as const satisfies Record<NotificationLevel, string>;

/**
 * Thin status strip along the bottom of the connected app, holding ambient
 * state the header has no room for. Part of the flex column rather than an
 * overlay, so it never covers the chat composer.
 *
 * @remarks Rendered only while connected — the connect screen has no ambient
 * state to report, and a drop unmounts the bar rather than dimming it. It
 * sits inside the subtree a modal marks `inert`, so it goes unreachable with
 * the rest of the app behind a dialog.
 */
export function ActionBar() {
  const { t } = useTranslation();
  const connected = useMeshStore((s) => s.status === 'connected');
  if (!connected) return null;
  return (
    <footer
      role='contentinfo'
      aria-label={t('actionBar.label')}
      className='flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-2 text-xs text-text2'
    >
      <NotificationBell />
    </footer>
  );
}

// The bell is the bar's right-hand anchor (`ml-auto`): later items land to its
// left and it stays put.
function NotificationBell() {
  const { t } = useTranslation();
  const notifications = useMeshStore((s) => s.notifications);
  const seenAt = useMeshStore((s) => s.notificationsSeenAt);
  const markSeen = useMeshStore((s) => s.markNotificationsSeen);
  const clearAll = useMeshStore((s) => s.clearNotifications);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const drawerId = useId();

  const unread = notifications.filter((n) => n.seq > seenAt).length;

  // Dismissing the drawer hands focus back to the bell, except when the close
  // is itself a move somewhere else: opening a conversation sends the reader
  // to the chat view, and parking them on the bell would put the next Enter
  // back on the drawer they just left.
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) bellRef.current?.focus();
  }, []);

  // An outside click fires on `mousedown`, before the click's own focus has
  // landed, so only focus the drawer still holds is worth taking back.
  const closeFromOutside = useCallback(() => {
    close(!!rootRef.current?.contains(document.activeElement));
  }, [close]);

  useClickOutside(rootRef, open, closeFromOutside);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    // Seen, not dismissed: the badge clears and the rows stay.
    markSeen();
    setOpen(true);
  };

  return (
    <div className='relative ml-auto' ref={rootRef}>
      <button
        ref={bellRef}
        type='button'
        onClick={toggle}
        aria-label={
          unread > 0
            ? t('notifications.bellUnread', { count: unread })
            : t('notifications.bell')
        }
        title={t('notifications.title')}
        aria-expanded={open}
        aria-controls={open ? drawerId : undefined}
        className='focus-inset flex items-center gap-1 rounded px-1 py-0.5 text-text2 transition-colors hover:text-accent'
      >
        <Bell size={13} aria-hidden='true' />
        {unread > 0 && (
          <span
            aria-hidden='true'
            className='rounded-full bg-accent-solid px-1 text-[10px] leading-4 font-semibold text-white'
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <NotificationDrawer
          id={drawerId}
          notifications={notifications}
          onClear={clearAll}
          onNavigate={() => close(false)}
          onExhausted={() => bellRef.current?.focus()}
        />
      )}
    </div>
  );
}

function NotificationDrawer({
  id,
  notifications,
  onClear,
  onNavigate,
  onExhausted,
}: {
  id: string;
  notifications: Notification[];
  onClear: () => void;
  /** Closes the drawer because a row is sending the reader somewhere else. */
  onNavigate: () => void;
  /** The drawer has no control left to hold focus; park it on the bell. */
  onExhausted: () => void;
}) {
  const { t } = useTranslation();
  const dismiss = useMeshStore((s) => s.dismissNotification);
  const ref = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const lastFocusedAt = useRef(0);
  const heldFocus = useRef(false);

  // Two ways the list can blur the reader without being asked to. A merge
  // hoists its row to the top, and React commits that reorder by re-inserting
  // every row above the hoisted one — briefly out of the document, which
  // blurs. An arrival at the 50-row cap, or a channel being removed, destroys
  // a row outright. Either way focus must not end up on `body`, outside the
  // drawer, where the arrow handler never sees their keys.
  //
  // Only a blur the list caused is worth undoing. `heldFocus` says the reader
  // had not already left (the blur handler clears it when focus moves to a
  // real element elsewhere), and `hasFocus` rules out the one case that looks
  // identical from inside the document: tabbing out to the browser's own
  // chrome, which also reads as `body`.
  useLayoutEffect(() => {
    const buttons = () => [...(ref.current?.querySelectorAll('button') ?? [])];
    const el = lastFocused.current;
    if (
      heldFocus.current &&
      document.activeElement === document.body &&
      document.hasFocus()
    ) {
      if (el && ref.current?.contains(el)) {
        el.focus();
      } else {
        // The control itself is gone. Prefer the one next to it over the
        // container, which has a name but nothing a reader can act on.
        const list = buttons();
        const near = list[Math.min(lastFocusedAt.current, list.length - 1)];
        (near ?? ref.current)?.focus();
      }
    }
    // Rows arriving above the focused control push its index along without
    // raising a focus event, so the fallback's aim has to be re-taken here or
    // it drifts further off with every arrival.
    if (el && ref.current?.contains(el)) {
      lastFocusedAt.current = Math.max(0, buttons().indexOf(el as never));
    }
  }, [notifications]);

  // Removing a row destroys the button that has focus, and focus falling to
  // `body` puts the reader outside the drawer — where the arrow handler below
  // never sees their keys. Hand it to the adjacent row's dismiss button,
  // so repeated Enter clears the list one row at a time; anything else here
  // would be the *open conversation* button or Clear all, and a second Enter
  // would navigate away or wipe the history.
  const dismissRow = (id: number, button: HTMLButtonElement) => {
    const row = button.closest('li');
    // Whether the row about to go holds focus — not whether this button does,
    // since the row's other control counts too. A mouse user's focus is
    // usually somewhere else entirely (Safari and Firefox on macOS do not
    // focus a button on click), and moving it would be a theft.
    const held = !!row?.contains(document.activeElement);
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling;
    const next = sibling
      ? [...sibling.querySelectorAll('button')].pop()
      : undefined;
    dismiss(id);
    if (!held) return;
    if (next) next.focus();
    else onExhausted();
  };

  const clearAll = () => {
    const held = !!ref.current?.contains(document.activeElement);
    onClear();
    if (held) onExhausted();
  };

  // Roving focus: the rows are a list, not a tab stop each, so the arrows walk
  // the drawer's controls in visual order and wrap at either end.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(ref.current?.querySelectorAll('button') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      at < 0
        ? step > 0
          ? 0
          : items.length - 1
        : (at + step + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div
      id={id}
      ref={ref}
      // Focusable so the effect above has somewhere to put a reader whose row
      // was destroyed under them; never a tab stop. Named, because a div
      // with no role and no name is announced as nothing at all when it
      // becomes the focus target.
      tabIndex={-1}
      role='group'
      aria-label={t('notifications.title')}
      onKeyDown={onKeyDown}
      onFocusCapture={(e) => {
        const el = e.target as HTMLElement;
        heldFocus.current = true;
        lastFocused.current = el;
        const buttons = [...(ref.current?.querySelectorAll('button') ?? [])];
        lastFocusedAt.current = Math.max(
          0,
          buttons.indexOf(el as HTMLButtonElement),
        );
      }}
      onBlurCapture={(e) => {
        // A blur that names where focus went is the reader moving on. One
        // that names nothing is the list pulling the element out from under
        // them, which is exactly what the effect above undoes.
        const to = e.relatedTarget as Node | null;
        if (to && !ref.current?.contains(to)) heldFocus.current = false;
      }}
      className='absolute right-0 bottom-full z-20 mb-1 flex max-h-[60vh] w-80 flex-col overflow-hidden rounded-md border border-border bg-surface2 shadow-pop'
    >
      {notifications.length === 0 ? (
        <p className='px-3 py-4 text-center text-xs text-text2'>
          {t('notifications.empty')}
        </p>
      ) : (
        <>
          <ul className='min-h-0 flex-1 overflow-y-auto'>
            {notifications.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onOpen={onNavigate}
                onDismiss={dismissRow}
              />
            ))}
          </ul>
          <button
            type='button'
            onClick={clearAll}
            className='focus-inset shrink-0 border-t border-border px-3 py-1.5 text-xs text-text2 hover:bg-surface hover:text-accent'
          >
            {t('notifications.clearAll')}
          </button>
        </>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
  onDismiss,
}: {
  notification: Notification;
  onOpen: () => void;
  /** Takes the clicked button so the drawer can move focus off it first. */
  onDismiss: (id: number, button: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const setView = useMeshStore((s) => s.setView);
  const { id, level, text, at, convo, count } = notification;
  const Icon = LEVEL_ICON[level];

  const body = (
    <>
      <Icon
        size={13}
        aria-hidden='true'
        className={`mt-0.5 shrink-0 ${LEVEL_COLOR[level]}`}
      />
      <span className='min-w-0 flex-1 wrap-break-word'>{text}</span>
    </>
  );

  const openTarget = () => {
    if (!convo) return;
    // Open first: switching the view catches the *then*-open conversation up
    // on its unread backlog, and the one being left behind shouldn't be it.
    openConvo(convo);
    setView('chat');
    onOpen();
  };

  return (
    <li className='flex items-start gap-2 border-b border-border px-2 py-1.5 text-xs text-text last:border-b-0'>
      {convo ? (
        <button
          type='button'
          onClick={openTarget}
          className='flex min-w-0 flex-1 items-start gap-2 rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent'
        >
          {body}
        </button>
      ) : (
        <span className='flex min-w-0 flex-1 items-start gap-2'>{body}</span>
      )}
      {count > 1 && (
        <span className='mt-0.5 shrink-0 rounded bg-surface px-1 text-[10px] text-text2'>
          {t('notifications.repeat', { count })}
        </span>
      )}
      <span className='mt-0.5 shrink-0 text-[10px] whitespace-nowrap text-text2'>
        {formatRelative(at)}
      </span>
      <button
        type='button'
        onClick={(e) => onDismiss(id, e.currentTarget)}
        aria-label={t('notifications.dismiss')}
        className='shrink-0 rounded p-0.5 text-text2 hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-accent'
      >
        <X size={12} aria-hidden='true' />
      </button>
    </li>
  );
}
