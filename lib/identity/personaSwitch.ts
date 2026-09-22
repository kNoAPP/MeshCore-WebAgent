// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import {
  ADVERT_LOC_POLICY,
  MAX_ADVERT_NAME_BYTES,
  PUBLIC_CHANNEL_NAME,
  PUBLIC_CHANNEL_SECRET,
} from '@/lib/meshcore/constants';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import { toHex, truncateUtf8 } from '@/lib/utils';
import {
  capturePersona,
  loadPersona,
  savePendingSwitch,
  savePersona,
  type PersonaState,
} from './persona';
import { identityFromMnemonic, type SeedIdentity } from './seed';
import { deriveSubIdentity } from './subIdentity';
import {
  fingerprintPhrase,
  saveVault,
  type Vault,
  type VaultIdentity,
} from './vault';

/**
 * Switching the radio between the personas one recovery phrase has minted,
 * and minting new ones.
 *
 * A switch is a sequence the caller drives, so it can record each step: first
 * {@link verifyPersonaKey} and {@link preparePersonaSwitch}, which touch
 * nothing on the radio; then `beginIdentitySwitch`, which takes the session
 * off the outgoing identity; then {@link installPersonaKey}; then
 * `applyPersona` with the state the preparation returned.
 * `CMD_IMPORT_PRIVATE_KEY` takes effect at once, but the apply's contact
 * writes sit in the radio's RAM until a lazy save, so the radio is rebooted,
 * which saves them first, before the session restarts onto the incoming
 * identity to hydrate its browser data. That session checks the contacts
 * took, and only then deletes the pending record the preparation wrote.
 *
 * @remarks The incoming identity's browser records are keyed from the radio's
 * channel secrets, and applying the persona is what gives them back. So the
 * session must not bind persistence until the apply is complete: until then
 * the key it would derive may be neither persona's.
 */

/**
 * Why a switch or a mint could not start: `notInVault` means the radio's live
 * identity is not one of the vault's, so its persona would have nowhere to be
 * kept; `phraseMismatch` means the typed phrase is not the vault's;
 * `keyMismatch` means the phrase derives a different key than the vault
 * lists, so the entry is not this phrase's; `saveFailed` means the outgoing
 * persona or the vault could not be written; `unsynced` means the radio's
 * channels or contacts were not all read, so the outgoing persona cannot be
 * kept whole; `damaged` means the incoming persona's saved channels or
 * contacts no longer read back.
 */
export type PersonaSwitchErrorCode =
  | 'notInVault'
  | 'phraseMismatch'
  | 'keyMismatch'
  | 'saveFailed'
  | 'unsynced'
  | 'damaged';

/** Thrown before anything reached the radio. */
export class PersonaSwitchError extends Error {
  constructor(readonly code: PersonaSwitchErrorCode) {
    super(code);
    this.name = 'PersonaSwitchError';
  }
}

/**
 * The persona a newly minted identity starts from: its label as the advert
 * name, no location and location sharing off, only the Public channel and no
 * contacts.
 *
 * @remarks Anything left as the radio has it would be inherited from the
 * outgoing persona, and a new key announcing the old one's name, position,
 * private channels or contact list is linked to it by anyone listening.
 * Clearing the location alone is not enough: while sharing is on, the
 * firmware replaces it with the live GPS fix in every advert.
 */
export function freshPersona(label: string): PersonaState {
  const name = truncateUtf8(label.trim(), MAX_ADVERT_NAME_BYTES);
  return {
    name: name || null,
    location: { lat: 0, lon: 0 },
    locationPolicy: ADVERT_LOC_POLICY.NONE,
    channels: [
      {
        idx: 0,
        name: PUBLIC_CHANNEL_NAME,
        secret: toHex(PUBLIC_CHANNEL_SECRET),
      },
    ],
    contacts: [],
  };
}

/**
 * Checks that a typed phrase is the one a vault was made for.
 *
 * @throws `SeedPhraseError` for a malformed phrase.
 */
export async function isVaultPhrase(
  vault: Vault,
  phrase: string,
): Promise<boolean> {
  return (await fingerprintPhrase(phrase)) === vault.fingerprint;
}

