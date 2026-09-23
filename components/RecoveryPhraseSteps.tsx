// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSeedBorn } from '@/hooks/useSeedBorn';
import { Switch } from './Switch';
import { SecretInput } from './SecretInput';
import { MIN_PASSPHRASE_LENGTH } from './BackupCommon';

/**
 * The step bodies of {@link RecoveryPhraseWizard}. Each is controlled: the
 * wizard owns every value, so going back a step never loses or regenerates
 * what the user has already seen and written down.
 */

const INPUT_CLASS =
  'w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Step 1: what regenerating costs, with the backup export offered first.
 *
 * @param onBackup - opens the backup export, so the outgoing identity can be
 * kept before it is destroyed.
 */
export function ExplainStep({ onBackup }: { onBackup: () => void }) {
  const { t } = useTranslation();
  const seedBorn = useSeedBorn();
  return (
    <>
      <p className='mb-4 text-xs leading-relaxed text-text2'>
        {t(
          seedBorn
            ? 'settings.recovery.seedBorn.explainIntro'
            : 'settings.recovery.explainIntro',
        )}
      </p>
      <div className='rounded-md border border-red bg-red/10 p-3'>
        <p className='mb-2 text-xs font-semibold text-text'>
          {t('settings.recovery.costTitle')}
        </p>
        <ul className='list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-text'>
          <li>{t('settings.recovery.costPubkey')}</li>
          <li>
            {t(
              seedBorn
                ? 'settings.recovery.seedBorn.costOld'
                : 'settings.recovery.costOld',
            )}
          </li>
          <li>{t('settings.recovery.costSecrets')}</li>
        </ul>
      </div>
      <p className='mt-3 text-xs leading-relaxed text-text2'>
        {t('settings.recovery.costKept')}
      </p>
      <button
        onClick={onBackup}
        className='mt-4 rounded-md border border-border-control px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface2'
      >
        {t('settings.recovery.backupFirst')}
      </button>
    </>
  );
}

