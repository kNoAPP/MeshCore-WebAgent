// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { identitySwitchPending } from '@/lib/session/persistence';
import type { PrivateKeyErrorCode } from '@/lib/meshcore/errors';
import type { BackupReadErrorCode } from '@/lib/backup/archive';

/**
 * Minimum passphrase length the backup dialogs accept. A backup is offline
 * ciphertext an attacker can grind at their leisure, so the floor is well above
 * a login password's.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * Whether a backup may be written or applied right now.
 *
 * Stricter than the other radio-touching cards, and deliberately so: those need
 * a live link, but these need the *stored* per-radio data to be in memory.
 * `status` flips to 'connected' before the derived key and the IndexedDB blobs
 * have loaded, so acting inside that window would export a half-empty backup,
 * or import onto state the pending hydrate is about to overwrite.
 * `prefsHydrated` marks the end of that load.
 *
 * Both dialogs sit above the reconnect overlay and stay mounted while the
 * auto-reconnect loop swaps the client — and what comes back may be a different
 * radio — so each rechecks this rather than trusting the check that opened it.
 *
 * Never true in a burner's session: every path this gates — a backup, a
 * restore, a regenerate — either writes the store to IndexedDB under some
 * identity or pairs it with a key, and nothing of a burner may be kept.
 */
export function useBackupReady(): boolean {
  const status = useMeshStore((s) => s.status);
  const client = useMeshStore((s) => s.client);
  const prefsHydrated = useMeshStore((s) => s.prefsHydrated);
  const burner = useMeshStore(isBurnerSession);
  return (
    status === 'connected' &&
    !!client &&
    !client.closed &&
    prefsHydrated &&
    !burner
  );
}

/** Whether the radio's live identity is the store's burner. */
export function isBurnerSession(
  s: ReturnType<typeof useMeshStore.getState>,
): boolean {
  return !!s.burner && s.burner.pubkey === s.selfInfo?.pubkey?.toLowerCase();
}

/**
 * The public key of the radio a backup may act on right now, or null when the
 * session is not ready by {@link useBackupReady}'s test.
 *
 * Read once from the live store rather than subscribed, for revalidating after
 * an `await`: comparing it against the pubkey an operation started with catches
 * both halves of the race in one test — the session going away, and a
 * *different* radio having taken its place.
 *
 * Also null while an identity switch awaits its restart: the store then holds
 * the data of an identity the radio no longer is, so a backup would pair that
 * data with the wrong key, and a restore would merge into it with nowhere to
 * persist the result. And null in a burner's session, as for
 * {@link useBackupReady}.
 */
export function backupSessionPubkey(): string | null {
  const s = useMeshStore.getState();
  const ready =
    s.status === 'connected' &&
    !!s.client &&
    !s.client.closed &&
    s.prefsHydrated &&
    !identitySwitchPending() &&
    !isBurnerSession(s);
  return ready ? (s.selfInfo?.pubkey ?? null) : null;
}

const PRIVATE_KEY_ERROR_KEY = {
  disabled: 'settings.backup.identityError.disabledExport',
  unsupported: 'settings.backup.identityError.unsupported',
  rejected: 'settings.backup.identityError.rejected',
  writeFailed: 'settings.backup.identityError.writeFailed',
} as const satisfies Record<PrivateKeyErrorCode, string>;

const READ_ERROR_KEY = {
  notABackup: 'settings.backup.readError.notABackup',
  unsupportedVersion: 'settings.backup.readError.unsupportedVersion',
  wrongPassphrase: 'settings.backup.readError.wrongPassphrase',
  corrupt: 'settings.backup.readError.corrupt',
} as const satisfies Record<BackupReadErrorCode, string>;

// The two build flags are independent — a firmware can export but not import,
// or the reverse — so `disabled` gets a per-action sentence rather than one
// that claims both halves are unavailable.
const DISABLED_KEY = {
  export: 'settings.backup.identityError.disabledExport',
  import: 'settings.backup.identityError.disabledImport',
} as const satisfies Record<'export' | 'import', string>;

/**
 * Explains why the radio refused an identity export or import.
 *
 * @param action - which half failed, so the copy describes only that operation
 * and names the build flag the operator's firmware is missing.
 */
export function PrivateKeyErrorText({
  code,
  action,
}: {
  code: PrivateKeyErrorCode;
  action: 'export' | 'import';
}) {
  const { t } = useTranslation();
  if (code === 'disabled') return <>{t(DISABLED_KEY[action])}</>;
  return <>{t(PRIVATE_KEY_ERROR_KEY[code])}</>;
}

/** Explains why a picked file could not be read as a backup. */
export function BackupReadErrorText({ code }: { code: BackupReadErrorCode }) {
  const { t } = useTranslation();
  return <>{t(READ_ERROR_KEY[code])}</>;
}
