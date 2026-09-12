// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useMeshStore } from '@/store/meshStore';
import { SyncDialog, SyncCard, DisconnectButton } from './SyncDialog';

/**
 * Blocking overlay shown while the transport is dropped and auto-reconnecting.
 *
 * @remarks Covers the still-mounted Sidebar/ChatArea (which keep the last
 * synced chats visible underneath) so the user stays in context, and captures
 * all clicks so they can't start a racing connection or send into the dead
 * link. The only exit is an explicit Disconnect, which cancels the reconnect
 * loop.
 */
export function ReconnectingOverlay() {
  const { t } = useTranslation();
  const deviceName = useMeshStore((s) => s.deviceName);
  // Present once an attempt reopens the link and starts re-syncing; null while
  // waiting out the backoff between attempts.
  const syncProgress = useMeshStore((s) => s.syncProgress);
  const progress = useMeshStore((s) => s.reconnectProgress);
  const { retryReconnectNow } = useMeshCore();

  const resumeAt = progress?.waiting ? progress.resumeAt : null;
  // Display-only clock for the backoff countdown, so the wait the Retry now
  // button skips is visible rather than implied.
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    if (resumeAt === null) return;
    const tick = () => setRemainingMs(Math.max(0, resumeAt - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [resumeAt]);
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      className='absolute inset-0 z-40 flex items-center justify-center bg-scrim p-4 backdrop-blur-sm'
      role='alertdialog'
      aria-busy='true'
      aria-label={t('connect.reconnecting.title')}
    >
      {syncProgress ? (
        // An attempt reopened the link — show the same sync dialog as the
        // initial connect, only the copy differs.
        <SyncDialog
          title={t('connect.reconnecting.title')}
          subtitle={
            deviceName
              ? t('connect.reconnecting.resyncFrom', { device: deviceName })
              : t('connect.reconnecting.resyncGeneric')
          }
          progress={syncProgress}
        />
      ) : (
        // Waiting out the backoff between attempts — no live sync to show yet.
        <SyncCard className='text-center'>
          <LoaderCircle
            size={36}
            className='mx-auto mb-4 animate-spin text-amber'
          />
          <h2 className='mb-1 text-xl font-bold'>
            {t('connect.reconnecting.title')}
          </h2>
          <p className='mb-2 text-sm text-text2'>
            {deviceName
              ? t('connect.reconnecting.bodyFrom', { device: deviceName })
              : t('connect.reconnecting.bodyGeneric')}
          </p>
          <p className='text-xs text-text2'>{t('connect.reconnecting.hint')}</p>
          {progress && (
            <p className='mt-2 text-xs text-text2'>
              {t('connect.reconnecting.attempt', {
                attempt: progress.attempt,
                total: progress.total,
              })}
              {progress.waiting && resumeAt !== null && (
                // Hidden from assistive tech: it changes every second, and
                // the attempt count beside it already carries the status.
                <span aria-hidden='true'>
                  {' · '}
                  {t('connect.reconnecting.nextAttempt', { seconds })}
                </span>
              )}
            </p>
          )}
          {/* One action cluster: the pair sits closer to each other than to
              the status text above them. */}
          <div className='mt-6 flex flex-col items-center gap-3'>
            {progress?.waiting && (
              <button
                onClick={retryReconnectNow}
                title={t('connect.reconnecting.retryNowHint')}
                aria-label={t('connect.reconnecting.retryNowHint')}
                className='rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent transition-opacity hover:opacity-80'
              >
                {t('connect.reconnecting.retryNow')}
              </button>
            )}
            <DisconnectButton className='text-center' />
          </div>
        </SyncCard>
      )}
    </div>
  );
}
