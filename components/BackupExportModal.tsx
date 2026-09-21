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
import { ensurePrivateKeyAccess } from '@/lib/session/privateKeyAccess';
import { ModalShell } from './ModalShell';
import { Switch } from './Switch';
import {
  MIN_PASSPHRASE_LENGTH,
  PrivateKeyErrorText,
  backupSessionPubkey,
  useBackupReady,
} from './BackupCommon';

// Stable identity for the suppressed-close handler, so ModalShell's props
// don't change on every render while an export runs.
const noop = () => {};

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
  const notify = useMeshStore((s) => s.notify);
  const keyAccess = useMeshStore((s) => s.privateKeyAccess);
  const passId = useId();
  const confirmId = useId();

  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [includeIdentity, setIncludeIdentity] = useState(false);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  // Measured the way the KDF sees it: deriveBackupKey normalizes to NFKC
  // first, so a decomposed "e + combining acute" pair is one character there
  // while raw `.length` counts two. Counting code points of the normalized
  // form is what actually enforces the advertised minimum.
  const normalized = passphrase.normalize('NFKC');
  const passLength = [...normalized].length;
  const tooShort = passphrase.length > 0 && passLength < MIN_PASSPHRASE_LENGTH;
  const mismatch =
    confirm.length > 0 && confirm.normalize('NFKC') !== normalized;
  // Rechecked here, not just where the dialog was opened: this modal sits above
  // the reconnect overlay and stays mounted while the auto-reconnect loop swaps
  // the client, so the session that was ready a moment ago may be gone.
  const sessionReady = useBackupReady();
  const ready =
    passLength >= MIN_PASSPHRASE_LENGTH &&
    confirm.normalize('NFKC') === normalized &&
    !!selfInfo?.pubkey &&
    sessionReady &&
    // While the probe runs the switch still reads off, so a backup started now
    // would silently leave out the identity the user just opted into.
    !probing &&
    !busy;

  const keyUnavailable = keyAccess !== null && keyAccess !== 'available';

  // Asked when the user opts in rather than when the dialog opens: the probe is
  // a real export, so the key only crosses the link after they have chosen to
  // send it — once for the probe, and again when the backup is written.
  const toggleIdentity = async (on: boolean) => {
    if (!on) {
      setIncludeIdentity(false);
      return;
    }
    setProbing(true);
    const access = await ensurePrivateKeyAccess();
    setProbing(false);
    // An inconclusive probe keeps the opt-in; the export itself then reports
    // whatever went wrong.
    setIncludeIdentity(access !== 'disabled' && access !== 'unsupported');
  };

  const run = async () => {
    if (!ready || !selfInfo) return;
    setBusy(true);
    setError(null);
    let identity: Uint8Array | undefined;
    // Both awaits below can straddle a link drop, and neither the modal nor
    // this closure is torn down by one: `beginReconnect` resets `view` to
    // 'chat', which unmounts Settings and this portal while the work carries
    // on. So the session is rechecked after each — before reading the store,
    // which would file the next radio's data under the captured pubkey, and
    // again before the download, which would otherwise hand the user a file
    // (with an opted-in identity in it) for a radio that is no longer there.
    const stillOurs = () => {
      if (backupSessionPubkey() !== selfInfo.pubkey) {
        throw new Error(t('settings.backup.sessionChanged'));
      }
    };
    try {
      if (includeIdentity) {
        if (!client) throw new PrivateKeyError('unsupported');
        identity = await client.exportPrivateKey();
      }
      stillOurs();
      const payload = buildBackupPayload(
        selfInfo.pubkey,
        selfInfo.name,
        identity,
      );
      const bytes = await encryptBackup(payload, passphrase);
      stillOurs();
      downloadBackup(bytes, backupFilename(selfInfo.name, selfInfo.pubkey));
      // The file landing in the browser's downloads is the lasting record;
      // the dialog closes on the next line.
      notify({
        level: 'success',
        text: t('settings.backup.exportDone'),
        key: 'backupExport',
        surface: 'none',
      });
      onClose();
    } catch (err) {
      // Reached after an inconclusive probe: the radio has now answered, so
      // the switch and any later identity feature can use the verdict.
      if (
        err instanceof PrivateKeyError &&
        (err.code === 'disabled' || err.code === 'unsupported') &&
        useMeshStore.getState().client === client
      ) {
        useMeshStore.getState().setPrivateKeyAccess(err.code);
      }
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
      // this bounds the lifetime of the *erasable* copy, nothing more. What
      // holds unconditionally is that no copy is written to the store,
      // IndexedDB, the DOM, or a log.
      identity?.fill(0);
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={t('settings.backup.exportTitle')}
      // Dismissal does not cancel the in-flight export, so while it runs every
      // close path is a no-op rather than a Cancel that still downloads an
      // identity-bearing file moments later.
      onClose={busy ? noop : onClose}
      confirmClose={!busy && passphrase.length > 0}
    >
      <p className='mb-4 text-xs text-text2'>
        {t('settings.backup.exportIntro')}
      </p>

      <label htmlFor={passId} className='mb-1 block text-xs text-text2'>
        {t('settings.backup.passphrase')}
      </label>
      {/* Frozen while the export runs, like the identity switch below: `run`
          captured this value before the 600k-iteration KDF started, so an edit
          made during it would leave the field showing a passphrase that does
          not open the file being written. */}
      <input
        id={passId}
        type='password'
        autoComplete='new-password'
        value={passphrase}
        disabled={busy}
        onChange={(e) => setPassphrase(e.target.value)}
        className='w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50'
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
        disabled={busy}
        onChange={(e) => setConfirm(e.target.value)}
        className='w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50'
      />
      {mismatch && (
        <p className='mt-1 text-xs text-red'>
          {t('settings.backup.passphraseMismatch')}
        </p>
      )}

      <div className='mt-5 rounded-md border border-red bg-red/10 p-3'>
        {/* `run` captured this choice when Back up was clicked, so leaving the
            switch live would let it read "excluded" while an identity-bearing
            file is still being written. */}
        <Switch
          label={t('settings.backup.includeIdentity')}
          checked={includeIdentity}
          onChange={(on) => void toggleIdentity(on)}
          disabled={busy || probing || keyUnavailable}
        />
        <p className='mt-2 text-xs text-text2'>
          {t('settings.backup.includeIdentityWarning')}
        </p>
        {keyUnavailable && (
          <p className='mt-2 text-xs text-red'>
            <PrivateKeyErrorText code={keyAccess} action='export' />
          </p>
        )}
      </div>

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
