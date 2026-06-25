// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
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

  return (
    <div
      className='absolute inset-0 z-40 flex items-center justify-center p-4 backdrop-blur-sm'
      style={{ background: 'color-mix(in srgb, var(--bg) 60%, transparent)' }}
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
            className='mx-auto mb-4 animate-spin text-(--amber)'
          />
          <h2 className='mb-1 text-xl font-bold'>
            {t('connect.reconnecting.title')}
          </h2>
          <p className='mb-2 text-sm text-(--text2)'>
            {deviceName
              ? t('connect.reconnecting.bodyFrom', { device: deviceName })
              : t('connect.reconnecting.bodyGeneric')}
          </p>
          <p className='text-xs text-(--text2)'>
            {t('connect.reconnecting.hint')}
          </p>
          <DisconnectButton />
        </SyncCard>
      )}
    </div>
  );
}
