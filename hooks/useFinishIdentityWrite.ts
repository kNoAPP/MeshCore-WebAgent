// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore, type IdentityCheck } from '@/store/meshStore';
import { useMeshCore } from './useMeshCore';

// Each flow's own copy and notice keys, so the two read differently to the
// user while sharing every step.
const COPY = {
  regenerate: {
    unconfirmed: 'settings.recovery.error.unconfirmed',
    unconfirmedKey: 'recoveryUnconfirmed',
    rebooting: 'settings.recovery.rebooting',
  },
  restore: {
    unconfirmed: 'settings.restore.error.unconfirmed',
    unconfirmedKey: 'restoreUnconfirmed',
    rebooting: 'settings.restore.rebooting',
  },
} as const satisfies Record<
  IdentityCheck['kind'],
  { unconfirmed: string; unconfirmedKey: string; rebooting: string }
>;

/**
 * The steps a recovery-phrase wizard takes once its key has been sent to the
 * radio: record the identity check, report an unacknowledged import or an
 * unsaved handover, reboot the radio, close, and restart the session.
 *
 * @remarks The check is recorded before anything else: from the moment the
 * key was sent the radio may hold the new identity, acknowledged or not, and
 * whatever happens next the following session is checked against it. The
 * session is restarted rather than left to a dropped link, since a native USB
 * link can survive the reboot.
 * @param onClose - closes the wizard, once the radio has rebooted.
 * @returns `finish`, which resolves to the localized reason the reboot failed
 * (the wizard stays open to show it), or null once the session is restarting.
 * Pass `persisted: false` for a run whose data did not reach encrypted storage.
 */
export function useFinishIdentityWrite(
  onClose: () => void,
): (check: IdentityCheck, persisted?: boolean) => Promise<string | null> {
  const { t } = useTranslation();
  const notify = useMeshStore((s) => s.notify);
  const setIdentityCheck = useMeshStore((s) => s.setIdentityCheck);
  const { restartSession } = useMeshCore();

  return useCallback(
    async (check, persisted = true) => {
      const copy = COPY[check.kind];
      setIdentityCheck(check);
      if (!check.confirmed) {
        notify({
          level: 'error',
          text: t(copy.unconfirmed),
          key: copy.unconfirmedKey,
          surface: 'bar',
        });
      }
      if (!persisted) {
        notify({
          level: 'error',
          text: t('settings.recovery.error.unsaved'),
          key: 'recoveryUnsaved',
          surface: 'bar',
        });
      }
      try {
        await check.client.reboot();
      } catch (err) {
        return t('settings.recovery.error.rebootFailed', {
          error: (err as Error).message,
        });
      }
      notify({ level: 'info', text: t(copy.rebooting), key: 'rebooting' });
      onClose();
      restartSession();
      return null;
    },
    [t, notify, setIdentityCheck, restartSession, onClose],
  );
}
