// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { BACKUP_FILE_EXT } from './archive';

/**
 * Browser file I/O for backups: handing encrypted bytes to the user's download
 * folder and reading a picked file back. Nothing here ever sees a passphrase or
 * a private key in the clear — it moves the already-encrypted envelope.
 */

/**
 * Builds the suggested filename for a backup, e.g.
 * `meshcore-KN0-APP-41029c91-2026-09-17.mcbak`. The node name is reduced to
 * filename-safe characters, and the pubkey prefix is always included so two
 * radios that share a name still get distinct files on the same day.
 */
export function backupFilename(nodeName: string, pubkey: string): string {
  const safeName = nodeName
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const date = new Date().toISOString().slice(0, 10);
  // The pubkey prefix is unconditional, not a fallback for an unnamed radio:
  // two nodes called "Base" would otherwise overwrite each other's backup.
  const parts = ['meshcore', safeName, pubkey.slice(0, 8), date].filter(
    Boolean,
  );
  return parts.join('-') + BACKUP_FILE_EXT;
}

/**
 * Saves `bytes` to the user's downloads as `filename`.
 *
 * @remarks Uses an object URL on a synthetic anchor — the only route a static,
 * backend-free page has to a real file. The URL is revoked on the next frame
 * rather than immediately, because Safari cancels a download whose blob URL is
 * revoked in the same task.
 */
export function downloadBackup(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Reads a picked file into bytes. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
