// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import {
  BackupReadError,
  decryptBackup,
  BACKUP_FILE_EXT,
  type BackupPayload,
} from '@/lib/backup/archive';
import { readFileBytes } from '@/lib/backup/file';
import { previewImport, type ImportPreview } from '@/lib/backup/merge';
import { applyBackup } from '@/lib/backup/session';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import { fmtNum } from '@/lib/utils';
import { ModalShell } from './ModalShell';
import { Switch } from './Switch';
import { BackupReadErrorText, PrivateKeyErrorText } from './BackupCommon';

// Stable identity for the suppressed-close handler, so ModalShell's props
// don't change on every render while a restore runs.
const noop = () => {};

/**
 * Restores a passphrase-encrypted backup: pick a file, unlock it, review a
 * preview of exactly what would change, then apply. Nothing is written until
 * the preview has been shown and confirmed.
 *
 * @param onClose - dismissal; also called once an import has been applied.
 */
export function BackupImportModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const client = useMeshStore((s) => s.client);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const showToast = useMeshStore((s) => s.showToast);
  const passId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [restoreChannels, setRestoreChannels] = useState(false);
  const [restoreIdentity, setRestoreIdentity] = useState(false);
  const [mismatchAck, setMismatchAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  const unlock = async () => {
    if (!file || !passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const decoded = await decryptBackup(
        await readFileBytes(file),
        passphrase,
      );
      setPayload(decoded);
      setPreview(
        previewImport(
          decoded,
          useMeshStore.getState(),
          selfInfo?.pubkey ?? null,
        ),
      );
    } catch (err) {
      setError(
        err instanceof BackupReadError ? (
          <BackupReadErrorText code={err.code} />
        ) : (
          t('settings.backup.importFailed', { error: (err as Error).message })
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!payload || !preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyBackup(payload, client, {
        restoreChannels,
        restoreIdentity,
      });
      // A refused slot is reported rather than folded into a plain success —
      // the user asked for those channels to reach the radio.
      if (result.channelsFailed > 0) {
        showToast(
          t('settings.backup.importDonePartial', {
            failed: result.channelsFailed,
            total: result.channelsFailed + result.channelsRestored,
          }),
          'error',
        );
      } else {
        showToast(
          result.identityRestored
            ? t('settings.backup.importDoneIdentity')
            : t('settings.backup.importDone'),
          'success',
        );
      }
      onClose();
    } catch (err) {
      // The browser data landed before any radio write was attempted, so this
      // only ever reports the identity step failing.
      setError(
        err instanceof PrivateKeyError ? (
          <PrivateKeyErrorText code={err.code} action='import' />
        ) : (
          t('settings.backup.importFailed', { error: (err as Error).message })
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const num = (n: number) => fmtNum(n, i18n.language);
  const blocked = preview?.pubkeyMismatch && !mismatchAck;

  return (
    <ModalShell
      title={t('settings.backup.importTitle')}
      // Restoring writes channel slots and can replace the radio's identity,
      // and dismissal cannot cancel a command already in flight. Suppress every
      // close path while it runs so closing the dialog never reads as having
      // stopped a destructive write that is still going.
      onClose={busy ? noop : onClose}
      widthClass='w-140'
      confirmClose={!busy && payload !== null}
    >
      {!payload ? (
        <>
          <p className='mb-4 text-xs text-text2'>
            {t('settings.backup.importIntro')}
          </p>
          <input
            type='file'
            accept={BACKUP_FILE_EXT}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
            className='w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm text-text2 file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1 file:text-sm file:text-text'
          />

          <label
            htmlFor={passId}
            className='mb-1 mt-4 block text-xs text-text2'
          >
            {t('settings.backup.passphrase')}
          </label>
          <input
            id={passId}
            type='password'
            autoComplete='current-password'
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void unlock();
            }}
            className='w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid'
          />

          {error && <p className='mt-4 text-xs text-red'>{error}</p>}

          <div className='mt-6 flex justify-end gap-2'>
            <button
              onClick={onClose}
              disabled={busy}
              className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => void unlock()}
              disabled={!file || !passphrase || busy}
              className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
            >
              {busy
                ? t('settings.backup.unlocking')
                : t('settings.backup.unlockAction')}
            </button>
          </div>
        </>
      ) : (
        preview && (
          <>
            <p className='mb-4 text-xs text-text2'>
              {t('settings.backup.previewIntro', {
                node: payload.nodeName || t('common.unknown'),
                date: new Date(payload.createdAt).toLocaleString(i18n.language),
              })}
            </p>

            <dl className='grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs'>
              <PreviewRow
                label={t('settings.backup.previewMessages')}
                value={t('settings.backup.previewNewOfSkipped', {
                  added: num(preview.newMessages),
                  skipped: num(preview.duplicateMessages),
                })}
              />
              <PreviewRow
                label={t('settings.backup.previewConversations')}
                value={num(preview.newConversations)}
              />
              <PreviewRow
                label={t('settings.backup.previewAdverts')}
                value={t('settings.backup.previewNewOfUpdated', {
                  added: num(preview.newAdverts),
                  updated: num(preview.updatedAdverts),
                })}
              />
              <PreviewRow
                label={t('settings.backup.previewRules')}
                value={t('settings.backup.previewNewOfSkipped', {
                  added: num(preview.newRules),
                  skipped: num(preview.existingRules),
                })}
              />
              <PreviewRow
                label={t('settings.backup.previewPreferences')}
                value={t(
                  preview.hasPreferences
                    ? 'settings.backup.previewReplaced'
                    : 'settings.backup.previewNone',
                )}
              />
              <PreviewRow
                label={t('settings.backup.previewChannels')}
                value={num(preview.channels)}
              />
            </dl>

            {preview.pubkeyMismatch && (
              <div className='mt-5 rounded-md border border-red bg-red/10 p-3'>
                <p className='mb-2 text-xs leading-relaxed text-text'>
                  {t('settings.backup.mismatchWarning', {
                    backup: payload.pubkey.slice(0, 12),
                    connected:
                      selfInfo?.pubkey.slice(0, 12) ?? t('common.unknown'),
                  })}
                </p>
                <Switch
                  label={t('settings.backup.mismatchAck')}
                  checked={mismatchAck}
                  onChange={setMismatchAck}
                />
              </div>
            )}

            {preview.channels > 0 && (
              <div className='mt-4'>
                <Switch
                  label={t('settings.backup.restoreChannels')}
                  description={t('settings.backup.restoreChannelsHint')}
                  checked={restoreChannels}
                  onChange={setRestoreChannels}
                  disabled={!client}
                />
              </div>
            )}

            {preview.hasIdentity && (
              <div className='mt-4 rounded-md border border-red bg-red/10 p-3'>
                <Switch
                  label={t('settings.backup.restoreIdentity')}
                  checked={restoreIdentity}
                  onChange={setRestoreIdentity}
                  disabled={!client}
                />
                <p className='mt-2 text-xs leading-relaxed text-text'>
                  {t('settings.backup.restoreIdentityWarning')}
                </p>
              </div>
            )}

            {error && <p className='mt-4 text-xs text-red'>{error}</p>}

            <div className='mt-6 flex justify-end gap-2'>
              <button
                onClick={onClose}
                disabled={busy}
                className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void apply()}
                disabled={busy || blocked}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  restoreIdentity
                    ? 'bg-red-solid hover:bg-red-hover disabled:hover:bg-red-solid'
                    : 'bg-accent-solid hover:bg-accent-hover disabled:hover:bg-accent-solid'
                }`}
              >
                {busy
                  ? t('settings.backup.importing')
                  : t('settings.backup.importAction')}
              </button>
            </div>
          </>
        )
      )}
    </ModalShell>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className='text-text2'>{label}</dt>
      <dd className='text-right text-text tabular-nums'>{value}</dd>
    </>
  );
}
