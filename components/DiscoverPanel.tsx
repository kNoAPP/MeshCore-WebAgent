// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import { ADV_ICON, ADV_LABEL_KEY } from '@/lib/utils';
import { formatRelative } from '@/lib/i18n/format';

/**
 * Modal listing heard adverts (most-recent first), each with an Add button (or
 * "✓ Added" if already a contact). Mounted only while `discoverOpen` is set.
 */
export function DiscoverPanel() {
  const { t } = useTranslation();
  const { discoverOpen, setDiscoverOpen, adverts, contacts, autoAddConfig } =
    useMeshStore();
  const { addDiscoveredContact } = useMeshCore();

  if (!discoverOpen) return null;
  const sorted = Object.values(adverts).sort(
    (a, b) => b.lastHeard - a.lastHeard,
  );

  return (
    <ModalShell
      title={t('discover.title')}
      onClose={() => setDiscoverOpen(false)}
    >
      {sorted.length === 0 ? (
        <p className='py-8 text-center text-sm text-(--text2)'>
          {t('discover.empty')}
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
                    {t(
                      ADV_LABEL_KEY[a.advType as keyof typeof ADV_LABEL_KEY] ??
                        'discover.node',
                    )}{' '}
                    · {formatRelative(a.lastHeard)}
                    {autoAddConfig.showPublicKeys && ` · ${a.pubkeyPrefix}`}
                  </div>
                </div>
                {added ? (
                  <span className='text-xs text-(--green)'>
                    {t('discover.added')}
                  </span>
                ) : (
                  <button
                    onClick={() => addDiscoveredContact(a)}
                    className='rounded-md px-3 py-1 text-xs font-semibold text-white'
                    style={{ background: 'var(--accent)' }}
                  >
                    {t('discover.add')}
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
