// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  HardDrive,
  Inbox,
  Info,
  LoaderCircle,
  MessageSquare,
  Radio,
  RotateCw,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useMeshStore,
  openConvo,
  isConvoVisible,
  type Notification,
  type NotificationLevel,
} from '@/store/meshStore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { useClickOutside } from '@/hooks/useClickOutside';
import {
  formatRelative,
  formatRelativePrecise,
  formatStorage,
  formatVoltage,
} from '@/lib/i18n/format';
import { IDENTITY_BOTTOM_FRAME_CLASS } from '@/lib/identity/accent';
import { ApprovalInboxList } from './AutomationPanel';
import { ModalShell } from './ModalShell';

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
 * Thin status strip along the bottom of the connected app, holding the ambient
 * state and occasional actions the header has no room for. Part of the flex
 * column rather than an overlay, so it never covers the chat composer.
 *
 * @remarks Rendered only while connected — the connect screen has no ambient
 * state to report, and a drop unmounts the bar rather than dimming it. Every
 * item may therefore assume a live link, which is why none of them carry a
 * reconnecting guard of their own. It sits inside the subtree a modal marks
 * `inert`, so it goes unreachable with the rest of the app behind a dialog.
 */
export function ActionBar() {
  const { t } = useTranslation();
  const connected = useMeshStore((s) => s.status === 'connected');
  const accent = useMeshStore((s) => s.identityAccent);
  if (!connected) return null;
  return (
    <footer
      role='contentinfo'
      aria-label={t('actionBar.label')}
      className={`flex h-6 shrink-0 items-center gap-2 border-t border-border bg-surface px-2 text-xs text-text2 ${IDENTITY_BOTTOM_FRAME_CLASS[accent]}`}
    >
      <TransientNotice />
      <CatchUp />
      <UpdatePrompt />
      <DeviceHealth />
      <AdvertMenu />
      <ProposalsButton />
      <LatestMessage />
      <NotificationBell />
    </footer>
  );
}

// The bar's transient line, in the VS Code idiom: the newest notice arrives at
// the left edge, holds, and fades. Never a card and never an overlay, so it
// cannot cover a control the user is reaching for, and it carries no dismiss
// button — anything worth keeping by hand is a drawer row instead. Like the
// bar's other truncating items it gives up width as the bar tightens, so a
// long message is cut rather than pushing anything off the end. A `'bar'`
// notice keeps the untruncated text in the drawer; a `'none'` one keeps
// nothing, which is why that surface is for receipts short enough to read
// whole.
//
// Hidden from the accessibility tree: `NoticeAnnouncer` speaks every notice,
// this one included, and announcing both would read it twice.
function TransientNotice() {
  const notice = useMeshStore((s) => s.barNotice);
  if (!notice) return null;
  return (
    <>
      {/* Keyed by the notice id so a replacement restarts the fade rather than
          inheriting whatever was left of the previous one's. */}
      <span
        key={notice.id}
        aria-hidden='true'
        className={`notice-line min-w-0 truncate ${LEVEL_COLOR[notice.level]}`}
      >
        {notice.text}
      </span>
      <Divider />
    </>
  );
}

// The connect-time drain is capped so the UI comes up promptly, and a deeper
// offline queue finishes in the background. This is the only standing sign
// that it is still running — without it the remainder arrives unannounced,
// since the arrivals themselves are collapsed into one summary at the end.
//
// Indeterminate by necessity: the companion protocol has no queue-depth query,
// so neither a percentage nor a remaining count is knowable. The spinner says
// "still going" and nothing it cannot back up.
function CatchUp() {
  const { t } = useTranslation();
  const draining = useMeshStore((s) => s.backlogDraining);
  const label = t('actionBar.catchingUp');
  return (
    <>
      {/*
        Announced, because while the catch-up runs the per-message notices
        that would otherwise be read out are suppressed — without this a
        screen reader gets no cue at all that a backlog is landing. The end is
        covered by the summary notice's own announcement.

        Mounted for the whole session rather than alongside the spinner: a live
        region inserted with its text already in it is commonly not announced,
        and here the whole bar mounts at once on 'connected'. Only the text
        changing is reliable. `sr-only` is absolutely positioned, so the empty
        region is not a flex item and adds no gap to the bar.
      */}
      <span role='status' className='sr-only'>
        {draining ? label : ''}
      </span>
      {draining && (
        <>
          {/* Hidden from the tree: the region above already carries this text,
              at the same place in the bar, and announcing both would read it
              twice in browse mode. */}
          <span aria-hidden='true' className='flex min-w-0 items-center gap-1'>
            <LoaderCircle size={13} className='animate-spin' />
            <span className='truncate'>{label}</span>
          </span>
          <Divider />
        </>
      )}
    </>
  );
}

/**
 * Shared idiom for the bar's own controls, so every item sits alike. It sets
 * no flex sizing: each item adds `shrink-0` to hold its width or `min-w-0` to
 * let its label truncate as the bar tightens.
 */
const BAR_BUTTON =
  'focus-inset flex items-center gap-1 rounded px-1 py-0.5 text-text2 transition-colors hover:text-accent';

