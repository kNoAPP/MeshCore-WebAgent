// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { useMeshStore, type IdentityCheck } from '@/store/meshStore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { settleUnconfirmed } from '@/lib/identity/regenerate';
import { ModalShell } from './ModalShell';

// A restore puts back an identity peers already know, and its phrase was on
// paper long before this run, so most of what the check says differs by flow.
const COPY = {
  regenerate: {
    ok: 'settings.recovery.checkOk',
    readd: 'settings.recovery.checkReadd',
    notLanded: 'settings.recovery.checkNotLanded',
    mismatch: 'settings.recovery.checkMismatch',
  },
  restore: {
    ok: 'settings.restore.checkOk',
    readd: 'settings.restore.checkReadd',
    notLanded: 'settings.restore.checkNotLanded',
    mismatch: 'settings.restore.checkMismatch',
  },
} as const satisfies Record<IdentityCheck['kind'], Record<string, string>>;

/**
 * Reports whether the radio came back as the identity a recovery-phrase
 * wizard wrote, once it has rebooted and reconnected.
 *
 * @remarks
 * The wizard's `OK` from the import proves only that the radio stored some
 * key. The proof that the phrase on paper restores this radio is the public
 * key a fresh session reports, compared with the one the phrase derives —
 * so this waits for a session other than the one that ran the import, from
 * the radio that ran it (see `IdentityCheck`), and says loudly when an
 * acknowledged import came back as the old identity. An unacknowledged one
 * that did so never landed, which is reported as such, and dismissing either
 * kind after a regenerate tidies away the records of the identity that did
 * not come back. A restore moved no records, so it leaves them all alone.
 *
 * Mounted by {@link AppShell} while connected, since the reconnect that
 * delivers the answer also closes the Settings page the wizard lived on.
 */
export function IdentityCheckModal() {
  const { t } = useTranslation();
  const check = useMeshStore((s) => s.identityCheck);
  const client = useMeshStore((s) => s.client);
  const reported = useMeshStore((s) => s.selfInfo?.pubkey?.toLowerCase());
  const setIdentityCheck = useMeshStore((s) => s.setIdentityCheck);
  const { advertise, sending } = useAdvertise();

  if (!check || !client || client === check.client) return null;
  const verified = reported === check.expected;
  if (!verified && reported !== check.outgoing) return null;
  const copy = COPY[check.kind];
  const dismiss = () => {
    if (check.kind === 'regenerate' && !check.confirmed) {
      void settleUnconfirmed(
        { publicKey: check.expected, fingerprint: check.fingerprint },
        check.outgoing,
        verified,
      );
    }
    setIdentityCheck(null);
  };

  return (
    <ModalShell title={t('settings.recovery.checkTitle')} onClose={dismiss}>
      {verified ? (
        <>
          <p className='text-xs leading-relaxed text-text'>
            {t(copy.ok, { pubkey: reported })}
          </p>
          <p className='mt-3 text-xs leading-relaxed text-text2'>
            {t(copy.readd)}
          </p>
        </>
      ) : !check.confirmed ? (
        <p role='alert' className='text-xs leading-relaxed break-all text-text'>
          {t(copy.notLanded, { pubkey: reported })}
        </p>
      ) : (
        <p
          role='alert'
          className='rounded-md border border-red bg-red/10 p-3 text-xs leading-relaxed break-all text-text'
        >
          {t(copy.mismatch, {
            actual: reported,
            expected: check.expected,
          })}
        </p>
      )}
      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={dismiss}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
        >
          {t('common.close')}
        </button>
        {verified && (
          <button
            onClick={() => void advertise(true).then(dismiss)}
            disabled={sending}
            className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
          >
            {t('settings.recovery.checkAdvert')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
