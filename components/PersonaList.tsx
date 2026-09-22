// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { isBurnerSession, useBackupReady } from './BackupCommon';
import { mintPersona } from '@/lib/identity/personaSwitch';
import {
  VaultError,
  type Vault,
  type VaultIdentity,
} from '@/lib/identity/vault';
import { MAX_ADVERT_NAME_BYTES } from '@/lib/meshcore/constants';
import { unknownWords } from './RestorePhraseSteps';
import { PersonaSwitchModal, switchErrorMessage } from './PersonaSwitchModal';
import { BurnerModal } from './BurnerModal';
import { KeyAvatar } from './KeyAvatar';

const BUTTON_CLASS =
  'rounded-md border border-border-control px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent';
const INPUT_CLASS =
  'w-full rounded-md border border-border-control bg-surface2 px-3 py-1.5 text-sm outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50';

const enc = new TextEncoder();

/**
 * The personas an unlocked vault lists, which one is live on the radio, and
 * the way to switch to another, mint a new one, or start a burner.
 *
 * @param onLock - locks the vault and returns to the unlock prompt.
 * @param onStale - the stored vault changed in another tab since it was
 * unlocked, and must be unlocked again before it can be saved.
 */
export function PersonaList({
  vault,
  onLock,
  onStale,
}: {
  vault: Vault;
  onLock: () => void;
  onStale: () => void;
}) {
  const { t } = useTranslation();
  const ready = useBackupReady();
  const live = useMeshStore((s) => s.selfInfo?.pubkey?.toLowerCase());
  const liveName = useMeshStore((s) => s.selfInfo?.name);
  const burnerLive = useMeshStore(isBurnerSession);
  // A burner's session is never backup-ready, since nothing of it may be
  // kept, but switching away from it needs only the link.
  const linked = useMeshStore(
    (s) => s.status === 'connected' && !!s.client && !s.client.closed,
  );
  const switching = useMeshStore((s) => !!s.personaSwitch?.running);
  // Mid-switch, the session is never hydrated, and switching away (back to
  // the persona it came from, say) must still be possible.
  const mixed = useMeshStore(
    (s) =>
      s.status === 'connected' &&
      s.personaSwitch?.stage === 'switching' &&
      s.personaSwitch.target === s.selfInfo?.pubkey?.toLowerCase(),
  );
  const [identities, setIdentities] = useState(vault.identities);
  const [target, setTarget] = useState<VaultIdentity | null>(null);
  const [minting, setMinting] = useState(false);
  const [burning, setBurning] = useState(false);
  // A burner is never listed, but it has nothing to keep, so switching away
  // from it needs nowhere to keep it.
  const liveKnown = burnerLive || identities.some((i) => i.publicKey === live);
  const canSwitch =
    liveKnown && (ready || mixed || (burnerLive && linked)) && !switching;

  return (
    <>
      {!liveKnown && (
        <p className='mb-3 text-xs leading-relaxed text-text2'>
          {t('settings.persona.liveNotListed')}
        </p>
      )}
      <ul className='space-y-2'>
        {burnerLive && live && (
          <li className='flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-red p-2'>
            <KeyAvatar pubkey={live} size={24} />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm text-text'>
                {liveName || t('settings.persona.unnamed')}
              </p>
              <p className='text-xs leading-relaxed text-text2'>
                {t('settings.persona.burner.liveHint')}
              </p>
            </div>
            <span className='rounded-full bg-red px-2 py-0.5 text-xs font-semibold text-white'>
              {t('settings.persona.burner.live')}
            </span>
          </li>
        )}
        {identities.map((identity) => (
          <li
            key={identity.publicKey}
            className='flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border p-2'
          >
            <KeyAvatar pubkey={identity.publicKey} size={24} />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm text-text'>
                {identity.label || t('settings.persona.unnamed')}
              </p>
              <p className='font-mono text-xs text-text2'>
                {identity.index === null
                  ? t('settings.persona.primary')
                  : t('settings.persona.index', { index: identity.index })}
                {' · '}
                {identity.publicKey.slice(0, 8)}…{identity.publicKey.slice(-4)}
              </p>
            </div>
            {identity.publicKey === live ? (
              <span className='rounded-full bg-accent-solid px-2 py-0.5 text-xs font-semibold text-white'>
                {t('settings.persona.live')}
              </span>
            ) : (
              <button
                onClick={() => setTarget(identity)}
                disabled={!canSwitch}
                className={BUTTON_CLASS}
              >
                {t('settings.persona.switch')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {minting ? (
        <MintForm
          vault={vault}
          onDone={(added) => {
            setMinting(false);
            if (added) setIdentities(vault.identities);
          }}
          onStale={onStale}
        />
      ) : (
        <div className='mt-3 flex flex-wrap gap-2'>
          <button onClick={() => setMinting(true)} className={BUTTON_CLASS}>
            {t('settings.persona.new')}
          </button>
          <button
            onClick={() => setBurning(true)}
            disabled={!canSwitch}
            className={BUTTON_CLASS}
          >
            {t('settings.persona.burner.new')}
          </button>
          <button onClick={onLock} className={BUTTON_CLASS}>
            {t('settings.persona.lock')}
          </button>
        </div>
      )}
      {target && (
        <PersonaSwitchModal
          vault={vault}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
      {burning && (
        <BurnerModal vault={vault} onClose={() => setBurning(false)} />
      )}
    </>
  );
}

// Names and derives the next persona. The phrase is asked for unless the
// vault remembers it: the vault can list personas, but not derive one.
function MintForm({
  vault,
  onDone,
  onStale,
}: {
  vault: Vault;
  onDone: (added: boolean) => void;
  onStale: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const phraseId = useId();
  const [label, setLabel] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPhrase = vault.phrase === null;
  const bytes = enc.encode(label.trim()).length;
  const canMint =
    !busy &&
    bytes > 0 &&
    bytes <= MAX_ADVERT_NAME_BYTES &&
    (!needsPhrase || (!!phrase.trim() && unknownWords(phrase).length === 0));

  const mint = async () => {
    setBusy(true);
    setError(null);
    try {
      await mintPersona(vault, vault.phrase ?? phrase, label.trim());
      onDone(true);
    } catch (err) {
      if (err instanceof VaultError && err.code === 'stale') {
        onStale();
        return;
      }
      setError(switchErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className='mt-3 rounded-md border border-border p-3'
      onSubmit={(e) => {
        e.preventDefault();
        void mint();
      }}
    >
      <p className='mb-3 text-xs leading-relaxed text-text2'>
        {t('settings.persona.newIntro')}
      </p>
      <label htmlFor={labelId} className='mb-1 block text-xs text-text2'>
        {t('settings.persona.labelField')}
      </label>
      <input
        id={labelId}
        value={label}
        disabled={busy}
        onChange={(e) => setLabel(e.target.value)}
        aria-invalid={bytes > MAX_ADVERT_NAME_BYTES}
        className={INPUT_CLASS}
      />
      <p className='mt-1 mb-3 text-xs text-text2 tabular-nums'>
        {bytes}/{MAX_ADVERT_NAME_BYTES}
      </p>
      {needsPhrase && (
        <>
          <label htmlFor={phraseId} className='mb-1 block text-xs text-text2'>
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
            className={`${INPUT_CLASS} resize-none font-mono`}
          />
        </>
      )}
      {error && (
        <p role='alert' className='mt-2 text-xs leading-relaxed text-red'>
          {error}
        </p>
      )}
      <div className='mt-3 flex justify-end gap-2'>
        <button
          type='button'
          onClick={() => onDone(false)}
          disabled={busy}
          className='rounded-md px-3 py-1.5 text-xs text-text hover:bg-surface2 disabled:opacity-50'
        >
          {t('common.cancel')}
        </button>
        <button type='submit' disabled={!canMint} className={BUTTON_CLASS}>
          {busy ? t('settings.persona.minting') : t('settings.persona.mint')}
        </button>
      </div>
    </form>
  );
}
