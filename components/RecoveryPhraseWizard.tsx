// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { boundPubkey } from '@/lib/session/persistence';
import { generateMnemonic, identityFromMnemonic } from '@/lib/identity/seed';
import {
  regenerateIdentity,
  type RegenerateResult,
} from '@/lib/identity/regenerate';
import {
  PrivateKeyError,
  type PrivateKeyErrorCode,
} from '@/lib/meshcore/errors';
import { toHex } from '@/lib/utils';
import { ModalShell } from './ModalShell';
import { BackupExportModal } from './BackupExportModal';
import {
  MIN_PASSPHRASE_LENGTH,
  backupSessionPubkey,
  useBackupReady,
} from './BackupCommon';
import {
  ConfirmStep,
  ExplainStep,
  PassphraseStep,
  PhraseStep,
  WriteStep,
} from './RecoveryPhraseSteps';

const STEPS = ['explain', 'phrase', 'confirm', 'passphrase', 'write'] as const;
type Step = (typeof STEPS)[number];

// 128 bits, Ed25519's own security level, and the shortest phrase to copy by
// hand without a slip.
const PHRASE_WORDS = 12;
const CONFIRM_WORDS = 3;

const PRIVATE_KEY_ERROR_KEY = {
  unsupported: 'settings.recovery.error.unsupported',
  rejected: 'settings.recovery.error.rejected',
  writeFailed: 'settings.recovery.error.writeFailed',
} as const satisfies Record<Exclude<PrivateKeyErrorCode, 'disabled'>, string>;

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

// The generated phrase, the words asked back, and the public key it derives.
interface Draft {
  words: string[];
  positions: number[];
  publicKey: string;
}

async function newDraft(): Promise<Draft> {
  const phrase = await generateMnemonic(PHRASE_WORDS);
  const { privateKey, publicKey } = await identityFromMnemonic(phrase);
  privateKey.fill(0);
  const positions = new Set<number>();
  const pick = new Uint8Array(1);
  while (positions.size < CONFIRM_WORDS) {
    // Rejection sampling over the next power of two, so every position is
    // equally likely.
    const n = crypto.getRandomValues(pick)[0] & 0x0f;
    if (n < PHRASE_WORDS) positions.add(n);
  }
  return {
    words: phrase.split(' '),
    positions: [...positions].sort((a, b) => a - b),
    publicKey: toHex(publicKey),
  };
}

/**
 * Replaces the radio's identity with a new one generated from a recovery
 * phrase, refusing to go on until the user has shown the phrase is on paper.
 *
 * @remarks
 * The phrase lives in this component's state and nowhere else — not the
 * store, not a log, not the vault unless the user opts in — and goes with the
 * component when it unmounts.
 *
 * The dialog cannot see the verification through. After the reboot the
 * session is restarted through the reconnect loop (the reboot alone does not
 * always drop the link), and that closes Settings with it, so the expected
 * public key is handed to the store's `identityCheck` and
 * {@link IdentityCheckModal} judges it once the radio is back.
 *
 * @param onClose - dismissal; also called once the radio is rebooting.
 */
