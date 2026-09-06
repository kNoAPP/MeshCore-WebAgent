// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Message } from '@/types/meshcore';
import { formatTime } from '@/lib/i18n/format';
import { CopyButton } from './CopyButton';

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

const URL_SPLIT_REGEX = /(https?:\/\/[^\s]+)/g;
const URL_TEST_REGEX = /^https?:\/\/[^\s]+$/;

function renderLinks(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(URL_SPLIT_REGEX);
  return parts.map((part, i) => {
    if (!URL_TEST_REGEX.test(part)) return part;
    // Trailing punctuation is commonly not part of the intended URL.
    const trailingMatch = part.match(/[.,!?;:)\]]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const href = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <span key={`${keyPrefix}-${i}`}>
        <a
          href={href}
          target='_blank'
          rel='noopener noreferrer'
          className='underline decoration-current/50 underline-offset-2 hover:decoration-current'
        >
          {href}
        </a>
        {trailing}
      </span>
    );
  });
}

function renderText(
  text: string,
  deviceName: string,
  own: boolean,
): React.ReactNode[] {
  const parts = text.split(/(@\[[^\]]+\])/g);
  return parts.flatMap((part, i) => {
    if (!part.startsWith('@[')) return renderLinks(part, String(i));
    const isSelf =
      deviceName.length > 0 &&
      part.toLowerCase() === `@[${deviceName.toLowerCase()}]`;
    return (
      <span
        key={i}
        className={
          isSelf
            ? 'mention-self font-semibold text-yellow-300'
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

// Null for an incoming message, and for the failed state, which is rendered
// separately.
function statusTick(
  t: TFunction,
  msg: Message,
): { glyph: string; title: string; color?: string } | null {
  if (!msg.own || !msg.status) return null;
  switch (msg.status) {
    case 'sending':
      return { glyph: '⏳', title: t('message.sending') };
    case 'sent':
      return msg.kind === 'channel'
        ? {
            glyph: '✓',
            title: t('message.broadcastSent'),
          }
        : {
            glyph: '✓',
            title: msg.routeFlood
              ? t('message.sentFloodAwaiting')
              : t('message.sentAwaiting'),
          };
    case 'delivered':
      return {
        glyph: '✓✓',
        title: msg.roundTripMs
          ? t('message.deliveredIn', {
              seconds: (msg.roundTripMs / 1000).toFixed(1),
            })
          : t('message.delivered'),
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
  const { t } = useTranslation();
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';
  const tick = statusTick(t, msg);

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
        className={`group/msg flex w-full items-center gap-1.5 ${
          msg.own ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        <div
          className={`max-w-[70%] px-3 py-2 text-sm leading-snug whitespace-pre-wrap wrap-break-word ${
            msg.own
              ? 'rounded-[14px_4px_14px_14px] bg-(--accent) text-white'
              : mentioned
                ? 'rounded-[4px_14px_14px_14px] border border-yellow-400/60 bg-yellow-400/10 text-(--text)'
                : 'rounded-[4px_14px_14px_14px] bg-(--surface2) text-(--text)'
          }`}
        >
          {renderText(text, deviceName, msg.own ?? false)}
        </div>
        <span className='opacity-0 transition-opacity group-hover/msg:opacity-100'>
          <CopyButton value={text} />
        </span>
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
        {metaParts(t, msg, time).map((part, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            {part}
          </span>
        ))}
      </div>
    </>
  );
}

function metaParts(
  t: TFunction,
  msg: Message,
  time: string,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];

  if (msg.snr != null) {
    parts.push(
      t('message.snr', {
        value: `${msg.snr > 0 ? '+' : ''}${msg.snr.toFixed(2)}`,
      }),
    );
  }

  if (!msg.own && msg.pathLen != null) {
    if (msg.pathLen === 0) {
      parts.push(t('message.direct'));
    } else {
      const title = msg.path?.length
        ? t('message.path', { path: msg.path.join(' → ') })
        : undefined;
      parts.push(
        <PathToken
          label={t('message.hops', { count: msg.pathLen })}
          title={title}
        />,
      );
    }
  }

  if (msg.own && msg.heardByRepeaters) {
    const title = msg.heardVia?.length
      ? t('message.heardVia', { path: msg.heardVia.join(', ') })
      : undefined;
    parts.push(
      <PathToken
        label={t('message.heardBy', { count: msg.heardByRepeaters })}
        title={title}
      />,
    );
  }

  if (time) parts.push(time);
  return parts;
}

// Focusable and linked via `aria-describedby`, so the path is announced by
// screen readers and reachable without a mouse.
function PathToken({
  label,
  title,
}: {
  label: string;
  title?: string;
}): React.ReactNode {
  const tooltipId = useId();
  if (!title) return label;
  return (
    <span
      tabIndex={0}
      aria-describedby={tooltipId}
      className='group/path relative cursor-help underline decoration-dotted'
    >
      {label}
      <span
        id={tooltipId}
        role='tooltip'
        className='pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-max max-w-60
          rounded-md border border-(--border) bg-(--surface2) px-2 py-1 font-mono text-(--text)
          shadow-lg group-hover/path:block group-focus/path:block'
      >
        {title}
      </span>
    </span>
  );
}