// A hairline between neighboring groups, in the VS Code idiom. Each item
// renders its own — trailing for the ones ahead of the advert menu, leading
// for the ones behind it — so a hidden item takes its divider with it and the
// bar never draws a rule with nothing on one side of it. The advert menu is
// the anchor because it is the one item that is always there.
function Divider() {
  return <span aria-hidden='true' className='h-3 w-px shrink-0 bg-border' />;
}

// The pending-deploy notice while connected. `VersionCheck` keeps the polling
// and the disconnected banner; only the presentation forks here, because that
// banner is drawn bottom-center, exactly where this bar now is.
function UpdatePrompt() {
  const { t } = useTranslation();
  const available = useMeshStore((s) => s.updateAvailable);
  return (
    <>
      {/*
        Mounted for the whole session, like CatchUp's: a live region inserted
        with its text already in it is commonly not announced, so only the
        text changing is reliable. That covers an update landing mid-session.
        One noticed earlier survives `reset()`, so the region does mount with
        its text in place — but the connect screen's banner announced it there,
        which is the case this cannot.

        The region carries the event — a new version exists — while the button
        carries the action, so a reader walking the bar is not read the same
        sentence twice.
      */}
      <span role='status' className='sr-only'>
        {available ? t('update.available') : ''}
      </span>
      {available && (
        <>
          <button
            type='button'
            onClick={() => window.location.reload()}
            title={t('update.hint')}
            className={`${BAR_BUTTON} min-w-0 text-accent hover:underline`}
          >
            <RotateCw size={13} aria-hidden='true' />
            <span className='truncate'>{t('update.barLabel')}</span>
          </button>
          <Divider />
        </>
      )}
    </>
  );
}

// Battery and flash usage. Unconditional at every width now that the bar has
// the room the header did not — which is also why the device name's tooltip
// no longer carries a second copy of these values.
function DeviceHealth() {
  const { t } = useTranslation();
  const battery = useMeshStore((s) => s.battery);
  if (!battery) return null;
  return (
    <>
      <span className='flex shrink-0 items-center gap-1 whitespace-nowrap'>
        {formatVoltage(battery.voltage)}
        <HardDrive size={12} aria-hidden='true' />
        <span className='sr-only'>{t('header.storage')}</span>
        {formatStorage(battery.usedKB, battery.totalKB)}
      </span>
      <Divider />
    </>
  );
}

