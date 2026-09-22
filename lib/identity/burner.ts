// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { ADVERT_LOC_POLICY } from '@/lib/meshcore/constants';
import {
  deleteBurnerGuard,
  hasBurnerGuard,
  hasRadioRecords,
} from '@/lib/storage';
import { useMeshStore, type PersonaSwitch } from '@/store/meshStore';
import type { PersonaState } from './persona';
import { freshPersona } from './personaSwitch';
import {
  derivePublicKey,
  expandSeed,
  isImportablePublicKey,
  type SeedIdentity,
} from './seed';

/**
 * Burner personas: identities that leave nothing behind in this browser.
 *
 * A linked persona is minted from the recovery phrase and its records are
 * sealed under the phrase's storage root, so the browser profile plus the
 * vault passphrase link every one of them. A burner is the opposite, chosen
 * when it is created and fixed from then on. Its key is drawn at random
 * rather than derived, so neither the phrase nor the vault can say it
 * belonged to anyone, and it is held only in memory for the import. Nothing
 * is written for it — no history, advert cache, preferences, automation
 * rules, secrets, vault entry or persona record — and once the radio is
 * switched away from it the key is gone for good. There is deliberately no
 * way to turn a burner into a linked persona: that would create the linkage
 * after the fact.
 *
 * The one thing written is the guard (`saveBurnerGuard`), an empty record
 * naming no identity, so a page reload while the burner is live does not
 * start saving what it receives. While it exists, the connect flow treats
 * an identity this browser has no records of as the burner. A burner known
 * to be off the radio deletes it.
 *
 * @remarks This protects against personas being tied together by what is
 * stored here, and — through {@link burnerPersona} — by what the radio
 * advertises. It does nothing against traffic analysis: the same hardware,
 * place and airtime habits are there for anyone listening.
 */

const ED25519_SEED_BYTES = 32;

/**
 * Draws a fresh random identity for a burner, redrawing any the firmware
 * would refuse. The caller owns the private key and zeroes it once written.
 */
export async function generateBurnerKey(): Promise<SeedIdentity> {
  for (;;) {
    const seed = crypto.getRandomValues(new Uint8Array(ED25519_SEED_BYTES));
    const privateKey = await expandSeed(seed);
    seed.fill(0);
    const publicKey = derivePublicKey(privateKey);
    if (isImportablePublicKey(publicKey)) return { privateKey, publicKey };
    privateKey.fill(0);
  }
}

/**
 * The persona a burner starts from: its own advert name, no location and
 * location sharing off, only the Public channel, and no contacts — the same
 * as any {@link freshPersona}.
 */
export function burnerPersona(name: string): PersonaState {
  return freshPersona(name);
}

/**
 * Whether the radio state is what a finished {@link burnerPersona} leaves:
 * location sharing off, only the Public channel, and no contacts.
 *
 * @remarks For a burner found after a reload, whose switch may have been cut
 * off before its persona was applied. The name cannot be checked, since the
 * burner's own was never kept: an outgoing persona that already had location
 * sharing off, only the Public channel and no contacts, cut off before the
 * rename, passes with its own name. A contact the radio added by itself since
 * reads as unfinished; finishing then only clears it again.
 */
export function isBurnerShaped(state: PersonaState): boolean {
  const [publicChannel] = burnerPersona('').channels ?? [];
  const [channel, ...others] = state.channels ?? [];
  return (
    state.locationPolicy === ADVERT_LOC_POLICY.NONE &&
    others.length === 0 &&
    channel?.idx === publicChannel?.idx &&
    channel?.secret === publicChannel?.secret &&
    state.contacts?.length === 0
  );
}

/**
 * Whether `name` would repeat one the user's other personas advertise, so a
 * burner using it would be linked to them by name alone. Compared trimmed and
 * case-insensitively.
 *
 * @param taken - the radio's current advert name and the vault's labels.
 */
export function isBurnerNameTaken(
  name: string,
  taken: readonly (string | null | undefined)[],
): boolean {
  const fold = (s: string) => s.trim().normalize('NFKC').toLowerCase();
  const wanted = fold(name);
  return taken.some((t) => t != null && fold(t) === wanted);
}

/**
 * Whether the session just connected as `pubkey` is a burner's, so nothing
 * may be stored for it.
 *
 * @remarks True for the burner this page started. Otherwise true when the
 * guard exists and this browser has no records at all for `pubkey`, which is
 * how a burner looks after a reload — and also how a radio new here looks,
 * which is why that session is marked assumed. A restore or regenerate still
 * being checked is new here by design, and is never taken for one; nor is the
 * target of a switch onto a persona of the vault, whose first session may
 * find its only record, the pending one, already deleted.
 * @returns `'live'` for a burner already known, `'assumed'` for one this call
 * has just inferred, false otherwise.
 */
export async function burnerSession(
  pubkey: string,
): Promise<'live' | 'assumed' | false> {
  const store = useMeshStore.getState();
  if (store.burner?.pubkey === pubkey) return 'live';
  if (store.identityCheck) return false;
  const pending = store.personaSwitch;
  if (pending && !pending.burner && pending.target === pubkey) return false;
  if (!(await hasBurnerGuard()) || (await hasRadioRecords(pubkey))) {
    return false;
  }
  useMeshStore.getState().setBurner({ pubkey, assumed: true });
  return 'assumed';
}

/**
 * Follows a persona switch whose key the radio now holds: a burner coming on
 * becomes the live one, and a burner going off ends, with its guard.
 */
export async function settleLandedSwitch(record: PersonaSwitch): Promise<void> {
  const store = useMeshStore.getState();
  // Stateless, it was rebuilt for an assumed burner rather than recorded by a
  // switch, and nothing about the identity is confirmed until it is finished.
  // Still assumed, then — and again the store's burner, which another
  // identity new here may have taken over since.
  if (record.burner && record.state === null) {
    store.setBurner({ pubkey: record.target, assumed: true });
    return;
  }
  if (record.burner) {
    store.setBurner({ pubkey: record.target, assumed: false });
  } else if (store.burner && store.burner.pubkey === record.outgoing) {
    store.setBurner(null);
    await deleteBurnerGuard();
  }
}

/**
 * Follows a switch onto a burner that left the radio on the outgoing
 * identity: the guard it wrote is dropped, unless a burner is still live.
 */
export async function settleKeptSwitch(record: PersonaSwitch): Promise<void> {
  if (record.burner && !useMeshStore.getState().burner) {
    await deleteBurnerGuard();
  }
}

/**
 * Stops treating an assumed burner as one, for a user who says the identity
 * is a radio new to this browser, along with the offer to finish it as a
 * burner. The session must restart to bind its persistence.
 */
export async function releaseAssumedBurner(): Promise<void> {
  const store = useMeshStore.getState();
  const pubkey = store.burner?.pubkey;
  const pending = store.personaSwitch;
  // Left in place, the restart would read it as a burner switch that landed.
  if (pending?.burner && pending.target === pubkey) {
    store.setPersonaSwitch(null);
  }
  store.setBurner(null);
  await deleteBurnerGuard();
}
