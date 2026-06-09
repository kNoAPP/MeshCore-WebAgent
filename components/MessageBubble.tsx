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
  text: string;
  deviceName: string;
  mentioned: boolean;
}

function renderText(text: string, deviceName: string): React.ReactNode[] {
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
            : 'font-semibold text-(--accent)'
        }
      >
        {part}
      </span>
    );
  });
}

export function MessageBubble({ msg, text, deviceName, mentioned }: Props) {
  const time = msg.timestamp ? formatTime(msg.timestamp) : '';

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
        {renderText(text, deviceName)}
      </div>
      <div className='px-1 text-[10px] text-(--text2)'>
        {[msg.snr != null ? `SNR: ${msg.snr > 0 ? '+' : ''}${msg.snr.toFixed(2)} dB` : null, time]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </>
  );
}
