// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ADV_ICON } from '@/lib/utils';
import { MessageBubble } from './MessageBubble';

const FAVOURITE_FLAG = 0x01;

export function ChatArea() {
  const { activeConvo, msgHistory, contacts } = useMeshStore();
  const { sendMessage } = useMeshCore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = activeConvo ? (msgHistory[activeConvo.id] ?? []) : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const handleSend = useCallback(async () => {
    if (!text.trim() || sending || !activeConvo) return;
    setSending(true);
    await sendMessage(text, activeConvo);
    setText('');
    setSending(false);
  }, [text, sending, activeConvo, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const charCount = text.length;

  if (!activeConvo) {
    return (
      <div className='flex flex-1 items-center justify-center text-sm text-(--text2)'>
        Select a channel or contact to start chatting
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
      : directContact && directContact.flags & FAVOURITE_FLAG
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
        <span className='ml-auto text-xs text-(--text2)'>
          {activeConvo.kind === 'channel'
            ? `Channel ${activeConvo.rawId}`
            : (activeConvo.rawId as string).slice(0, 16) + '…'}
        </span>
      </div>

      {/* Messages */}
      <div className='flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4'>
        {messages.length === 0 && (
          <div className='mt-8 text-center text-xs text-(--text2)'>
            No messages yet
          </div>
        )}
        {messages.map((msg, i) => {
          const contact = msg.pubkeyPrefix
            ? contacts[msg.pubkeyPrefix]
            : undefined;
          const senderLabel = msg.own
            ? 'You'
            : (contact?.name ?? msg.pubkeyPrefix?.slice(0, 8) ?? '?');
          return (
            <MessageBubble
              key={msg.id ?? i}
              msg={msg}
              senderLabel={senderLabel}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div
        className='flex shrink-0 items-end gap-2 border-t px-4 py-3'
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={160}
          placeholder='Type a message… (Enter to send, Shift+Enter for newline)'
          className='flex-1 resize-none rounded-[10px] border border-(--border) bg-(--surface2) px-3 py-2
            text-sm text-(--text) outline-none
            placeholder:text-(--text2) focus:border-(--accent)'
          style={{ maxHeight: 120 }}
        />
        <span
          className={`self-center text-[11px] ${charCount > 140 ? 'text-(--yellow)' : 'text-(--text2)'}`}
        >
          {charCount}/160
        </span>
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-(--accent)
            text-base text-white transition-opacity
            hover:opacity-85 disabled:opacity-40'
        >
          ➤
        </button>
      </div>
    </div>
  );
}
