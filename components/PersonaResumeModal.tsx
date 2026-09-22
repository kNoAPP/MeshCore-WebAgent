// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { usePersonaSwitch } from '@/hooks/usePersonaSwitch';
import { ModalShell } from './ModalShell';
import { SwitchProgressView } from './PersonaSwitchModal';

// Stable identity for the suppressed-close handler, as in the backup dialogs.
const noop = () => {};

/**
 * Offers to finish a persona switch that stopped part way: cancelled, failed,
 * or cut off by a dropped link.
 *
 * @remarks Shown while the radio reports the incoming identity, which means it
 * holds the new key but only part of the persona that goes with it. Nothing
 * this session receives is saved until the switch is finished, since the
 * storage key depends on the channels still being written. Finishing needs no
 * phrase or passphrase: the state to apply is in the store's record of the
 * switch. Putting it off leaves the Identity settings offering it again.
 *
 * Mounted by {@link AppShell} while connected, since the reconnect after a
 * drop closes the Settings page the switch was started from.
 */
export function PersonaResumeModal() {
  const { t } = useTranslation();
  const record = useMeshStore((s) => s.personaSwitch);
  const reported = useMeshStore((s) => s.selfInfo?.pubkey?.toLowerCase());
  const setPersonaSwitch = useMeshStore((s) => s.setPersonaSwitch);
  const { finish, progress } = usePersonaSwitch();
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

  const dismiss = () => setPersonaSwitch({ ...record, dismissed: true });
  const run = async () => {
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await finish(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          t('settings.persona.resumeFailed', {
            error: (err as Error).message,
          }),
        );
      }
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={t('settings.persona.resumeTitle', { name: record.label })}
      onClose={busy ? noop : dismiss}
    >
      {progress ? (
        <SwitchProgressView progress={progress} />
      ) : (
        <>
          <p role='alert' className='text-xs leading-relaxed text-text'>
            {t('settings.persona.resumeBody', { name: record.label })}
          </p>
          <p className='mt-3 text-xs leading-relaxed text-text2'>
            {t('settings.persona.resumeUnsaved')}
          </p>
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
            className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover'
          >
            {t('settings.persona.resumeAction')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
