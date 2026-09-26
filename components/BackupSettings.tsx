// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackupExportModal } from './BackupExportModal';
import { BackupImportModal } from './BackupImportModal';
import { useBackupReady } from './BackupCommon';

/**
 * The Backup & Restore card body: one button to write a passphrase-encrypted
 * backup of this radio's browser-side data (optionally including the radio's
 * identity), one to restore such a file.
 *
 * Identity backup lives here rather than in the Identity card because the
 * exported private key is only ever written into this card's encrypted file —
 * it is never rendered, copied, or stored anywhere else.
 */
export function BackupSettingsBody() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Gates opening either dialog; each one rechecks the same condition for the
  // action itself, since a reconnect can start after it opened.
  const ready = useBackupReady();

  return (
    <>
      <p className='mb-4 text-xs leading-relaxed text-text2'>
        {t('settings.backup.hint')}
      </p>
      <div className='flex flex-wrap gap-2'>
        <button
          onClick={() => setExporting(true)}
          disabled={!ready}
          className='rounded-md bg-accent-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
        >
          {t('settings.backup.exportAction')}
        </button>
        <button
          onClick={() => setImporting(true)}
          disabled={!ready}
          className='rounded-md border border-border-control px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
        >
          {t('settings.backup.importAction')}
        </button>
      </div>
      <p className='mt-3 text-xs text-text2'>
        {t('settings.backup.secretsExcluded')}
      </p>

      {exporting && <BackupExportModal onClose={() => setExporting(false)} />}
      {importing && <BackupImportModal onClose={() => setImporting(false)} />}
    </>
  );
}
