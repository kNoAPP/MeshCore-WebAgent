// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  Fragment,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Send } from 'lucide-react';
import { useMeshStore, isConvoVisible } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import {
  ADV_ICON,
  utf8ByteLength,
  formatPubkey,
  isPublicChannelSecret,
  splitChannelMessage,
} from '@/lib/utils';
import { formatDateDivider } from '@/lib/i18n/format';
import { flashTarget } from '@/lib/ui/flash';
import { MessageBubble } from './MessageBubble';
import { RouteChip } from './RouteChip';
import {
  NO_PATH,
  ADV_TYPE_REPEATER,
  FAVORITE_FLAG,
  MAX_MSG_BYTES,
} from '@/lib/meshcore/constants';

const MAX_SUGGESTIONS = 5;

// Messages mounted per page of chat history. The newest page renders on open;
// scrolling to the top pages another in.
const MESSAGE_PAGE = 50;

// Within this distance of the bottom, an incoming message auto-scrolls into
// view; past it the user is reading history, so their position is preserved.
const NEAR_BOTTOM_PX = 120;

// Within this distance of the top, the next page of history is mounted, so
// reading back is continuous rather than a click.
const NEAR_TOP_PX = 240;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

// Null when the cursor isn't in a mention: whitespace follows the at-sign, the
// mention is already bracketed and complete, or the `@` is mid-word (an email
// local part like `bob@…` must not open the mention popover).
function getMentionQuery(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1) return null;
  if (atIdx > 0 && /\S/.test(before[atIdx - 1])) return null;
  const fragment = before.slice(atIdx + 1);
  if (/\s/.test(fragment)) return null;
  if (fragment.startsWith('[') && fragment.includes(']')) return null;
  return fragment;
}

const MENTION_LISTBOX_ID = 'mention-suggestions';
const mentionOptionId = (index: number) => `mention-option-${index}`;

// How far apart two messages from the same sender can be and still read as one
// turn, in seconds. Beyond it the header repeats, because the reader has lost
// the thread of who was speaking.
const GROUP_WINDOW_SEC = 5 * 60;

/**
 * The main conversation pane for the active channel or contact: header with
 * route info, the scrolling message list, and the composer with at-mention
 * autocomplete, retry actions, and a repeater-can't-message guard.
 */