/** Step 2: the phrase itself, and the user's word that it is on paper. */
export function PhraseStep({
  words,
  written,
  onWritten,
}: {
  words: string[];
  written: boolean;
  onWritten: (written: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className='mb-3 text-xs leading-relaxed text-text2'>
        {/* Bold steers the phrase off screenshots, notes apps and synced
            password managers. */}
        <Trans
          t={t}
          i18nKey='settings.recovery.phraseIntro'
          values={{ count: words.length }}
          components={{
            strong: <strong className='font-semibold text-text' />,
          }}
        />
      </p>
      <ol className='grid grid-cols-3 gap-2 rounded-md border border-border bg-surface2 p-3 font-mono text-sm'>
        {words.map((word, i) => (
          <li key={i} className='flex gap-2'>
            <span className='w-5 text-right text-text2 tabular-nums'>
              {i + 1}
            </span>
            <span className='font-semibold text-text'>{word}</span>
          </li>
        ))}
      </ol>
      <p className='mt-3 rounded-md border border-red bg-red/10 p-3 text-xs leading-relaxed text-text'>
        {t('settings.recovery.phraseWarning')}
      </p>
      <Switch
        className='mt-4'
        label={t('settings.recovery.phraseWritten')}
        checked={written}
        onChange={onWritten}
      />
    </>
  );
}

/**
 * Step 3: the user re-enters a few words from their written copy.
 *
 * @param positions - zero-based word positions to ask for, in display order.
 * @param answers - what has been typed so far, parallel to `positions`.
 * @param wrong - the answers were submitted and at least one does not match.
 */
export function ConfirmStep({
  positions,
  answers,
  wrong,
  onAnswer,
}: {
  positions: number[];
  answers: string[];
  wrong: boolean;
  onAnswer: (slot: number, value: string) => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  return (
    <>
      <p className='mb-4 text-xs leading-relaxed text-text2'>
        {t('settings.recovery.confirmIntro')}
      </p>
      <div className='flex flex-col gap-3'>
        {positions.map((pos, slot) => (
          <div key={pos}>
            <label
              htmlFor={`${baseId}-${slot}`}
              className='mb-1 block text-xs text-text2'
            >
              {t('settings.recovery.confirmWord', { n: pos + 1 })}
            </label>
            {/* No spellcheck or autocomplete: either would hand the words to
                a browser service, or keep them in its suggestion history. */}
            <input
              id={`${baseId}-${slot}`}
              value={answers[slot]}
              onChange={(e) => onAnswer(slot, e.target.value)}
              autoComplete='off'
              autoCapitalize='off'
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
        ))}
      </div>
      {wrong && (
        <p role='alert' className='mt-3 text-xs text-red'>
          {t('settings.recovery.confirmWrong')}
        </p>
      )}
    </>
  );
}

/**
 * Step 4: the vault passphrase, and whether the vault keeps the phrase.
 *
 * @param intro - replaces the step's opening sentence, for a flow the default
 * does not describe.
 */
export function PassphraseStep({
  intro,
  passphrase,
  confirm,
  remember,
  onPassphrase,
  onConfirm,
  onRemember,
}: {
  intro?: string;
  passphrase: string;
  confirm: string;
  remember: boolean;
  onPassphrase: (value: string) => void;
  onConfirm: (value: string) => void;
  onRemember: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const passId = useId();
  const confirmId = useId();
  const tooShort =
    passphrase.length > 0 &&
    [...passphrase.normalize('NFKC')].length < MIN_PASSPHRASE_LENGTH;
  const mismatch =
    confirm.length > 0 &&
    confirm.normalize('NFKC') !== passphrase.normalize('NFKC');
  return (
    <>
      <p className='mb-4 text-xs leading-relaxed text-text2'>
        {intro ?? t('settings.recovery.passphraseIntro')}
      </p>
      <label htmlFor={passId} className='mb-1 block text-xs text-text2'>
        {t('settings.backup.passphrase')}
      </label>
      <SecretInput
        id={passId}
        autoComplete='new-password'
        value={passphrase}
        onChange={(e) => onPassphrase(e.target.value)}
        className={INPUT_CLASS}
      />
      <p className='mt-1 text-xs text-text2'>
        {tooShort
          ? t('settings.backup.passphraseTooShort', {
              count: MIN_PASSPHRASE_LENGTH,
            })
          : t('settings.recovery.passphraseHint')}
      </p>
      <label htmlFor={confirmId} className='mb-1 mt-4 block text-xs text-text2'>
        {t('settings.backup.passphraseConfirm')}
      </label>
      <SecretInput
        id={confirmId}
        autoComplete='new-password'
        value={confirm}
        onChange={(e) => onConfirm(e.target.value)}
        className={INPUT_CLASS}
      />
      {mismatch && (
        <p className='mt-1 text-xs text-red'>
          {t('settings.backup.passphraseMismatch')}
        </p>
      )}
      <div className='mt-5 rounded-md border border-red bg-red/10 p-3'>
        <Switch
          label={t('settings.recovery.remember')}
          checked={remember}
          onChange={onRemember}
        />
        <p className='mt-2 text-xs leading-relaxed text-text2'>
          {t('settings.recovery.rememberWarning')}
        </p>
      </div>
    </>
  );
}

/**
 * Step 5: the public key about to be installed, and the typed confirmation
 * that authorizes destroying the current identity.
 *
 * @param publicKey - the key the phrase derives, lowercase hex.
 * @param node - the connected node's name, which the user must type.
 */
export function WriteStep({
  publicKey,
  node,
  typed,
  busy,
  onTyped,
}: {
  publicKey: string;
  node: string;
  typed: string;
  busy: boolean;
  onTyped: (value: string) => void;
}) {
  const { t } = useTranslation();
  const confirmId = useId();
  return (
    <>
      <p className='mb-2 text-xs leading-relaxed text-text2'>
        {t('settings.recovery.writeIntro')}
      </p>
      <p className='rounded-md border border-border bg-surface2 p-3 font-mono text-xs break-all text-text'>
        {publicKey}
      </p>
      <p className='mt-3 text-xs leading-relaxed text-text2'>
        {t('settings.recovery.writeReboot')}
      </p>
      <div className='mt-4 rounded-md border border-red bg-red/10 p-3'>
        <label htmlFor={confirmId} className='mb-1 block text-xs text-text'>
          {t('settings.backup.restoreIdentityConfirm', { node })}
        </label>
        <input
          id={confirmId}
          value={typed}
          disabled={busy}
          onChange={(e) => onTyped(e.target.value)}
          autoComplete='off'
          className='w-full rounded-md border border-red bg-surface2 px-3 py-2 text-sm outline-none focus:border-red disabled:cursor-not-allowed disabled:opacity-50'
        />
      </div>
    </>
  );
}
