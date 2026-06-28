// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ADV_ICON, utf8ByteLength } from '@/lib/utils';
import { MessageBubble } from './MessageBubble';
import { RouteChip } from './RouteChip';
import {
  NO_PATH,
  ADV_TYPE_REPEATER,
  FAVORITE_FLAG,
  MAX_MSG_BYTES,
} from '@/lib/meshcore/constants';

/** Max at-mention autocomplete suggestions shown at once. */
const MAX_SUGGESTIONS = 5;

/**
 * Extracts the in-progress at-mention fragment at the cursor for autocomplete.
 *
 * @returns the text after the nearest at-sign, or null if the cursor isn't in a
 * mention (whitespace follows it, or it's already a completed bracketed
 * mention).
 */
function getMentionQuery(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1) return null;
  const fragment = before.slice(atIdx + 1);
  if (/\s/.test(fragment)) return null;
  if (fragment.startsWith('[') && fragment.includes(']')) return null;
  return fragment;
}

/**
 * The main conversation pane for the active channel or contact: header with
 * route info, the scrolling message list, and the composer with at-mention
 * autocomplete, retry actions, and a repeater-can't-message guard.
 */
export function ChatArea() {
  const { activeConvo, msgHistory, contacts, deviceName } = useMeshStore();
  const { sendMessage, retryMessage } = useMeshCore();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevConvoId = useRef<string | null>(null);

  const messages = activeConvo ? (msgHistory[activeConvo.id] ?? []) : [];

  const contactNames = Object.values(contacts)
    .map((c) => c.name)
    .filter(Boolean);

  const suggestions =
    mentionQuery !== null
      ? contactNames
          .filter((name) =>
            name.toLowerCase().startsWith(mentionQuery.toLowerCase()),
          )
          .slice(0, MAX_SUGGESTIONS)
      : [];

  // Jump to the latest message instantly when switching conversations, but
  // animate smoothly when a new message arrives in the conversation already
  // open. Keying only on message count would miss same-length switches and
  // wrongly animate the rest.
  useEffect(() => {
    const convoId = activeConvo?.id ?? null;
    const switched = prevConvoId.current !== convoId;
    prevConvoId.current = convoId;
    bottomRef.current?.scrollIntoView({
      behavior: switched ? 'auto' : 'smooth',
    });
  }, [activeConvo?.id, messages.length]);

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
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setMentionQuery(
      getMentionQuery(el.value, el.selectionStart ?? el.value.length),
    );
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
    if (!text.trim() || sending || !activeConvo || overLimit) return;
    setSending(true);
    await sendMessage(text, activeConvo);
    setText('');
    setSending(false);
    setMentionQuery(null);
  }, [text, sending, activeConvo, overLimit, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      insertMention(suggestions[0]);
      return;
    }
    if (e.key === 'Escape' && mentionQuery !== null) {
      e.preventDefault();
      setMentionQuery(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) {
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
  const icon =
    activeConvo.kind === 'channel'
      ? activeConvo.rawId === 0
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
            : (activeConvo.rawId as string).slice(0, 16) + '…'}
        </span>
      </div>

      {/* Messages */}
      <div className='flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4'>
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
            const colonIdx = msg.text.indexOf(': ');
            if (colonIdx !== -1) {
              senderLabel = msg.text.slice(0, colonIdx);
              bodyText = msg.text.slice(colonIdx + 2);
            } else {
              senderLabel = '?';
            }
          } else {
            const contact = msg.pubkeyPrefix
              ? contacts[msg.pubkeyPrefix]
              : undefined;
            senderLabel = contact?.name ?? msg.pubkeyPrefix?.slice(0, 8) ?? '?';
          }

          const mentioned =
            !msg.own &&
            !msg.system &&
            deviceName.length > 0 &&
            bodyText.toLowerCase().includes(`@[${deviceName.toLowerCase()}]`);

          return (
            <div
              key={msg.id ?? i}
              className={`flex flex-col gap-0.5 ${msg.own ? 'items-end' : 'items-start'}`}
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
                            onClick={() => retryMessage(msg, activeConvo, true)}
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
          );
        })}
        <div ref={bottomRef} />
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
            <div
              className='absolute bottom-full left-4 right-4 mb-1 overflow-hidden rounded-[10px] border border-(--border) shadow-lg'
              style={{ background: 'var(--surface2)' }}
            >
              {suggestions.map((name) => (
                <button
                  key={name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(name);
                  }}
                  className='w-full px-3 py-2 text-left text-sm text-(--text) hover:bg-(--surface) hover:text-(--accent)'
                >
                  @{name}
                </button>
              ))}
            </div>
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
              className='flex-1 resize-none overflow-y-hidden rounded-[10px] border border-(--border) bg-(--surface2) px-3 py-2
              text-sm text-(--text) outline-none
              placeholder:text-(--text2) focus:border-(--accent)'
              style={{ maxHeight: 120 }}
            />
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
              onClick={handleSend}
              disabled={!text.trim() || sending || overLimit}
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
