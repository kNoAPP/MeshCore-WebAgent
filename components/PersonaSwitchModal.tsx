// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import {
  usePersonaSwitch,
  type SwitchProgress,
} from '@/hooks/usePersonaSwitch';
import {
  isVaultPhrase,
  PersonaSwitchError,
  type PersonaSwitchErrorCode,
} from '@/lib/identity/personaSwitch';
import { SeedPhraseError } from '@/lib/identity/seed';
import type { Vault, VaultIdentity } from '@/lib/identity/vault';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import i18n from '@/lib/i18n';
import { ModalShell } from './ModalShell';
import { PRIVATE_KEY_ERROR_KEY } from './RecoveryPhraseWizard';
import { Switch } from './Switch';
import { unknownWords } from './RestorePhraseSteps';

const SWITCH_ERROR_KEY = {
  notInVault: 'settings.persona.error.notInVault',
  phraseMismatch: 'settings.persona.error.phraseMismatch',
  keyMismatch: 'settings.persona.error.keyMismatch',
  saveFailed: 'settings.persona.error.saveFailed',
  unsynced: 'settings.persona.error.unsynced',
  damaged: 'settings.persona.error.damaged',
} as const satisfies Record<PersonaSwitchErrorCode, string>;

const STAGE_KEY = {
  saving: 'settings.persona.stage.saving',
  importing: 'settings.persona.stage.importing',
  syncing: 'settings.persona.stage.syncing',
  applying: 'settings.persona.stage.applying',
  announcing: 'settings.persona.stage.announcing',
} as const satisfies Record<SwitchProgress['stage'], string>;

const INPUT_CLASS =
  'w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50';

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

/**
 * Makes one of an unlocked vault's personas live on the radio.
 *
 * @remarks Asks for the recovery phrase unless the vault remembers it, since
 * the vault holds no private keys. Warns hard when another radio seems to be
 * running the incoming identity — it has been heard on the mesh this
 * session, or the vault last saw a switch make it live — since two radios on
 * one key break message dedup and acknowledgements for both.
 *
 * Cancelling while the persona is being applied stops before the next radio
 * command. The radio then holds the new key and part of its persona, which
 * {@link PersonaResumeModal} offers to finish, as it does after a failure or
 * a dropped link.
 *
 * @param onClose - dismissal; also called once the switch has finished or
 * stopped part way.
 */
export function PersonaSwitchModal({
  vault,
  target,
  onClose,
}: {
  vault: Vault;
  target: VaultIdentity;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phraseId = useId();
  const notify = useMeshStore((s) => s.notify);
  const heardElsewhere = useMeshStore(
    (s) =>
      Object.values(s.adverts).some((a) => a.pubkey === target.publicKey) ||
      Object.values(s.contacts).some((c) => c.pubkey === target.publicKey),
  );
  // The vault last saw it go live, and the radio in hand is not it: another
  // radio is running it, whether or not it has been heard.
  const liveElsewhere = !heardElsewhere && !!target.live;
  const warned = heardElsewhere || liveElsewhere;
  const { start, progress } = usePersonaSwitch();
  const [phrase, setPhrase] = useState('');
  const [announce, setAnnounce] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // A dialog that goes away mid-run (the reconnect after a dropped link
  // closes Settings) stops the run at its next command.
  useEffect(() => () => abort.current?.abort(), []);

  const needsPhrase = vault.phrase === null;
  const canSwitch =
    !busy &&
    (!warned || acknowledged) &&
    (!needsPhrase || (!!phrase.trim() && unknownWords(phrase).length === 0));

  const run = async () => {
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const words = vault.phrase ?? phrase;
      if (needsPhrase && !(await isVaultPhrase(vault, words))) {
        setError(t(SWITCH_ERROR_KEY.phraseMismatch));
        return;
      }
      const outcome = await start(
        vault,
        words,
        target,
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
      if (useMeshStore.getState().personaSwitch?.target === target.publicKey) {
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
      title={t('settings.persona.switchTitle', { name: target.label })}
      onClose={busy ? noop : onClose}
      widthClass='w-140'
    >
      {progress ? (
        <SwitchProgressView progress={progress} />
      ) : (
        <>
          <p className='mb-3 text-xs leading-relaxed text-text2'>
            {t('settings.persona.switchIntro')}
          </p>
          <ul className='mb-4 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-text'>
            <li>{t('settings.persona.switchRadio')}</li>
            <li>{t('settings.persona.switchBrowser')}</li>
            <li>{t('settings.persona.switchContacts')}</li>
          </ul>
          {warned && (
            <div
              role='alert'
              className='mb-4 rounded-md border border-red bg-red/10 p-3'
            >
              <p className='mb-2 text-xs leading-relaxed text-text'>
                {t(
                  heardElsewhere
                    ? 'settings.persona.heardElsewhere'
                    : 'settings.persona.liveElsewhere',
                  { name: target.label },
                )}
              </p>
              <Switch
                label={t('settings.persona.heardElsewhereAck')}
                checked={acknowledged}
                onChange={setAcknowledged}
              />
            </div>
          )}
          {needsPhrase && (
            <>
              <label
                htmlFor={phraseId}
                className='mb-1 block text-xs text-text2'
              >
                {t('settings.persona.phraseLabel')}
              </label>
              {/* No spellcheck or autocomplete, as in the restore wizard. */}
              <textarea
                id={phraseId}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                rows={3}
                autoComplete='off'
                autoCapitalize='off'
                spellCheck={false}
                disabled={busy}
                className={`${INPUT_CLASS} mb-4 resize-none font-mono`}
              />
            </>
          )}
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
            disabled={!canSwitch}
            className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
          >
            {t('settings.persona.switchAction')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}

/** A persona switch's current step, with a bar for the persona's commands. */
export function SwitchProgressView({ progress }: { progress: SwitchProgress }) {
  const { t } = useTranslation();
  const counted = progress.stage === 'applying' && progress.total > 0;
  return (
    <div aria-live='polite'>
      <p className='mb-3 text-xs leading-relaxed text-text'>
        {progress.stage === 'applying'
          ? t(STAGE_KEY.applying, {
              done: progress.done,
              total: progress.total,
            })
          : t(STAGE_KEY[progress.stage])}
      </p>
      <div className='h-1.5 overflow-hidden rounded-full bg-surface2'>
        <div
          className={`h-full bg-accent-solid transition-[width] ${counted ? '' : 'w-1/3 animate-pulse'}`}
          style={
            counted
              ? { width: `${(100 * progress.done) / progress.total}%` }
              : undefined
          }
        />
      </div>
      <p className='mt-3 text-xs leading-relaxed text-text2'>
        {t('settings.persona.progressHint')}
      </p>
    </div>
  );
}

/** Localized copy for a persona switch or mint that failed. */
export function switchErrorMessage(err: unknown): string {
  if (err instanceof PersonaSwitchError) {
    return i18n.t(SWITCH_ERROR_KEY[err.code]);
  }
  if (err instanceof SeedPhraseError) {
    return i18n.t('settings.persona.error.phrase');
  }
  if (err instanceof PrivateKeyError) {
    return i18n.t(
      err.code === 'disabled'
        ? 'settings.backup.identityError.disabledImport'
        : PRIVATE_KEY_ERROR_KEY[err.code],
    );
  }
  return i18n.t('settings.persona.error.other', {
    error: (err as Error).message,
  });
}
