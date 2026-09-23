// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { registeredIdentityKey } from '@/lib/identity/storageRoot';
import { lockVault, openVaultFor } from '@/lib/identity/vault';
import { ModalShell } from './ModalShell';
import { SecretInput } from './SecretInput';

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

/**
 * Asks for the vault passphrase of a seed-born identity that connected before
 * its vault was opened in this tab, and binds the session once it is.
 *
 * @remarks The identity's records are sealed under its vault's storage root,
 * so until then nothing this session receives is saved. The record names no
 * vault, so the passphrase is tried against every vault on this device.
 * Putting it off leaves the Identity settings offering it again.
 *
 * Mounted by {@link AppShell} while connected.
 */
export function SeedUnlockModal() {
  const { t } = useTranslation();
  const passphraseId = useId();
  const lock = useMeshStore((s) => s.seedLock);
  const reported = useMeshStore((s) => s.selfInfo?.pubkey?.toLowerCase());
  const setSeedLock = useMeshStore((s) => s.setSeedLock);
  const { unlockSeedSession } = useMeshCore();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lock || (lock.dismissed && !busy) || reported !== lock.pubkey) {
    return null;
  }

  // A vault opened elsewhere in this tab since — the persona list — has
  // registered the key already, and there is nothing left to open.
  const registered = !!registeredIdentityKey(lock.pubkey);
  const dismiss = () => setSeedLock({ ...lock, dismissed: true });
  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!registeredIdentityKey(lock.pubkey)) {
        const vault = await openVaultFor(lock.pubkey, passphrase);
        if (!vault) {
          setError(t('settings.persona.seedLock.wrongPassphrase'));
          return;
        }
        // Opening it registered the identity's key; nothing else is needed.
        lockVault(vault);
      }
      if (!(await unlockSeedSession())) {
        setError(t('settings.persona.seedLock.failed'));
      }
    } catch {
      setError(t('settings.persona.seedLock.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={t('settings.persona.seedLock.title')}
      onClose={busy ? noop : dismiss}
    >
      <p role='alert' className='text-xs leading-relaxed text-text'>
        {t('settings.persona.seedLock.body')}
      </p>
      <label
        htmlFor={passphraseId}
        className='mt-3 mb-1 block text-xs text-text2'
      >
        {t('settings.backup.passphrase')}
      </label>
      <SecretInput
        id={passphraseId}
        autoComplete='current-password'
        value={passphrase}
        disabled={busy}
        onChange={(e) => setPassphrase(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (passphrase || registered) && !busy) {
            void run();
          }
        }}
        className='w-full rounded-md border border-border-control bg-surface2 px-3 py-1.5 text-sm outline-none focus:border-accent-solid disabled:opacity-50'
      />
      {error && (
        <p role='alert' className='mt-4 text-xs leading-relaxed text-red'>
          {error}
        </p>
      )}
      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={dismiss}
          disabled={busy}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
        >
          {t('settings.persona.resumeLater')}
        </button>
        <button
          onClick={() => void run()}
          disabled={(!passphrase && !registered) || busy}
          className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
        >
          {busy
            ? t('settings.persona.unlocking')
            : t('settings.persona.unlock')}
        </button>
      </div>
    </ModalShell>
  );
}
