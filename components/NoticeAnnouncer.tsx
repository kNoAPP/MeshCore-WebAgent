// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useMeshStore } from '@/store/meshStore';

/**
 * The session-wide screen-reader announcer for {@link MeshActions.notify}.
 * Errors go to the assertive region and everything else to the polite one, so
 * a failure interrupts and a receipt waits its turn.
 *
 * @remarks Mounted for the whole session because the surfaces a notice
 * actually shows on announce nothing by themselves: a bell badge only changes
 * a number, a transient line only fades, and a `'silent'` notice draws
 * nothing at all.
 *
 * Both regions stay mounted whether or not a notice is set — the text moves in
 * and out of them — because a region inserted together with its text is not
 * announced.
 */
export function NoticeAnnouncer() {
  const notice = useMeshStore((s) => s.notice);
  const isError = notice?.level === 'error';
  // Keyed by the notice id: two notices with identical text would otherwise
  // leave the text node untouched, and a live region only announces content
  // that actually changed.
  const line = notice && <span key={notice.id}>{notice.text}</span>;
  return (
    <div className='sr-only'>
      <div role='status' aria-live='polite'>
        {!isError && line}
      </div>
      <div role='alert' aria-live='assertive'>
        {isError && line}
      </div>
    </div>
  );
}
