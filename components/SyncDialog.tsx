// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshCore } from '@/hooks/useMeshCore';
import type { SyncProgress } from '@/types/meshcore';
import { SyncProgressView } from './SyncProgressView';

/**
 * The shared card chrome for the connect/reconnect dialogs — fixed width,
 * surface background, rounded border. Centralizes the box styling so the
 * initial-connect screen and the reconnect waiting state can't visually drift.
 */
export function SyncCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-105 max-w-[95vw] rounded-[10px] border p-8 ${className}`}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {children}
    </div>
  );
}

/**
 * The Disconnect escape shared by the sync dialogs (and their waiting states),
 * so the initial-connect and reconnect screens offer an identical way out.
 *
 * @param className - Wrapper classes. Override when the caller groups this
 * with another action and owns the spacing itself.
 */
export function DisconnectButton({
  className = 'mt-6 text-center',
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  const { disconnect } = useMeshCore();
  return (
    <div className={className}>
      <button
        onClick={disconnect}
        className='rounded-lg border border-(--border) px-4 py-2 text-sm font-medium text-(--text2) transition-colors hover:border-(--red) hover:text-(--red)'
      >
        {t('header.disconnect')}
      </button>
    </div>
  );
}

/**
 * The synchronization dialog card — title, subtitle, the live
 * {@link SyncProgressView}, and a Disconnect escape — rendered identically by
 * the initial-connect screen and the reconnect overlay; only the copy differs.
 */
export function SyncDialog({
  title,
  subtitle,
  progress,
}: {
  title: string;
  subtitle: string;
  progress: SyncProgress;
}) {
  return (
    <SyncCard>
      <h2 className='mb-1 text-xl font-bold'>{title}</h2>
      <p className='mb-5 text-sm text-(--text2)'>{subtitle}</p>
      <SyncProgressView progress={progress} />
      <DisconnectButton />
    </SyncCard>
  );
}
