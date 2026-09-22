// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { releaseAssumedBurner } from '@/lib/identity/burner';
import {
  deleteVault,
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
 * is locked again when the user asks or the card goes away. A locked vault
 * can be deleted without its passphrase, since a forgotten one is the usual
 * reason to delete it.
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

  if (vaults.length === 0) {
    return <AssumedBurner />;
  }
  return (
    <div className='mt-4 border-t border-border pt-3'>
      <p className='mb-1 text-xs font-semibold text-text'>
        {t('settings.persona.title')}
      </p>
      <AssumedBurner />
      <SeedLocked />
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
                onDelete={() =>
                  setVaults((list) => list.filter((f) => f !== fingerprint))
                }
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// A seed-born identity whose vault is still locked, put off by the user:
// nothing it receives is saved until the unlock dialog is answered.
function SeedLocked() {
  const { t } = useTranslation();
  const lock = useMeshStore((s) => s.seedLock);
  const reported = useMeshStore((s) => s.selfInfo?.pubkey?.toLowerCase());
  const setSeedLock = useMeshStore((s) => s.setSeedLock);
  if (!lock || reported !== lock.pubkey) return null;
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-red bg-red/10 p-3 text-xs leading-relaxed text-text'
    >
      <p>{t('settings.persona.seedLock.pending')}</p>
      <button
        onClick={() => setSeedLock({ ...lock, dismissed: false })}
        className={`${BUTTON_CLASS} mt-2`}
      >
        {t('settings.persona.unlock')}
      </button>
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
    reported !== record.target ||
    // An assumed burner's, which AssumedBurner offers instead.
    (record.burner && record.state === null)
  ) {
    return null;
  }
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-red bg-red/10 p-3 text-xs leading-relaxed text-text'
    >
      <p>
        {t('settings.persona.unfinished', {
          name: record.label || t('settings.persona.unnamed'),
        })}
      </p>
      <button
        onClick={() => setPersonaSwitch({ ...record, dismissed: false })}
        className={`${BUTTON_CLASS} mt-2`}
      >
        {t('settings.persona.resumeAction')}
      </button>
    </div>
  );
}

// An identity taken for a burner only because it arrived with nothing saved
// while a burner may still be live; it may be a radio new here instead.
function AssumedBurner() {
  const { t } = useTranslation();
  const { restartSession } = useMeshCore();
  const assumed = useMeshStore(
    (s) =>
      !!s.burner?.assumed &&
      s.burner.pubkey === s.selfInfo?.pubkey?.toLowerCase(),
  );
  // The radio does not look like a finished burner, which a burner switch
  // cut off by a reload leaves behind — and so does a radio new here.
  const unfinished = useMeshStore((s) =>
    s.personaSwitch?.burner &&
    s.personaSwitch.state === null &&
    s.personaSwitch.stage === 'switching' &&
    !s.personaSwitch.running &&
    s.personaSwitch.target === s.burner?.pubkey
      ? s.personaSwitch
      : null,
  );
  const setPersonaSwitch = useMeshStore((s) => s.setPersonaSwitch);
  const [busy, setBusy] = useState(false);
  if (!assumed) return null;
  return (
    <div
      role='alert'
      className='my-3 rounded-md border border-red bg-red/10 p-3 text-xs leading-relaxed text-text'
    >
      <p>{t('settings.persona.burner.assumed')}</p>
      {unfinished && (
        <p className='mt-2'>{t('settings.persona.burner.assumedUnfinished')}</p>
      )}
      <div className='mt-2 flex flex-wrap gap-2'>
        <button
          onClick={() => {
            setBusy(true);
            // The restart binds this identity's persistence like any other's.
            void releaseAssumedBurner().then(restartSession);
          }}
          disabled={busy}
          className={BUTTON_CLASS}
        >
          {t('settings.persona.burner.keepData')}
        </button>
        {unfinished && (
          <button
            onClick={() =>
              setPersonaSwitch({ ...unfinished, dismissed: false })
            }
            disabled={busy}
            className={BUTTON_CLASS}
          >
            {t('settings.persona.burner.finish')}
          </button>
        )}
      </div>
    </div>
  );
}

function UnlockRow({
  fingerprint,
  onUnlock,
  onDelete,
}: {
  fingerprint: string;
  onUnlock: (vault: Vault) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Set by Cancel, so the Delete button it brings back takes focus again.
  const [cancelled, setCancelled] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    if (await deleteVault(fingerprint)) {
      onDelete();
      return;
    }
    setError(t('settings.persona.delete.failed'));
    setBusy(false);
  };

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
        {!open && !confirming && (
          <button onClick={() => setOpen(true)} className={BUTTON_CLASS}>
            {t('settings.persona.unlock')}
          </button>
        )}
        {!confirming && (
          <button
            autoFocus={cancelled}
            onClick={() => {
              setOpen(false);
              setError(null);
              setConfirming(true);
            }}
            disabled={busy}
            className={BUTTON_CLASS}
          >
            {t('common.delete')}
          </button>
        )}
      </div>
      {confirming && (
        <DeleteConfirm
          busy={busy}
          onCancel={() => {
            setConfirming(false);
            setCancelled(true);
            setError(null);
          }}
          onConfirm={() => void remove()}
        />
      )}
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

// What deleting a vault keeps and loses, before it is gone for good.
function DeleteConfirm({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  // A switch cut off by a reload is finished from its pending record. Only the
  // vault that started it can open that, and which vault it was is sealed.
  const sealedSwitch = useMeshStore(
    (s) =>
      s.personaSwitch?.stage === 'switching' &&
      s.personaSwitch.state === null &&
      !s.personaSwitch.burner,
  );
  return (
    <div className='mt-2 rounded-md border border-red bg-red/10 p-3 text-xs leading-relaxed text-text'>
      <p className='font-semibold'>{t('settings.persona.delete.question')}</p>
      <ul className='mt-1 list-disc space-y-1 pl-4'>
        <li>{t('settings.persona.delete.keeps')}</li>
        <li>{t('settings.persona.delete.loses')}</li>
        <li>{t('settings.persona.delete.keys')}</li>
        {sealedSwitch && <li>{t('settings.persona.delete.unfinished')}</li>}
      </ul>
      <div className='mt-3 flex justify-end gap-2'>
        {/* Delete, which had focus, is gone: land on the safe choice. */}
        <button
          autoFocus
          onClick={onCancel}
          disabled={busy}
          className='rounded-md px-3 py-1.5 text-xs text-text hover:bg-surface2 disabled:opacity-50'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className='rounded-md bg-red-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-hover disabled:cursor-not-allowed disabled:opacity-50'
        >
          {t('settings.persona.delete.action')}
        </button>
      </div>
    </div>
  );
}