// Opens upward, unlike the header menu it replaces: the bar is the last row on
// the page, so there is nothing below it to drop into.
function AdvertMenu() {
  const { t } = useTranslation();
  const { advertise, sending } = useAdvertise();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss the open menu on an outside click (shared with the app's other
  // popovers) or Escape.
  useClickOutside(ref, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const onSelect = (flood: boolean) => {
    setOpen(false);
    void advertise(flood);
  };

  const itemClass =
    'focus-inset block w-full px-3 py-2 text-left text-xs text-text hover:bg-surface hover:text-accent';

  return (
    <div className='relative shrink-0' ref={ref}>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        disabled={sending}
        aria-label={t('header.advertise')}
        title={t('header.advertise')}
        aria-haspopup='menu'
        aria-expanded={open}
        className={`${BAR_BUTTON} shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text2`}
      >
        <Radio size={13} aria-hidden='true' />
      </button>
      {open && (
        <div
          role='menu'
          className='absolute bottom-full left-0 z-20 mb-1 min-w-max overflow-hidden rounded-md border border-border shadow-pop bg-surface2'
        >
          <button
            role='menuitem'
            onClick={() => onSelect(false)}
            className={itemClass}
          >
            {t('settings.advertiseZeroHop')}
          </button>
          <button
            role='menuitem'
            onClick={() => onSelect(true)}
            className={itemClass}
          >
            {t('settings.advertiseFlood')}
          </button>
        </div>
      )}
    </div>
  );
}

// The popup's open state lives in ProposalsInbox, which is mounted only while
// the queue is non-empty. Draining the queue unmounts it and discards that
// state, so a newly arriving proposal always starts closed.
function ProposalsButton() {
  const count = useMeshStore((s) => s.stagedActions.length);
  if (count === 0) return null;
  return <ProposalsInbox count={count} />;
}

function ProposalsInbox({ count }: { count: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Divider />
      <button
        type='button'
        onClick={() => setOpen(true)}
        aria-label={t('automation.inbox.title', { count })}
        title={t('automation.inbox.title', { count })}
        className={`${BAR_BUTTON} shrink-0`}
      >
        <Inbox size={13} aria-hidden='true' />
        <span
          aria-hidden='true'
          className='rounded-full bg-accent-solid px-1 text-[10px] leading-4 font-semibold text-white'
        >
          {count}
        </span>
      </button>
      {open && (
        <ModalShell
          title={t('automation.inbox.title', { count })}
          onClose={() => setOpen(false)}
        >
          <ApprovalInboxList />
        </ModalShell>
      )}
    </>
  );
}

/** How often the quick link's stamp re-renders while it still reads seconds. */
const TICK_SECONDS_MS = 1000;

/** And once it doesn't: a per-second timer for `3h ago` is pure waste. */
const TICK_MINUTES_MS = 60_000;

// The session's newest inbound message, as a way back to the conversation it
// landed in: the sidebar's unread badges only exist on the chat view, so on
// Nodes, Map, Stats or Settings this is the only standing cue that traffic
// arrived.
function LatestMessage() {
  const { t } = useTranslation();
  const latest = useMeshStore((s) => s.latestInbound);
  const setView = useMeshStore((s) => s.setView);
  const at = latest?.at;
  // A browser clock with no store equivalent: nothing but this one label
  // changes when it advances, so the re-render is scoped to this component.
  const [, advance] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (at === undefined) return;
    const period = () =>
      Math.floor(Date.now() / 1000) - at < 60
        ? TICK_SECONDS_MS
        : TICK_MINUTES_MS;
    // Re-armed rather than an interval, so crossing the first minute changes
    // the rate without the effect having to re-run.
    let timer = window.setTimeout(function tick() {
      advance();
      timer = window.setTimeout(tick, period());
    }, period());
    return () => window.clearTimeout(timer);
  }, [at]);

  if (!latest) return null;
  const { convo, sender } = latest;
  const age = formatRelativePrecise(latest.at);
  // Neither the accessible name nor the tooltip below ticks with the visible
  // stamp. An accessible name that changed once a second would be re-announced
  // that often by NVDA and JAWS for as long as the button held focus, and a
  // `title` rewritten that often tears down the very tooltip it exists to
  // show — the only way to read a name the row has truncated. So the
  // accessible name takes a coarse age (`just now` carries the only fact that
  // matters at that range) and the tooltip takes the name alone, the part
  // that truncates.
  const coarseAge = formatRelative(latest.at);
  // A frame that names nobody — a channel text with no `sender: ` prefix, an
  // unsigned room post — falls back to the conversation, and the accessible
  // name switches preposition with it. "from General" would assert that the
  // channel wrote the message, which is why the arrival notice has a separate
  // `…In` string rather than a substituted one.
  //
  // With both in hand the bar names both: on a channel or a room, who wrote it
  // is only half the cue — whether it is worth leaving the current view turns
  // on which of the reader's channels it landed in. A direct message's
  // conversation *is* its sender, so pairing them there would say the same
  // thing twice.
  const inConvo = sender !== null && convo.kind !== 'direct';
  const vars = { sender, convo: convo.label, age: coarseAge };
  const name = inConvo
    ? t('actionBar.latestMessageSenderIn', vars)
    : (sender ?? convo.label);

  const openTarget = () => {
    // This is the one control that routinely aims at the conversation already
    // on screen, because the slot takes visible arrivals too, so it is the one
    // that has to ask. `openConvo` clears the "last unread" divider when it
    // lands somewhere with nothing unread, and there is nothing to open here
    // anyway. Every other caller is a list the reader picked a target from,
    // and keeps that shared behavior.
    if (!isConvoVisible(useMeshStore.getState(), convo.id)) {
      // Open first: switching the view catches the *then*-open conversation
      // up on its unread backlog, and the one being left behind shouldn't be
      // it.
      openConvo(convo);
      setView('chat');
    }
    // Then land the reader in the content, where the drawer's row hands focus
    // too. Unlike that row this button survives the navigation, so focus would
    // otherwise stay in the bar — the last landmark on the page, from which
    // the next Tab leaves for the browser's chrome rather than entering the
    // conversation they just asked for.
    document.getElementById('main')?.focus();
  };

  return (
    <>
      <Divider />
      <button
        type='button'
        onClick={openTarget}
        aria-label={
          inConvo
            ? t('actionBar.latestMessageFromIn', vars)
            : sender
              ? t('actionBar.latestMessageLabel', vars)
              : t('actionBar.latestMessageIn', vars)
        }
        title={name}
        className={`${BAR_BUTTON} min-w-0`}
      >
        <MessageSquare size={13} aria-hidden='true' className='shrink-0' />
        <span className='max-w-64 truncate'>{name}</span>
        <span className='shrink-0'>·</span>
        <span className='shrink-0 whitespace-nowrap'>{age}</span>
      </button>
    </>
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
    <div className='relative ml-auto shrink-0' ref={rootRef}>
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
        className={`${BAR_BUTTON} shrink-0`}
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
          onNavigate={() => {
            // Not the bell — the reader asked to be taken to the
            // conversation, so land them in the content, the same place the
            // bar's quick link hands focus to.
            close(false);
            document.getElementById('main')?.focus();
          }}
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
    // Row controls only: clamping across every button in the drawer could
    // land on Clear all, and the reader's next Enter would wipe the history
    // when all they meant to do was dismiss one row.
    const buttons = () => [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('li button') ?? []),
    ];
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

  // `hasFocus()` below is a point-in-time read, and focus can leave the
  // document long before the list next changes. Clear the flag when it does,
  // so a reader who steps away and comes back with nothing focused does not
  // get hauled onto a row by the next arrival.
  useEffect(() => {
    const onWindowBlur = () => {
      heldFocus.current = false;
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, []);

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
        const buttons = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>('li button') ??
            []),
        ];
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
