// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  useMeshStore,
  selectPreferences,
  type RadioPreferences,
} from '@/store/meshStore';
import { flushSessionAsync } from '@/lib/session/persistence';
import { toHex, fromHex } from '@/lib/utils';
import { PRIVATE_KEY_BYTES } from '@/lib/meshcore/constants';
import type { MeshCoreClient } from '@/lib/meshcore/client';
import {
  BACKUP_PAYLOAD_VERSION,
  type BackupChannel,
  type BackupPayload,
} from './archive';
import { freshAdverts, mergeAutomationRules } from './merge';

/**
 * Binds the pure backup format in `./archive` to this session: reading the
 * current store state into a payload, and applying a decrypted payload back
 * onto the store (and, when asked, onto the radio).
 */

/**
 * Snapshots everything this browser holds for the connected radio.
 *
 * @param identity - the radio's raw private key, when the user chose to include
 * it. It is hex-encoded into the payload and never copied anywhere else; the
 * caller still owns the array and should zero it afterwards.
 */
export function buildBackupPayload(
  pubkey: string,
  nodeName: string,
  identity?: Uint8Array,
): BackupPayload {
  const state = useMeshStore.getState();
  const channels: BackupChannel[] = Object.values(state.channels).map((c) => ({
    idx: c.idx,
    name: c.name,
    secretHex: c.secret ? toHex(c.secret) : '',
  }));
  return {
    version: BACKUP_PAYLOAD_VERSION,
    createdAt: Date.now(),
    pubkey: pubkey.toLowerCase(),
    nodeName,
    msgHistory: state.msgHistory,
    advertCache: state.advertCache,
    automationRules: state.automationRules,
    preferences: selectPreferences(state),
    channels,
    ...(identity ? { identityHex: toHex(identity) } : {}),
  };
}

/** What an {@link applyBackup} run should restore, beyond the browser data. */
export interface ApplyOptions {
  /**
   * Replace the radio's Ed25519 identity with the backup's. Irreversible from
   * this app's side: the previous identity is gone unless it too was backed up.
   */
  restoreIdentity: boolean;
}

/** What {@link applyBackup} actually managed to do. */
export interface ApplyResult {
  /** Whether the radio accepted the backup's identity. */
  identityRestored: boolean;
}

/**
 * Applies a decrypted backup.
 *
 * Browser data is merged, never replaced: history de-duplicates by message id
 * (`restoreHistory`), adverts fold in newest-sighting-wins (`cacheAdverts`),
 * and automation rules already present by id are left as they are. Preferences
 * are the one exception — they are a single blob with no meaningful merge, so
 * the backup's copy wins.
 *
 * Radio writes are opt-in through {@link ApplyOptions} and happen after the
 * browser data has landed, so a radio that refuses them still leaves the
 * history restored.
 *
 * @throws whatever {@link MeshCoreClient.importPrivateKey} throws when identity
 * restore was requested and refused — the browser data is already applied by
 * then, and the caller surfaces the failure against the identity step alone.
 */
export async function applyBackup(
  payload: BackupPayload,
  client: MeshCoreClient | null,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const state = useMeshStore.getState();
  state.restoreHistory(payload.msgHistory);
  state.cacheAdverts(freshAdverts(payload.advertCache, state.advertCache));
  state.restoreAutomationRules(
    mergeAutomationRules(state.automationRules, payload.automationRules),
  );
  if (payload.preferences) {
    // `explicit`: the preview promised the file's preferences replace the
    // current ones, so this must override the hydrate-race guards too.
    state.restorePreferences(importablePreferences(payload.preferences), true);
  }

  // Awaited, not just started: the caller reports success and closes the dialog
  // on return, and an identity restore below ends in a reboot. A reload in
  // either window would lose the import if the writes were still pending.
  await flushSessionAsync(client);

  const result: ApplyResult = { identityRestored: false };
  if (!client) return result;

  if (opts.restoreIdentity && payload.identityHex) {
    const key = fromHex(payload.identityHex, PRIVATE_KEY_BYTES);
    if (key) {
      try {
        await client.importPrivateKey(key);
        result.identityRestored = true;
      } finally {
        // Zeroed even when the radio refuses the key, so a failed restore
        // doesn't leave the plaintext identity resident until GC.
        key.fill(0);
      }
    }
  }
  return result;
}

// `autoAddConfig` mirrors state the radio owns — the settings UI writes it
// through the client, and reconnect hydration overwrites the store from the
// device. Restoring it into the store alone would show the backup's value
// while the radio kept its own, until the next reconnect silently replaced it.
// It stays in the file (it describes the radio the backup came from) but is
// not applied.
function importablePreferences(prefs: RadioPreferences): RadioPreferences {
  return { ...prefs, autoAddConfig: useMeshStore.getState().autoAddConfig };
}
