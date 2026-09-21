// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { SeedPhraseError, type SeedPhraseErrorCode } from '@/lib/identity/seed';
import {
  previewPhrase,
  recordInVault,
  restoreIdentity,
  RestoreVaultError,
  type PhrasePreview,
  type VaultPlan,
} from '@/lib/identity/restore';
import {
  lockVault,
  unlockVault,
  VaultError,
  type Vault,
  type VaultErrorCode,
} from '@/lib/identity/vault';
import { persistenceNamespace } from '@/lib/session/persistence';
import { ModalShell } from './ModalShell';
import { BackupExportModal } from './BackupExportModal';
import {
  MIN_PASSPHRASE_LENGTH,
  backupSessionPubkey,
  useBackupReady,
} from './BackupCommon';
import { PassphraseStep, WriteStep } from './RecoveryPhraseSteps';
import { WriteErrorText } from './RecoveryPhraseWizard';
import {
  EnterStep,
  PreviewStep,
  ReplaceStep,
  UnlockStep,
  unknownWords,
} from './RestorePhraseSteps';

// The radio already holding the phrase's identity skips everything that
// replaces it, and ends by saving the vault instead.
const REPLACE_STEPS = [
  'enter',
  'preview',
  'replace',
  'vault',
  'write',
] as const;
const KEEP_STEPS = ['enter', 'preview', 'vault'] as const;
type Step = (typeof REPLACE_STEPS)[number];

const PHRASE_ERROR_KEY = {
  wordCount: 'settings.restore.phraseError.wordCount',
  unknownWord: 'settings.restore.phraseError.unknownWord',
  checksum: 'settings.restore.phraseError.checksum',
  reservedKey: 'settings.restore.phraseError.reservedKey',
} as const satisfies Record<SeedPhraseErrorCode, string>;

const VAULT_ERROR_KEY = {
  notFound: 'settings.restore.vaultError.notFound',
  exists: 'settings.restore.vaultError.exists',
  unsupportedVersion: 'settings.restore.vaultError.unsupportedVersion',
  wrongPassphrase: 'settings.restore.vaultError.wrongPassphrase',
  corrupt: 'settings.restore.vaultError.corrupt',
  stale: 'settings.restore.vaultError.stale',
} as const satisfies Record<VaultErrorCode, string>;

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

/**
 * Puts the identity a recovery phrase derives onto the connected radio — the
 * way back to a lost radio's public key on replacement hardware.
 *
 * @remarks
 * A mistyped phrase is refused before anything else happens, and the public
 * key it derives is shown before anything is written, so a wrong phrase is
 * caught while it costs nothing. The phrase is also recorded in this device's
 * identity vault, so the restored persona is manageable here.
 *
 * Nothing in this browser moves with the identity: the phrase restores the
 * key, not the message archive. As in {@link RecoveryPhraseWizard}, the reboot
 * closes Settings, so the verification is handed to the store's
 * `identityCheck` for {@link IdentityCheckModal} to judge.
 *
 * The phrase lives in this component's state and nowhere else, and an
 * unlocked vault is locked again when the dialog closes.
 *
 * @param onClose - dismissal; also called once the radio is rebooting.
 */
