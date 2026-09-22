// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useSeedBorn } from '@/hooks/useSeedBorn';
import { ensurePrivateKeyAccess } from '@/lib/session/privateKeyAccess';
import { useBackupReady } from './BackupCommon';
import { RecoveryPhraseWizard } from './RecoveryPhraseWizard';
import { RestorePhraseWizard } from './RestorePhraseWizard';

type Wizard = 'create' | 'restore';

/**
 * Opens a recovery-phrase wizard once the radio has been probed for identity
 * import, which both of them end in.
 *
 * @remarks A radio that cannot take a new identity is explained by
 * {@link KeyAccessError} before the user types or writes down a phrase it will
 * never hold. An inconclusive probe still opens the wizard, and the import
 * then reports what went wrong.
 * @returns the wizard to show, the wizard being probed for, and `start`,
 * which probes and then opens the given wizard.
 */
export function useRecoveryWizard(): {
  open: Wizard | null;
  probing: Wizard | null;
  start: (wizard: Wizard) => Promise<void>;
  close: () => void;
} {
  const [probing, setProbing] = useState<Wizard | null>(null);
  const [open, setOpen] = useState<Wizard | null>(null);
  const start = async (wizard: Wizard) => {
    setProbing(wizard);
    const access = await ensurePrivateKeyAccess();
    setProbing(null);
    if (access !== 'disabled' && access !== 'unsupported') setOpen(wizard);
  };
  return { open, probing, start, close: () => setOpen(null) };
}

/** Renders the wizard {@link useRecoveryWizard} has open, if any. */
export function RecoveryWizard({
  open,
  onClose,
}: {
  open: Wizard | null;
  onClose: () => void;
}) {
  if (open === 'create') return <RecoveryPhraseWizard onClose={onClose} />;
  if (open === 'restore') return <RestorePhraseWizard onClose={onClose} />;
  return null;
}

/** Why the connected radio cannot take a new identity, once probed. */
export function KeyAccessError() {
  const { t } = useTranslation();
  const keyAccess = useMeshStore((s) => s.privateKeyAccess);
  if (keyAccess !== 'disabled' && keyAccess !== 'unsupported') return null;
  return (
    <p className='mt-2 text-xs text-red'>
      {t(
        keyAccess === 'disabled'
          ? 'settings.backup.identityError.disabledImport'
          : 'settings.recovery.error.unsupported',
      )}
    </p>
  );
}

/**
 * The Identity card's entries to {@link RecoveryPhraseWizard} and
 * {@link RestorePhraseWizard}.
 */
export function RecoveryPhraseRow() {
  const { t } = useTranslation();
  const ready = useBackupReady();
  const seedBorn = useSeedBorn();
  const { open, probing, start, close } = useRecoveryWizard();

  const button =
    'rounded-md border border-border-control px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent';
  return (
    <div className='mt-3'>
      <p className='mb-3 text-xs leading-relaxed text-text2'>
        {t(
          seedBorn
            ? 'settings.recovery.seedBorn.hint'
            : 'settings.recovery.hint',
        )}
      </p>
      <div className='flex flex-wrap gap-2'>
        <button
          onClick={() => void start('create')}
          disabled={!ready || !!probing}
          className={button}
        >
          {probing === 'create'
            ? t('settings.recovery.checking')
            : t(
                seedBorn
                  ? 'settings.recovery.seedBorn.action'
                  : 'settings.recovery.action',
              )}
        </button>
        <button
          onClick={() => void start('restore')}
          disabled={!ready || !!probing}
          className={button}
        >
          {probing === 'restore'
            ? t('settings.recovery.checking')
            : t('settings.restore.action')}
        </button>
      </div>
      <KeyAccessError />
      <RecoveryWizard open={open} onClose={close} />
    </div>
  );
}
