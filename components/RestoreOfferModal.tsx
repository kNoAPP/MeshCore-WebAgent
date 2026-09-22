// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { ModalShell } from './ModalShell';
import { useBackupReady } from './BackupCommon';
import {
  KeyAccessError,
  RecoveryWizard,
  useRecoveryWizard,
} from './RecoveryPhraseSettings';

/**
 * Offers {@link RestorePhraseWizard} the first time this browser sees a radio.
 *
 * @remarks A user restoring onto replacement hardware has no prior session
 * with it, and should not have to hunt through Settings for the one thing
 * they connected it to do. Raised by the connect flow through the store's
 * `restoreOffer`, and held back while an identity check is pending, since
 * that session's identity is new here by design.
 *
 * Mounted by {@link AppShell} while connected.
 */
export function RestoreOfferModal() {
  const { t } = useTranslation();
  const offer = useMeshStore((s) => s.restoreOffer && !s.identityCheck);
  const setRestoreOffer = useMeshStore((s) => s.setRestoreOffer);
  const ready = useBackupReady();
  const { open, probing, start, close } = useRecoveryWizard();

  if (open) return <RecoveryWizard open={open} onClose={close} />;
  if (!offer) return null;
  const dismiss = () => setRestoreOffer(false);
  const restore = async () => {
    await start('restore');
    const access = useMeshStore.getState().privateKeyAccess;
    if (access !== 'disabled' && access !== 'unsupported') dismiss();
  };

  return (
    <ModalShell title={t('settings.restore.offerTitle')} onClose={dismiss}>
      <p className='text-xs leading-relaxed text-text'>
        {t('settings.restore.offerBody')}
      </p>
      <p className='mt-3 text-xs leading-relaxed text-text2'>
        {t('settings.restore.offerLater')}
      </p>
      <KeyAccessError />
      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={dismiss}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
        >
          {t('settings.restore.offerDismiss')}
        </button>
        <button
          onClick={() => void restore()}
          disabled={!ready || !!probing}
          className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
        >
          {probing
            ? t('settings.recovery.checking')
            : t('settings.restore.offerAction')}
        </button>
      </div>
    </ModalShell>
  );
}
