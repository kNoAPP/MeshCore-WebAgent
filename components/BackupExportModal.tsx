// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { encryptBackup } from '@/lib/backup/archive';
import { backupFilename, downloadBackup } from '@/lib/backup/file';
import { buildBackupPayload } from '@/lib/backup/session';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import { ModalShell } from './ModalShell';
import { Switch } from './Switch';
import { MIN_PASSPHRASE_LENGTH, PrivateKeyErrorText } from './BackupCommon';

/**
 * Writes a passphrase-encrypted backup of everything this browser holds for the
 * connected radio, optionally including the radio's Ed25519 identity.
 *
 * @param onClose - dismissal; also called after a successful download.
 */
export function BackupExportModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const client = useMeshStore((s) => s.client);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const showToast = useMeshStore((s) => s.showToast);
  const passId = useId();
  const confirmId = useId();

  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [includeIdentity, setIncludeIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  const tooShort =
    passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const ready =
    passphrase.length >= MIN_PASSPHRASE_LENGTH &&
    confirm === passphrase &&
    !!selfInfo?.pubkey &&
    !busy;

  const run = async () => {
    if (!ready || !selfInfo) return;
    setBusy(true);
    setError(null);
    let identity: Uint8Array | undefined;
    try {
      if (includeIdentity) {
        if (!client) throw new PrivateKeyError('unsupported');
        identity = await client.exportPrivateKey();
      }
      const payload = buildBackupPayload(
        selfInfo.pubkey,
        selfInfo.name,
        identity,
      );
      const bytes = await encryptBackup(payload, passphrase);
      downloadBackup(bytes, backupFilename(selfInfo.name, selfInfo.pubkey));
      showToast(t('settings.backup.exportDone'), 'success');
      onClose();
    } catch (err) {
      setError(
        err instanceof PrivateKeyError ? (
          <PrivateKeyErrorText code={err.code} action='export' />
        ) : (
          t('settings.backup.exportFailed', { error: (err as Error).message })
        ),
      );
    } finally {
      // Zero the one copy we own, success or not. JS strings are immutable, so
      // the hex and JSON forms inside encryptBackup stay readable until GC —
      // this bounds the exposure, it does not eliminate it. What it does
      // guarantee is that no copy outlives this handler.
      identity?.fill(0);
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={t('settings.backup.exportTitle')}
      onClose={onClose}
      confirmClose={passphrase.length > 0}
    >
      <p className='mb-4 text-xs text-text2'>
        {t('settings.backup.exportIntro')}
      </p>

      <label htmlFor={passId} className='mb-1 block text-xs text-text2'>
        {t('settings.backup.passphrase')}
      </label>
      <input
        id={passId}
        type='password'
        autoComplete='new-password'
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        className='w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid'
      />
      <p className='mt-1 text-xs text-text2'>
        {tooShort
          ? t('settings.backup.passphraseTooShort', {
              count: MIN_PASSPHRASE_LENGTH,
            })
          : t('settings.backup.passphraseHint')}
      </p>

      <label htmlFor={confirmId} className='mb-1 mt-4 block text-xs text-text2'>
        {t('settings.backup.passphraseConfirm')}
      </label>
      <input
        id={confirmId}
        type='password'
        autoComplete='new-password'
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className='w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid'
      />
      {mismatch && (
        <p className='mt-1 text-xs text-red'>
          {t('settings.backup.passphraseMismatch')}
        </p>
      )}

      <div className='mt-5 rounded-md border border-red bg-red/10 p-3'>
        <Switch
          label={t('settings.backup.includeIdentity')}
          checked={includeIdentity}
          onChange={setIncludeIdentity}
        />
        <p className='mt-2 text-xs text-text2'>
          {t('settings.backup.includeIdentityWarning')}
        </p>
      </div>

      {error && <p className='mt-4 text-xs text-red'>{error}</p>}

      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={onClose}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={() => void run()}
          disabled={!ready}
          className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
        >
          {busy
            ? t('settings.backup.exporting')
            : t('settings.backup.exportAction')}
        </button>
      </div>
    </ModalShell>
  );
}
