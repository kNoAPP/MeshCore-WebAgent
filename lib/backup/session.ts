// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { useMeshStore, selectPreferences } from '@/store/meshStore';
import { toHex, fromHex } from '@/lib/utils';
import { PRIVATE_KEY_BYTES } from '@/lib/meshcore/constants';
import type { MeshCoreClient } from '@/lib/meshcore/client';
import {
  BACKUP_PAYLOAD_VERSION,
  type BackupChannel,
  type BackupPayload,
} from './archive';
import { mergeAutomationRules } from './merge';

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
  /** Write the backup's channel slots back to the radio. */
  restoreChannels: boolean;
  /**
   * Replace the radio's Ed25519 identity with the backup's. Irreversible from
   * this app's side: the previous identity is gone unless it too was backed up.
   */
  restoreIdentity: boolean;
}

/** What {@link applyBackup} actually managed to do. */
export interface ApplyResult {
  /** Channel slots successfully written back to the radio. */
  channelsRestored: number;
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
  state.cacheAdverts(payload.advertCache);
  state.restoreAutomationRules(
    mergeAutomationRules(state.automationRules, payload.automationRules),
  );
  if (payload.preferences) state.restorePreferences(payload.preferences);

  const result: ApplyResult = { channelsRestored: 0, identityRestored: false };
  if (!client) return result;

  if (opts.restoreChannels) {
    for (const ch of payload.channels) {
      const secret = fromHex(ch.secretHex, 16);
      if (!secret) continue;
      // Per slot rather than all-or-nothing: a radio with fewer slots than the
      // backup should still take the ones it can hold.
      try {
        await client.setChannel(ch.idx, ch.name, secret);
        result.channelsRestored++;
      } catch {
        // Slot rejected (out of range on this model, or storage full).
      }
    }
  }

  if (opts.restoreIdentity && payload.identityHex) {
    const key = fromHex(payload.identityHex, PRIVATE_KEY_BYTES);
    if (key) {
      await client.importPrivateKey(key);
      key.fill(0);
      result.identityRestored = true;
    }
  }
  return result;
}
