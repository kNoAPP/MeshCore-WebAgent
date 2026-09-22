// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { usePersonaSwitch } from '@/hooks/usePersonaSwitch';
import { isBurnerNameTaken } from '@/lib/identity/burner';
import { loadPersona } from '@/lib/identity/persona';
import type { Vault } from '@/lib/identity/vault';
import { MAX_ADVERT_NAME_BYTES } from '@/lib/meshcore/constants';
import { ModalShell } from './ModalShell';
import { SwitchProgressView, switchErrorMessage } from './PersonaSwitchModal';
import { Switch } from './Switch';

const INPUT_CLASS =
  'w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50';

const enc = new TextEncoder();

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

/**
 * Starts a burner: a throwaway identity with a random key, of which nothing
 * is saved in this browser, and switches the radio to it.
 *
 * @remarks Says plainly what a burner does and does not protect against, and
 * asks the user to acknowledge that switching away from it is final. Its
 * advert name must differ from the radio's current one and from every name
 * the vault's personas go by — their labels and the advert names their saved
 * state holds — since a shared name would link them.
 *
 * @param vault - the unlocked vault the outgoing persona is kept in.
 * @param onClose - dismissal; also called once the switch has finished or
 * stopped part way.
 */
export function BurnerModal({
  vault,
  onClose,
}: {
  vault: Vault;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const notify = useMeshStore((s) => s.notify);
  const current = useMeshStore((s) => s.selfInfo?.name);
  const { startBurner, progress } = usePersonaSwitch();
  const [name, setName] = useState('');
  const [announce, setAnnounce] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until every persona's saved name has been read.
  const [savedNames, setSavedNames] = useState<(string | null)[] | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  // A persona renamed after it was minted advertises a name its label does
  // not show.
  useEffect(() => {
    let live = true;
    Promise.all(
      vault.identities.map((i) =>
        loadPersona(vault, i.publicKey).then(
          (state) => state?.name ?? null,
          () => null,
        ),
      ),
    ).then((names) => live && setSavedNames(names));
    return () => {
      live = false;
    };
  }, [vault]);

  const trimmed = name.trim();
  const bytes = enc.encode(trimmed).length;
  const taken =
    bytes > 0 &&
    isBurnerNameTaken(trimmed, [
      current,
      ...vault.identities.map((i) => i.label),
      ...(savedNames ?? []),
    ]);
  const canStart =
    !busy &&
    savedNames !== null &&
    acknowledged &&
    bytes > 0 &&
    bytes <= MAX_ADVERT_NAME_BYTES &&
    !taken;

  const run = async () => {
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const from = useMeshStore.getState().selfInfo?.pubkey?.toLowerCase();
    try {
      const outcome = await startBurner(
        vault,
        trimmed,
        announce,
        controller.signal,
      );
      // Both restart the session, which closes Settings and this dialog.
      if (outcome === 'kept') {
        notify({
          level: 'warning',
          text: t('settings.persona.error.kept'),
          key: 'personaSwitchKept',
        });
      }
      if (outcome === 'unknown') {
        notify({
          level: 'warning',
          text: t('settings.persona.unknown'),
          key: 'personaSwitchUnknown',
        });
      }
      onClose();
    } catch (err) {
      // Stopped after the key went on: the resume dialog takes over.
      const record = useMeshStore.getState().personaSwitch;
      if (record?.burner && record.target !== from) {
        onClose();
        return;
      }
      if (controller.signal.aborted) return;
      // A refusal came after the session left the outgoing identity, so the
      // restart that brings it back is closing this dialog.
      if (useMeshStore.getState().status !== 'connected') {
        notify({
          level: 'error',
          text: switchErrorMessage(err),
          key: 'personaSwitchFailed',
        });
        return;
      }
      setError(switchErrorMessage(err));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const applying = progress?.stage === 'applying';
  return (
    <ModalShell
      title={t('settings.persona.burner.title')}
      onClose={busy ? noop : onClose}
      widthClass='w-140'
    >
      {progress ? (
        <SwitchProgressView progress={progress} />
      ) : (
        <>
          <p className='mb-3 text-xs leading-relaxed text-text2'>
            {t('settings.persona.burner.intro')}
          </p>
          <ul className='mb-4 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-text'>
            <li>{t('settings.persona.burner.saves')}</li>
            <li>{t('settings.persona.burner.radio')}</li>
            <li>{t('settings.persona.burner.protects')}</li>
            <li>{t('settings.persona.burner.limits')}</li>
            <li>{t('settings.persona.burner.reload')}</li>
          </ul>
          <label htmlFor={nameId} className='mb-1 block text-xs text-text2'>
            {t('settings.persona.burner.nameField')}
          </label>
          <input
            id={nameId}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={taken || bytes > MAX_ADVERT_NAME_BYTES}
            className={INPUT_CLASS}
          />
          <p className='mt-1 mb-3 text-xs text-text2 tabular-nums'>
            {bytes}/{MAX_ADVERT_NAME_BYTES}
          </p>
          {taken && (
            <p role='alert' className='mb-3 text-xs leading-relaxed text-red'>
              {t('settings.persona.burner.nameTaken')}
            </p>
          )}
          <div className='mb-4 rounded-md border border-red bg-red/10 p-3'>
            <p className='mb-2 text-xs leading-relaxed text-text'>
              {t('settings.persona.burner.gone')}
            </p>
            <Switch
              label={t('settings.persona.burner.ack')}
              checked={acknowledged}
              onChange={setAcknowledged}
            />
          </div>
          <Switch
            label={t('settings.persona.announce')}
            checked={announce}
            onChange={setAnnounce}
          />
        </>
      )}

      {error && (
        <p role='alert' className='mt-4 text-xs leading-relaxed text-red'>
          {error}
        </p>
      )}

      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={busy ? () => abort.current?.abort() : onClose}
          disabled={busy && !applying && progress?.stage !== 'saving'}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
        >
          {t('common.cancel')}
        </button>
        {!busy && (
          <button
            onClick={() => void run()}
            disabled={!canStart}
            className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
          >
            {t('settings.persona.burner.action')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
