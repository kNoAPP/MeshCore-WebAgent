// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useFinishIdentityWrite } from '@/hooks/useFinishIdentityWrite';
import { boundPubkey } from '@/lib/session/persistence';
import { SeedPhraseError, type SeedPhraseErrorCode } from '@/lib/identity/seed';
import { previewPhrase, restoreIdentity } from '@/lib/identity/restore';
import { ModalShell } from './ModalShell';
import { BackupExportModal } from './BackupExportModal';
import { backupSessionPubkey, useBackupReady } from './BackupCommon';
import { WriteStep } from './RecoveryPhraseSteps';
import { WriteErrorText } from './RecoveryPhraseWizard';
import { EnterStep, PreviewStep, ReplaceStep } from './RestorePhraseSteps';
import { unknownWords } from './PhraseInput';

// The radio already holding the phrase's identity has nothing to be given, so
// the run ends at the preview.
const REPLACE_STEPS = ['enter', 'preview', 'replace', 'write'] as const;
const KEEP_STEPS = ['enter', 'preview'] as const;
type Step = (typeof REPLACE_STEPS)[number];

const PHRASE_ERROR_KEY = {
  wordCount: 'settings.restore.phraseError.wordCount',
  unknownWord: 'settings.restore.phraseError.unknownWord',
  checksum: 'settings.restore.phraseError.checksum',
  reservedKey: 'settings.restore.phraseError.reservedKey',
} as const satisfies Record<SeedPhraseErrorCode, string>;

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

/**
 * Puts the identity a recovery phrase derives onto the connected radio — the
 * way back to a lost radio's public key on replacement hardware.
 *
 * @remarks
 * A mistyped phrase is refused before anything else happens, and the public
 * key it derives is shown before anything is written, so a wrong phrase is
 * caught while it costs nothing.
 *
 * Nothing in this browser moves with the identity: the phrase restores the
 * key, not the message archive. As in {@link RecoveryPhraseWizard}, the reboot
 * closes Settings, so the verification is handed to the store's
 * `identityCheck` for {@link IdentityCheckModal} to judge.
 *
 * The phrase lives in this component's state and nowhere else.
 *
 * @param onClose - dismissal; also called once the radio is rebooting.
 */
export function RestorePhraseWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const client = useMeshStore((s) => s.client);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const finish = useFinishIdentityWrite(onClose);
  const sessionReady = useBackupReady();
  const installed = useMeshStore(
    (s) => !!client && s.identityCheck?.client === client,
  );
  // The radio this run is for; see RecoveryPhraseWizard.
  const [pubkey] = useState(selfInfo?.pubkey?.toLowerCase() ?? null);

  const [step, setStep] = useState<Step>('enter');
  const [phrase, setPhrase] = useState('');
  const [phraseError, setPhraseError] = useState<string | null>(null);
  // The public key the entered phrase derives, lowercase hex.
  const [preview, setPreview] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  const node = selfInfo?.name ?? '';
  const current = !!preview && preview === pubkey;
  const steps: readonly Step[] = current ? KEEP_STEPS : REPLACE_STEPS;
  const index = steps.indexOf(step);
  const last = index === steps.length - 1;

  const canAdvance = {
    enter: !busy && !!phrase.trim() && unknownWords(phrase).length === 0,
    preview: true,
    replace: sessionReady,
    write: sessionReady && !busy && typed.trim() === node,
  }[step];

  const next = async () => {
    setError(null);
    setBusy(true);
    try {
      if (step === 'enter') {
        setPhraseError(null);
        try {
          setPreview(await previewPhrase(phrase));
        } catch (err) {
          setPhraseError(
            err instanceof SeedPhraseError
              ? t(PHRASE_ERROR_KEY[err.code], {
                  n: (err.wordIndex ?? 0) + 1,
                })
              : t('settings.restore.error.derive', {
                  error: (err as Error).message,
                }),
          );
          return;
        }
      }
      setStep(steps[index + 1]);
    } finally {
      setBusy(false);
    }
  };

  const write = async () => {
    if (!preview || !client || !pubkey) return;
    setBusy(true);
    setError(null);
    try {
      // Revalidated against the live store: a reconnect between the last
      // render and this click may have brought back a different radio.
      if (backupSessionPubkey()?.toLowerCase() !== pubkey) {
        setError(t('settings.backup.sessionChanged'));
        return;
      }
      // What the radio reports if the key does not land; see
      // RecoveryPhraseWizard. Read before the run, which unbinds the session.
      const outgoing = boundPubkey() ?? pubkey;
      let confirmed: boolean;
      try {
        confirmed = await restoreIdentity(client, phrase);
      } catch (err) {
        setError(<WriteErrorText err={err} />);
        return;
      }
      const failed = await finish({
        kind: 'restore',
        expected: preview,
        outgoing,
        confirmed,
        client,
      });
      if (failed) setError(failed);
    } finally {
      setBusy(false);
    }
  };

  const primary =
    step === 'write'
      ? {
          run: write,
          label: busy
            ? t('settings.recovery.writing')
            : t('settings.recovery.writeAction'),
          danger: true,
        }
      : last
        ? { run: onClose, label: t('common.close'), danger: false }
        : { run: next, label: t('settings.recovery.next'), danger: false };

  return (
    <ModalShell
      title={t('settings.restore.title')}
      onClose={busy ? noop : onClose}
      widthClass='w-140'
      confirmClose={!busy && !!phrase && !installed}
    >
      <p className='mb-3 text-xs text-text2'>
        {t('settings.recovery.step', { step: index + 1, total: steps.length })}
      </p>

      {step === 'enter' && (
        <EnterStep
          phrase={phrase}
          error={phraseError}
          onPhrase={(value) => {
            setPhraseError(null);
            setPhrase(value);
          }}
        />
      )}
      {step === 'preview' && preview && (
        <PreviewStep publicKey={preview} current={current} />
      )}
      {step === 'replace' && (
        <ReplaceStep onBackup={() => setBackingUp(true)} />
      )}
      {step === 'write' && preview && (
        <WriteStep
          publicKey={preview}
          node={node}
          typed={typed}
          busy={busy || installed}
          onTyped={setTyped}
        />
      )}

      {error && (
        <p role='alert' className='mt-4 text-xs leading-relaxed text-red'>
          {error}
        </p>
      )}

      <div className='mt-6 flex justify-end gap-2'>
        {installed ? (
          <button
            onClick={onClose}
            className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
          >
            {t('common.close')}
          </button>
        ) : (
          <>
            <button
              onClick={index === 0 ? onClose : () => setStep(steps[index - 1])}
              disabled={busy}
              className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
            >
              {index === 0 ? t('common.cancel') : t('common.back')}
            </button>
            <button
              onClick={() => void primary.run()}
              disabled={!canAdvance}
              className={
                primary.danger
                  ? 'rounded-md bg-red-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-solid'
                  : 'rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
              }
            >
              {primary.label}
            </button>
          </>
        )}
      </div>

      {backingUp && <BackupExportModal onClose={() => setBackingUp(false)} />}
    </ModalShell>
  );
}
