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

import type { Message } from '@/types/meshcore';
import { formatTime } from '@/lib/utils';

interface Props {
  msg: Message;
  /**
   * The display text (already resolved from the message, e.g. sender-prefixed).
   */
  text: string;
  /** This radio's name, used to highlight self-mentions. */
  deviceName: string;
  /** Whether this radio is at-mentioned in the message (tints the bubble). */
  mentioned: boolean;
  /**
   * Optional controls (e.g. retry) rendered in the status line under the
   * bubble.
   */
  statusActions?: React.ReactNode;
}

/**
 * Splits message text into nodes, styling bracketed name-mention tokens
 * (self/own/other get distinct colors).
 */
function renderText(
  text: string,
  deviceName: string,
  own: boolean,
): React.ReactNode[] {
  const parts = text.split(/(@\[[^\]]+\])/g);
  return parts.map((part, i) => {
    if (!part.startsWith('@[')) return part;
    const isSelf =
      deviceName.length > 0 &&
      part.toLowerCase() === `@[${deviceName.toLowerCase()}]`;
    return (
      <span
        key={i}
        className={
          isSelf
            ? 'font-semibold text-yellow-300'
            : own
              ? 'font-semibold text-lime-300'
              : 'font-semibold text-(--accent)'
        }
      >
        @{part.slice(2, -1)}
      </span>
    );
  });
}

/**
 * The delivery-status glyph for an own message (⏳ / ✓ / ✓✓), with tooltip and
 * optional color. Null for incoming messages or the failed state (handled
 * separately).
 */
function statusTick(
  msg: Message,
): { glyph: string; title: string; color?: string } | null {
  if (!msg.own || !msg.status) return null;
  switch (msg.status) {
    case 'sending':
      return { glyph: '⏳', title: 'Sending…' };
    case 'sent':
      return msg.kind === 'channel'
        ? {
            glyph: '✓',
            title: 'Broadcast sent — channels have no delivery receipts',
          }
        : {
            glyph: '✓',
            title: `Sent${msg.routeFlood ? ' via flood' : ''} — awaiting delivery confirmation`,
          };
    case 'delivered':
      return {
        glyph: '✓✓',
        title: msg.roundTripMs
          ? `Delivered in ${(msg.roundTripMs / 1000).toFixed(1)}s`
          : 'Delivered',
        color: 'var(--green)',
      };
    case 'failed':
      // The "! No acknowledgment" row rendered below the bubble covers this
      // state
      return null;
  }
}

/**
 * One chat message: a styled bubble (own / mentioned / plain, or a centered
 * system note) plus a metadata line with delivery status, SNR, hop count, and
 * time.
 */
export function MessageBubble({
  msg,
  text,
  deviceName,
  mentioned,
  statusActions,
}: Props) {
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';
  const tick = statusTick(msg);

  if (msg.system) {
    return (
      <div className='my-1 flex justify-center'>
        <div className='rounded-lg border border-dashed border-(--border) px-3 py-1.5 text-[11px] text-(--text2) italic'>
          {text}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`max-w-[70%] px-3 py-2 text-sm leading-snug wrap-break-word ${
          msg.own
            ? 'rounded-[14px_4px_14px_14px] bg-(--accent) text-white'
            : mentioned
              ? 'rounded-[4px_14px_14px_14px] border border-yellow-400/60 bg-yellow-400/10 text-(--text)'
              : 'rounded-[4px_14px_14px_14px] bg-(--surface2) text-(--text)'
        }`}
      >
        {renderText(text, deviceName, msg.own ?? false)}
      </div>
      <div className='px-1 text-[10px] text-(--text2)'>
        {statusActions}
        {tick && (
          <span
            title={tick.title}
            className='mr-1 cursor-default font-semibold'
            style={tick.color ? { color: tick.color } : undefined}
          >
            {tick.glyph}
          </span>
        )}
        {[
          msg.snr != null
            ? `SNR: ${msg.snr > 0 ? '+' : ''}${msg.snr.toFixed(2)} dB`
            : null,
          !msg.own && msg.pathLen != null
            ? msg.pathLen === 0
              ? 'Direct'
              : `${msg.pathLen} hop${msg.pathLen === 1 ? '' : 's'}`
            : null,
          msg.own && msg.heardByRepeaters
            ? `Heard by ${msg.heardByRepeaters} repeater${msg.heardByRepeaters === 1 ? '' : 's'}`
            : null,
          time,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </>
  );
}