/**
 * Mints the phrase's next sub-identity and lists it in the vault. Nothing is
 * sent to the radio.
 *
 * @remarks The next index is one past the highest the vault lists, and the
 * skip rule then passes over any index whose key the firmware would refuse.
 * The vault is unchanged when the save fails.
 * @param label - the persona's name, and its advert name once it goes live.
 * @throws {@link PersonaSwitchError} `phraseMismatch` or `saveFailed`.
 * @throws `VaultError` `stale` when another tab changed the vault.
 * @throws `SeedPhraseError` for a malformed phrase.
 */
export async function mintPersona(
  vault: Vault,
  phrase: string,
  label: string,
): Promise<VaultIdentity> {
  if (!(await isVaultPhrase(vault, phrase))) {
    throw new PersonaSwitchError('phraseMismatch');
  }
  const indices = vault.identities
    .map((i) => i.index)
    .filter((i): i is number => i !== null);
  const from = indices.length ? Math.max(...indices) + 1 : 0;
  const sub = await deriveSubIdentity(phrase, from);
  sub.privateKey.fill(0);
  const entry: VaultIdentity = {
    index: sub.index,
    publicKey: toHex(sub.publicKey),
    label,
  };
  const before = vault.identities;
  vault.identities = [...before, entry];
  try {
    if (!(await saveVault(vault))) throw new PersonaSwitchError('saveFailed');
  } catch (err) {
    vault.identities = before;
    throw err;
  }
  return entry;
}

/**
 * Checks that `phrase` derives the key the vault lists for `target`, without
 * sending anything.
 *
 * @throws {@link PersonaSwitchError} `keyMismatch`.
 * @throws `SeedPhraseError` for a malformed phrase.
 */
export async function verifyPersonaKey(
  phrase: string,
  target: VaultIdentity,
): Promise<void> {
  (await derivePersonaKey(phrase, target)).privateKey.fill(0);
}

/**
 * Records in the vault that `incoming` is now live on a radio and `outgoing`
 * no longer is, so a later switch onto `incoming` from another radio can be
 * warned about.
 *
 * @remarks Best-effort: a vault that cannot be saved (another tab changed
 * it, or IndexedDB failed) is left as it was, and a stale flag only costs a
 * warning, so the switch goes on regardless.
 * @returns an undo that writes back both identities' flags as they were, and
 * touches no other identity's, for a switch that turns out to leave the radio
 * on `outgoing`. Only this session can run it: a switch found not to have
 * landed at the next connect keeps the flags this set (see
 * `VaultIdentity.live`).
 */
export async function recordLive(
  vault: Vault,
  incoming: string,
  outgoing: string,
): Promise<() => Promise<void>> {
  const was = new Map(
    vault.identities
      .filter((i) => i.publicKey === incoming || i.publicKey === outgoing)
      .map((i) => [i.publicKey, i.live]),
  );
  await writeLive(vault, (key) =>
    key === incoming ? true : key === outgoing ? false : undefined,
  );
  // An involved identity's absent flag reads back undefined, which writeLive
  // takes as "leave it"; it must be cleared instead.
  return () =>
    writeLive(vault, (key) =>
      was.has(key) ? (was.get(key) ?? null) : undefined,
    );
}

// Rewrites the live flag of each identity `flag` names — undefined leaves it,
// null clears it — and saves, keeping the vault as it was if the save fails.
async function writeLive(
  vault: Vault,
  flag: (publicKey: string) => boolean | null | undefined,
): Promise<void> {
  const before = vault.identities;
  vault.identities = before.map((i) => {
    const next = flag(i.publicKey);
    if (next === null) return { ...i, live: undefined };
    return next === undefined ? i : { ...i, live: next };
  });
  try {
    if (!(await saveVault(vault))) vault.identities = before;
  } catch {
    vault.identities = before;
  }
}

/**
 * Keeps the outgoing persona and works out what the incoming one needs,
 * without sending anything to the radio.
 *
 * @remarks The outgoing persona is captured from the client's mirror and
 * sealed in its record first, so the radio state it leaves behind can be
 * given back later. Pass `capture` false when the radio holds a switch that
 * never finished — its state is then part one persona, part another, and
 * would overwrite the good record — or a burner, which is never kept.
 *
 * Both personas must be whole in their channels and contacts. The storage
 * key follows the channels, so a persona that goes live without its own
 * would hydrate under a key its records were never written with, and then
 * overwrite them; and contacts left as they are would be the other
 * persona's.
 *
 * The incoming state is also sealed as the switch's pending record, whose
 * existence tells the next connect — after a page reload too — that the
 * switch has not finished. Delete it once the state is applied, or once the
 * key is known not to have landed.
 * @returns the incoming persona's saved state, or a {@link freshPersona} for
 * an identity that has never been live on this device.
 * @throws {@link PersonaSwitchError} `damaged` or `saveFailed`; and, when
 * capturing, `notInVault` or `unsynced`.
 */