export function RecoveryPhraseWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const client = useMeshStore((s) => s.client);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const notify = useMeshStore((s) => s.notify);
  const setIdentityCheck = useMeshStore((s) => s.setIdentityCheck);
  const { restartSession } = useMeshCore();
  const sessionReady = useBackupReady();
  // Once the key is on the radio the only way forward is the reboot, and the
  // steps before it no longer describe anything that can be changed.
  const installed = useMeshStore(
    (s) => !!client && s.identityCheck?.client === client,
  );
  // The radio this run is for. Every write is checked against it, so a
  // reconnect that brings back a different radio cannot inherit the run.
  const [pubkey] = useState(selfInfo?.pubkey ?? null);

  const [step, setStep] = useState<Step>('explain');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [written, setWritten] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);
  // Whether Next was pressed on the current answers. The mismatch is only
  // reported then, not while the last word is still being typed.
  const [checked, setChecked] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(false);
  const [typed, setTyped] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  const node = selfInfo?.name ?? '';
  const index = STEPS.indexOf(step);

  const filled =
    !!draft && answers.length === CONFIRM_WORDS && answers.every((a) => a);
  const confirmed =
    filled &&
    draft.positions.every(
      (pos, slot) => answers[slot].trim().toLowerCase() === draft.words[pos],
    );
  const normalized = passphrase.normalize('NFKC');
  const passphraseOk =
    [...normalized].length >= MIN_PASSPHRASE_LENGTH &&
    confirm.normalize('NFKC') === normalized;

  const canAdvance = {
    explain: sessionReady && !busy,
    phrase: written,
    confirm: filled,
    passphrase: passphraseOk,
    write: sessionReady && !busy && typed.trim() === node,
  }[step];

  const next = async () => {
    setError(null);
    if (step === 'confirm' && !confirmed) {
      setChecked(true);
      return;
    }
    if (step === 'explain' && !draft) {
      setBusy(true);
      try {
        const fresh = await newDraft();
        setDraft(fresh);
        setAnswers(fresh.positions.map(() => ''));
      } catch (err) {
        setError(
          t('settings.recovery.error.generate', {
            error: (err as Error).message,
          }),
        );
        return;
      } finally {
        setBusy(false);
      }
    }
    setStep(STEPS[index + 1]);
  };

  const write = async () => {
    if (!draft || !client || !pubkey) return;
    setBusy(true);
    setError(null);
    try {
      // Revalidated against the live store: a reconnect between the last
      // render and this click may have brought back a different radio.
      if (backupSessionPubkey() !== pubkey) {
        setError(t('settings.backup.sessionChanged'));
        return;
      }
      // What the radio reports if the key does not land: where this session's
      // data is bound, which stays right even if an earlier import's
      // `SELF_INFO` re-read failed. Read before the run, whose handover moves
      // the binding onto the incoming identity.
      const outgoing = boundPubkey() ?? pubkey;
      let result: RegenerateResult;
      try {
        result = await regenerateIdentity(
          client,
          draft.words.join(' '),
          passphrase,
          remember,
          node,
        );
      } catch (err) {
        setError(<WriteErrorText err={err} />);
        return;
      }
      // From here the radio may hold the new identity, acknowledged or not:
      // whatever else happens, the next session is checked against it.
      setIdentityCheck({
        kind: 'regenerate',
        expected: draft.publicKey,
        outgoing,
        confirmed: result.confirmed,
        fingerprint: result.fingerprint,
        client,
      });
      if (!result.confirmed) {
        notify({
          level: 'error',
          text: t('settings.recovery.error.unconfirmed'),
          key: 'recoveryUnconfirmed',
          surface: 'bar',
        });
      }
      if (!result.persisted) {
        notify({
          level: 'error',
          text: t('settings.recovery.error.unsaved'),
          key: 'recoveryUnsaved',
          surface: 'bar',
        });
      }
      try {
        await client.reboot();
      } catch (err) {
        setError(
          t('settings.recovery.error.rebootFailed', {
            error: (err as Error).message,
          }),
        );
        return;
      }
      notify({
        level: 'info',
        text: t('settings.recovery.rebooting'),
        key: 'rebooting',
      });
      onClose();
      // The check needs a fresh session, and the restart may not have dropped
      // the link to trigger one.
      restartSession();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={t('settings.recovery.title')}
      onClose={busy ? noop : onClose}
      widthClass='w-140'
      confirmClose={!busy && draft !== null && !installed}
    >
      <p className='mb-3 text-xs text-text2'>
        {t('settings.recovery.step', { step: index + 1, total: STEPS.length })}
      </p>

      {step === 'explain' && (
        <ExplainStep onBackup={() => setBackingUp(true)} />
      )}
      {step === 'phrase' && draft && (
        <PhraseStep
          words={draft.words}
          written={written}
          onWritten={setWritten}
        />
      )}
      {step === 'confirm' && draft && (
        <ConfirmStep
          positions={draft.positions}
          answers={answers}
          wrong={checked && !confirmed}
          onAnswer={(slot, value) => {
            setChecked(false);
            setAnswers((a) => a.map((v, i) => (i === slot ? value : v)));
          }}
        />
      )}
      {step === 'passphrase' && (
        <PassphraseStep
          passphrase={passphrase}
          confirm={confirm}
          remember={remember}
          onPassphrase={setPassphrase}
          onConfirm={setConfirm}
          onRemember={setRemember}
        />
      )}
      {step === 'write' && draft && (
        <WriteStep
          publicKey={draft.publicKey}
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
              onClick={index === 0 ? onClose : () => setStep(STEPS[index - 1])}
              disabled={busy}
              className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
            >
              {index === 0 ? t('common.cancel') : t('common.back')}
            </button>
            {step === 'write' ? (
              <button
                onClick={() => void write()}
                disabled={!canAdvance}
                className='rounded-md bg-red-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-solid'
              >
                {busy
                  ? t('settings.recovery.writing')
                  : t('settings.recovery.writeAction')}
              </button>
            ) : (
              <button
                onClick={() => void next()}
                disabled={!canAdvance}
                className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
              >
                {t('settings.recovery.next')}
              </button>
            )}
          </>
        )}
      </div>

      {backingUp && <BackupExportModal onClose={() => setBackingUp(false)} />}
    </ModalShell>
  );
}

/**
 * Explains why a recovery-phrase write failed. Each failure means something
 * different to the user: a refusal left the old identity in place, and a vault
 * failure never reached the radio.
 */
export function WriteErrorText({ err }: { err: unknown }) {
  const { t } = useTranslation();
  if (err instanceof PrivateKeyError) {
    return (
      <>
        {t(
          err.code === 'disabled'
            ? 'settings.backup.identityError.disabledImport'
            : PRIVATE_KEY_ERROR_KEY[err.code],
        )}
      </>
    );
  }
  return (
    <>{t('settings.recovery.error.vault', { error: (err as Error).message })}</>
  );
}
