// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  useMeshStore,
  selectPreferences,
  type RadioPreferences,
} from '@/store/meshStore';
import {
  beginIdentityHandover,
  boundPubkey,
  flushSessionAsync,
  identitySwitchPending,
  markUnsavedRestore,
} from '@/lib/session/persistence';
import i18n from '@/lib/i18n';
import { derivePublicKey } from '@/lib/identity/seed';
import { toHex, fromHex } from '@/lib/utils';
import { PRIVATE_KEY_BYTES } from '@/lib/meshcore/constants';
import { PrivateKeyError } from '@/lib/meshcore/errors';
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
 * {@link beginIdentityHandover}, which also collects the outgoing identity's
 * records. `CMD_IMPORT_PRIVATE_KEY` replaces the key pair without rebooting,
 * so the ordinary flush would file the restored data under a public key the
 * user stops reading from the moment they reboot.
 *
 * The incoming public key is derived from the backup's private key, not read
 * from its `pubkey` field. The file's claim decides nothing destructive: a
 * backup whose two fields disagree still has its data filed under the
 * identity the radio will actually report.
 *
 * @throws whatever {@link MeshCoreClient.importPrivateKey} throws when identity
 * restore was requested and refused — the browser data is applied and
 * persisted by then, and the caller surfaces the failure against the identity
 * step alone. A backup key that has no public key at all is refused here as
 * `PrivateKeyError` `rejected`, without being sent. Throws before touching
 * anything while an identity switch awaits its restart
 * ({@link identitySwitchPending}): the store's data belongs to an identity the
 * radio no longer is, and there is nowhere to persist a merge into it.
 */
export async function applyBackup(
  payload: BackupPayload,
  client: MeshCoreClient | null,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  if (client && identitySwitchPending()) {
    throw new Error(i18n.t('settings.backup.sessionChanged'));
  }
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
    // The accent names an identity, so it only comes along when the data it
    // lands in is that identity's — this one's own backup, or a restore that
    // is about to become it.
    const sameIdentity =
      (!!client && opts.restoreIdentity && !!payload.identityHex) ||
      payload.pubkey === liveNamespace(client);
    state.restorePreferences(
      importablePreferences(payload.preferences, sameIdentity),
      true,
    );
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
      persisted: unsavedUnless(
        await flushSessionAsync(),
        liveNamespace(client),
      ),
    };
  }

  let incoming: string;
  try {
    incoming = toHex(derivePublicKey(identity));
  } catch {
    // Only a crafted file reaches this: a scalar with no public key is one the
    // firmware's `validatePrivateKey` refuses too, so it fails as that refusal
    // would, without sending the key.
    identity.fill(0);
    unsavedUnless(await flushSessionAsync(), liveNamespace(client));
    throw new PrivateKeyError('rejected');
  }
  // Compared against where this session's data is bound, not `selfInfo`: the
  // two differ after a handover whose `SELF_INFO` re-read failed, and a
  // restore that took the same-identity path then would file its data in a
  // namespace the radio does not come back as.
  //
  // Only a restore that actually changes that namespace may skip the flush.
  // For a same-identity restore it is still the one the user reads from, so
  // the pre-flush stays exactly where it was: it is what protects the merged
  // data against a reload during the radio's 10s import window.
  const handover = incoming !== boundPubkey();
  const preImport = handover ? false : await flushSessionAsync();

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
    unsavedUnless(await flushSessionAsync(), liveNamespace(client));
    throw err;
  }

  // The handover writes the incoming namespace and collects the outgoing one; a
  // same-identity restore already landed in the live namespace above. Awaited
  // here rather than inside the result literal, so the identity write's outcome
  // is settled before anything else can go wrong with the persistence step.
  const persisted = handover
    ? await beginIdentityHandover(client, incoming)
    : preImport;
  return {
    identityRestored: true,
    persisted: unsavedUnless(persisted, incoming),
  };
}

// Where a flush right now lands, or — with nothing bound, as after a phrase
// restore awaiting its restart — the identity the next session hydrates.
function liveNamespace(client: MeshCoreClient | null): string | undefined {
  return boundPubkey() ?? client?.selfInfo?.pubkey;
}

// A restore that stayed in memory must survive the next hydrate for the
// identity it was written for, or a reconnect normalizes it away — see
// `markUnsavedRestore`. Passes `persisted` through so each return stays one
// expression.
function unsavedUnless(persisted: boolean, pubkey: string | undefined) {
  if (!persisted && pubkey) markUnsavedRestore(pubkey);
  return persisted;
}

// `autoAddConfig` mirrors state the radio owns — the settings UI writes it
// through the client, and reconnect hydration overwrites the store from the
// device. Restoring it into the store alone would show the backup's value
// while the radio kept its own, until the next reconnect silently replaced it.
// It stays in the file (it describes the radio the backup came from) but is
// not applied.
//
// `identityAccent` is what tells identities apart at a glance, so another
// identity's backup keeps the live one's rather than dressing it in the
// wrong persona's color.
function importablePreferences(
  prefs: RadioPreferences,
  sameIdentity: boolean,
): RadioPreferences {
  const live = useMeshStore.getState();
  return {
    ...prefs,
    autoAddConfig: live.autoAddConfig,
    identityAccent: sameIdentity ? prefs.identityAccent : live.identityAccent,
  };
}
