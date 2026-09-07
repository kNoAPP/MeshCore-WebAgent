// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  Fragment,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import {
  ADV_ICON,
  utf8ByteLength,
  formatPubkey,
  isPublicChannelSecret,
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

// Within this distance of the bottom, an incoming message auto-scrolls into
// view; past it the user is reading history, so their position is preserved.
const NEAR_BOTTOM_PX = 120;

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

// The firmware formats a channel message's text as `<sender>: <body>`.
function splitChannelMessage(text: string): {
  sender: string | null;
  body: string;
} {
  const colonIdx = text.indexOf(': ');
  if (colonIdx === -1) return { sender: null, body: text };
  return { sender: text.slice(0, colonIdx), body: text.slice(colonIdx + 2) };
}

/**
 * The main conversation pane for the active channel or contact: header with
 * route info, the scrolling message list, and the composer with at-mention
 * autocomplete, retry actions, and a repeater-can't-message guard.
 */
export function ChatArea() {
  const { activeConvo, msgHistory, contacts, channels, deviceName } =
    useMeshStore();
  const scrollToMsgId = useMeshStore((s) => s.scrollToMsgId);
  const setScrollToMsgId = useMeshStore((s) => s.setScrollToMsgId);
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);
  const unreadMarker = useMeshStore((s) =>
    activeConvo ? (s.unreadMarkers[activeConvo.id] ?? null) : null,
  );
  const { sendMessage, retryMessage } = useMeshCore();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
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

  const messages = useMemo(
    () => (activeConvo ? (msgHistory[activeConvo.id] ?? []) : []),
    [activeConvo, msgHistory],
  );

  // For each message, the timestamp to render a date divider above it (the
  // first message of each local calendar day), or null. Timestamp-less
  // messages never open a new day, so they don't produce spurious dividers.
  const dayDividers = useMemo(
    () =>
      messages.map((msg, i) => {
        if (!msg.timestamp) return null;
        const dayKey = new Date(msg.timestamp * 1000).toDateString();
        // Compare against the most recent earlier message that has a
        // timestamp, so gaps of timestamp-less messages don't split a day.
        let prevDayKey: string | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const prevTs = messages[j].timestamp;
          if (prevTs) {
            prevDayKey = new Date(prevTs * 1000).toDateString();
            break;
          }
        }
        return dayKey !== prevDayKey ? msg.timestamp : null;
      }),
    [messages],
  );

  // Mentionable names span both saved contacts and anyone seen posting in
  // history, so channel participants who were never added as a contact can
  // still be mentioned. Contacts come first (most relevant), then history
  // senders, de-duplicated case-insensitively while keeping first-seen casing.
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
      const live = convoId
        ? (useMeshStore.getState().msgHistory[convoId] ?? [])
        : [];
      const last = live[live.length - 1];
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
  // clear the one-shot request.
  useEffect(() => {
    if (!scrollToMsgId) return;
    const el = messagesRef.current?.querySelector<HTMLElement>(
      `[data-msg-id="${scrollToMsgId}"]`,
    );
    setScrollToMsgId(null);
    if (!el) return;
    el.scrollIntoView({ behavior: 'auto', block: 'center' });
    flashTarget(el);
  }, [scrollToMsgId, activeConvo?.id, setScrollToMsgId]);

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
    if (nearBottom) setShowNewIndicator(false);
  };

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
  // transmitted. Channel sends also carry a "<sender>: " prefix that counts
  // toward the firmware limit; the cap here ignores it, so a channel message
  // right at the limit can still be trimmed by the radio.
  const byteCount = utf8ByteLength(text.trim());
  const overLimit = byteCount > MAX_MSG_BYTES;

  const handleSend = useCallback(async () => {
    const body = text;
    if (!body.trim() || sending || !activeConvo || overLimit) return;
    setSending(true);
    // Clear and refocus optimistically, before the radio I/O: the bubble's own
    // status tracks in-flight state, so the composer is free for the next
    // message immediately, and a slow send never strands focus on <body>.
    setText('');
    setMentionQuery(null);
    textareaRef.current?.focus();
    await sendMessage(body, activeConvo);
    setSending(false);
  }, [text, sending, activeConvo, overLimit, sendMessage]);

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
      <div className='flex flex-1 items-center justify-center text-sm text-(--text2)'>
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
      <div
        className='flex shrink-0 items-center gap-2.5 border-b px-4 py-3'
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <span className='text-lg'>{icon}</span>
        <span className='text-[15px] font-semibold'>{activeConvo.label}</span>
        {directContact && <RouteChip contact={directContact} />}
        <span className='ml-auto text-xs text-(--text2)'>
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
          className='flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4'
          ref={messagesRef}
          onScroll={handleMessagesScroll}
        >
          {messages.length === 0 && (
            <div className='mt-8 text-center text-xs text-(--text2)'>
              {t('chat.noMessages')}
            </div>
          )}
          {messages.map((msg, i) => {
            let senderLabel: string;
            let bodyText = msg.text;

            if (msg.own) {
              senderLabel = t('chat.you');
            } else if (msg.kind === 'channel') {
              const { sender, body } = splitChannelMessage(msg.text);
              senderLabel = sender ?? '?';
              bodyText = body;
            } else {
              const contact = msg.pubkeyPrefix
                ? contacts[msg.pubkeyPrefix]
                : undefined;
              senderLabel =
                contact?.name ?? msg.pubkeyPrefix?.slice(0, 8) ?? '?';
            }

            const mentioned =
              !msg.own &&
              !msg.system &&
              deviceName.length > 0 &&
              bodyText.toLowerCase().includes(`@[${deviceName.toLowerCase()}]`);

            const dividerTs = dayDividers[i];

            return (
              <Fragment key={msg.id ?? i}>
                {dividerTs != null && (
                  <div className='my-1 flex justify-center'>
                    <div className='rounded-lg border border-dashed border-(--border) px-3 py-1.5 text-[11px] text-(--text2)'>
                      {formatDateDivider(dividerTs)}
                    </div>
                  </div>
                )}
                {msg.id != null && msg.id === unreadMarker && (
                  <div
                    className='my-1 flex items-center gap-2'
                    data-unread-divider
                  >
                    <div
                      className='h-px flex-1'
                      style={{ background: 'var(--red)' }}
                    />
                    <span
                      className='text-[11px] font-semibold'
                      style={{ color: 'var(--red)' }}
                    >
                      {t('chat.lastUnread')}
                    </span>
                    <div
                      className='h-px flex-1'
                      style={{ background: 'var(--red)' }}
                    />
                  </div>
                )}
                <div
                  className={`flex flex-col gap-0.5 ${msg.own ? 'items-end' : 'items-start'}`}
                  data-msg-id={msg.id}
                >
                  {!msg.system && (
                    <div className='px-1 text-[11px] text-(--text2)'>
                      {senderLabel}
                    </div>
                  )}
                  <MessageBubble
                    msg={msg}
                    text={bodyText}
                    deviceName={deviceName}
                    mentioned={mentioned}
                    statusActions={
                      msg.own && msg.status === 'failed' ? (
                        <span
                          className='mr-1.5 inline-flex items-center gap-1.5'
                          style={{ color: 'var(--amber)' }}
                        >
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
            className='absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition hover:opacity-90'
            style={{ background: 'var(--accent)' }}
          >
            {t('chat.newMessages')}
            <span aria-hidden>↓</span>
          </button>
        )}
      </div>

      {/* Input bar */}
      {directContact?.advType === ADV_TYPE_REPEATER ? (
        <div
          className='shrink-0 border-t px-4 py-3 text-center text-xs text-(--text2)'
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {t('chat.repeaterCantMessage')}
        </div>
      ) : (
        <div
          className='relative flex shrink-0 flex-col border-t'
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {suggestions.length > 0 && (
            <ul
              id={MENTION_LISTBOX_ID}
              role='listbox'
              aria-label={t('chat.mentions')}
              className='absolute right-4 bottom-full left-4 mb-1 overflow-hidden rounded-[10px] border border-(--border) shadow-lg'
              style={{ background: 'var(--surface2)' }}
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
                    className={`block w-full px-3 py-2 text-left text-sm text-(--text) hover:text-(--accent) ${
                      i === activeMentionIndex
                        ? 'bg-(--surface) text-(--accent)'
                        : ''
                    }`}
                  >
                    @{name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className='flex items-end gap-2 px-4 py-3'>
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
              className='flex-1 resize-none overflow-y-hidden rounded-[10px] border border-(--border) bg-(--surface2) px-3 py-2
              text-sm text-(--text) outline-none
              placeholder:text-(--text2) focus:border-(--accent)'
              style={{ maxHeight: 120 }}
            />
            {/* A live status stands in for the combobox `aria-expanded` a native
                textarea can't carry, announcing when suggestions appear. */}
            <span className='sr-only' role='status'>
              {suggestions.length > 0
                ? t('chat.mentionCount', { count: suggestions.length })
                : ''}
            </span>
            <span
              title={overLimit ? t('chat.overByteLimit') : undefined}
              className={`self-center text-[11px] ${
                overLimit
                  ? 'text-(--red)'
                  : byteCount > MAX_MSG_BYTES - 20
                    ? 'text-(--yellow)'
                    : 'text-(--text2)'
              }`}
            >
              {byteCount}/{MAX_MSG_BYTES}
            </span>
            <button
              type='button'
              onClick={handleSend}
              disabled={!text.trim() || sending || overLimit}
              aria-label={t('chat.send')}
              className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-(--accent)
              text-base text-white transition-opacity
              hover:opacity-85 disabled:opacity-40'
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
