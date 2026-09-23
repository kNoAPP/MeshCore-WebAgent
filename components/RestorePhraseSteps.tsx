// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { PhrasePreview } from '@/lib/identity/restore';
import { PhraseInput } from './PhraseInput';
import { Switch } from './Switch';

/**
 * The step bodies of {@link RestorePhraseWizard} that the regenerate wizard
 * has no counterpart for. Each is controlled: the wizard owns every value.
 */

const INPUT_CLASS =
  'w-full rounded-md border border-border-control bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Step 1: the phrase, one word per numbered box.
 *
 * @param error - why the last submitted phrase was refused, already
 * localized, or null.
 */
export function EnterStep({
  phrase,
  error,
  onPhrase,
}: {
  phrase: string;
  error: string | null;
  onPhrase: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className='mb-3 text-xs leading-relaxed text-text2'>
        {t('settings.restore.enterIntro')}
      </p>
      <PhraseInput
        label={t('settings.restore.phraseLabel')}
        value={phrase}
        onChange={onPhrase}
      />
      {error && (
        <p role='alert' className='mt-2 text-xs leading-relaxed text-red'>
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Step 2: what the phrase would restore, shown before anything is written.
 *
 * @param current - true when the connected radio already holds this identity.
 */
export function PreviewStep({
  preview,
  current,
}: {
  preview: PhrasePreview;
  current: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className='mb-2 text-xs leading-relaxed text-text2'>
        {t('settings.restore.previewIntro')}
      </p>
      <p className='rounded-md border border-border bg-surface2 p-3 font-mono text-xs break-all text-text'>
        {preview.publicKey}
      </p>
      <p className='mt-3 text-xs leading-relaxed text-text2'>
        {t('settings.restore.previewCheck')}
      </p>
      <p className='mt-3 text-xs leading-relaxed text-text'>
        {t(
          preview.vaultExists
            ? 'settings.restore.vaultKnown'
            : 'settings.restore.vaultUnknown',
        )}
      </p>
      {current && (
        <p className='mt-3 rounded-md border border-border bg-surface2 p-3 text-xs leading-relaxed text-text'>
          {t('settings.restore.alreadyHeld')}
        </p>
      )}
      <p className='mt-3 text-xs leading-relaxed text-text2'>
        {t('settings.restore.historyNote')}
      </p>
    </>
  );
}

/**
 * Step 3: what replacing the radio's identity destroys, with the backup
 * export offered first.
 *
 * @param onBackup - opens the backup export for the outgoing identity.
 */
export function ReplaceStep({ onBackup }: { onBackup: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className='rounded-md border border-red bg-red/10 p-3'>
        <p className='mb-2 text-xs font-semibold text-text'>
          {t('settings.restore.replaceTitle')}
        </p>
        <ul className='list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-text'>
          <li>{t('settings.restore.replaceErase')}</li>
          <li>{t('settings.restore.replaceContacts')}</li>
        </ul>
      </div>
      <button
        onClick={onBackup}
        className='mt-4 rounded-md border border-border-control px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface2'
      >
        {t('settings.recovery.backupFirst')}
      </button>
    </>
  );
}

/**
 * Step 4, when this device already has a vault for the phrase: its
 * passphrase, or the choice to replace a vault whose passphrase is lost. The
 * wizard renders the new vault's passphrase fields below once `replace` is on.
 *
 * @param error - why the last unlock failed, already localized, or null.
 */
export function UnlockStep({
  passphrase,
  replace,
  error,
  busy,
  onPassphrase,
  onReplace,
}: {
  passphrase: string;
  replace: boolean;
  error: string | null;
  busy: boolean;
  onPassphrase: (value: string) => void;
  onReplace: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <>
      <p className='mb-4 text-xs leading-relaxed text-text2'>
        {t('settings.restore.unlockIntro')}
      </p>
      {!replace && (
        <>
          <label htmlFor={id} className='mb-1 block text-xs text-text2'>
            {t('settings.backup.passphrase')}
          </label>
          <input
            id={id}
            type='password'
            autoComplete='current-password'
            value={passphrase}
            disabled={busy}
            onChange={(e) => onPassphrase(e.target.value)}
            className={INPUT_CLASS}
          />
          {error && (
            <p role='alert' className='mt-2 text-xs leading-relaxed text-red'>
              {error}
            </p>
          )}
        </>
      )}
      <div className='mt-5 mb-4 rounded-md border border-border p-3'>
        <Switch
          label={t('settings.restore.replaceVault')}
          checked={replace}
          onChange={onReplace}
        />
        <p className='mt-2 text-xs leading-relaxed text-text2'>
          {t('settings.restore.replaceVaultHint')}
        </p>
      </div>
    </>
  );
}