export async function preparePersonaSwitch(
  client: MeshCoreClient,
  vault: Vault,
  target: VaultIdentity,
  capture: boolean,
): Promise<PersonaState> {
  if (capture) await keepOutgoingPersona(client, vault);
  const state =
    (await loadPersona(vault, target.publicKey)) ?? freshPersona(target.label);
  if (!isWhole(state)) throw new PersonaSwitchError('damaged');
  if (!(await savePendingSwitch(vault, target.publicKey, state))) {
    throw new PersonaSwitchError('saveFailed');
  }
  return state;
}

/**
 * Captures the radio's persona from the client's mirror and seals it in the
 * live identity's record, so a switch away can give it back later.
 *
 * @throws {@link PersonaSwitchError} `notInVault`, `unsynced` or
 * `saveFailed`.
 */
export async function keepOutgoingPersona(
  client: MeshCoreClient,
  vault: Vault,
): Promise<void> {
  const outgoing = client.selfInfo?.pubkey?.toLowerCase();
  if (!outgoing || !vault.identities.some((i) => i.publicKey === outgoing)) {
    throw new PersonaSwitchError('notInVault');
  }
  const captured = capturePersona(client);
  if (!isWhole(captured)) throw new PersonaSwitchError('unsynced');
  if (!(await savePersona(vault, outgoing, captured))) {
    throw new PersonaSwitchError('saveFailed');
  }
}

function isWhole(state: PersonaState): boolean {
  return state.channels !== null && state.contacts !== null;
}

/**
 * Puts a persona's key on the radio.
 *
 * @remarks Call with the session already off the outgoing identity
 * (`beginIdentitySwitch`), so nothing the new key receives is filed under the
 * old one. Once the key has landed, re-read the contact table
 * (`resyncContacts`) before applying the persona: the import reloads it from
 * flash, which can drop contacts the firmware had not written yet.
 * @returns true when the radio holds the key; false when it reports the
 * outgoing identity after an exchange that did not settle, so nothing
 * changed; null when it could not be asked — the link is failing, and only
 * the next session can tell.
 * @throws {@link PersonaSwitchError} `keyMismatch` before sending anything.
 * @throws `PrivateKeyError` when the radio refuses the key and keeps its
 * identity.
 */
export async function installPersonaKey(
  client: MeshCoreClient,
  phrase: string,
  target: VaultIdentity,
): Promise<boolean | null> {
  const { privateKey } = await derivePersonaKey(phrase, target);
  return installKey(client, privateKey, target.publicKey);
}

/**
 * Puts a key on the radio and zeroes it, as {@link installPersonaKey} does
 * for a key already known to be the one wanted.
 *
 * @param publicKey - the key's public half, lowercase hex, to tell whether an
 * exchange that did not settle landed it anyway.
 * @returns as for {@link installPersonaKey}.
 * @throws `PrivateKeyError` when the radio refuses the key and keeps its
 * identity.
 */
export async function installKey(
  client: MeshCoreClient,
  privateKey: Uint8Array,
  publicKey: string,
): Promise<boolean | null> {
  try {
    await client.importPrivateKey(privateKey);
  } catch (err) {
    if (err instanceof PrivateKeyError) throw err;
    const asked = await client.refreshSelfInfo().then(
      () => true,
      () => false,
    );
    if (!asked) return null;
    if (client.selfInfo?.pubkey?.toLowerCase() !== publicKey) {
      return false;
    }
  } finally {
    privateKey.fill(0);
  }
  return true;
}

// The vault stores only the public key and index, so the key is re-derived
// from the phrase and checked against the entry before it goes anywhere.
async function derivePersonaKey(
  phrase: string,
  target: VaultIdentity,
): Promise<SeedIdentity> {
  const derived =
    target.index === null
      ? await identityFromMnemonic(phrase)
      : await deriveSubIdentity(phrase, target.index);
  const index = 'index' in derived ? derived.index : null;
  if (toHex(derived.publicKey) !== target.publicKey || index !== target.index) {
    derived.privateKey.fill(0);
    throw new PersonaSwitchError('keyMismatch');
  }
  return derived;
}
