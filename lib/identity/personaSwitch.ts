// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import {
  MAX_ADVERT_NAME_BYTES,
  PUBLIC_CHANNEL_NAME,
  PUBLIC_CHANNEL_SECRET,
} from '@/lib/meshcore/constants';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import { beginIdentitySwitch } from '@/lib/session/persistence';
import { toHex, truncateUtf8 } from '@/lib/utils';
import {
  capturePersona,
  loadPersona,
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
 * A switch is three calls, so the caller can record it between them: first
 * {@link preparePersonaSwitch}, which touches nothing on the radio, then
 * {@link installPersonaKey}, then `applyPersona` with the state the first
 * returned. `CMD_IMPORT_PRIVATE_KEY` takes effect at once, with no reboot, so
 * the session then only has to restart onto the incoming identity to hydrate
 * its browser data.
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
 * persona or the vault could not be written.
 */
export type PersonaSwitchErrorCode =
  'notInVault' | 'phraseMismatch' | 'keyMismatch' | 'saveFailed';

/** Thrown before anything reached the radio. */
export class PersonaSwitchError extends Error {
  constructor(readonly code: PersonaSwitchErrorCode) {
    super(code);
    this.name = 'PersonaSwitchError';
  }
}

/**
 * The persona a newly minted identity starts from: its label as the advert
 * name, no location, only the Public channel and no contacts.
 *
 * @remarks Anything left as the radio has it would be inherited from the
 * outgoing persona, and a new key announcing the old one's name, position,
 * private channels or contact list is linked to it by anyone listening.
 */
export function freshPersona(label: string): PersonaState {
  const name = truncateUtf8(label.trim(), MAX_ADVERT_NAME_BYTES);
  return {
    name: name || null,
    location: { lat: 0, lon: 0 },
    locationPolicy: null,
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
 * Keeps the outgoing persona and works out what the incoming one needs,
 * without sending anything to the radio.
 *
 * @remarks The outgoing persona is captured from the client's mirror and
 * sealed in its record first, so the radio state it leaves behind can be
 * given back later. Pass `capture` false when the radio holds a switch that
 * never finished: its state is then part one persona, part another, and
 * would overwrite the good record.
 * @returns the incoming persona's saved state, or a {@link freshPersona} for
 * an identity that has never been live on this device.
 * @throws {@link PersonaSwitchError} `notInVault` or `saveFailed`.
 */
export async function preparePersonaSwitch(
  client: MeshCoreClient,
  vault: Vault,
  target: VaultIdentity,
  capture: boolean,
): Promise<PersonaState> {
  const outgoing = client.selfInfo?.pubkey?.toLowerCase();
  if (!outgoing || !vault.identities.some((i) => i.publicKey === outgoing)) {
    throw new PersonaSwitchError('notInVault');
  }
  if (capture) {
    const saved = await savePersona(vault, outgoing, capturePersona(client));
    if (!saved) throw new PersonaSwitchError('saveFailed');
  }
  return (
    (await loadPersona(vault, target.publicKey)) ?? freshPersona(target.label)
  );
}

/**
 * Puts a persona's key on the radio, and moves the session off the outgoing
 * identity once the radio holds it.
 *
 * @remarks On success the outgoing identity's records are flushed where they
 * are and persistence is left unbound ({@link beginIdentitySwitch}), and the
 * contact table is re-read: the import reloads it from flash, which can drop
 * contacts the firmware had not written yet.
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
  try {
    await client.importPrivateKey(privateKey);
  } catch (err) {
    if (err instanceof PrivateKeyError) throw err;
    const asked = await client.refreshSelfInfo().then(
      () => true,
      () => false,
    );
    if (!asked) return null;
    if (client.selfInfo?.pubkey?.toLowerCase() !== target.publicKey) {
      return false;
    }
  } finally {
    privateKey.fill(0);
  }
  await beginIdentitySwitch(client, target.publicKey);
  await client.resyncContacts();
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
