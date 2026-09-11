// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useMemo } from 'react';
import { useMeshStore } from '@/store/meshStore';
import i18n from '@/lib/i18n';

/**
 * A polite live region carrying the message that just arrived, mounted for the
 * whole app session.
 *
 * @remarks
 * The transcript itself is `aria-live='off'`: a conversation switch swaps the
 * whole list and paging back prepends old rows, and neither is news. This
 * region carries only genuine arrivals.
 *
 * It lives here rather than inside {@link ChatArea} because `ChatArea`
 * unmounts on every trip to Map / Stats / Settings, and a region that comes
 * back with the previous arrival still in it would announce that message a
 * second time. `lastArrival` is the memo's only dependency for the same
 * reason: navigation must not rebuild the value, because re-inserting
 * identical text is what a live region reports as new.
 *
 * Only an arrival that was on screen when it landed is announced — anything
 * else is the toast's job, and repeating it here later would replay it out of
 * context.
 */
export function MessageAnnouncer() {
  const lastArrival = useMeshStore((s) => s.lastArrival);
  const announcement = useMemo(() => {
    if (
      !lastArrival ||
      !lastArrival.visible ||
      lastArrival.own ||
      lastArrival.system
    ) {
      return { id: '', text: '' };
    }
    return {
      id: lastArrival.msgId,
      text: lastArrival.senderName
        ? i18n.t('chat.messageAnnouncement', {
            sender: lastArrival.senderName,
            message: lastArrival.text,
          })
        : lastArrival.text,
    };
  }, [lastArrival]);

  return (
    <span className='sr-only' role='status' aria-live='polite'>
      {/* Keyed by message id: two arrivals with identical text would otherwise
          leave the text node untouched, and a live region only announces what
          actually changed. */}
      <span key={announcement.id}>{announcement.text}</span>
    </span>
  );
}
