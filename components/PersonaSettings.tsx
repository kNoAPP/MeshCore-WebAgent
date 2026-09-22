// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import {
  listVaults,
  lockVault,
  unlockVault,
  VaultError,
  type Vault,
  type VaultErrorCode,
} from '@/lib/identity/vault';
import { PersonaList } from './PersonaList';

const VAULT_ERROR_KEY = {
  notFound: 'settings.restore.vaultError.notFound',
  exists: 'settings.restore.vaultError.exists',
  unsupportedVersion: 'settings.restore.vaultError.unsupportedVersion',
  wrongPassphrase: 'settings.restore.vaultError.wrongPassphrase',
  corrupt: 'settings.restore.vaultError.corrupt',
  stale: 'settings.restore.vaultError.stale',
} as const satisfies Record<VaultErrorCode, string>;

const BUTTON_CLASS =
  'rounded-md border border-border-control px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent';

/**
 * The Identity card's personas: this device's identity vaults, each unlocked
 * with its passphrase to list and switch between the personas its phrase has
 * minted.
 *
 * @remarks Renders nothing on a device with no vault. Which personas belong
 * to which phrase is sealed in the vault, so nothing is listed until one is
 * unlocked. An unlocked vault holds the phrase's storage root in memory, and
 * is locked again when the user asks or the card goes away.
 */
export function PersonaRow() {
  const { t } = useTranslation();
  const [vaults, setVaults] = useState<string[]>([]);
  const [vault, setVault] = useState<Vault | null>(null);

  useEffect(() => {
    let live = true;
    listVaults()
      .then((list) => live && setVaults(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => void (vault && lockVault(vault)), [vault]);

  if (vaults.length === 0) return null;
  return (
    <div className='mt-4 border-t border-border pt-3'>
      <p className='mb-1 text-xs font-semibold text-text'>
        {t('settings.persona.title')}
      </p>
      <UnfinishedSwitch />
      {vault ? (
        <PersonaList
          vault={vault}
          onLock={() => setVault(null)}
          onStale={() => setVault(null)}
        />
      ) : (
        <>
          <p className='mb-3 text-xs leading-relaxed text-text2'>
            {t('settings.persona.lockedHint')}
          </p>
          <ul className='space-y-3'>
            {vaults.map((fingerprint) => (
              <UnlockRow
                key={fingerprint}
                fingerprint={fingerprint}
                onUnlock={setVault}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// A switch the radio holds only part of, put off by the user; the resume
// dialog is only a click away.
function UnfinishedSwitch() {
  const { t } = useTranslation();
  const record = useMeshStore((s) => s.personaSwitch);
  const reported = useMeshStore((s) => s.selfInfo?.pubkey?.toLowerCase());
  const setPersonaSwitch = useMeshStore((s) => s.setPersonaSwitch);
  if (
    !record ||
    record.stage !== 'switching' ||
    record.running ||
    reported !== record.target
  ) {
    return null;
  }
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-red bg-red/10 p-3 text-xs leading-relaxed text-text'
    >
      <p>{t('settings.persona.unfinished', { name: record.label })}</p>
      <button
        onClick={() => setPersonaSwitch({ ...record, dismissed: false })}
        className={`${BUTTON_CLASS} mt-2`}
      >
        {t('settings.persona.resumeAction')}
      </button>
    </div>
  );
}

function UnlockRow({
  fingerprint,
  onUnlock,
}: {
  fingerprint: string;
  onUnlock: (vault: Vault) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      onUnlock(await unlockVault(fingerprint, passphrase));
    } catch (err) {
      setError(
        err instanceof VaultError
          ? t(VAULT_ERROR_KEY[err.code])
          : t('settings.restore.error.vault', {
              error: (err as Error).message,
            }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-mono text-xs text-text'>
          {t('settings.persona.vaultName', { id: fingerprint.slice(0, 8) })}
        </span>
        {!open && (
          <button onClick={() => setOpen(true)} className={BUTTON_CLASS}>
            {t('settings.persona.unlock')}
          </button>
        )}
      </div>
      {open && (
        <form
          className='mt-2 flex flex-wrap items-end gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <div className='min-w-48 flex-1'>
            <label htmlFor={id} className='mb-1 block text-xs text-text2'>
              {t('settings.backup.passphrase')}
            </label>
            <input
              id={id}
              type='password'
              autoComplete='current-password'
              value={passphrase}
              disabled={busy}
              onChange={(e) => setPassphrase(e.target.value)}
              className='w-full rounded-md border border-border-control bg-surface2 px-3 py-1.5 text-sm outline-none focus:border-accent-solid disabled:opacity-50'
            />
          </div>
          <button
            type='submit'
            disabled={busy || !passphrase}
            className={BUTTON_CLASS}
          >
            {busy
              ? t('settings.persona.unlocking')
              : t('settings.persona.unlock')}
          </button>
        </form>
      )}
      {error && (
        <p role='alert' className='mt-2 text-xs leading-relaxed text-red'>
          {error}
        </p>
      )}
    </li>
  );
}