export function ChatArea() {
  const activeConvo = useMeshStore((s) => s.activeConvo);
  const msgHistory = useMeshStore((s) => s.msgHistory);
  const contacts = useMeshStore((s) => s.contacts);
  const channels = useMeshStore((s) => s.channels);
  const deviceName = useMeshStore((s) => s.deviceName);
  const scrollToMsgId = useMeshStore((s) => s.scrollToMsgId);
  const setScrollToMsgId = useMeshStore((s) => s.setScrollToMsgId);
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);
  const unreadMarker = useMeshStore((s) =>
    activeConvo ? (s.unreadMarkers[activeConvo.id] ?? null) : null,
  );
  const { sendMessage, retryMessage } = useMeshCore();
  const { t } = useTranslation();
  const convoId = activeConvo?.id ?? null;
  // The composer is backed by the store rather than local state: ChatArea is
  // never remounted on a conversation switch, so a local draft would stay in
  // the box and re-target itself at whatever conversation is now open.
  const text = useMeshStore((s) => (convoId ? (s.drafts[convoId] ?? '') : ''));
  const setDraft = useMeshStore((s) => s.setDraft);
  const setText = useCallback(
    (value: string) => {
      if (convoId) setDraft(convoId, value);
    },
    [convoId, setDraft],
  );
  // Tagged with the conversation it was typed in: the composer swaps to the new
  // conversation's draft on a switch, so an untagged query would leave the
  // popover open over text that is no longer in the box.
  const [mention, setMention] = useState<{
    convoId: string;
    query: string;
  } | null>(null);
  const mentionQuery =
    mention && mention.convoId === convoId ? mention.query : null;
  const setMentionQuery = useCallback(
    (query: string | null) => {
      setMention(query !== null && convoId ? { convoId, query } : null);
    },
    [convoId],
  );
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showNewIndicator, setShowNewIndicator] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevConvoId = useRef<string | null>(null);
  // Whether the user was near the bottom as of their last scroll. Captured
  // before a new message appends (which grows the list and would otherwise
  // inflate a live distance measurement), so a tall incoming message can't be
  // mistaken for the user having scrolled up.
  const atBottomRef = useRef(true);
  // Distance from the bottom captured just before a page of history is
  // prepended, so the reading position can be restored after it mounts. Tagged
  // with the conversation it was measured in: a switch between the capture and
  // the commit would otherwise apply it to a different list.
  const growAnchorRef = useRef<{
    convoId: string | null;
    distanceToBottom: number;
  } | null>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(
    () => (activeConvo ? (msgHistory[activeConvo.id] ?? []) : []),
    [activeConvo, msgHistory],
  );

  // The oldest message index the window has been opened back to — by scrolling
  // up, or by a jump — or -1 for just the newest page. An index rather than a
  // tail count because history only ever appends: an index survives an
  // incoming message untouched, where a count would have to grow on every one
  // to hold the same messages mounted.
  const [messageWindow, setMessageWindow] = useState({ convoId, start: -1 });
  const sameConvo = messageWindow.convoId === convoId;
  const openedStart = sameConvo ? messageWindow.start : -1;
  // Indices that must stay mounted whatever the paging: the "last unread"
  // divider the open-conversation effect scrolls to, and a pending
  // command-palette jump. Either can sit arbitrarily far back, but both sit
  // near the newest end in practice, so one backwards pass that stops as soon
  // as each wanted id is found beats two full forward scans.
  const { unreadIdx, jumpIdx } = useMemo(() => {
    let unread = -1;
    let jump = -1;
    if (!unreadMarker && !scrollToMsgId) return { unreadIdx: -1, jumpIdx: -1 };
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i].id;
      if (unread === -1 && unreadMarker && id === unreadMarker) unread = i;
      if (jump === -1 && scrollToMsgId && id === scrollToMsgId) jump = i;
      const unreadDone = unread !== -1 || !unreadMarker;
      const jumpDone = jump !== -1 || !scrollToMsgId;
      if (unreadDone && jumpDone) break;
    }
    return { unreadIdx: unread, jumpIdx: jump };
  }, [messages, unreadMarker, scrollToMsgId]);
  // A jump request is one-shot: the scroll effect clears it. Pin how far back
  // it reached, or the target would unmount from under the user the moment it
  // clears. Recorded during render — React's "adjust state when an input
  // changes" pattern — so it lands before the effect consumes the request, and
  // it fires once per jump rather than once per message.
  if (
    !sameConvo ||
    (jumpIdx !== -1 && (openedStart === -1 || jumpIdx < openedStart))
  ) {
    setMessageWindow({ convoId, start: sameConvo ? jumpIdx : -1 });
  }
  const firstVisible = Math.min(
    ...[
      Math.max(0, messages.length - MESSAGE_PAGE),
      ...[openedStart, unreadIdx, jumpIdx].filter((i) => i >= 0),
    ],
  );
  const visibleMessages = useMemo(
    () => messages.slice(firstVisible),
    [messages, firstVisible],
  );

  // For each mounted message, the timestamp to render a date divider above it
  // (the first message of each local calendar day), or null. Timestamp-less
  // messages never open a new day, so they don't produce spurious dividers.
  // Scoped to the window rather than the whole history, so the work scales
  // with what is rendered — which also means the topmost mounted message
  // always carries its own day label instead of inheriting one that scrolled
  // out of range.
  const dayDividers = useMemo(
    () =>
      visibleMessages.map((msg, i) => {
        if (!msg.timestamp) return null;
        const dayKey = new Date(msg.timestamp * 1000).toDateString();
        // Compare against the most recent earlier message that has a
        // timestamp, so gaps of timestamp-less messages don't split a day.
        let prevDayKey: string | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const prevTs = visibleMessages[j].timestamp;
          if (prevTs) {
            prevDayKey = new Date(prevTs * 1000).toDateString();
            break;
          }
        }
        return dayKey !== prevDayKey ? msg.timestamp : null;
      }),
    [visibleMessages],
  );

  // Resolved sender label per mounted message: the channel prefix, the
  // contact's name, or null for a system note and for own messages (which are
  // already marked by their side, color and corner — a "You" header on top of
  // that is pure repetition).
  const senderLabels = useMemo(
    () =>
      visibleMessages.map((msg) => {
        if (msg.system || msg.own) return null;
        if (msg.kind === 'channel') {
          return splitChannelMessage(msg.text).sender?.trim() || '?';
        }
        const prefix = msg.pubkeyPrefix;
        const contact = prefix
          ? (contacts[prefix] ??
            Object.values(contacts).find((entry) =>
              entry.pubkeyPrefix.startsWith(prefix),
            ))
          : undefined;
        return (
          contact?.name ||
          msg.senderName ||
          msg.pubkeyPrefix?.slice(0, 8) ||
          '?'
        );
      }),
    [visibleMessages, contacts],
  );
  const senderKeys = useMemo(
    () =>
      visibleMessages.map((msg) => {
        if (msg.system || msg.own) return null;
        if (msg.kind === 'channel') {
          const sender = splitChannelMessage(msg.text).sender?.trim();
          return sender ? `channel:${sender}` : null;
        }
        return msg.pubkeyPrefix ? `direct:${msg.pubkeyPrefix}` : null;
      }),
    [visibleMessages],
  );

  // Whether each message needs its own sender header. A burst from one contact
  // is one conversational turn, so only the first message of a run carries the
  // name: same sender, same side, no day divider between, and close enough in
  // time to still be the same turn.
  const showHeader = useMemo(
    () =>
      visibleMessages.map((msg, i) => {
        if (senderLabels[i] === null) return false;
        if (i === 0 || dayDividers[i] != null) return true;
        const prev = visibleMessages[i - 1];
        if (!senderKeys[i] || senderKeys[i - 1] !== senderKeys[i]) return true;
        if (prev.own !== msg.own) return true;
        const gap = (msg.timestamp ?? 0) - (prev.timestamp ?? 0);
        return (
          !msg.timestamp || !prev.timestamp || gap < 0 || gap > GROUP_WINDOW_SEC
        );
      }),
    [visibleMessages, senderLabels, senderKeys, dayDividers],
  );

  // Only built while a mention is in progress so the full-history scan stays
  // out of the message-receive hot path.
  const mentionActive = mentionQuery !== null;
  const mentionCandidates = useMemo(() => {
    if (!mentionActive) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    const add = (name: string | undefined) => {
      const trimmed = name?.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      names.push(trimmed);
    };
    for (const contact of Object.values(contacts)) add(contact.name);
    for (const msgs of Object.values(msgHistory)) {
      for (const msg of msgs) {
        if (msg.own || msg.system) continue;
        if (msg.kind === 'channel') {
          add(splitChannelMessage(msg.text).sender ?? undefined);
        } else if (msg.senderName !== msg.pubkeyPrefix?.slice(0, 8)) {
          // Skip the hex-prefix fallback used for unsaved senders — it's an
          // identifier, not a mentionable name.
          add(msg.senderName);
        }
      }
    }
    return names;
  }, [mentionActive, contacts, msgHistory]);

  const suggestions =
    mentionQuery !== null
      ? mentionCandidates
          .filter((name) =>
            name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
          )
          .slice(0, MAX_SUGGESTIONS)
      : [];

  // Clamp so a shrunk suggestion list can't strand the highlight past the end.
  const activeMentionIndex = suggestions.length
    ? Math.min(mentionIndex, suggestions.length - 1)
    : 0;

  // Jump to the latest message instantly when switching conversations, but
  // animate smoothly when a new message arrives in the conversation already
  // open. Keying only on message count would miss same-length switches and
  // wrongly animate the rest.
  useEffect(() => {
    const convoId = activeConvo?.id ?? null;
    const switched = prevConvoId.current !== convoId;
    prevConvoId.current = convoId;
    // Whether this run should jump to the bottom instantly rather than animate
    // (a send from up in history covers a long distance not worth animating).
    let instantJump = false;
    // A pending command-palette jump owns the scroll position — don't yank it
    // to the bottom underneath it. Read live so clearing the flag can't
    // retrigger this effect (its deps deliberately exclude scrollToMsgId).
    if (useMeshStore.getState().scrollToMsgId) return;
    // On switch, land on the "last unread" divider so the user picks up where
    // they left off; fall back to the newest message when there's no unread
    // boundary. Read the marker live to keep it out of the deps.
    if (switched && convoId) {
      setShowNewIndicator(false);
      const marker = useMeshStore.getState().unreadMarkers[convoId];
      const el = marker
        ? messagesRef.current?.querySelector<HTMLElement>(
            '[data-unread-divider]',
          )
        : null;
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
        atBottomRef.current = false;
        return;
      }
    } else {
      // A new message arrived in the already-open conversation. Always follow
      // the user's own just-sent message down; otherwise only follow when they
      // were already near the bottom as of their last scroll. If they've
      // scrolled up to read history, leave their position and surface a "new
      // messages" bubble instead of yanking them down. Read the latest message
      // live to keep `messages` out of the deps (we key on its length, not
      // identity).
      const state = useMeshStore.getState();
      const live = convoId ? (state.msgHistory[convoId] ?? []) : [];
      const last = live[live.length - 1];
      const arrival = state.lastArrival;
      const arrivedHidden =
        arrival?.convoId === convoId &&
        arrival?.msgId === last?.id &&
        !arrival?.visible;
      // Arrived while the conversation was off screen (other tab, other
      // window, other view): leave the scroll where the user left it, so the
      // unread divider they come back to isn't already scrolled past.
      if (convoId && (arrivedHidden || !isConvoVisible(state, convoId))) {
        atBottomRef.current = false;
        return;
      }
      if (!last?.own && !atBottomRef.current) {
        setShowNewIndicator(true);
        return;
      }
      // Sending from within history — jump instantly across the long distance.
      // When already at the bottom, fall through to a smooth short scroll.
      instantJump = (last?.own ?? false) && !atBottomRef.current;
    }
    bottomRef.current?.scrollIntoView({
      behavior: switched || instantJump ? 'auto' : 'smooth',
    });
    atBottomRef.current = true;
  }, [activeConvo?.id, messages.length]);

  // Scroll to and briefly flash a message targeted by the command palette, then
  // clear the one-shot request. The render pass above has already widened the
  // window far enough for the target to be mounted.
  useEffect(() => {
    if (!scrollToMsgId) return;
    const el = messagesRef.current?.querySelector<HTMLElement>(
      `[data-msg-id="${scrollToMsgId}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
      flashTarget(el);
    }
    // Cleared last, so the pinning that keeps the target mounted outlives the
    // scroll; a target that isn't in the DOM still clears rather than sticking.
    setScrollToMsgId(null);
  }, [scrollToMsgId, convoId, setScrollToMsgId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [text]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setText(val);
    setMentionQuery(getMentionQuery(val, cursor));
    setMentionIndex(0);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape dismissed the popover in keydown; don't recompute the same query
    // from the unchanged text here, which would immediately reopen it.
    if (e.key === 'Escape') return;
    const el = e.currentTarget;
    setMentionQuery(
      getMentionQuery(el.value, el.selectionStart ?? el.value.length),
    );
  };

  // Dismiss the "new messages" bubble once the user scrolls back within reach
  // of the bottom, whether by our jump or their own scrolling.
  const handleMessagesScroll = () => {
    const list = messagesRef.current;
    if (!list) return;
    const nearBottom = isNearBottom(list);
    atBottomRef.current = nearBottom;
    if (nearBottom) {
      setShowNewIndicator(false);
    } else if (openedStart === -1) {
      // Reading back through history: pin the window where it is. Left to
      // slide, the newest-N start would advance on every incoming message and
      // unmount rows above the viewport out from under the user.
      setMessageWindow({ convoId, start: firstVisible });
    }
  };

  // Page older history in as the top of the list comes into view, so reading
  // back is continuous. An observer rather than a scroll handler, so a mounted
  // page shorter than the pane — which never fires a scroll event — still
  // fills itself.
  useEffect(() => {
    const list = messagesRef.current;
    const sentinel = topSentinelRef.current;
    if (!list || !sentinel || firstVisible === 0) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || growAnchorRef.current != null) return;
        // Prepending rows pushes the content down, so anchor on the distance
        // to the bottom — which the prepend leaves untouched — and restore it
        // before the browser paints.
        growAnchorRef.current = {
          convoId,
          distanceToBottom: list.scrollHeight - list.scrollTop,
        };
        setMessageWindow({
          convoId,
          start: Math.max(0, firstVisible - MESSAGE_PAGE),
        });
      },
      { root: list, rootMargin: `${NEAR_TOP_PX}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [convoId, firstVisible]);

  useLayoutEffect(() => {
    const list = messagesRef.current;
    const anchor = growAnchorRef.current;
    if (anchor == null || !list) return;
    growAnchorRef.current = null;
    if (anchor.convoId !== convoId) return;
    // While following the live conversation — including the initial fill of a
    // page shorter than the pane — stay pinned to the bottom; the captured
    // anchor only matters once the user has scrolled up into history.
    list.scrollTop = atBottomRef.current
      ? list.scrollHeight
      : list.scrollHeight - anchor.distanceToBottom;
  }, [convoId, firstVisible]);

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    atBottomRef.current = true;
    setShowNewIndicator(false);
  };

  const insertMention = (name: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    const newText = text.slice(0, atIdx) + `@[${name}]` + text.slice(cursor);
    setText(newText);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = atIdx + name.length + 3;
      el.setSelectionRange(pos, pos);
    });
  };

  // The radio caps text by UTF-8 byte length, not character count, so measure
  // the same way it does — against the trimmed value, since that's what gets
  // transmitted. The firmware prepends "<sender>: " to a channel send and
  // counts it against the same limit, so the composer's budget has to reserve
  // it or the radio silently truncates the tail.
  const maxBytes =
    MAX_MSG_BYTES -
    (activeConvo?.kind === 'channel' ? utf8ByteLength(`${deviceName}: `) : 0);
  const byteCount = utf8ByteLength(text.trim());
  const overLimit = byteCount > maxBytes;

  const handleSend = useCallback(async () => {
    const body = text;
    if (!body.trim() || !activeConvo || overLimit) return;
    // Clear and refocus optimistically, before the radio I/O, and with no
    // in-flight lockout: a send can sit behind the radio's command queue for
    // ten seconds, the bubble's own status already tracks it, and the client
    // serializes frames, so the composer stays free for the next message.
    // Clear by the id captured here, so a conversation switch mid-send can't
    // wipe the newly-opened conversation's draft instead.
    setDraft(activeConvo.id, '');
    setMentionQuery(null);
    textareaRef.current?.focus();
    await sendMessage(body, activeConvo);
  }, [text, activeConvo, overLimit, sendMessage, setDraft, setMentionQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // While the suggestion popover is open, arrows move the highlight and
    // Enter/Tab accept it; otherwise Enter sends.
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((activeMentionIndex + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(
          (activeMentionIndex - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        insertMention(suggestions[activeMentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!activeConvo) {
    return (
      <div className='flex flex-1 items-center justify-center text-sm text-text2'>
        {t('chat.empty')}
      </div>
    );
  }

  const directContact =
    activeConvo.kind === 'direct'
      ? contacts[activeConvo.rawId as string]
      : undefined;
  const channel =
    activeConvo.kind === 'channel'
      ? channels[activeConvo.rawId as number]
      : undefined;
  const icon =
    activeConvo.kind === 'channel'
      ? isPublicChannelSecret(channel?.secret)
        ? '📢'
        : '🔒'
      : directContact && directContact.flags & FAVORITE_FLAG
        ? '⭐'
        : (ADV_ICON[directContact?.advType ?? 0] ?? '👤');

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {/* Chat header */}
      <div className='flex shrink-0 items-center gap-2.5 border-b px-4 py-3 bg-surface border-border'>
        <span className='text-lg'>{icon}</span>
        <span className='text-[15px] font-semibold'>{activeConvo.label}</span>
        {directContact && <RouteChip contact={directContact} />}
        <span className='ml-auto text-xs text-text2'>
          {activeConvo.kind === 'channel'
            ? t('common.channelName', { index: activeConvo.rawId })
            : formatPubkey(
                directContact?.pubkey ?? (activeConvo.rawId as string),
                showFullPublicKeys,
              )}
        </span>
      </div>

      {/* Messages */}
      <div className='relative flex flex-1 flex-col overflow-hidden'>
        <div
          role='log'
          aria-live='off'
          aria-label={t('chat.transcriptLabel')}
          className='mx-auto flex w-full max-w-4xl flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4'
          ref={messagesRef}
          onScroll={handleMessagesScroll}
        >
          {messages.length === 0 && (
            <div className='mt-8 text-center text-xs text-text2'>
              {t('chat.noMessages')}
            </div>
          )}
          {/* One pixel tall, not zero: a zero-area target is not a reliable
              IntersectionObserver root intersection. */}
          <div ref={topSentinelRef} className='h-px shrink-0' />
          {visibleMessages.map((msg, i) => {
            const bodyText =
              !msg.own && msg.kind === 'channel'
                ? splitChannelMessage(msg.text).body
                : msg.text;
            const mentioned =
              !msg.own &&
              !msg.system &&
              deviceName.length > 0 &&
              bodyText.toLowerCase().includes(`@[${deviceName.toLowerCase()}]`);

            const dividerTs = dayDividers[i];

            return (
              <Fragment key={msg.id ?? firstVisible + i}>
                {dividerTs != null && (
                  <div className='my-1 flex justify-center'>
                    <div className='rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-text2'>
                      {formatDateDivider(dividerTs)}
                    </div>
                  </div>
                )}
                {msg.id != null && msg.id === unreadMarker && (
                  <div
                    className='my-1 flex items-center gap-2'
                    data-unread-divider
                  >
                    <div className='h-px flex-1 bg-red' />
                    <span className='text-[11px] font-semibold text-red'>
                      {t('chat.lastUnread')}
                    </span>
                    <div className='h-px flex-1 bg-red' />
                  </div>
                )}
                <div
                  className={`flex flex-col gap-0.5 ${msg.own ? 'items-end' : 'items-start'}`}
                  data-msg-id={msg.id}
                >
                  {showHeader[i] && (
                    <div className='px-1 text-[11px] text-text2'>
                      {senderLabels[i]}
                    </div>
                  )}
                  <MessageBubble
                    msg={msg}
                    text={bodyText}
                    deviceName={deviceName}
                    mentioned={mentioned}
                    statusActions={
                      msg.own && msg.status === 'failed' ? (
                        <span className='mr-1.5 inline-flex items-center gap-1.5 text-amber'>
                          <span title={t('chat.noAckTooltip')}>
                            {t('chat.noAck')}
                          </span>
                          <span>·</span>
                          <button
                            onClick={() => retryMessage(msg, activeConvo)}
                            className='font-semibold underline hover:opacity-80'
                          >
                            {t('chat.retry')}
                          </button>
                          {msg.kind === 'direct' &&
                            (msg.attempt ?? 0) >= 1 &&
                            directContact &&
                            directContact.outPathLen !== NO_PATH && (
                              <button
                                onClick={() =>
                                  retryMessage(msg, activeConvo, true)
                                }
                                title={t('chat.resetRouteRetryTooltip')}
                                className='font-semibold underline hover:opacity-80'
                              >
                                {t('chat.resetRouteRetry')}
                              </button>
                            )}
                        </span>
                      ) : undefined
                    }
                  />
                </div>
              </Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>
        {showNewIndicator && (
          <button
            type='button'
            onClick={jumpToBottom}
            className='absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent-solid px-3.5 py-1.5 text-xs font-semibold text-white shadow-pop transition hover:opacity-90'
          >
            {t('chat.newMessages')}
            <ArrowDown size={13} aria-hidden='true' />
          </button>
        )}
      </div>

      {/* Input bar */}
      {directContact?.advType === ADV_TYPE_REPEATER ? (
        <div className='shrink-0 border-t px-4 py-3 text-center text-xs text-text2 bg-surface border-border'>
          {t('chat.repeaterCantMessage')}
        </div>
      ) : (
        <div className='relative flex shrink-0 flex-col border-t bg-surface border-border'>
          {suggestions.length > 0 && (
            <ul
              id={MENTION_LISTBOX_ID}
              role='listbox'
              aria-label={t('chat.mentions')}
              className='absolute right-4 bottom-full left-4 mb-1 overflow-hidden rounded-card border border-border shadow-pop bg-surface2'
            >
              {suggestions.map((name, i) => (
                <li key={name} role='presentation'>
                  <button
                    type='button'
                    id={mentionOptionId(i)}
                    role='option'
                    aria-selected={i === activeMentionIndex}
                    tabIndex={-1}
                    // preventDefault keeps focus in the textarea so the blur
                    // doesn't close the popover before the click lands.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertMention(name)}
                    onMouseMove={() => setMentionIndex(i)}
                    className={`block w-full px-3 py-2 text-left text-sm text-text hover:text-accent ${
                      i === activeMentionIndex ? 'bg-surface text-accent' : ''
                    }`}
                  >
                    @{name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* The live region stays mounted and in the accessibility tree — a
              region revealed in the same tick as its text may not announce.
              When empty it collapses to zero height, so only the inner row
              paints. */}
          <div role='status'>
            {overLimit && (
              <div className='px-4 pt-2 text-[11px] text-red'>
                {t('chat.overByteLimit')}
              </div>
            )}
          </div>
          <div className='mx-auto flex w-full max-w-4xl items-end gap-2 px-4 py-3'>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onClick={
                handleKeyUp as unknown as React.MouseEventHandler<HTMLTextAreaElement>
              }
              rows={1}
              placeholder={t('chat.placeholder')}
              aria-label={t('chat.placeholder')}
              aria-autocomplete='list'
              aria-controls={
                suggestions.length > 0 ? MENTION_LISTBOX_ID : undefined
              }
              aria-activedescendant={
                suggestions.length > 0
                  ? mentionOptionId(activeMentionIndex)
                  : undefined
              }
              className='flex-1 resize-none overflow-y-hidden rounded-card border border-border bg-surface2 px-3 py-2
              text-sm text-text outline-none
              placeholder:text-text2 focus:border-accent'
              style={{ maxHeight: 120 }}
            />
            {/* A native textarea can't carry aria-expanded, so this live
                status announces the popover instead. */}
            <span className='sr-only' role='status'>
              {suggestions.length > 0
                ? t('chat.mentionCount', { count: suggestions.length })
                : ''}
            </span>
            <span
              className={`self-center text-[11px] ${
                overLimit
                  ? 'text-red'
                  : byteCount > maxBytes - 20
                    ? 'text-yellow'
                    : 'text-text2'
              }`}
            >
              {byteCount}/{maxBytes}
            </span>
            <button
              type='button'
              onClick={handleSend}
              disabled={!text.trim() || overLimit}
              aria-label={t('chat.send')}
              className='flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-accent-solid
              text-white transition-opacity
              hover:opacity-85 disabled:opacity-40'
            >
              <Send size={16} aria-hidden='true' />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
