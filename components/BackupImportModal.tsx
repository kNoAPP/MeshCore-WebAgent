// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId, useMemo, useState } from 'react';
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
import {
  BackupReadErrorText,
  PrivateKeyErrorText,
  backupSessionPubkey,
  useBackupReady,
} from './BackupCommon';

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
  // The slices the preview counts against. Subscribed rather than read once, so
  // the counts stay true while the dialog is open — the radio keeps delivering
  // messages and adverts, and `applyBackup` merges against whatever the store
  // holds at the moment Restore is clicked, not at unlock time.
  const msgHistory = useMeshStore((s) => s.msgHistory);
  const advertCache = useMeshStore((s) => s.advertCache);
  const automationRules = useMeshStore((s) => s.automationRules);
  const passId = useId();
  const confirmId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [restoreIdentity, setRestoreIdentity] = useState(false);
  const [mismatchAck, setMismatchAck] = useState(false);
  const [identityConfirm, setIdentityConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  const connectedName = selfInfo?.name ?? '';
  const connectedPubkey = selfInfo?.pubkey?.toLowerCase() ?? null;
  const sessionReady = useBackupReady();

  const preview: ImportPreview | null = useMemo(
    () =>
      payload
        ? previewImport(
            payload,
            { msgHistory, advertCache, automationRules },
            connectedPubkey,
          )
        : null,
    [payload, msgHistory, advertCache, automationRules, connectedPubkey],
  );

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
    if (!payload || !preview || busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      // Revalidated against the live store, not the render's captured values: a
      // reconnect can start between the last render and this click, and merging
      // now would fold the file's records into whatever radio the pending
      // hydrate is about to load.
      if (backupSessionPubkey() !== selfInfo?.pubkey) {
        throw new Error(t('settings.backup.sessionChanged'));
      }
      const result = await applyBackup(payload, client, { restoreIdentity });
      // A failed write still leaves the import applied in memory, so the dialog
      // closes either way — but it says so rather than claiming a restore that
      // the next reload would undo.
      const done = result.identityRestored
        ? 'settings.backup.importDoneIdentity'
        : 'settings.backup.importDone';
      const unsaved = result.identityRestored
        ? 'settings.backup.importUnsavedIdentity'
        : 'settings.backup.importUnsaved';
      showToast(
        t(result.persisted ? done : unsaved),
        result.persisted ? 'success' : 'error',
      );
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

  // The auto-reconnect loop keeps this modal mounted while it swaps `client`
  // and `selfInfo`, and what comes back may be a different radio. Both
  // confirmations are therefore bound to the pubkey they were given for and
  // dropped the moment it changes — otherwise an acknowledgement for one radio
  // would still authorize the write to another. Adjusted during render (the
  // "reset state when an input changes" pattern) rather than in an effect, so
  // it lands before the buttons below read it.
  const [ackedFor, setAckedFor] = useState(connectedPubkey);
  if (ackedFor !== connectedPubkey) {
    setAckedFor(connectedPubkey);
    setMismatchAck(false);
    setIdentityConfirm('');
  }

  const pubkeyMismatch = preview?.pubkeyMismatch ?? false;

  // Restore stays disabled until both irreversible choices are confirmed the
  // way each is meant to be: the different-radio graft by acknowledging it, and
  // the identity replacement by naming the node it destroys.
  const identityUnconfirmed =
    restoreIdentity && identityConfirm.trim() !== connectedName;
  // `!sessionReady` covers the reconnect window: this dialog stays mounted
  // above the reconnect overlay with a payload unlocked against the previous
  // session, and the radio that comes back may not be the one the preview
  // describes.
  const blocked =
    (pubkeyMismatch && !mismatchAck) || identityUnconfirmed || !sessionReady;

  return (
    <ModalShell
      title={t('settings.backup.importTitle')}
      // A restore persists the imported data and can replace the radio's
      // identity, and dismissal cannot cancel either once started. Suppress
      // every close path while it runs so closing the dialog never reads as
      // having stopped work that is still going.
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

          {error && (
            <p role='alert' className='mt-4 text-xs text-red'>
              {error}
            </p>
          )}

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

            {/* A restore is otherwise purely additive, so the one case where it
                removes something the user already had is called out rather than
                left to be inferred from a count that does not show it. */}
            {preview.evictedAdverts > 0 && (
              <p className='mt-3 text-xs leading-relaxed text-text2'>
                {t('settings.backup.previewAdvertsEvicted', {
                  count: preview.evictedAdverts,
                })}
              </p>
            )}

            {pubkeyMismatch && (
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
                {/* Replacing the identity is the one step here with no undo:
                    the outgoing key is gone unless it was itself backed up. A
                    toggle alone is too easy to leave on by accident next to a
                    Restore the user wants for other reasons, so it also takes
                    typing the name of the node being overwritten. */}
                {restoreIdentity && (
                  <>
                    <label
                      htmlFor={confirmId}
                      className='mt-3 mb-1 block text-xs text-text'
                    >
                      {t('settings.backup.restoreIdentityConfirm', {
                        node: connectedName,
                      })}
                    </label>
                    <input
                      id={confirmId}
                      value={identityConfirm}
                      onChange={(e) => setIdentityConfirm(e.target.value)}
                      autoComplete='off'
                      className='w-full rounded-md border border-red bg-surface2 px-3 py-2 text-sm outline-none focus:border-red'
                    />
                  </>
                )}
              </div>
            )}

            {error && (
              <p role='alert' className='mt-4 text-xs text-red'>
                {error}
              </p>
            )}

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
