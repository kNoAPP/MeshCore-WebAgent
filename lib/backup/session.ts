// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  useMeshStore,
  selectPreferences,
  type RadioPreferences,
} from '@/store/meshStore';
import {
  beginIdentityHandover,
  flushSessionAsync,
} from '@/lib/session/persistence';
import { deleteRadioRecords } from '@/lib/storage';
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
 * @param identity - the radio's raw private key, when the user chose to
 * include it. Hex-encoding it creates an immutable string, and encryption then
 * creates JSON and UTF-8 plaintext copies, none of which can be wiped — see
 * {@link BackupPayload.identityHex}. The caller still owns the array and should
 * zero it afterwards to bound the erasable copy's lifetime.
 */
export function buildBackupPayload(
  pubkey: string,
  nodeName: string,
  identity?: Uint8Array,
): BackupPayload {
  const state = useMeshStore.getState();
  // Slot and name only — see {@link BackupChannel} for why the secret is left
  // out of the file.
  const channels: BackupChannel[] = Object.values(state.channels).map((c) => ({
    idx: c.idx,
    name: c.name,
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
  /**
   * Whether the merged data reached encrypted storage, in the namespace the
   * user will actually read it back from. For an identity restore that is the
   * *incoming* identity's namespace, not the one this session is still
   * connected under. False when the session key is gone (a reconnect swapped
   * radios mid-restore) or a write failed — the import is then in memory only
   * and a reload loses it, so the caller must not report an unqualified
   * success.
   */
  persisted: boolean;
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
 * Whether the merged data reached encrypted storage is reported in
 * {@link ApplyResult.persisted} rather than thrown — the import is applied to
 * the store either way, so a failed write is a weaker success, not a failure to
 * roll back.
 *
 * @remarks
 * An identity restore hands the session over to the *incoming* identity
 * instead, once the radio has accepted the key: see
 * {@link beginIdentityHandover}. `CMD_IMPORT_PRIVATE_KEY` replaces the key
 * pair without rebooting, so the link stays up under the outgoing identity and
 * the ordinary flush would file the restored data under a public key the user
 * stops reading from the moment they reboot — which is how preferences and
 * automation rules went missing. The outgoing identity's records are then
 * deleted: that identity is gone from the radio, nothing will write to its
 * namespace again, and leaving it would be a readable orphan nothing collects.
 *
 * @throws whatever {@link MeshCoreClient.importPrivateKey} throws when identity
 * restore was requested and refused — the browser data is applied and
 * persisted by then, and the caller surfaces the failure against the identity
 * step alone.
 */
export async function applyBackup(
  payload: BackupPayload,
  client: MeshCoreClient | null,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const state = useMeshStore.getState();
  // `interleave`: unlike a reconnect hydrate, a backup is not a strictly older
  // prefix of the live transcript — it can hold messages newer than ones this
  // browser already has, so the merged list is ordered by time rather than
  // simply prepended.
  state.restoreHistory(payload.msgHistory, true);
  state.cacheAdverts(freshAdverts(payload.advertCache, state.advertCache));
  state.restoreAutomationRules(
    mergeAutomationRules(state.automationRules, payload.automationRules),
  );
  if (payload.preferences) {
    // `explicit`: the preview promised the file's preferences replace the
    // current ones, so this must override the hydrate-race guards too.
    state.restorePreferences(importablePreferences(payload.preferences), true);
  }

  const identity =
    client && opts.restoreIdentity && payload.identityHex
      ? fromHex(payload.identityHex, PRIVATE_KEY_BYTES)
      : null;

  if (!client || !identity) {
    // Awaited, not just started: the caller reports success and closes the
    // dialog on return. A reload in that window would lose the import if the
    // writes were still pending.
    return {
      identityRestored: false,
      persisted: await flushSessionAsync(client),
    };
  }

  const outgoing = client.selfInfo?.pubkey;
  try {
    // Nested so the key is zeroed the moment the exchange settles, before the
    // failure path's own await — it must not stay resident across an
    // IndexedDB round-trip.
    try {
      await client.importPrivateKey(identity);
    } finally {
      // Zeroed even when the radio refuses the key, so a failed restore
      // doesn't leave the plaintext identity resident until GC.
      identity.fill(0);
    }
  } catch (err) {
    // The radio kept its identity, so this session's own namespace is still
    // the one the user reads from — persist there before surfacing the
    // failure, or a refused key would also cost them the restored data.
    await flushSessionAsync(client);
    throw err;
  }

  // A restore onto the radio that produced the backup changes no public key,
  // so its records already belong to the live namespace and the ordinary flush
  // is the correct write.
  if (payload.pubkey === outgoing) {
    return {
      identityRestored: true,
      persisted: await flushSessionAsync(client),
    };
  }

  const persisted = await beginIdentityHandover(client, payload.pubkey);
  // Only once the data is safely under the incoming identity: a failed write
  // would otherwise make this delete the user's only remaining copy.
  if (persisted && outgoing) await deleteRadioRecords(outgoing);
  return { identityRestored: true, persisted };
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
