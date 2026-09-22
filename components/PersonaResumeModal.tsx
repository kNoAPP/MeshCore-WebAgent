// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { usePersonaSwitch } from '@/hooks/usePersonaSwitch';
import { loadPendingSwitch, type PersonaState } from '@/lib/identity/persona';
import {
  listVaults,
  lockVault,
  unlockVault,
  VaultError,
} from '@/lib/identity/vault';
import { ModalShell } from './ModalShell';
import { SwitchProgressView, switchErrorMessage } from './PersonaSwitchModal';

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

/**
 * Offers to finish a persona switch that stopped part way: cancelled, failed,
 * cut off by a dropped link, or by a page reload.
 *
 * @remarks Shown while the radio reports the incoming identity, which means it
 * holds the new key but only part of the persona that goes with it. Nothing
 * this session receives is saved until the switch is finished, since the
 * storage key depends on the channels still being written. Finishing re-applies
 * the recorded state. After a reload only the sealed pending record is left,
 * so the vault's passphrase is asked for to read it. Putting it off leaves the
 * Identity settings offering it again.
 *
 * Mounted by {@link AppShell} while connected, since the reconnect after a
 * drop closes the Settings page the switch was started from.
 */
export function PersonaResumeModal() {
  const { t } = useTranslation();
  const passphraseId = useId();
  const record = useMeshStore((s) => s.personaSwitch);
  const reported = useMeshStore((s) => s.selfInfo?.pubkey?.toLowerCase());
  const setPersonaSwitch = useMeshStore((s) => s.setPersonaSwitch);
  const { finish, progress } = usePersonaSwitch();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  if (
    !record ||
    record.stage !== 'switching' ||
    (record.running && !busy) ||
    (record.dismissed && !busy) ||
    reported !== record.target
  ) {
    return null;
  }

  const sealed = record.state === null;
  const dismiss = () => setPersonaSwitch({ ...record, dismissed: true });
  const run = async () => {
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const state = sealed
        ? await unseal(record.target, passphrase)
        : undefined;
      if (sealed && !state) {
        setError(t('settings.persona.resumeWrongPassphrase'));
        return;
      }
      await finish(controller.signal, state ?? undefined);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(switchErrorMessage(err));
      }
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const name = record.label || t('settings.persona.unnamed');
  return (
    <ModalShell
      title={t('settings.persona.resumeTitle', { name })}
      onClose={busy ? noop : dismiss}
    >
      {progress ? (
        <SwitchProgressView progress={progress} />
      ) : (
        <>
          <p role='alert' className='text-xs leading-relaxed text-text'>
            {t('settings.persona.resumeBody', { name })}
          </p>
          <p className='mt-3 text-xs leading-relaxed text-text2'>
            {t('settings.persona.resumeUnsaved')}
          </p>
          {sealed && (
            <>
              <p className='mt-3 mb-2 text-xs leading-relaxed text-text2'>
                {t('settings.persona.resumeSealed')}
              </p>
              <label
                htmlFor={passphraseId}
                className='mb-1 block text-xs text-text2'
              >
                {t('settings.backup.passphrase')}
              </label>
              <input
                id={passphraseId}
                type='password'
                autoComplete='current-password'
                value={passphrase}
                disabled={busy}
                onChange={(e) => setPassphrase(e.target.value)}
                className='w-full rounded-md border border-border-control bg-surface2 px-3 py-1.5 text-sm outline-none focus:border-accent-solid disabled:opacity-50'
              />
            </>
          )}
        </>
      )}
      {error && (
        <p role='alert' className='mt-4 text-xs leading-relaxed text-red'>
          {error}
        </p>
      )}
      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={busy ? () => abort.current?.abort() : dismiss}
          disabled={busy && progress?.stage !== 'applying'}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
        >
          {busy ? t('common.cancel') : t('settings.persona.resumeLater')}
        </button>
        {!busy && (
          <button
            onClick={() => void run()}
            disabled={sealed && !passphrase}
            className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
          >
            {t('settings.persona.resumeAction')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}

// Tries each vault on this device, since which one sealed the switch is
// itself sealed; the one whose root opens the pending record is it. Null when
// no vault opens under the passphrase or holds the record.
async function unseal(
  target: string,
  passphrase: string,
): Promise<PersonaState | null> {
  for (const fingerprint of await listVaults()) {
    let vault;
    try {
      vault = await unlockVault(fingerprint, passphrase);
    } catch (err) {
      if (err instanceof VaultError && err.code === 'wrongPassphrase') continue;
      throw err;
    }
    try {
      const state = await loadPendingSwitch(vault, target);
      if (!state) continue;
      const label = vault.identities.find((i) => i.publicKey === target)?.label;
      const store = useMeshStore.getState();
      const record = store.personaSwitch;
      if (record) store.setPersonaSwitch({ ...record, label: label ?? '' });
      return state;
    } finally {
      lockVault(vault);
    }
  }
  return null;
}
