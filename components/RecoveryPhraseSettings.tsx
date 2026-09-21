// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { ensurePrivateKeyAccess } from '@/lib/session/privateKeyAccess';
import { useBackupReady } from './BackupCommon';
import { RecoveryPhraseWizard } from './RecoveryPhraseWizard';

/**
 * The Identity card's entry to {@link RecoveryPhraseWizard}.
 *
 * @remarks Gated on the private-key capability probe, run when the user
 * reaches for the wizard: a radio that cannot take a new identity is
 * explained here, before the user writes down a phrase it will never hold. An
 * inconclusive probe still opens the wizard, and the import then reports what
 * went wrong.
 */
export function RecoveryPhraseRow() {
  const { t } = useTranslation();
  const keyAccess = useMeshStore((s) => s.privateKeyAccess);
  const ready = useBackupReady();
  const [probing, setProbing] = useState(false);
  const [open, setOpen] = useState(false);

  const start = async () => {
    setProbing(true);
    const access = await ensurePrivateKeyAccess();
    setProbing(false);
    if (access !== 'disabled' && access !== 'unsupported') setOpen(true);
  };

  return (
    <div className='mt-3'>
      <p className='mb-3 text-xs leading-relaxed text-text2'>
        {t('settings.recovery.hint')}
      </p>
      <button
        onClick={() => void start()}
        disabled={!ready || probing}
        className='rounded-md border border-border-control px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
      >
        {probing
          ? t('settings.recovery.checking')
          : t('settings.recovery.action')}
      </button>
      {(keyAccess === 'disabled' || keyAccess === 'unsupported') && (
        <p className='mt-2 text-xs text-red'>
          {t(
            keyAccess === 'disabled'
              ? 'settings.backup.identityError.disabledImport'
              : 'settings.recovery.error.unsupported',
          )}
        </p>
      )}
      {open && <RecoveryPhraseWizard onClose={() => setOpen(false)} />}
    </div>
  );
}