export function RestorePhraseWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const client = useMeshStore((s) => s.client);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const notify = useMeshStore((s) => s.notify);
  const setIdentityCheck = useMeshStore((s) => s.setIdentityCheck);
  const { restartSession } = useMeshCore();
  const sessionReady = useBackupReady();
  const installed = useMeshStore(
    (s) => !!client && s.identityCheck?.client === client,
  );
  // The radio this run is for; see RecoveryPhraseWizard.
  const [pubkey] = useState(selfInfo?.pubkey?.toLowerCase() ?? null);

  const [step, setStep] = useState<Step>('enter');
  const [phrase, setPhrase] = useState('');
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PhrasePreview | null>(null);
  const [unlockPassphrase, setUnlockPassphrase] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [replace, setReplace] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(false);
  const [typed, setTyped] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  // An unlocked vault holds the phrase's storage root in memory; it is locked
  // as soon as it is replaced or the dialog goes.
  useEffect(() => () => void (vault && lockVault(vault)), [vault]);

  const node = selfInfo?.name ?? '';
  // Holding the identity already, the radio has nothing to be given — only
  // the vault may still need it.
  const current = !!preview && preview.publicKey === pubkey;
  const steps: readonly Step[] = current ? KEEP_STEPS : REPLACE_STEPS;
  const index = steps.indexOf(step);
  const last = index === steps.length - 1;
  const unlocking = !!preview?.vaultExists && !replace;

  const normalized = passphrase.normalize('NFKC');
  const passphraseOk =
    [...normalized].length >= MIN_PASSPHRASE_LENGTH &&
    confirm.normalize('NFKC') === normalized;

  const canAdvance = {
    enter: !busy && !!phrase.trim() && unknownWords(phrase).length === 0,
    preview: true,
    replace: sessionReady,
    vault: !busy && (unlocking ? !!unlockPassphrase : passphraseOk),
    write: sessionReady && !busy && typed.trim() === node,
  }[step];

  // How the run records the identity, unlocking the phrase's vault first if
  // the run needs it and has not yet; null when the unlock failed. Returned
  // rather than read back from state, which only updates on the next render.
  const vaultPlan = async (): Promise<VaultPlan | null> => {
    if (vault) return { mode: 'unlocked', vault };
    if (!unlocking || !preview) {
      return { mode: 'create', passphrase, remember, replace };
    }
    try {
      const unlocked = await unlockVault(preview.fingerprint, unlockPassphrase);
      setVault(unlocked);
      return { mode: 'unlocked', vault: unlocked };
    } catch (err) {
      setUnlockError(
        err instanceof VaultError
          ? t(VAULT_ERROR_KEY[err.code])
          : t('settings.restore.error.vault', {
              error: (err as Error).message,
            }),
      );
      return null;
    }
  };

  const next = async () => {
    setError(null);
    setBusy(true);
    try {
      if (step === 'enter') {
        setPhraseError(null);
        try {
          const fresh = await previewPhrase(phrase);
          if (fresh.fingerprint !== preview?.fingerprint) {
            // A different phrase: nothing chosen for the last one applies.
            setVault(null);
            setReplace(false);
            setUnlockPassphrase('');
            setUnlockError(null);
          }
          setPreview(fresh);
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
      if (step === 'vault') {
        setUnlockError(null);
        if (!(await vaultPlan())) return;
      }
      setStep(steps[index + 1]);
    } finally {
      setBusy(false);
    }
  };

  // The radio already holds the identity: record it in the vault and stop.
  const save = async () => {
    if (!preview) return;
    setError(null);
    setUnlockError(null);
    setBusy(true);
    try {
      const plan = await vaultPlan();
      if (!plan) return;
      await recordInVault(phrase, preview.publicKey, node, plan);
      notify({
        level: 'info',
        text: t('settings.restore.saved'),
        key: 'restoreSaved',
      });
      onClose();
    } catch (err) {
      setError(<RestoreErrorText err={err} />);
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
      // RecoveryPhraseWizard for why this is not `pubkey`.
      const outgoing = persistenceNamespace(client) ?? pubkey;
      // Unlocked on the vault step already, so this does not prompt again.
      const plan = await vaultPlan();
      if (!plan) return;
      let confirmed: boolean;
      try {
        confirmed = await restoreIdentity(client, phrase, node, plan);
      } catch (err) {
        setError(<RestoreErrorText err={err} />);
        return;
      }
      setIdentityCheck({
        kind: 'restore',
        expected: preview.publicKey,
        outgoing: outgoing.toLowerCase(),
        confirmed,
        fingerprint: preview.fingerprint,
        client,
      });
      if (!confirmed) {
        notify({
          level: 'error',
          text: t('settings.restore.error.unconfirmed'),
          key: 'restoreUnconfirmed',
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
        text: t('settings.restore.rebooting'),
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
        ? {
            run: save,
            label: busy
              ? t('settings.restore.saving')
              : t('settings.restore.saveAction'),
            danger: false,
          }
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
        <PreviewStep preview={preview} current={current} />
      )}
      {step === 'replace' && (
        <ReplaceStep onBackup={() => setBackingUp(true)} />
      )}
      {step === 'vault' && preview?.vaultExists && (
        <UnlockStep
          passphrase={unlockPassphrase}
          replace={replace}
          error={unlockError}
          busy={busy || !!vault}
          onPassphrase={(value) => {
            setUnlockError(null);
            setUnlockPassphrase(value);
          }}
          onReplace={(value) => {
            setVault(null);
            setReplace(value);
          }}
        />
      )}
      {step === 'vault' && !unlocking && (
        <PassphraseStep
          intro={t(
            replace
              ? 'settings.restore.replaceVaultIntro'
              : 'settings.restore.passphraseIntro',
          )}
          passphrase={passphrase}
          confirm={confirm}
          remember={remember}
          onPassphrase={setPassphrase}
          onConfirm={setConfirm}
          onRemember={setRemember}
        />
      )}
      {step === 'write' && preview && (
        <WriteStep
          publicKey={preview.publicKey}
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

// A vault failure is told apart by its cause, since a wrong passphrase and a
// vault another tab changed need different next steps; a radio refusal reads
// exactly as it does for a regenerate.
function RestoreErrorText({ err }: { err: unknown }) {
  const { t } = useTranslation();
  if (!(err instanceof RestoreVaultError)) return <WriteErrorText err={err} />;
  const cause = err.cause;
  return (
    <>
      {cause instanceof VaultError
        ? t(VAULT_ERROR_KEY[cause.code])
        : t('settings.restore.error.vault', { error: err.message })}
    </>
  );
}
