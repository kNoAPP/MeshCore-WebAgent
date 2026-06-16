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

import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useTranslation } from '@/hooks/useTranslation';
import { ModalShell } from './ModalShell';
import { ADV_ICON, getAdvLabel, formatRelative } from '@/lib/utils';

/**
 * Modal listing heard adverts (most-recent first), each with an Add button (or
 * "✓ Added" if already a contact). Mounted only while `discoverOpen` is set.
 */
export function DiscoverPanel() {
  const { discoverOpen, setDiscoverOpen, adverts, contacts, autoAddConfig } =
    useMeshStore();
  const { addDiscoveredContact } = useMeshCore();
  const { t } = useTranslation();

  if (!discoverOpen) return null;
  const sorted = Object.values(adverts).sort(
    (a, b) => b.lastHeard - a.lastHeard,
  );

  return (
    <ModalShell
      title={t('discoverTitle')}
      onClose={() => setDiscoverOpen(false)}
    >
      {sorted.length === 0 ? (
        <p className='py-8 text-center text-sm text-(--text2)'>
          {t('discoverEmpty')}
        </p>
      ) : (
        <div className='space-y-1'>
          {sorted.map((a) => {
            const added = contacts[a.pubkeyPrefix] !== undefined;
            return (
              <div
                key={a.pubkeyPrefix}
                className='flex items-center gap-3 rounded-md px-2 py-2 hover:bg-(--surface2)'
              >
                <span className='text-base'>{ADV_ICON[a.advType] ?? '👤'}</span>
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm'>
                    {a.name || a.pubkeyPrefix.slice(0, 8)}
                  </div>
                  <div className='truncate text-xs text-(--text2)'>
                    {getAdvLabel(a.advType, t)} &middot;{' '}
                    {formatRelative(a.lastHeard, t)}
                    {autoAddConfig.showPublicKeys && ` · ${a.pubkeyPrefix}`}
                  </div>
                </div>
                {added ? (
                  <span className='text-xs text-(--green)'>
                    {t('discoverAdded')}
                  </span>
                ) : (
                  <button
                    onClick={() => addDiscoveredContact(a)}
                    className='rounded-md px-3 py-1 text-xs font-semibold text-white'
                    style={{ background: 'var(--accent)' }}
                  >
                    {t('discoverBtnAdd')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}
