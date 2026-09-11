// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Check, CheckCheck, Clock, type LucideIcon } from 'lucide-react';
import type { Message } from '@/types/meshcore';
import { fixed, formatTime } from '@/lib/i18n/format';
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
            ? // Own bubbles are already a deep accent fill, so the surface
              // tone would bury the name there.
              own
              ? 'font-semibold text-mention-own'
              : 'font-semibold text-mention'
            : own
              ? // Already white on the deep accent fill; weight alone marks
                // the mention, since no tint clears 4.5:1 against it.
                'font-semibold text-white'
              : 'font-semibold text-accent'
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
): { Icon: LucideIcon; label: string; hint: string; className: string } | null {
  if (!msg.own || !msg.status) return null;
  switch (msg.status) {
    case 'sending':
      return {
        Icon: Clock,
        label: t('message.sendingLabel'),
        hint: t('message.sending'),
        className: 'text-text2',
      };
    case 'sent':
      return msg.kind === 'channel'
        ? {
            Icon: Check,
            label: t('message.sentLabel'),
            hint: t('message.broadcastSent'),
            className: 'text-text2',
          }
        : {
            // A direct message can sit here for up to thirty seconds waiting
            // on an acknowledgment that may never come, so say so in words
            // rather than leaving a tick to be interpreted.
            Icon: Check,
            label: t('message.awaitingLabel'),
            hint: msg.routeFlood
              ? t('message.sentFloodAwaiting')
              : t('message.sentAwaiting'),
            className: 'text-text2',
          };
    case 'delivered':
      return {
        Icon: CheckCheck,
        label: t('message.deliveredLabel'),
        hint: msg.roundTripMs
          ? t('message.deliveredIn', {
              seconds: fixed(msg.roundTripMs / 1000, 1),
            })
          : t('message.delivered'),
        className: 'text-green',
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
 *
 * @remarks Memoized: a long conversation mounts hundreds of these, and the
 * props of an already-rendered message never change once it settles, so an
 * unrelated store write (a heard advert, a battery poll) re-renders none of
 * them.
 */
export const MessageBubble = memo(function MessageBubble({
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
        <div className='rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-text2 italic'>
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
          className={`max-w-[48rem] px-3 py-2 text-sm leading-snug whitespace-pre-wrap wrap-break-word ${
            msg.own
              ? 'rounded-[14px_4px_14px_14px] bg-accent-solid text-white'
              : mentioned
                ? 'rounded-[4px_14px_14px_14px] border border-mention/60 bg-mention/10 text-text'
                : 'rounded-[4px_14px_14px_14px] bg-surface2 text-text'
          }`}
        >
          {renderText(text, deviceName, msg.own ?? false)}
        </div>
        <span className='opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100'>
          <CopyButton value={text} />
        </span>
      </div>
      <div className='px-1 text-[10px] text-text2'>
        {statusActions}
        {tick && (
          <span
            className={`mr-1 inline-flex items-center gap-1 ${tick.className}`}
          >
            <tick.Icon size={12} aria-hidden='true' />
            <HintToken label={tick.label} title={tick.hint} />
          </span>
        )}
        {metaParts(t, msg, time).map((part, i) => (
          <span key={i}>
            {(i > 0 || tick || statusActions) && ' · '}
            {part}
          </span>
        ))}
      </div>
    </>
  );
});

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
        <HintToken
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
      <HintToken
        label={t('message.heardBy', { count: msg.heardByRepeaters })}
        title={title}
      />,
    );
  }

  if (time) parts.push(time);
  return parts;
}

/**
 * A short label with an optional explanation. Focusable and linked via
 * `aria-describedby`, so the detail is announced by screen readers and
 * reachable without a mouse; without a `title` it is just the label.
 */
function HintToken({
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
          rounded-md border border-border bg-surface2 px-2 py-1 font-mono text-text
          shadow-pop group-hover/path:block group-focus/path:block'
      >
        {title}
      </span>
    </span>
  );
}
