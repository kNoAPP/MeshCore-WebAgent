// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import type { PrivateKeyErrorCode } from '@/lib/meshcore/errors';
import type { BackupReadErrorCode } from '@/lib/backup/archive';

/**
 * Minimum passphrase length the backup dialogs accept. A backup is offline
 * ciphertext an attacker can grind at their leisure, so the floor is well above
 * a login password's.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

const PRIVATE_KEY_ERROR_KEY = {
  disabled: 'settings.backup.identityError.disabled',
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

/**
 * Explains why the radio refused an identity export or import.
 *
 * @param action - which half failed, so the `disabled` copy can name the build
 * flag the operator's firmware is missing.
 */
export function PrivateKeyErrorText({
  code,
  action,
}: {
  code: PrivateKeyErrorCode;
  action: 'export' | 'import';
}) {
  const { t } = useTranslation();
  return (
    <>
      {t(PRIVATE_KEY_ERROR_KEY[code], {
        flag:
          action === 'export'
            ? 'ENABLE_PRIVATE_KEY_EXPORT'
            : 'ENABLE_PRIVATE_KEY_IMPORT',
      })}
    </>
  );
}

/** Explains why a picked file could not be read as a backup. */
export function BackupReadErrorText({ code }: { code: BackupReadErrorCode }) {
  const { t } = useTranslation();
  return <>{t(READ_ERROR_KEY[code])}</>;
}
